import type { WikiNote } from "../../ipc/types";

export interface NoteChunk {
  chunkId: string;
  headingPath: string;
  content: string;
  embeddingInput: string;
}

interface RawSection {
  headingPath: string;
  lines: string[];
}

const maxChunkCharacters = 2_400;

function headingPathFor(
  noteTitle: string,
  headingStack: string[],
  fallback = "Overview"
): string {
  const parts = headingStack.filter((part) => part.length > 0);

  if (parts.length === 0) {
    return `${noteTitle} > ${fallback}`;
  }

  return `${noteTitle} > ${parts.join(" > ")}`;
}

function splitLargeSection(section: RawSection): RawSection[] {
  const content = section.lines.join("\n").trim();

  if (content.length <= maxChunkCharacters) {
    return [section];
  }

  const paragraphs = content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: RawSection[] = [];
  let currentLines: string[] = [];
  let currentLength = 0;
  let chunkIndex = 1;

  for (const paragraph of paragraphs) {
    const nextLength = currentLength + paragraph.length + 2;

    if (currentLines.length > 0 && nextLength > maxChunkCharacters) {
      chunks.push({
        headingPath: `${section.headingPath} (Part ${chunkIndex})`,
        lines: currentLines
      });
      currentLines = [paragraph];
      currentLength = paragraph.length;
      chunkIndex += 1;
      continue;
    }

    currentLines.push(paragraph);
    currentLength = nextLength;
  }

  if (currentLines.length > 0) {
    chunks.push({
      headingPath: chunkIndex > 1 ? `${section.headingPath} (Part ${chunkIndex})` : section.headingPath,
      lines: currentLines
    });
  }

  return chunks;
}

export function chunkNote(note: WikiNote): NoteChunk[] {
  const trimmedContent = note.content.trim();

  if (trimmedContent.length === 0) {
    return [];
  }

  const lines = trimmedContent.split("\n");
  const sections: RawSection[] = [];
  const headingStack: string[] = [];
  let current: RawSection = {
    headingPath: `${note.title} > Overview`,
    lines: []
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (!headingMatch) {
      current.lines.push(line);
      continue;
    }

    if (current.lines.some((entry) => entry.trim().length > 0)) {
      sections.push(current);
    }

    const level = headingMatch[1]?.length ?? 1;
    const heading = headingMatch[2]?.trim() ?? "Section";
    headingStack.splice(Math.max(0, level - 1));
    headingStack[level - 1] = heading;
    current = {
      headingPath: headingPathFor(note.title, headingStack),
      lines: [line]
    };
  }

  if (current.lines.some((entry) => entry.trim().length > 0)) {
    sections.push(current);
  }

  return sections
    .flatMap(splitLargeSection)
    .map((section, index) => {
      const content = section.lines.join("\n").trim();

      return {
        chunkId: `${index}`,
        headingPath: section.headingPath,
        content,
        embeddingInput: [
          `Title: ${note.title}`,
          note.tags.length > 0 ? `Tags: ${note.tags.join(", ")}` : "",
          `Heading: ${section.headingPath}`,
          "Content:",
          content
        ]
          .filter(Boolean)
          .join("\n")
      };
    })
    .filter((chunk) => chunk.content.length > 0);
}
