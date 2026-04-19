import type { ExtractionSectionPatch } from "../../../shared/extraction/contracts";

const connectedNotesHeading = "## Connected Notes";

/** GitHub-style pipe table row (header or data). */
function isGfmPipeTableRowLine(line: string): boolean {
  const t = line.trim();
  return t.length >= 2 && t.startsWith("|") && t.lastIndexOf("|") > 0;
}

/** Separator row like `| --- | --- |` */
function isGfmPipeTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) {
    return false;
  }
  return /^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(t);
}

/**
 * Returns [startLine, endLine) indexes into `lines` for each contiguous GFM pipe table
 * (header + separator + optional data rows; stops at first non-row line).
 */
function findGfmPipeTableLineRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;

  while (i < lines.length) {
    if (
      isGfmPipeTableRowLine(lines[i] ?? "") &&
      i + 1 < lines.length &&
      isGfmPipeTableSeparatorLine(lines[i + 1] ?? "")
    ) {
      let j = i + 2;
      while (j < lines.length && isGfmPipeTableRowLine(lines[j] ?? "")) {
        j += 1;
      }
      ranges.push([i, j]);
      i = j;
      continue;
    }
    i += 1;
  }

  return ranges;
}

/** True if markdown contains at least one GFM pipe table. */
export function containsGfmPipeTable(body: string): boolean {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  return findGfmPipeTableLineRanges(lines).length > 0;
}

