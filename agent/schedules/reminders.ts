import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack.js";
import {
  listOpenReminders,
  nycWeekday,
  shouldNagToday,
} from "../lib/reminders.js";

export default defineSchedule({
  // 11am America/New_York. Vercel/eve evaluate cron in UTC with no timezone
  // option, so this is 11am EDT (summer) / 10am EST (winter) — fine for a
  // daily nudge. Runs every day; weekly reminders are filtered out on the days
  // they aren't due, so there's no second cron to keep in sync.
  cron: "0 15 * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(
      (async () => {
        const reminders = await listOpenReminders();
        const today = nycWeekday();
        await Promise.all(
          reminders.map((r) => {
            if (!r.channelId) return; // no origin channel -> can't nag
            if (!shouldNagToday({ reminder: r, today })) return; // not its day
            const due = r.dueDate
              ? ` It has a due date of ${r.dueDate}; if that date has passed, nag more urgently and note it's overdue.`
              : "";
            const cadence =
              r.frequency === "weekly"
                ? " This is a weekly reminder, so frame it as a weekly check-in."
                : "";
            return receive(slack, {
              message:
                `Post a short, friendly Slack nudge reminding about this still-open ` +
                `reminder (#${r.number}): "${r.title}".${due}${cadence} Keep it to one line. Tell them ` +
                `to let you know when it's handled so you can close it. Do not use any tools.`,
              target: { channelId: r.channelId },
              auth: appAuth,
            }).catch((err) => {
              console.error("reminder nag failed", r.number, err);
            });
          }),
        );
      })(),
    );
  },
});
