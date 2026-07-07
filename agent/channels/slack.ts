import { connectSlackCredentials } from "@vercel/connect/eve";
import {
  Card,
  Image,
  slackChannel,
  defaultSlackAuth,
  type SlackContext,
  type SlackMessage,
} from "eve/channels/slack";
import { record, currentThread, type RecentMessage } from "../lib/recent-memory.js";

// Attributes an inbound Slack message to a human-readable label, falling
// back through the fields eve gives us on `SlackAuthor`.
function authorLabel(author: SlackMessage["author"]): string {
  if (!author) return "someone";
  return author.fullName ?? author.userName ?? `<@${author.userId}>`;
}

// The eve internal `firstNonEmptyLine` isn't exported, so we replicate it
// here to keep the `message.completed` default behavior byte-for-byte.
function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

// Captures an inbound mention/DM into the cross-conversation rolling window
// before dispatch. Fire-and-forget: `record` never throws, but we don't want
// a slow Redis write to delay turn dispatch.
function recordInbound(message: SlackMessage): void {
  const entry: RecentMessage = {
    ts: message.ts,
    channelId: message.channelId,
    threadTs: message.threadTs,
    authorLabel: authorLabel(message.author),
    isPuar: false,
    text: message.markdown || message.text,
  };
  void record(entry);
}

// Slack `ts` is epoch seconds with a microsecond fraction (e.g.
// "1735689600.000200"); eve never converts this for the model, so without this
// the LLM only ever sees the raw string. Rendered in New York time since
// that's the team's home timezone.
const NY_TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "long",
});

function formatSlackTimestamp(ts: string): string {
  return NY_TIMESTAMP_FORMAT.format(new Date(Number(ts) * 1000));
}

// Shared body for the mention/DM hooks. We override the defaults to capture into
// the rolling window and to inject sender name + human-readable time (eve only
// gives the model a raw Slack user id and raw `ts`, deliberately skipping profile
// lookups; `message.author.fullName`/`userName` are already resolved by eve, so
// this needs no extra API call). We restore the "Thinking..." indicator the
// default posts (replacing onAppMention/onDirectMessage replaces both auth AND
// typing), then defer to the default auth derivation. Typing is best-effort: a
// hiccup there must never drop the inbound message.
async function dispatchInbound(ctx: SlackContext, message: SlackMessage) {
  try {
    await ctx.thread.startTyping("Thinking...");
  } catch {
    // best-effort indicator
  }
  recordInbound(message);

  const sender = authorLabel(message.author);
  const senderId = message.author?.userId ? ` (Slack ID ${message.author.userId})` : "";
  const context = [`The sender of this message is ${sender}${senderId}. It was sent at ${formatSlackTimestamp(message.ts)} (New York time).`];

  return { auth: defaultSlackAuth(message, ctx), context };
}

// Slack only auto-unfurls bare, standalone URLs, and treats bot-posted links
// conservatively — so a generated image URL dropped into the reply text renders
// as a link chip, not a picture. Instead, when generate_puar_image finishes, we
// post the result as a native Block Kit image so it always shows inline. The
// model still shares the raw URL in its reply as a fallback for channels that
// don't render image blocks (eve web, etc.).
export default slackChannel({
  credentials: connectSlackCredentials("slack/puar"),

  // Pre-dispatch: capture into the rolling-memory window, then defer to the
  // default auth derivation so dispatch behavior is unchanged.
  onAppMention: dispatchInbound,
  onDirectMessage: dispatchInbound,

  events: {
    async "action.result"(data, channel) {
      const result = data.result;
      if (result?.kind !== "tool-result") return;
      if (result.toolName !== "generate_puar_image") return;

      const output = result.output as { imageUrl?: string; scene?: string } | null;
      if (!output?.imageUrl) return;

      const alt = output.scene ?? "Puar";
      await channel.thread.post({
        card: Card({ children: [Image({ url: output.imageUrl, alt })] }),
        fallbackText: alt,
      });
    },

    // Replicates eve's default `turn.started` (reset typing-throttle state,
    // start the "Working..." indicator) and additionally records the
    // current thread so the rolling-memory store can dedup against it.
    async "turn.started"(_data, channel) {
      channel.state.pendingToolCallMessage = null;
      channel.state.lastReasoningTypingAtMs = null;
      channel.state.lastReasoningTypingStatus = null;
      await channel.thread.startTyping("Working...");

      if (!channel.state.channelId || !channel.state.threadTs) return;
      const channelId = channel.state.channelId;
      const threadTs = channel.state.threadTs;
      currentThread.update(() => ({ channelId, threadTs }));
    },

    // Replicates eve's default `message.completed` (stash pre-tool
    // narration, clear it once the turn resolves, post the reply or start
    // an empty typing indicator) and additionally records Puar's posted
    // reply into the rolling-memory window.
    async "message.completed"(data, channel) {
      if (data.finishReason === "tool-calls") {
        channel.state.pendingToolCallMessage = data.message ? (firstNonEmptyLine(data.message) ?? null) : null;
        return;
      }
      channel.state.pendingToolCallMessage = null;

      if (!data.message) {
        await channel.thread.startTyping();
        return;
      }

      const posted = await channel.thread.post(data.message);
      if (!posted.id || !channel.state.channelId) return;

      const entry: RecentMessage = {
        ts: posted.id,
        channelId: channel.state.channelId,
        threadTs: channel.state.threadTs ?? undefined,
        authorLabel: "Puar",
        isPuar: true,
        text: data.message,
      };
      void record(entry);
    },
  },
});
