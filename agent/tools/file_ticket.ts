import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "../lib/tickets-repo.js";

export default defineTool({
  description:
    "File a ticket as a GitHub issue on Puar's own repo. Use this when Steven " +
    "or Amy asks for a new capability Puar doesn't have, or reports a bug. " +
    "Confirm the title and a one-line description with them before calling.",
  inputSchema: z.object({
    title: z.string().min(3).describe("Short, specific issue title."),
    body: z
      .string()
      .describe("What's being requested and why, in a sentence or two."),
    kind: z
      .enum(["feature", "bug", "idea"])
      .default("feature")
      .describe("The kind of ticket, used to label the issue."),
  }),
  async execute({ title, body, kind }) {
    const token = requireGithubToken("file tickets");

    const labels = ["puar", kind === "feature" ? "feature-request" : kind];
    const res = await fetch(`https://api.github.com/repos/${TICKETS_REPO}/issues`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `GitHub rejected the ticket (${res.status} ${res.statusText}): ${detail}`,
      );
    }

    const issue = (await res.json()) as { number: number; html_url: string };
    return {
      repo: TICKETS_REPO,
      number: issue.number,
      url: issue.html_url,
      title,
      kind,
    };
  },
});
