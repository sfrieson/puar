// Reminders are GitHub issues labeled `reminder` on Puar's repo. Puar creates
// them when Steven or Amy asks to be reminded of something, a daily schedule
// (agent/schedules/reminders.ts) re-pings the origin Slack channel for every
// open reminder, and closing the issue stops the nagging. This mirrors the
// tickets-as-storage pattern in tickets-repo.ts and reuses its helpers.
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "./tickets-repo.js";

export const REMINDER_LABEL = "reminder";

// Metadata Puar needs to nag but shouldn't clutter the human-readable body:
// where to deliver the nag (channelId) and an optional due date to escalate on.
export interface ReminderMeta {
  channelId?: string;
  dueDate?: string;
}

// Stored as a single HTML comment at the end of the issue body so it survives
// round-trips through the GitHub API while staying unobtrusive in the UI.
const META_PREFIX = "puar-reminder:";
const META_RE = /<!--\s*puar-reminder:\s*(\{[\s\S]*?\})\s*-->/u;

// Builds the issue body: the reminder text, a human-readable Due line when a
// due date is set, then the machine-readable metadata comment.
export function formatReminderBody(text: string, meta: ReminderMeta): string {
  const parts = [text.trim()];
  if (meta.dueDate) parts.push(`\nDue: ${meta.dueDate}`);
  const json = JSON.stringify({
    ...(meta.channelId ? { channelId: meta.channelId } : {}),
    ...(meta.dueDate ? { dueDate: meta.dueDate } : {}),
  });
  parts.push(`\n<!-- ${META_PREFIX} ${json} -->`);
  return parts.join("\n");
}

// Tolerant parse: returns {} when the comment is missing or unparseable so a
// hand-edited or legacy reminder never breaks listing.
export function parseReminderMeta(body: string | null): ReminderMeta {
  if (!body) return {};
  const match = body.match(META_RE);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]) as ReminderMeta;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export interface OpenReminder {
  number: number;
  title: string;
  url: string;
  channelId?: string;
  dueDate?: string;
  body: string;
}

// Lists all open issues labeled `reminder` on Puar's repo, parsing the
// per-reminder metadata. Filters out pull requests, which the issues endpoint
// also returns. Used by list_reminders (tool) and the daily nag schedule.
export async function listOpenReminders(): Promise<OpenReminder[]> {
  const token = requireGithubToken("check reminders");

  const url = new URL(
    `https://api.github.com/repos/${TICKETS_REPO}/issues`,
  );
  url.searchParams.set("labels", REMINDER_LABEL);
  url.searchParams.set("state", "open");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("sort", "created");
  url.searchParams.set("direction", "asc");

  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `GitHub rejected the reminder list (${res.status} ${res.statusText}): ${detail}`,
    );
  }

  const data = (await res.json()) as Array<{
    number: number;
    title: string;
    html_url: string;
    body: string | null;
    pull_request?: unknown;
  }>;

  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => {
      const meta = parseReminderMeta(issue.body);
      return {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        channelId: meta.channelId,
        dueDate: meta.dueDate,
        body: issue.body ?? "",
      };
    });
}