/** Removes all GFM pipe table blocks (used when an append supersedes schedule-style tables). */
export function stripGfmPipeTables(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const ranges = findGfmPipeTableLineRanges(lines);
  if (ranges.length === 0) {
    return body.trimEnd();
  }

  let out = [...lines];
  for (const [start, end] of [...ranges].reverse()) {
    out.splice(start, end - start);
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
}

/** Lowercase, trim, strip # prefix and wiki links, collapse whitespace — for heading equality. */
export function normalizeHeadingForMatch(heading: string | null | undefined): string {
  if (!heading) {
    return "";
  }
  let h = heading.trim();
  h = h.replace(/^#{1,6}\s+/, "");
  h = h.replace(/\[\[([^[\]]+)\]\]/g, "$1");
  h = h.replace(/\s+/g, " ").trim().toLowerCase();
  return h;
}

export interface NoteSection {
  heading: string | null;
  level: number;
  body: string;
  startLine: number;
}

function headingLevel(line: string): { level: number; text: string } | null {
  const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!m) {
    return null;
  }
  return { level: m[1]!.length, text: (m[2] ?? "").trim() };
}

/**
 * Split markdown into sections by ATX headings. First chunk may have heading === null (preamble).
 */
export function parseNoteSections(content: string): NoteSection[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;
  let bodyStart = 0;

  const flush = (endLine: number): void => {
    if (!current) {
      return;
    }
    const slice = lines.slice(bodyStart, endLine);
    current.body = slice.join("\n").replace(/\n+$/g, "");
    sections.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const hl = headingLevel(line);
    if (hl) {
      flush(i);
      current = {
        heading: line.trim(),
        level: hl.level,
        body: "",
        startLine: i
      };
      bodyStart = i + 1;
    } else if (!current) {
      current = {
        heading: null,
        level: 0,
        body: "",
        startLine: 0
      };
      bodyStart = i;
    }
  }

  flush(lines.length);

  if (sections.length === 0) {
    return [
      {
        heading: null,
        level: 0,
        body: lines.join("\n").trimEnd(),
        startLine: 0
      }
    ];
  }

  return sections;
}

export function renderNoteSections(sections: NoteSection[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    const body = s.body.trim();
    if (s.heading) {
      parts.push(body.length > 0 ? `${s.heading}\n\n${body}` : s.heading);
    } else if (body.length > 0) {
      parts.push(body);
    }
  }
  return parts.join("\n\n").trim();
}

export function splitConnectedNotesFromBody(content: string): {
  main: string;
  connectedSuffix: string;
} {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const idx = lines.findIndex((line) => line.trim() === connectedNotesHeading);
  if (idx === -1) {
    return { main: content.trimEnd(), connectedSuffix: "" };
  }
  const main = lines.slice(0, idx).join("\n").trimEnd();
  const connectedSuffix = lines.slice(idx).join("\n");
  return { main, connectedSuffix };
}

function appendBeforeConnectedNotesBlock(mainExisting: string, insert: string): string {
  const ins = insert.trim();
  if (ins.length === 0) {
    return mainExisting;
  }
  const { main, connectedSuffix } = splitConnectedNotesFromBody(mainExisting);
  const base = main.trimEnd();
  if (connectedSuffix.length === 0) {
    return base.length > 0 ? `${base}\n\n${ins}` : ins;
  }
  return base.length > 0 ? `${base}\n\n${ins}\n\n${connectedSuffix}` : `${ins}\n\n${connectedSuffix}`;
}

interface KvBullet {
  raw: string;
  keyNorm: string;
  keyDisplay: string;
}

function parseKvFromBulletLine(line: string): KvBullet | null {
  const trimmed = line.replace(/\r$/, "").trim();
  const withoutBullet = trimmed.replace(/^\s*[-*+]\s+/, "");
  // `- **Key:** value` or `- Key: value` or `- Key — value`
  const boldKey = withoutBullet.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
  if (boldKey) {
    const key = boldKey[1]?.trim() ?? "";
    if (key.length === 0) {
      return null;
    }
    return {
      raw: line,
      keyNorm: normalizeHeadingForMatch(key),
      keyDisplay: key
    };
  }
  const plain = withoutBullet.match(/^([^:：\n]+?)[:：]\s*(.*)$/);
  if (plain) {
    const keyPart = plain[1]?.replace(/\*\*/g, "").trim() ?? "";
    if (keyPart.length === 0) {
      return null;
    }
    return {
      raw: line,
      keyNorm: normalizeHeadingForMatch(keyPart),
      keyDisplay: keyPart
    };
  }
  const mdash = withoutBullet.match(/^([^—\-:]+?)\s*[—\-]\s*(.+)$/);
  if (mdash) {
    const keyPart = mdash[1]?.trim() ?? "";
    if (keyPart.length === 0) {
      return null;
    }
    return {
      raw: line,
      keyNorm: normalizeHeadingForMatch(keyPart),
      keyDisplay: keyPart
    };
  }
  return null;
}

/** Merge bullet lists by key; new keys replace old; new keys append after existing order. */
export function mergeBulletLists(existingBody: string, newBody: string): string {
  const exLines = existingBody.replace(/\r\n?/g, "\n").split("\n");
  const nwLines = newBody.replace(/\r\n?/g, "\n").split("\n");

  const byKey = new Map<string, string>();
  const order: string[] = [];
  const nonKvExisting: string[] = [];

  for (const line of exLines) {
    const kv = parseKvFromBulletLine(line);
    if (kv) {
      if (!byKey.has(kv.keyNorm)) {
        order.push(kv.keyNorm);
      }
      byKey.set(kv.keyNorm, line);
    } else if (line.trim().length > 0) {
      nonKvExisting.push(line);
    }
  }

  for (const line of nwLines) {
    const kv = parseKvFromBulletLine(line);
    if (kv) {
      if (!byKey.has(kv.keyNorm)) {
        order.push(kv.keyNorm);
      }
      byKey.set(kv.keyNorm, line.trim());
    }
  }

  const mergedKvLines = order.map((k) => byKey.get(k)).filter((l): l is string => Boolean(l));
  const nonKvNew: string[] = [];
  for (const line of nwLines) {
    const kv = parseKvFromBulletLine(line);
    if (!kv && line.trim().length > 0) {
      nonKvNew.push(line);
    }
  }

  const parts = [...nonKvExisting, ...mergedKvLines, ...nonKvNew];
  return parts.join("\n").trim();
}

function findSectionByHeading(
  sections: NoteSection[],
  patchHeading: string
): NoteSection | undefined {
  const want = normalizeHeadingForMatch(patchHeading);
  return sections.find((s) => s.heading && normalizeHeadingForMatch(s.heading) === want);
}

export function applyMerge(
  existing: string,
  patches: ExtractionSectionPatch[],
  residualBody: string | undefined
): { content: string; appliedHeadings: string[]; skippedHeadings: string[] } {
  const { main, connectedSuffix } = splitConnectedNotesFromBody(existing);
  const sections = parseNoteSections(main);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const patch of patches) {
    const match = findSectionByHeading(sections, patch.heading);
    if (!match || !match.heading) {
      skipped.push(patch.heading);
      continue;
    }
    const newBody =
      patch.mode === "merge-bullets"
        ? mergeBulletLists(match.body, patch.body)
        : patch.body.trim();
    match.body = newBody;
    applied.push(patch.heading);
  }

  let outputMain = renderNoteSections(sections);
  const residualParts: string[] = [];
  if (residualBody?.trim()) {
    residualParts.push(residualBody.trim());
  }
  for (const h of skipped) {
    const p = patches.find((x) => x.heading === h);
    if (p) {
      residualParts.push(
        p.body.trim().length > 0 ? `${p.heading}\n\n${p.body.trim()}` : p.heading
      );
    }
  }
  if (residualParts.length > 0) {
    outputMain = appendBeforeConnectedNotesBlock(outputMain, residualParts.join("\n\n"));
  }

  const content =
    connectedSuffix.length > 0
      ? outputMain.trimEnd().length > 0
        ? `${outputMain.trimEnd()}\n\n${connectedSuffix}`
        : connectedSuffix
      : outputMain;

  return { content: content.trimEnd(), appliedHeadings: applied, skippedHeadings: skipped };
}

