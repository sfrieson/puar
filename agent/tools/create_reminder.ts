import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "../lib/tickets-repo.js";
import { REMINDER_LABEL, formatReminderBody } from "../lib/reminders.js";
import { currentThread } from "../lib/recent-memory.js";

export default defineTool({
  description:
    "Create a persistent reminder: a GitHub issue labeled 'reminder' on Puar's " +
    "own repo. Puar will nudge about it daily in this Slack channel until told " +
    "it's done (see complete_reminder). This is distinct from file_ticket, which " +
    "is for feature requests or bugs, not personal reminders. Confirm the " +
    "reminder text with the user before calling.",
  inputSchema: z.object({
    text: z
      .string()
      .min(3)
      .describe("What to be reminded of, e.g. 'look for play tickets'."),
    dueDate: z
      .string()
      .optional()
      .describe(
        "Optional due date as ISO YYYY-MM-DD. Resolve relative phrases like " +
          "'next Friday' to an ISO date using the current date before calling.",
      ),
  }),
  async execute({ text, dueDate }) {
    const token = requireGithubToken("set reminders");

    // Nudges land in whatever Slack channel this reminder was created from.
    // Created outside Slack (e.g. no live thread), there's nowhere to nag, so
    // the reminder is still saved but won't be nudged about.
    const channelId = currentThread.get()?.channelId;

    const res = await fetch(`https://api.github.com/repos/${TICKETS_REPO}/issues`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: text,
        body: formatReminderBody(text, { channelId, dueDate }),
        labels: ["puar", REMINDER_LABEL],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `GitHub rejected the reminder (${res.status} ${res.statusText}): ${detail}`,
      );
    }

    const issue = (await res.json()) as { number: number; html_url: string };
    return {
      repo: TICKETS_REPO,
      number: issue.number,
      url: issue.html_url,
      title: text,
      dueDate: dueDate ?? null,
      // False when there's no channel to nudge in; Puar should tell the user
      // it can only nag from Slack in that case.
      willNag: Boolean(channelId),
    };
  },
});
