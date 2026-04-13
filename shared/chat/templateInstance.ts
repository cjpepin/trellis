/**
 * Shared naming for template instances created from chat or extraction,
 * so the composer prompt and vault filenames stay aligned.
 */

export function stripTemplateTitleForInstance(title: string): string {
  return title
    .replace(/\btemplate\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripTemplateSlugForInstance(slug: string): string {
  return slug
    .replace(/(^|-+)(date|today|iso|iso-date|isodate)(-+|$)/gi, "-")
    .replace(/(^|-+)template(-+|$)/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatTemplateInstanceDateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function titleHasDateMacro(title: string): boolean {
  return /\{\{\s*(?:date|today|iso_date|isodate|iso)\s*\}\}/i.test(title);
}

function expandTemplateTitleDateMacros(title: string, date: Date): string {
  const dateLabel = formatTemplateInstanceDateLabel(date);
  const iso = localIsoDate(date);

  return title.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (full, key: string) => {
    switch (key.toLowerCase()) {
      case "date":
      case "today":
        return dateLabel;
      case "iso_date":
      case "isodate":
      case "iso":
        return iso;
      default:
        return full;
    }
  });
}

export function buildTemplateInstanceTitle(templateTitle: string, date = new Date()): string {
  const hadDateMacro = titleHasDateMacro(templateTitle);
  const expandedTitle = expandTemplateTitleDateMacros(templateTitle, date);
  const base = stripTemplateTitleForInstance(expandedTitle) || "Template Entry";

  if (hadDateMacro) {
    return base;
  }

  return `${base} - ${formatTemplateInstanceDateLabel(date)}`;
}

export function buildTemplateInstanceSlug(
  templateSlug: string,
  sessionId: string,
  date = new Date()
): string {
  const base = stripTemplateSlugForInstance(templateSlug) || "template-entry";
  const iso = date.toISOString().slice(0, 10);
  return `${base}-${iso}-${sessionId.slice(0, 8)}`;
}

/** Match wiki “create from template” body shaping (strip leading H1). */
export function templateBodyWithoutLeadingTitle(content: string): string {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return ["## Notes", "", ""].join("\n");
  }

  return trimmed.replace(/^#\s+.+(?:\n+|$)/, "").trimStart();
}
