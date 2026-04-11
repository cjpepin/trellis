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

export function buildTemplateInstanceTitle(templateTitle: string, date = new Date()): string {
  const base = stripTemplateTitleForInstance(templateTitle) || "Template Entry";
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
