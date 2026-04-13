import { templateInstanceFillSystemPrompt } from "../../../supabase/functions/_shared/prompts";
import {
  buildTemplateInstanceTitle,
  templateBodyWithoutLeadingTitle
} from "../../../shared/chat/templateInstance";
import { expandTemplateMacros, type TemplateMacroContext } from "../../../shared/chat/templateMacros";
import { runEmbeddedChatPrompt } from "./embeddedCompletion";
import { isEmbeddedModelAvailable } from "./embeddedModelPath";
import { stripLeadingMarkdownFence } from "./noteInsertionMarkdown";

const maxTemplateChars = 24_000;
const maxMessageChars = 12_000;
const maxBodyChars = 100_000;

function truncate(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }

  return `${input.slice(0, max)}\n\n…`;
}

function templateMacroContext(templateTitle: string, now: Date): TemplateMacroContext {
  return {
    instanceTitle: buildTemplateInstanceTitle(templateTitle, now),
    templateTitle,
    now
  };
}

/** Applies Trellis `{{token}}` substitution so the model sees concrete dates and titles. */
function expandTemplateBodyForInstance(templateTitle: string, bodyMarkdown: string, now: Date): string {
  return expandTemplateMacros(bodyMarkdown, templateMacroContext(templateTitle, now));
}

/**
 * User messages only — assistant turns are omitted so the model cannot treat generic assistant
 * suggestions as user-provided facts when filling the template.
 */
function formatUserAnswersForPrompt(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const blocks = transcript
    .filter((message) => message.role === "user")
    .map((message) => truncate(message.content.trim(), maxMessageChars))
    .filter((text) => text.length > 0);

  if (blocks.length === 0) {
    return "(no user answers)";
  }

  return blocks
    .map((text, index) => {
      return `### User answer ${index + 1}\n\n${text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * When the embedded model is unavailable or fails, append only the user’s messages as plain
 * paragraphs—no role headings—so the vault does not read like a labeled chat export.
 */
export function buildDeterministicTemplateFillBody(
  templateCtx: { title: string; content: string },
  transcript: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { now?: Date }
): string {
  const now = options?.now ?? new Date();
  const base = expandTemplateBodyForInstance(
    templateCtx.title,
    templateBodyWithoutLeadingTitle(templateCtx.content),
    now
  );
  const userParts = transcript
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter((text) => text.length > 0);

  const userBlock = userParts.join("\n\n");

  if (userBlock.length === 0) {
    return truncate(base, maxBodyChars);
  }

  return truncate(`${base}\n\n---\n\n${userBlock}`, maxBodyChars);
}

export async function trySynthesizeTemplateInstanceMarkdown(input: {
  templateTitle: string;
  templateContent: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  now?: Date;
}): Promise<string | null> {
  if (!(await isEmbeddedModelAvailable())) {
    return null;
  }

  const now = input.now ?? new Date();
  const base = truncate(
    expandTemplateBodyForInstance(
      input.templateTitle,
      templateBodyWithoutLeadingTitle(input.templateContent),
      now
    ),
    maxTemplateChars
  );
  const userAnswersBlock = formatUserAnswersForPrompt(input.transcript);

  const userPrompt = [
    "## Template title",
    input.templateTitle.trim(),
    "",
    "## Template structure (place the user’s answers here; keep labels/headings)",
    base.trim().length > 0 ? base.trim() : "(empty template body)",
    "",
    "## User answers (source of truth — use this text faithfully; do not invent details)",
    userAnswersBlock,
    "",
    "Write ONLY the completed markdown note body. Every substantive line should come from the user answers above or from resolved template macros."
  ].join("\n");

  try {
    const raw = await runEmbeddedChatPrompt({
      systemPrompt: templateInstanceFillSystemPrompt,
      userPrompt,
      maxTokens: 4096,
      temperature: 0.12
    });

    const stripped = stripLeadingMarkdownFence(raw);
    if (stripped.trim().length < 12) {
      return null;
    }

    return truncate(stripped.trim(), maxBodyChars);
  } catch {
    return null;
  }
}
