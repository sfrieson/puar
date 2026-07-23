import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack.js";
import { listOpenReminders } from "../lib/reminders.js";

export default defineSchedule({
  // 11am America/New_York. Vercel/eve evaluate cron in UTC with no timezone
  // option, so this is 11am EDT (summer) / 10am EST (winter) — fine for a
  // daily nudge.
  cron: "0 15 * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(
      (async () => {
        const reminders = await listOpenReminders();
        await Promise.all(
          reminders.map((r) => {
            if (!r.channelId) return; // no origin channel -> can't nag
            const due = r.dueDate
              ? ` It has a due date of ${r.dueDate}; if that date has passed, nag more urgently and note it's overdue.`
              : "";
            return receive(slack, {
              message:
                `Post a short, friendly Slack nudge reminding about this still-open ` +
                `reminder (#${r.number}): "${r.title}".${due} Keep it to one line. Tell them ` +
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
