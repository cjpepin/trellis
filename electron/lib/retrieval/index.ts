import { createHash } from "node:crypto";
import type { ExtractionContextNote } from "@shared/extraction/contracts";
import type { RetrievalRebuildResult, WikiNote } from "../../ipc/types";
import {
  deleteMissingNoteEmbeddings,
  listNoteEmbeddings,
  replaceNoteEmbeddings,
  type StoredNoteEmbedding
} from "../database";
import { chunkNote } from "./chunkNote";
import { embedTexts } from "./ollama";

interface SearchRelevantNotesInput {
  vaultId: string;
  query: string;
  explicitSlugs?: string[];
  limit?: number;
}

const retrievalStopWords = new Set([
  "about",
  "after",
  "again",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "more",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "with",
  "would",
  "your",
  "want",
  "make",
  "need",
  "help",
  "please"
]);

function tokenize(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !retrievalStopWords.has(token)
      )
    )
  ];
}

function normalizeForPhraseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function computeContentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cosineSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left || !right || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function lexicalScore(query: string, row: StoredNoteEmbedding): number {
  const normalizedQuery = normalizeForPhraseSearch(query);
  const queryTokens = tokenize(query);
  const searchable = [row.noteTitle, row.headingPath, row.tags.join(" "), row.content].join(" ");
  const searchableTokens = new Set(tokenize(searchable));
  const titlePhrase = normalizeForPhraseSearch(row.noteTitle);
  const headingPhrase = normalizeForPhraseSearch(row.headingPath);
  let score = 0;

  if (titlePhrase.length >= 8 && normalizedQuery.includes(titlePhrase)) {
    score += 18;
  }

  if (headingPhrase.length >= 8 && normalizedQuery.includes(headingPhrase)) {
    score += 10;
  }

  for (const token of queryTokens) {
    if (searchableTokens.has(token)) {
      score += row.noteTitle.toLowerCase().includes(token) ? 4 : 2;
    }
  }

  return score;
}

export async function syncNoteEmbeddings(
  vaultId: string,
  note: WikiNote
): Promise<{
  chunkCount: number;
  embeddingModel: string | null;
  usedEmbeddings: boolean;
}> {
  const chunks = chunkNote(note);

  if (chunks.length === 0) {
    await replaceNoteEmbeddings(vaultId, note.slug, []);
    return {
      chunkCount: 0,
      embeddingModel: null,
      usedEmbeddings: false
    };
  }

  const embeddingRun = await embedTexts(chunks.map((chunk) => chunk.embeddingInput));

  await replaceNoteEmbeddings(
    vaultId,
    note.slug,
    chunks.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      noteTitle: note.title,
      noteType: note.type,
      tags: note.tags,
      headingPath: chunk.headingPath,
      content: chunk.content,
      contentHash: computeContentHash(chunk.embeddingInput),
      embedding: embeddingRun.embeddings[index] ?? null
    }))
  );

  return {
    chunkCount: chunks.length,
    embeddingModel: embeddingRun.model,
    usedEmbeddings: embeddingRun.usedEmbeddings
  };
}

export async function rebuildVaultEmbeddings(
  vaultId: string,
  notes: WikiNote[]
): Promise<RetrievalRebuildResult> {
  let chunkCount = 0;
  let embeddingModel: string | null = null;
  let usedEmbeddings = false;

  for (const note of notes) {
    const result = await syncNoteEmbeddings(vaultId, note);
    chunkCount += result.chunkCount;
    embeddingModel = embeddingModel ?? result.embeddingModel;
    usedEmbeddings = usedEmbeddings || result.usedEmbeddings;
  }

  await deleteMissingNoteEmbeddings(
    vaultId,
    notes.map((note) => note.slug)
  );

  return {
    vaultId,
    notesIndexed: notes.length,
    chunkCount,
    embeddingModel,
    usedEmbeddings
  };
}

function pickBestRowPerNote(
  rows: StoredNoteEmbedding[],
  query: string,
  queryEmbedding: number[] | null,
  explicitSlugs: Set<string>
): Array<StoredNoteEmbedding & { score: number; isExplicitMatch: boolean }> {
  const bestBySlug = new Map<string, StoredNoteEmbedding & { score: number; isExplicitMatch: boolean }>();

  for (const row of rows) {
    const lexical = lexicalScore(query, row);
    const semantic = cosineSimilarity(queryEmbedding, row.embedding);
    const isExplicitMatch = explicitSlugs.has(row.noteSlug);
    const score = lexical + semantic * 30 + (isExplicitMatch ? 100 : 0);
    const candidate = {
      ...row,
      score,
      isExplicitMatch
    };
    const existing = bestBySlug.get(row.noteSlug);

    if (!existing || candidate.score > existing.score) {
      bestBySlug.set(row.noteSlug, candidate);
    }
  }

  return [...bestBySlug.values()];
}

export async function searchRelevantNotes(
  input: SearchRelevantNotesInput
): Promise<ExtractionContextNote[]> {
  let rows = await listNoteEmbeddings(input.vaultId);

  if (rows.length === 0) {
    return [];
  }

  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const explicitSlugs = new Set((input.explicitSlugs ?? []).filter((slug) => slug.length > 0));
  rows = rows.filter((row) => row.content.length > 0);
  const hasStoredEmbeddings = rows.some((row) => Array.isArray(row.embedding) && row.embedding.length > 0);
  const queryEmbedding = hasStoredEmbeddings
    ? (await embedTexts([input.query.slice(0, 8_000)])).embeddings[0] ?? null
    : null;

  return pickBestRowPerNote(rows, input.query, queryEmbedding, explicitSlugs)
    .filter((row) => row.score > 0 || row.isExplicitMatch)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((row) => ({
      slug: row.noteSlug,
      title: row.noteTitle,
      tags: row.tags,
      headingPath: row.headingPath,
      content: row.content,
      score: Number(row.score.toFixed(4)),
      isExplicitMatch: row.isExplicitMatch
    }));
}
