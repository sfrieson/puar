// Repo that Puar files its own feature requests / bugs against, and searches
// when checking whether a ticket already exists. Override with
// PUAR_TICKETS_REPO ("owner/repo"); defaults to Puar's own repo.
export const TICKETS_REPO = process.env.PUAR_TICKETS_REPO ?? "sfrieson/puar";

// Reads GITHUB_TOKEN or throws a message the model can relay to the user.
// `action` fills in what Puar was trying to do, e.g. "file tickets".
export function requireGithubToken(action: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      `GITHUB_TOKEN is not set, so I can't ${action} yet. Add a token with ` +
        "'repo' (or issues) scope to the environment.",
    );
  }
  return token;
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
