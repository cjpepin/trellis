import { formatTemplateInstanceDateLabel } from "./templateInstance";

const TOKEN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export type TemplateMacroContext = {
  /** Title of the new note being created (wiki prompt value). */
  instanceTitle: string;
  /** Title of the template note. */
  templateTitle: string;
  /** Clock used for date and time values (inject in tests). */
  now: Date;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function localYmd(d: Date): { y: number; iso: string } {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return { y, iso: `${y}-${m}-${day}` };
}

function buildMacroMap(ctx: TemplateMacroContext): Map<string, string> {
  const d = ctx.now;
  const { iso } = localYmd(d);
  const prettyDate = formatTemplateInstanceDateLabel(d);

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(d);

  const datetime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(d);

  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(d);
  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long" }).format(d);
  const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" }).format(d);

  const y = d.getFullYear();
  const monthNum = pad2(d.getMonth() + 1);
  const dayNum = pad2(d.getDate());

  const map = new Map<string, string>();

  const set = (key: string, value: string): void => {
    map.set(key.toLowerCase(), value);
  };

  set("date", prettyDate);
  set("today", prettyDate);

  set("iso_date", iso);
  set("isodate", iso);
  set("iso", iso);

  set("time", time);
  set("datetime", datetime);
  set("timestamp", d.toISOString());

  set("year", String(y));
  set("month", monthNum);
  set("day", dayNum);

  set("weekday", weekday);
  set("weekday_short", weekdayShort);
  set("month_name", monthName);
  set("month_short", monthShort);

  set("title", ctx.instanceTitle);
  set("template_title", ctx.templateTitle);

  return map;
}

/**
 * Replaces `{{token}}` placeholders in template body text when creating a note from a template.
 * Unknown tokens are left unchanged. Matching is case-insensitive on the token name.
 */
export function expandTemplateMacros(text: string, ctx: TemplateMacroContext): string {
  const map = buildMacroMap(ctx);
  return text.replace(TOKEN, (full, rawKey: string) => {
    const value = map.get(String(rawKey).toLowerCase());
    return value !== undefined ? value : full;
  });
}

/** Reference for template authors (Templates UI, starter markdown). */
export const templateMacroReference: ReadonlyArray<{
  macro: string;
  aliases?: readonly string[];
  description: string;
}> = [
  {
    macro: "{{date}}",
    aliases: ["{{today}}"],
    description: "Today's date in your locale (same style as dated template instances)."
  },
  {
    macro: "{{iso_date}}",
    aliases: ["{{iso}}"],
    description: "Local calendar date as YYYY-MM-DD (good for sorting and daily logs)."
  },
  { macro: "{{time}}", description: "Current time in your locale." },
  { macro: "{{datetime}}", description: "Date and time together (locale medium + short time)." },
  {
    macro: "{{timestamp}}",
    description: "Precise instant as ISO-8601 UTC (handy for one-line log stamps)."
  },
  { macro: "{{year}}", description: "Four-digit calendar year (local)." },
  { macro: "{{month}}", description: "Month number 01–12 (local)." },
  { macro: "{{day}}", description: "Day of month 01–31 (local)." },
  { macro: "{{weekday}}", description: "Weekday name (e.g. Saturday)." },
  { macro: "{{weekday_short}}", description: "Abbreviated weekday." },
  { macro: "{{month_name}}", description: "Full month name." },
  { macro: "{{month_short}}", description: "Short month name." },
  {
    macro: "{{title}}",
    description: "The new note’s title (what you typed when creating the note)."
  },
  { macro: "{{template_title}}", description: "The template note’s title." }
];

/**
 * If `textBefore` ends with an unfinished `{{ ...` macro (no closing `}}` before the cursor),
 * returns the length of that suffix and the inner query text.
 */
export function matchTemplateMacroInTextBefore(textBefore: string): {
  fullLength: number;
  query: string;
} | null {
  const match = textBefore.match(/\{\{([^}]*)$/);
  if (!match) {
    return null;
  }

  const full = match[0];
  return {
    fullLength: full.length,
    query: match[1] ?? ""
  };
}