/**
 * When appending, infer section-level replacements for headings that already exist in the note.
 */
export function inferAppendSectionPatches(
  existingMain: string,
  incomingFragment: string
): { patches: ExtractionSectionPatch[]; residual: string } {
  const existingSections = parseNoteSections(existingMain);
  const incomingSections = parseNoteSections(incomingFragment);
  const patches: ExtractionSectionPatch[] = [];
  const residualSections: NoteSection[] = [];

  const existingKeys = new Set(
    existingSections
      .map((s) => (s.heading ? normalizeHeadingForMatch(s.heading) : ""))
      .filter(Boolean)
  );

  for (const inc of incomingSections) {
    if (!inc.heading) {
      if (inc.body.trim().length > 0) {
        residualSections.push(inc);
      }
      continue;
    }
    const key = normalizeHeadingForMatch(inc.heading);
    if (key && existingKeys.has(key)) {
      const match = existingSections.find(
        (s) => s.heading && normalizeHeadingForMatch(s.heading) === key
      );
      patches.push({
        heading: match?.heading ?? inc.heading,
        body: inc.body.trim(),
        mode: "replace"
      });
    } else {
      residualSections.push(inc);
    }
  }

  const residual = renderNoteSections(residualSections);
  return { patches, residual };
}

/** Replace bullets in `base` when `incoming` has the same key (normalized). */
export function applyKeyValueBulletSupersession(base: string, incoming: string): string {
  if (incoming.trim().length === 0) {
    return base;
  }

  const incomingByKey = new Map<string, string>();
  for (const line of incoming.split("\n")) {
    const kv = parseKvFromBulletLine(line);
    if (kv) {
      incomingByKey.set(kv.keyNorm, line.trim());
    }
  }
  if (incomingByKey.size === 0) {
    return base;
  }

  const out: string[] = [];
  const replaced = new Set<string>();
  for (const line of base.split("\n")) {
    const kv = parseKvFromBulletLine(line);
    if (kv && incomingByKey.has(kv.keyNorm)) {
      if (!replaced.has(kv.keyNorm)) {
        out.push(incomingByKey.get(kv.keyNorm)!);
        replaced.add(kv.keyNorm);
      }
      continue;
    }
    if (kv && replaced.has(kv.keyNorm)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function dedupeKvLinesInBlock(block: string): string {
  const lines = block.split("\n");
  const lastIdx = new Map<string, number>();
  for (let i = 0; i < lines.length; i += 1) {
    const kv = parseKvFromBulletLine(lines[i] ?? "");
    if (kv) {
      lastIdx.set(kv.keyNorm, i);
    }
  }
  return lines
    .filter((line, i) => {
      const kv = parseKvFromBulletLine(line);
      if (!kv) {
        return true;
      }
      return lastIdx.get(kv.keyNorm) === i;
    })
    .join("\n");
}

function stripAdjacentBoldHeadingDupes(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    const prev = lines[i - 1] ?? "";
    const bold = line.match(/^\*\*([^*]+)\*\*\s*$/);
    const nextHm = next.match(/^#{1,6}\s+(.+?)\s*$/);
    const prevHm = prev.match(/^#{1,6}\s+(.+?)\s*$/);
    if (bold && nextHm && normalizeHeadingForMatch(bold[1]!) === normalizeHeadingForMatch(nextHm[1]!)) {
      continue;
    }
    if (bold && prevHm && normalizeHeadingForMatch(bold[1]!) === normalizeHeadingForMatch(prevHm[1]!)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Collapse duplicate adjacent headings; duplicate kv bullets; drop bold duplicate of real heading.
 */
export function reconcileNoteContent(content: string): string {
  const text = content.replace(/\r\n?/g, "\n");
  const { main, connectedSuffix } = splitConnectedNotesFromBody(text);
  let sections = parseNoteSections(main);

  const deduped: NoteSection[] = [];
  for (const s of sections) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      s.heading &&
      prev.heading &&
      normalizeHeadingForMatch(prev.heading) === normalizeHeadingForMatch(s.heading)
    ) {
      deduped[deduped.length - 1] = s;
    } else {
      deduped.push(s);
    }
  }
  sections = deduped;

  for (const s of sections) {
    s.body = dedupeKvLinesInBlock(s.body);
  }

  let rendered = stripAdjacentBoldHeadingDupes(renderNoteSections(sections));

  if (connectedSuffix.length > 0) {
    return rendered.trimEnd().length > 0
      ? `${rendered.trimEnd()}\n\n${connectedSuffix}`
      : connectedSuffix;
  }
  return rendered.trimEnd();
}
