import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionSourceType
} from "./contracts.ts";

export interface ExtractionPromptInput {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  index: ExtractionIndexEntry[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: ExtractionSourceType;
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
}

export function buildExtractionCorpus(input: ExtractionPromptInput): string {
  return (
    input.sourceContent ||
    input.transcript
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n")
  );
}

export function buildExtractionUserMessage(input: ExtractionPromptInput): string {
  const corpus = buildExtractionCorpus(input);
  const indexBlock =
    input.index.length > 0
      ? input.index
          .map(
            (note) =>
              `- ${note.title} (${note.slug}.md) [${note.tags.join(", ")}]${
                note.isPlaceholder ? " {placeholder target}" : ""
              }`
          )
          .join("\n")
      : "(empty notes index)";
  const relatedNotesBlock =
    input.relatedNotes && input.relatedNotes.length > 0
      ? input.relatedNotes
          .map(
            (note) =>
              `Title: ${note.title}\nSlug: ${note.slug}\nTags: [${note.tags.join(
                ", "
              )}]\nHeading: ${note.headingPath}\nScore: ${note.score}\nContent:\n${note.content.trim()}`
          )
          .join("\n\n---\n\n")
      : "(none)";

  return [
    "## Current Notes Index",
    indexBlock,
    "",
    "## Relevant Existing Notes",
    relatedNotesBlock,
    "",
    input.sourceType ? `## Source (${input.sourceType})` : "## Conversation Transcript",
    input.sourceTitle ? `Title: ${input.sourceTitle}` : "",
    input.sourcePath ? `Path: ${input.sourcePath}` : "",
    "",
    corpus.slice(0, 12_000)
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
