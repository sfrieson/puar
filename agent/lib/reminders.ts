// Reminders are GitHub issues labeled `reminder` on Puar's repo. Puar creates
// them when Steven or Amy asks to be reminded of something, a daily schedule
// (agent/schedules/reminders.ts) re-pings the origin Slack channel for every
// open reminder that's due today, and closing the issue stops the nagging.
// This mirrors the tickets-as-storage pattern in tickets-repo.ts and reuses
// its helpers.
import {
  TICKETS_REPO,
  requireGithubToken,
  githubHeaders,
} from "./tickets-repo.js";

export const REMINDER_LABEL = "reminder";

// How often a reminder nags. Daily is the default and the only cadence that
// existed before weekly was added, so reminders with no stored frequency are
// read as daily.
export type ReminderFrequency = "daily" | "weekly";

// Indexed to match Date#getDay / Intl's "long" weekday, lowercased.
export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// Today's weekday in New York, the team's home timezone. The nag cron fires at
// 15:00 UTC, which is the same calendar day in New York year-round, so a
// UTC-scheduled job can safely ask "what day is it there?". Mirrors the
// Intl usage in agent/instructions/current-time.ts.
const NY_WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
});

export function nycWeekday(date: Date = new Date()): Weekday {
  return NY_WEEKDAY_FORMAT.format(date).toLowerCase() as Weekday;
}

// Metadata Puar needs to nag but shouldn't clutter the human-readable body:
// where to deliver the nag (channelId), an optional due date to escalate on,
// and the nag cadence (dayOfWeek is only meaningful when weekly).
export interface ReminderMeta {
  channelId?: string;
  dueDate?: string;
  frequency?: ReminderFrequency;
  dayOfWeek?: Weekday;
}

// Stored as a single HTML comment at the end of the issue body so it survives
// round-trips through the GitHub API while staying unobtrusive in the UI.
const META_PREFIX = "puar-reminder:";
const META_RE = /<!--\s*puar-reminder:\s*(\{[\s\S]*?\})\s*-->/u;

// Builds the issue body: the reminder text, a human-readable Due line when a
// due date is set, a Repeats line for weekly reminders, then the
// machine-readable metadata comment.
export function formatReminderBody(text: string, meta: ReminderMeta): string {
  const parts = [text.trim()];
  if (meta.dueDate) parts.push(`\nDue: ${meta.dueDate}`);
  if (meta.frequency === "weekly") {
    const day = meta.dayOfWeek;
    parts.push(
      `\nRepeats: weekly${day ? ` on ${day[0].toUpperCase()}${day.slice(1)}s` : ""}`,
    );
  }
  const json = JSON.stringify({
    ...(meta.channelId ? { channelId: meta.channelId } : {}),
    ...(meta.dueDate ? { dueDate: meta.dueDate } : {}),
    ...(meta.frequency ? { frequency: meta.frequency } : {}),
    ...(meta.dayOfWeek ? { dayOfWeek: meta.dayOfWeek } : {}),
  });
  parts.push(`\n<!-- ${META_PREFIX} ${json} -->`);
  return parts.join("\n");
}

// Tolerant parse: returns {} when the comment is missing or unparseable so a
// hand-edited or legacy reminder never breaks listing.
export function parseReminderMeta(body: string | null): ReminderMeta {
  if (!body) return {};
  const match = body.match(META_RE);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]) as ReminderMeta;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export interface OpenReminder {
  number: number;
  title: string;
  url: string;
  channelId?: string;
  dueDate?: string;
  frequency: ReminderFrequency;
  dayOfWeek?: Weekday;
  body: string;
}

// Whether today's nag sweep should nudge about this reminder. Daily reminders
// always nag; weekly ones only on their day. A weekly reminder missing its
// dayOfWeek (hand-edited or malformed metadata) falls back to nagging — better
// to over-nag than to go silent forever.
export function shouldNagToday(opts: {
  reminder: OpenReminder;
  today: Weekday;
}): boolean {
  const { reminder, today } = opts;
  if (reminder.frequency !== "weekly") return true;
  if (!reminder.dayOfWeek) return true;
  return reminder.dayOfWeek === today;
}

// Lists all open issues labeled `reminder` on Puar's repo, parsing the
// per-reminder metadata. Filters out pull requests, which the issues endpoint
// also returns. Used by list_reminders (tool) and the daily nag schedule.
export async function listOpenReminders(): Promise<OpenReminder[]> {
  const token = requireGithubToken("check reminders");

  const url = new URL(
    `https://api.github.com/repos/${TICKETS_REPO}/issues`,
  );
  url.searchParams.set("labels", REMINDER_LABEL);
  url.searchParams.set("state", "open");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("sort", "created");
  url.searchParams.set("direction", "asc");

  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `GitHub rejected the reminder list (${res.status} ${res.statusText}): ${detail}`,
    );
  }

  const data = (await res.json()) as Array<{
    number: number;
    title: string;
    html_url: string;
    body: string | null;
    pull_request?: unknown;
  }>;

  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => {
      const meta = parseReminderMeta(issue.body);
      return {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        channelId: meta.channelId,
        dueDate: meta.dueDate,
        // Reminders created before weekly existed have no stored frequency.
        frequency: meta.frequency ?? "daily",
        dayOfWeek: meta.dayOfWeek,
        body: issue.body ?? "",
      };
    });
}
