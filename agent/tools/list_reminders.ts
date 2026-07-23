import { defineTool } from "eve/tools";
import { z } from "zod";
import { TICKETS_REPO } from "../lib/tickets-repo.js";
import { listOpenReminders } from "../lib/reminders.js";

export default defineTool({
  description:
    "List the currently open reminders. Use this to answer 'what are my " +
    "reminders?' or to find a reminder's issue number before closing it with " +
    "complete_reminder.",
  inputSchema: z.object({}),
  async execute() {
    const reminders = await listOpenReminders();

    return {
      repo: TICKETS_REPO,
      count: reminders.length,
      // channelId and body are internal (nagging plumbing / metadata comment)
      // and stay out of the model-visible output.
      reminders: reminders.map((r) => ({
        number: r.number,
        title: r.title,
        url: r.url,
        dueDate: r.dueDate ?? null,
      })),
    };
  },
});
