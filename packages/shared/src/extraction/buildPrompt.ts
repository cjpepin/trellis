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
          "When the **new** transcript material continues the **same** subject as one of these strand notes, prefer **rewrite** or **append** on that note. When the user **switches** to a different subject (new theme, project, or domain—not a follow-up on the strand's topic), use **create** for a new note (or update an existing index page if it is clearly the right home). Do not fold an unrelated topic into a strand just because it appeared earlier in the chat.",
          "",
          "If the transcript also changes **other** indexed pages (not only these strand notes), include **additional** updates for those existing slugs — one update per affected page.",
          ""
        ].join("\n")
      : "";

  const multiNoteHint =
    sessionStrandBlock.length > 0
      ? ""
      : [
          "## Multi-topic updates",
          "When the user adjusts or records facts for more than one existing wiki page in this thread, return **one update per affected page** (merge, rewrite, or append). When the transcript introduces **additional** substantive topics that need new pages, you may emit more than one **create**—but avoid duplicate or overlapping new notes.",
          ""
        ].join("\n");

  return [
    "## Current Notes Index",
    indexBlock,
    "",
    "## Relevant Existing Notes",
    relatedNotesBlock,
    "",
    sessionStrandBlock,
    multiNoteHint,
    input.sourceType ? `## Source (${input.sourceType})` : "## Conversation Transcript",
    input.sourceTitle ? `Title: ${input.sourceTitle}` : "",
    input.sourcePath ? `Path: ${input.sourcePath}` : "",
    "",
    corpus.slice(0, maxCorpusChars)
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
