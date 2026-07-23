import { defineDynamic, defineInstructions } from "eve/instructions";

// Formats "now" in New York time, the team's home timezone. Mirrors
// NY_TIMESTAMP_FORMAT in agent/channels/slack.ts. Injected every turn so Puar
// always knows the current date/time — including on schedule-driven nag turns,
// which carry no inbound message timestamp — and can prioritize time-urgent
// requests and flag overdue reminders.
const NY_NOW_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "full",
  timeStyle: "long",
});

export default defineDynamic({
  events: {
    "turn.started": async () => {
      const now = NY_NOW_FORMAT.format(new Date());
      return defineInstructions({
        markdown:
          `# Current time\n\nThe current date and time is **${now}** (New York time). ` +
          `Use this to prioritize time-urgent requests and to judge whether a ` +
          `reminder's due date has passed.`,
      });
    },
  },
});
