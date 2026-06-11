/**
 * Heuristic vault folder creation + note moves (shared by desktop + cloud organize).
 */
import { normalizeWikiFolderPath } from "../bucket/folderPath.ts";

export interface BucketOrganizeNoteSummary {
  slug: string;
  title: string;
  /** Normalized POSIX path; empty = vault root */
  folderPath: string;
}

export function hasBucketOrganizeIntent(text: string): boolean {
  const trimmed = text.trim().toLowerCase();

  if (trimmed.length === 0) {
    return false;
  }

  return (
    /\b(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?folder\b/i.test(trimmed) ||
    /\borganize\s+(?:my\s+)?(?:notes?|vault|wiki)\b/i.test(trimmed) ||
    /\b(?:move|put)\s+.+\s+(?:into|in|to|under)\s+(?:a\s+)?(?:new\s+)?folder\b/i.test(trimmed) ||
    /\b(?:move|put)\s+.+\s+(?:into|in|to|under)\s+(?:a\s+)?(?:new\s+)?["'][^"']+["']\s+folder\b/i.test(trimmed) ||
    /\b(?:move|put)\s+.+\s+(?:into|in|to|under)\s+(?:a\s+)?(?:new\s+)?[a-z0-9][^.?\n]{1,120}?\s+folder\b/i.test(trimmed) ||
    /\b(?:move|put)\s+.+\s+(?:into|in|to)\s+(?:that|the)\s+folder\b/i.test(trimmed)
  );
}

function slugifyFolderName(phrase: string): string {
  const slug = phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug.length > 0 ? slug : "organized";
}

function inferFolderBaseName(userMessage: string): string | null {
  const quoted =
    userMessage.match(/\bfolder\s+(?:for|named|called)\s+"([^"]+)"/i)?.[1]?.trim() ??
    userMessage.match(/\bfolder\s+(?:for|named|called)\s+'([^']+)'/i)?.[1]?.trim();

  if (quoted) {
    return quoted;
  }

  const quotedBeforeFolder =
    userMessage.match(/\b(?:new\s+)?folder\s+"([^"]+)"/i)?.[1]?.trim() ??
    userMessage.match(/\b(?:new\s+)?folder\s+'([^']+)'/i)?.[1]?.trim() ??
    userMessage.match(/\b(?:new\s+)?["']([^"']+)["']\s+folder\b/i)?.[1]?.trim();

  if (quotedBeforeFolder) {
    return quotedBeforeFolder;
  }

  const namedBeforeFolder = userMessage.match(
    /\bnew\s+([a-z0-9][^.?\n"']{1,120}?)\s+folder\b/i
  )?.[1]?.trim();

  if (namedBeforeFolder) {
    return namedBeforeFolder;
  }

  const newFolderFor = userMessage.match(
    /\bnew\s+folder\s+for\s+([^.?\n]+?)(?:\s+and\b|\s+to\b|\s*$)/i
  )?.[1]?.trim();

  if (newFolderFor) {
    return newFolderFor;
  }

  const unquoted = userMessage.match(
    /\bfolder\s+(?:for|named|called)\s+([^.?\n]+?)(?:\s+and\b|\s+to\b|\s*$)/i
  )?.[1]?.trim();

  if (unquoted) {
    return unquoted;
  }

  if (/\bdaily\s+log/i.test(userMessage)) {
    return "daily log";
  }

  return null;
}

function isDailyLogNote(note: BucketOrganizeNoteSummary): boolean {
  const searchable = `${note.slug} ${note.title}`.replace(/[-_]+/g, " ");

  return /\bdaily\s+logs?\b/i.test(searchable);
}

function findDailyLogNotes(notes: BucketOrganizeNoteSummary[]): BucketOrganizeNoteSummary[] {
  return notes.filter(isDailyLogNote);
}

function findBestDailyLogNote(
  notes: BucketOrganizeNoteSummary[],
  now: Date
): BucketOrganizeNoteSummary | undefined {
  const iso = now.toISOString().slice(0, 10);
  const month = now.toLocaleString("en-US", { month: "short" });
  const day = String(now.getDate());
  const year = String(now.getFullYear());

  const candidates = findDailyLogNotes(notes);

  const scored = candidates
    .map((note) => {
      let score = 0;

      if (note.slug.includes(iso)) {
        score += 10;
      }

      if (note.title.includes(month) && note.title.includes(day)) {
        score += 8;
      }

      if (note.title.includes(year)) {
        score += 2;
      }

      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.note ?? candidates[0];
}

function shouldMoveAllDailyLogNotes(userMessage: string): boolean {
  return (
    /\b(?:any|all|every)\b[^.?\n]*\bdaily\s+logs?\b/i.test(userMessage) ||
    /\bdaily\s+log\s+(?:files?|notes?)\b/i.test(userMessage) ||
    /\bdaily\s+logs\b/i.test(userMessage)
  );
}

export interface BucketOrganizePlan {
  createFolders: Array<{ parentPath: string; name: string }>;
  moves: Array<{ slug: string; folderPath: string }>;
}

export function planBucketOrganize(
  userMessage: string,
  notes: BucketOrganizeNoteSummary[],
  now = new Date()
): BucketOrganizePlan | null {
  if (!hasBucketOrganizeIntent(userMessage)) {
    return null;
  }

  const base = inferFolderBaseName(userMessage);

  if (!base) {
    return null;
  }

  const segment = slugifyFolderName(base);
  const folderPath = normalizeWikiFolderPath(segment);
  const plan: BucketOrganizePlan = {
    createFolders: [{ parentPath: "", name: segment }],
    moves: []
  };

  if (/\bdaily\s+log/i.test(userMessage)) {
    const wantsToday = /\btoday(?:'s)?\b/i.test(userMessage);
    const candidates =
      !wantsToday && shouldMoveAllDailyLogNotes(userMessage)
        ? findDailyLogNotes(notes)
        : [findBestDailyLogNote(notes, now)].filter((note): note is BucketOrganizeNoteSummary =>
            Boolean(note)
          );

    for (const candidate of candidates) {
      const current = normalizeWikiFolderPath(candidate.folderPath ?? "");

      if (current !== folderPath) {
        plan.moves.push({ slug: candidate.slug, folderPath });
      }
    }
  }

  return plan;
}
