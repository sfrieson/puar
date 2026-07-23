import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "../lib/tickets-repo.js";
import { REMINDER_LABEL } from "../lib/reminders.js";

export default defineTool({
  description:
    "Close an open reminder when the user says it's handled or done, which " +
    "stops the daily nagging. Confirm the right one with the user first — use " +
    "list_reminders if unsure of the issue number.",
  inputSchema: z.object({
    number: z
      .number()
      .int()
      .positive()
      .describe("The reminder's GitHub issue number."),
  }),
  async execute({ number }) {
    const token = requireGithubToken("close reminders");

    const getRes = await fetch(
      `https://api.github.com/repos/${TICKETS_REPO}/issues/${number}`,
      { headers: githubHeaders(token) },
    );
    if (!getRes.ok) {
      const detail = await getRes.text();
      throw new Error(
        `GitHub rejected the lookup for issue #${number} (${getRes.status} ${getRes.statusText}): ${detail}`,
      );
    }

    const issue = (await getRes.json()) as {
      title: string;
      labels: Array<{ name: string } | string>;
      state: string;
    };
    const labels = issue.labels.map((label) =>
      typeof label === "string" ? label : label.name,
    );
    if (!labels.includes(REMINDER_LABEL)) {
      throw new Error(
        `Issue #${number} isn't a reminder (missing the '${REMINDER_LABEL}' label), so I won't close it here.`,
      );
    }

    const patchRes = await fetch(
      `https://api.github.com/repos/${TICKETS_REPO}/issues/${number}`,
      {
        method: "PATCH",
        headers: { ...githubHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed" }),
      },
    );
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      throw new Error(
        `GitHub rejected closing issue #${number} (${patchRes.status} ${patchRes.statusText}): ${detail}`,
      );
    }

    return {
      repo: TICKETS_REPO,
      number,
      title: issue.title,
      closed: true,
    };
  },
});
