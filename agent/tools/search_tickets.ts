import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "../lib/tickets-repo.js";

export default defineTool({
  description:
    "Search or list GitHub issues (tickets) on Puar's own repo. Use this to check " +
    "whether a feature request or bug already has a ticket before filing a new one " +
    "with file_ticket, or to look up the status of existing tickets.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Free-text search matched against issue titles and bodies (e.g. 'dark mode'). Omit to just list issues.",
      ),
    state: z
      .enum(["open", "closed", "all"])
      .default("open")
      .describe("Filter by issue state."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Max issues to return."),
  }),
  async execute({ query, state, limit }) {
    const token = requireGithubToken("read tickets");

    const qParts = [`repo:${TICKETS_REPO}`, "is:issue"];
    if (state !== "all") qParts.push(`is:${state}`);
    if (query) qParts.push(query);

    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", qParts.join(" "));
    url.searchParams.set("per_page", String(limit));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");

    const res = await fetch(url, { headers: githubHeaders(token) });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `GitHub rejected the search (${res.status} ${res.statusText}): ${detail}`,
      );
    }

    const data = (await res.json()) as {
      total_count: number;
      items: Array<{
        number: number;
        title: string;
        html_url: string;
        state: string;
        labels: Array<{ name: string } | string>;
        body: string | null;
        updated_at: string;
      }>;
    };

    return {
      repo: TICKETS_REPO,
      query: query ?? null,
      totalCount: data.total_count,
      issues: data.items.map((issue) => ({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
        labels: issue.labels.map((label) =>
          typeof label === "string" ? label : label.name,
        ),
        summary: issue.body ? issue.body.slice(0, 300) : null,
        updatedAt: issue.updated_at,
      })),
    };
  },
});
