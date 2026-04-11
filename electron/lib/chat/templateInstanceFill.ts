import { templateInstanceFillSystemPrompt } from "../../../supabase/functions/_shared/prompts";
import { templateBodyWithoutLeadingTitle } from "../../../shared/chat/templateInstance";
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

/**
 * Internal transcript formatting for the model (not shown to the user). Numbered blocks avoid
 * "User:" / "Assistant:" line prefixes that models sometimes echo into the final note.
 */
function formatTranscriptForPrompt(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  return transcript
    .map((message, index) => {
      const role = message.role === "user" ? "user" : "assistant";
      const text = truncate(message.content.trim(), maxMessageChars);
      return `### ${index + 1} (${role})\n\n${text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * When the embedded model is unavailable or fails, append only the user’s messages as plain
 * paragraphs—no role headings—so the vault does not read like a labeled chat export.
 */
export function buildDeterministicTemplateFillBody(
  templateCtx: { title: string; content: string },
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const base = templateBodyWithoutLeadingTitle(templateCtx.content);
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
}): Promise<string | null> {
  if (!(await isEmbeddedModelAvailable())) {
    return null;
  }

  const base = truncate(
    templateBodyWithoutLeadingTitle(input.templateContent),
    maxTemplateChars
  );
  const transcriptBlock = formatTranscriptForPrompt(input.transcript);

  const userPrompt = [
    "## Template title",
    input.templateTitle.trim(),
    "",
    "## Template structure (fill with the user’s answers)",
    base.trim().length > 0 ? base.trim() : "(empty template body)",
    "",
    "## Messages while using this template (interpret; do not copy as dialogue)",
    transcriptBlock,
    "",
    "Write ONLY the completed markdown note body."
  ].join("\n");

  try {
    const raw = await runEmbeddedChatPrompt({
      systemPrompt: templateInstanceFillSystemPrompt,
      userPrompt,
      maxTokens: 4096,
      temperature: 0.35
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
