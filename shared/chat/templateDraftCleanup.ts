/**
 * Removes common assistant chat framing from template markdown so saved templates
 * contain only the reusable structure (headings, tables, prompts).
 */

const HR = "\n---\n";

function hasMarkdownHeading(text: string): boolean {
  return /^#{1,6}\s+\S/m.test(text);
}

/** True when the first non-empty line looks like assistant sign-off / upsell, not template body. */
function firstLineLooksLikeAssistantChatter(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) {
    return false;
  }
  // Offer to extend, customize, or close the chat — not a section heading or table row.
  return (
    /^(If you want|Let me know|Would you like|I can (also|help|make)|Hope this|Feel free|That would|Tell me if|I'?m happy to|Anything else|Want me to|Need anything|Is there anything)/i.test(
      t
    ) ||
    /^(Does that help|Does this\b)/i.test(t) ||
    /^(I(?:'|’)?m|I am)\s+(?:adding|saving|creating|setting)\b/i.test(t) ||
    /^You can now\b/i.test(t)
  );
}

/**
 * Drop intro paragraphs and horizontal rules that appear before the first markdown heading.
 */
function stripLeadingBeforeFirstHeading(markdown: string): string {
  const lines = markdown.split("\n");
  let start = 0;

  for (; start < lines.length; start += 1) {
    const line = lines[start];
    if (line !== undefined && /^#{1,6}\s+\S/.test(line)) {
      break;
    }
  }

  if (start === 0 || start >= lines.length) {
    return markdown;
  }

  // Avoid stripping huge paste jobs that never use headings.
  if (start > 40) {
    return markdown;
  }

  return lines.slice(start).join("\n");
}

/**
 * Remove a trailing `---` block when everything after it has no headings and reads like chat wrap-up.
 */
function stripTrailingAfterHorizontalRule(markdown: string): string {
  let idx = markdown.lastIndexOf(HR);
  if (idx === -1) {
    return markdown;
  }

  const tail = markdown.slice(idx + HR.length);
  if (hasMarkdownHeading(tail)) {
    return markdown;
  }

  const firstLine = tail.split("\n").find((l) => l.trim().length > 0) ?? "";
  if (!firstLineLooksLikeAssistantChatter(firstLine)) {
    return markdown;
  }

  return markdown.slice(0, idx).trimEnd();
}

/**
 * Remove a final paragraph that is clearly assistant chatter (no heading in that paragraph).
 */
function stripTrailingChatterParagraph(markdown: string): string {
  const blocks = markdown.trimEnd().split(/\n{2,}/);
  if (blocks.length < 2) {
    return markdown;
  }

  const last = blocks[blocks.length - 1] ?? "";
  if (hasMarkdownHeading(last)) {
    return markdown;
  }

  const firstLine = last.split("\n").find((l) => l.trim().length > 0) ?? "";
  if (!firstLineLooksLikeAssistantChatter(firstLine)) {
    return markdown;
  }

  return blocks.slice(0, -1).join("\n\n").trimEnd();
}

/**
 * Strips leading assistant intro and trailing offers / sign-offs from chat-produced template drafts.
 */
export function stripAssistantTemplateDraftMarkdown(markdown: string): string {
  let out = markdown.trim();
  if (out.length === 0) {
    return out;
  }

  out = stripLeadingBeforeFirstHeading(out);
  out = stripTrailingAfterHorizontalRule(out);
  out = stripTrailingChatterParagraph(out);
  // Second pass: model may nest another `---` + chatter after the first strip.
  out = stripTrailingAfterHorizontalRule(out);
  out = stripTrailingChatterParagraph(out);

  return out.trim();
}
