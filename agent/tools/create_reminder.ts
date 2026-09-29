import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "../lib/tickets-repo.js";
import {
  REMINDER_LABEL,
  WEEKDAYS,
  formatReminderBody,
  nycWeekday,
} from "../lib/reminders.js";
import { currentThread } from "../lib/recent-memory.js";

export default defineTool({
  description:
    "Create a persistent reminder: a GitHub issue labeled 'reminder' on Puar's " +
    "own repo. Puar will nudge about it in this Slack channel — daily by " +
    "default, or once a week if asked — until told it's done (see " +
    "complete_reminder). This is distinct from file_ticket, which is for " +
    "feature requests or bugs, not personal reminders. Confirm the reminder " +
    "text with the user before calling.",
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
    frequency: z
      .enum(["daily", "weekly"])
      .default("daily")
      .describe(
        "How often to nudge. Infer from the user's phrasing — 'weekly', 'once " +
          "a week' or 'every Monday' is weekly; anything else defaults to " +
          "daily. Only ask if it's genuinely unclear.",
      ),
    dayOfWeek: z
      .enum(WEEKDAYS)
      .optional()
      .describe(
        "Weekly reminders only: which day to nudge on, when the user names one " +
          "('every Monday'). Defaults to today's weekday. Ignored for daily.",
      ),
  }),
  async execute({ text, dueDate, frequency, dayOfWeek }) {
    const token = requireGithubToken("set reminders");

    // Nudges land in whatever Slack channel this reminder was created from.
    // Created outside Slack (e.g. no live thread), there's nowhere to nag, so
    // the reminder is still saved but won't be nudged about.
    const channelId = currentThread.get()?.channelId;

    // Only weekly reminders carry a day, so a stale dayOfWeek can never sit in
    // metadata contradicting a daily cadence. Unspecified means "same weekday
    // it was set on".
    const nagDay =
      frequency === "weekly" ? (dayOfWeek ?? nycWeekday()) : undefined;

    const res = await fetch(`https://api.github.com/repos/${TICKETS_REPO}/issues`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: text,
        body: formatReminderBody(text, {
          channelId,
          dueDate,
          frequency,
          dayOfWeek: nagDay,
        }),
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
      // Echoed back so Puar confirms the cadence it actually stored, including
      // the weekday it defaulted to.
      frequency,
      dayOfWeek: nagDay ?? null,
      // False when there's no channel to nudge in; Puar should tell the user
      // it can only nag from Slack in that case.
      willNag: Boolean(channelId),
    };
  },
});
