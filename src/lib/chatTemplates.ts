import type { NoteSummary, WikiNote } from "@electron/ipc/types";
import {
  buildTemplateInstanceTitle as buildTemplateInstanceTitleShared,
  templateBodyWithoutLeadingTitle
} from "../../shared/chat/templateInstance";

export const templateTag = "template";

export function isTemplateNote(note: Pick<NoteSummary, "tags">): boolean {
  return note.tags.some((tag) => tag.trim().toLowerCase() === templateTag);
}

export function buildTemplateInstanceTitle(templateTitle: string, date = new Date()): string {
  return buildTemplateInstanceTitleShared(templateTitle, date);
}

export function buildTemplateUsePrompt(templateTitle: string): string {
  const instanceTitle = buildTemplateInstanceTitle(templateTitle);

  return [
    `Use [[${templateTitle}]] as the template for a new note titled "${instanceTitle}".`,
    "Ask me focused follow-up questions when a section is missing, and keep the note organized with the template's structure as we talk.",
    "",
    "My first entry:"
  ].join("\n");
}

export function buildTemplateCreationPrompt(description: string): string {
  return [
    `Help me create a reusable Trellis template for ${description.trim()}.`,
    "Include a clear markdown structure and the prompts you should ask me when I use it, so Trellis can save it as a reusable template note."
  ].join("\n");
}

/** Starter markdown for a new template note (vault `wiki/templates/`, tag `template`). */
export function defaultNewTemplateMarkdown(title: string): string {
  return [
    `# ${title}`,
    "",
    "## Prompt",
    "",
    "Use this structure to ask focused questions and keep the final note consistent.",
    "",
    "## Notes",
    "",
    "- "
  ].join("\n");
}

export function buildNoteContentFromTemplate(template: Pick<WikiNote, "content" | "title">): string {
  return templateBodyWithoutLeadingTitle(template.content);
}
