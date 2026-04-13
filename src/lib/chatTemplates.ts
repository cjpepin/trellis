import type { NoteSummary, WikiNote } from "@electron/ipc/types";
import {
  buildTemplateInstanceTitle as buildTemplateInstanceTitleShared,
  templateBodyWithoutLeadingTitle
} from "../../shared/chat/templateInstance";
import { expandTemplateMacros, templateMacroReference } from "../../shared/chat/templateMacros";
import { stripAssistantTemplateDraftMarkdown } from "../../shared/chat/templateDraftCleanup";

export const templateTag = "template";

export { stripAssistantTemplateDraftMarkdown, templateMacroReference };

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
    "Trellis should create that note instance now and keep updating the same note from my answers; do not ask for a separate save review.",
    "Substitute Trellis macros in the template (such as {{date}}, {{title}}, {{iso_date}}) with their real values for this instance—do not ask me for those.",
    "Ask me focused follow-up questions when a section is missing, and keep the note organized with the template's structure as we talk.",
    "",
    "My first entry:"
  ].join("\n");
}

export function buildTemplateCreationPrompt(description: string): string {
  return [
    `Help me create a reusable Trellis template for ${description.trim()}.`,
    "Include a clear markdown structure and the prompts you should ask me when I use it, so Trellis can show it as an editable reusable template draft.",
    "You may use placeholders such as {{date}}, {{iso_date}}, and {{title}} where the final note should insert the current date or the new note's title when someone creates a note from this template."
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
    "## Macros",
    "",
    "When someone creates a note from this template, Trellis fills placeholders like `{{date}}`, `{{iso_date}}`, and `{{title}}`. Open **Templates** in the app for the full list.",
    "",
    "## Notes",
    "",
    "- "
  ].join("\n");
}

export function buildNoteContentFromTemplate(
  template: Pick<WikiNote, "content" | "title">,
  options?: { instanceTitle: string; now?: Date }
): string {
  const body = templateBodyWithoutLeadingTitle(template.content);
  return expandTemplateMacros(body, {
    instanceTitle: options?.instanceTitle ?? "",
    templateTitle: template.title,
    now: options?.now ?? new Date()
  });
}
