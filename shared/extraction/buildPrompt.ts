import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionSourceType
} from "./contracts.ts";

export interface ExtractionPromptInput {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  index: ExtractionIndexEntry[];
  relatedNotes?: ExtractionContextNote[];
  /** Slugs of wiki notes already written from this chat session (pinned for retrieval). */
  sessionPriorNoteSlugs?: string[];
  /** Current body content of prior session notes, keyed by slug. */
  sessionPriorNoteContents?: Map<string, string>;
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

export function buildExtractionUserMessage(
  input: ExtractionPromptInput,
  options?: { maxCorpusChars?: number }
): string {
  const maxCorpusChars = options?.maxCorpusChars ?? 12_000;
  const corpus = buildExtractionCorpus(input);
  const indexBlock =
    input.index.length > 0
      ? input.index
          .map(
            (note) =>
              `- ${note.title} (${note.slug}.md) [${note.tags.join(", ")}]${
                note.folderPath ? ` folder:${note.folderPath}/` : ""
              }${note.isPlaceholder ? " {placeholder target}" : ""}`
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
              )}]\nHeading: ${note.headingPath}\nScore: ${note.score}\nLast updated: ${
                note.updatedAt ?? "unknown"
              }\nContent:\n${note.content.trim()}`
          )
          .join("\n\n---\n\n")
      : "(none)";

  const sessionStrandBlock =
    input.sessionPriorNoteSlugs && input.sessionPriorNoteSlugs.length > 0
      ? [
          "## Strand notes already linked to this chat session",
          input.sessionPriorNoteSlugs
            .map((slug) => {
              const entry = input.index.find((note) => note.slug === slug);
              const title = entry?.title ?? slug;
              const bodyPreview = input.sessionPriorNoteContents?.get(slug);
              if (bodyPreview) {
                return `- ${title} (${slug}.md)\n  Current content (preview):\n${bodyPreview.slice(0, 2000)}`;
              }
              return `- ${title} (${slug}.md)`;
            })
            .join("\n"),
          "",
          "When the new transcript continues the same topic as one of these, prefer **rewrite** or **append** on that note. Use **create** only when the thread clearly moves to a separate, independently useful topic.",
          ""
        ].join("\n")
      : "";

  return [
    "## Current Notes Index",
    indexBlock,
    "",
    "## Relevant Existing Notes",
    relatedNotesBlock,
    "",
    sessionStrandBlock,
    input.sourceType ? `## Source (${input.sourceType})` : "## Conversation Transcript",
    input.sourceTitle ? `Title: ${input.sourceTitle}` : "",
    input.sourcePath ? `Path: ${input.sourcePath}` : "",
    "",
    corpus.slice(0, maxCorpusChars)
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
