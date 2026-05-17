import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import { notesHashHref } from "./noteRoutes";
import { slugifyNoteTitle } from "./noteReferences";

let wikiSpanStyleHookInstalled = false;

function ensureWikiSpanStyleSanitizeHook(): void {
  if (wikiSpanStyleHookInstalled) {
    return;
  }

  wikiSpanStyleHookInstalled = true;

  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") {
      return;
    }

    let el: Node | null = node;
    for (let depth = 0; depth < 24 && el; depth++, el = el.parentElement) {
      if (el instanceof HTMLElement && /\bkatex\b/.test(el.className)) {
        data.keepAttr = true;
        return;
      }
    }

    const raw = (data.attrValue ?? "").trim().toLowerCase();
    if (!raw) {
      data.keepAttr = false;
      return;
    }

    const parts = raw
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const nodeName = node.nodeName;

    if (["TABLE", "COL", "TH", "TD"].includes(nodeName)) {
      let allowedTableSize = false;

      for (const part of parts) {
        const [rawKey, ...rawValueParts] = part.split(":");
        const key = rawKey?.trim();
        const value = rawValueParts.join(":").trim().replace(/\s+/g, "");

        if ((key === "width" || key === "min-width") && /^[\d.]+(px|rem|em|%)$/.test(value)) {
          allowedTableSize = true;
          continue;
        }

        data.keepAttr = false;
        return;
      }

      data.keepAttr = allowedTableSize;
      return;
    }

    if (nodeName !== "SPAN") {
      data.keepAttr = false;
      return;
    }

    let allowedColor = false;
    let allowedSize = false;

    for (const part of parts) {
      if (part.startsWith("color:")) {
        const value = part.slice("color:".length).trim();
        if (value.includes("url(") || value.includes("expression")) {
          data.keepAttr = false;
          return;
        }
        allowedColor = true;
        continue;
      }

      if (part.startsWith("font-size:")) {
        const value = part.slice("font-size:".length).trim().replace(/\s+/g, "");
        if (!/^[\d.]+(rem|em|%)$/.test(value)) {
          data.keepAttr = false;
          return;
        }
        allowedSize = true;
        continue;
      }

      data.keepAttr = false;
      return;
    }

    if (!allowedColor && !allowedSize) {
      data.keepAttr = false;
    }
  });
}

export interface MarkdownRenderResult {
  html: string;
  links: string[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\n", "&#10;");
}

const KATEX_OPTS_DISPLAY = {
  displayMode: true,
  throwOnError: false,
  strict: "ignore" as const,
  trust: false,
  maxSize: 500,
  maxExpand: 1000
};

const KATEX_OPTS_INLINE = {
  displayMode: false,
  throwOnError: false,
  strict: "ignore" as const,
  trust: false,
  maxSize: 500,
  maxExpand: 1000
};

/** KaTeX HTML must not sit in markdown before `marked` (fence flush splits on `\n` and breaks markup); stash and expand after parse. */
interface TrellisMathStash {
  pushBlock: (html: string) => string;
  pushInline: (html: string) => string;
}

function decodeHtmlEntities(value: string): string {
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * Models often emit a single `\` before a row break; LaTeX needs `\\`. They also paste `&amp;`, `&#10;`, odd Unicode line ends.
 * Without this, KaTeX shows a red `.katex-error` span whose text looks like raw HTML.
 */
function normalizeLatexForKatex(tex: string): string {
  let t = decodeHtmlEntities(tex.trim());
  t = t.replace(/\u00a0/g, " ");
  t = t.replace(/\u2028|\u2029|\u0085/g, "\n");
  t = t.replace(/(?<!\\)\\(\s*(?:\r?\n|\r))/g, "\\\\$1");
  return t;
}

/** Unicode minus (U+2212) and missing whitespace break stub matching; KaTeX is not in the tree yet. */
function normalizeMathSlotStubMarkup(html: string): string {
  return html
    .replace(/\u2212/g, "-")
    .replace(/<divdata-trellis-math-slot/gi, "<div data-trellis-math-slot")
    .replace(/<spandata-trellis-math-slot/gi, "<span data-trellis-math-slot");
}

const SLOT_ATTR_CHUNK = "data(?:\\u2212|-)trellis(?:\\u2212|-)math(?:\\u2212|-)slot";

/**
 * Stash KaTeX output behind plain-text markers. HTML `<!--…-->` stashes were fragile: `marked` can
 * put them in `<pre><code>` as `&lt;!-- … --&gt;` (visible as the literal `<!--` text), and real
 * comment nodes are dropped by DOMPurify. Marker strings like `TRELLIS_MATH_S_0_BLK` are left as
 * normal text by `marked` and replaced with KaTeX before sanitization.
 */
/** Single newlines: marked still expands slots; double newlines added too much vertical gap around display math. */
const MATH_STASH_BLOCK = (idx: number) => `\nTRELLIS_MATH_S_${idx}_BLK\n`;
const MATH_STASH_INLINE = (idx: number) => `TRELLIS_MATH_S_${idx}_INL`;
const MATH_STASH_TOKEN = /TRELLIS_MATH_S_(\d+)_(BLK|INL)/g;
const MATH_STASH_ORPHAN_TOKEN = /TRELLIS_MATH_S_\d+_(?:BLK|INL)/g;
const MATH_STASH_RAW_HTML_COMMENT = /<!--\s*trellis-math:(?:blk|inl):(\d+)\s*-->/g;
const MATH_STASH_ESC_HTML_COMMENT = /&lt;!--\s*trellis-math:(?:blk|inl):(\d+)\s*--&gt;/g;
const MATH_STASH_ORPHAN_ESC_COMMENT = /&lt;!--\s*trellis-math:(?:blk|inl):\d+\s*--&gt;/g;
const MATH_STASH_ORPHAN_RAW_COMMENT = /<!--\s*trellis-math:(?:blk|inl):\d+\s*-->/g;

/** Stateless check (no `/g` regex) — global `.test` would leak `lastIndex` between calls. */
const TEX_STASH_PLACEHOLDER = /\bTRELLIS_MATH_S_\d+_(?:BLK|INL)\b/;

function texContainsStashPlaceholder(tex: string): boolean {
  return TEX_STASH_PLACEHOLDER.test(tex);
}

/**
 * Remove leaked slot stubs from markdown. Glued `<divdata-…` makes marked escape the tag so it shows up as raw text.
 */
function stripLeakedMathSlotStubsFromMarkdown(markdown: string): string {
  let md = normalizeMathSlotStubMarkup(markdown);
  const divStub = new RegExp(`<div\\s*${SLOT_ATTR_CHUNK}="\\d+"\\s*></div>`, "gi");
  const spanStub = new RegExp(`<span\\s*${SLOT_ATTR_CHUNK}="\\d+"\\s*></span>`, "gi");
  md = md.replace(divStub, "");
  md = md.replace(spanStub, "");
  md = md.replace(/&lt;div\s*data-trellis-math-slot="(\d+)"\s*&gt;\s*&lt;\/div&gt;/gi, "");
  md = md.replace(/&lt;divdata-trellis-math-slot="(\d+)"\s*&gt;\s*&lt;\/div&gt;/gi, "");
  md = md.replace(/&lt;divdata-trellis-math-slot=&quot;(\d+)&quot;\s*&gt;\s*&lt;\/div&gt;/gi, "");
  md = md.replace(/&lt;div\s*data-trellis-math-slot=&quot;(\d+)&quot;\s*&gt;\s*&lt;\/div&gt;/gi, "");
  md = md.replace(MATH_STASH_ORPHAN_TOKEN, "");
  return md;
}

/** Persisted chat bodies sometimes contain leaked stubs from a failed render; fix before re-parsing. */
function repairPersistedMathSlotArtifacts(markdown: string): string {
  return stripLeakedMathSlotStubsFromMarkdown(markdown);
}

/**
 * Swap stash tokens, legacy `<!-- trellis-math:… -->` markers, or `div`/`span` stubs for real KaTeX HTML.
 */
function expandTrellisMathPlaceholders(html: string, slots: string[]): string {
  let out = normalizeMathSlotStubMarkup(html);
  const slotValue = (idx: number): string => slots[idx] ?? "";

  out = out.replace(MATH_STASH_TOKEN, (_m, d: string) => slotValue(parseInt(d, 10)));
  out = out.replace(MATH_STASH_ESC_HTML_COMMENT, (_m, d: string) => slotValue(parseInt(d, 10)));
  out = out.replace(MATH_STASH_RAW_HTML_COMMENT, (_m, d: string) => slotValue(parseInt(d, 10)));

  for (let i = slots.length - 1; i >= 0; i--) {
    const replacement = slotValue(i);
    const divExact = `<div data-trellis-math-slot="${i}"></div>`;
    const spanExact = `<span data-trellis-math-slot="${i}"></span>`;
    if (out.includes(divExact)) {
      out = out.split(divExact).join(replacement);
      continue;
    }

    if (out.includes(spanExact)) {
      out = out.split(spanExact).join(replacement);
      continue;
    }

    const blockRe = new RegExp(`<div\\s[^>]*\\b${SLOT_ATTR_CHUNK}="${i}"\\b[^>]*>\\s*</div>`, "gi");
    const inlineRe = new RegExp(`<span\\s[^>]*\\b${SLOT_ATTR_CHUNK}="${i}"\\b[^>]*>\\s*</span>`, "gi");
    const looseDiv = new RegExp(`<div\\s*${SLOT_ATTR_CHUNK}="${i}"\\s*></div>`, "gi");
    const looseSpan = new RegExp(`<span\\s*${SLOT_ATTR_CHUNK}="${i}"\\s*></span>`, "gi");

    let next = out.replace(blockRe, replacement);
    if (next !== out) {
      out = next;
      continue;
    }

    next = out.replace(inlineRe, replacement);
    if (next !== out) {
      out = next;
      continue;
    }

    next = out.replace(looseDiv, replacement);
    if (next !== out) {
      out = next;
      continue;
    }

    out = out.replace(looseSpan, replacement);
  }

  return stripOrphanMathSlotStubs(out);
}

/** marked escapes glued `<divdata-…` as entities (`&lt;divdata…&quot;0&quot;&gt;</div>`), so strip those too. */
function stripEscapedMathSlotArtifacts(html: string): string {
  return html
    .replace(/&lt;divdata-trellis-math-slot=&quot;\d+&quot;&gt;\s*<\/div>/gi, "")
    .replace(/&lt;divdata-trellis-math-slot="(\d+)"&gt;\s*<\/div>/gi, "")
    .replace(/&lt;div\s*data-trellis-math-slot=&quot;\d+&quot;&gt;\s*<\/div>/gi, "")
    .replace(/&lt;div\s*data-trellis-math-slot="(\d+)"&gt;\s*<\/div>/gi, "")
    .replace(/&lt;span[^&]*?trellis-math-slot[^&]*?&gt;\s*&lt;\/span&gt;/gi, "");
}

/** Remove leftover stubs (wrong index / persisted leak) so they never show as raw tags. */
function stripOrphanMathSlotStubs(html: string): string {
  let out = normalizeMathSlotStubMarkup(html);
  out = out.replace(MATH_STASH_ORPHAN_TOKEN, "");
  out = out.replace(MATH_STASH_ORPHAN_ESC_COMMENT, "");
  out = out.replace(MATH_STASH_ORPHAN_RAW_COMMENT, "");
  const orphanDiv = new RegExp(`<div\\s*${SLOT_ATTR_CHUNK}="\\d+"\\s*></div>`, "gi");
  const orphanSpan = new RegExp(`<span\\s*${SLOT_ATTR_CHUNK}="\\d+"\\s*></span>`, "gi");
  out = out.replace(orphanDiv, "");
  out = out.replace(orphanSpan, "");
  out = stripEscapedMathSlotArtifacts(out);
  return out;
}

function katexDisplayHtml(tex: string, origin: "delim" | "fence", stash?: TrellisMathStash): string {
  const trimmed = normalizeLatexForKatex(tex);
  if (!trimmed) {
    return "";
  }

  if (texContainsStashPlaceholder(trimmed)) {
    // Markdown stash tokens are not valid LaTeX; `expandTrellisMathPlaceholders` runs after `marked`.
    return `\n\n${trimmed}\n\n`;
  }

  const rendered = katex.renderToString(trimmed, KATEX_OPTS_DISPLAY);
  logKatexRenderIssue(trimmed, rendered, "display");
  const originAttr = origin === "fence" ? ' data-trellis-math-origin="fence-latex"' : "";
  const block = `<div class="trellis-math-display"${originAttr} data-trellis-tex="${escapeAttr(trimmed)}">${rendered}</div>`;
  if (stash) {
    return stash.pushBlock(block);
  }

  return `\n\n${block}\n\n`;
}

function katexInlineHtml(tex: string, stash?: TrellisMathStash): string {
  const trimmed = normalizeLatexForKatex(tex);
  if (!trimmed) {
    return "";
  }

  if (texContainsStashPlaceholder(trimmed)) {
    return trimmed;
  }

  const rendered = katex.renderToString(trimmed, KATEX_OPTS_INLINE);
  logKatexRenderIssue(trimmed, rendered, "inline");
  const span = `<span class="trellis-math-inline" data-trellis-tex="${escapeAttr(trimmed)}">${rendered}</span>`;
  if (stash) {
    return stash.pushInline(span);
  }

  return span;
}

/** Many models emit display math as a bracket block instead of $$…$$; keep this strict to avoid normal prose. */
function looksLikeLatexChunk(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) {
    return false;
  }

  return (
    /\\[a-zA-Z]/.test(t) ||
    /[_^][\d{]/.test(t) ||
    /[_^]\{/.test(t) ||
    /[A-Za-z]_[A-Za-z0-9{\s]/.test(t) ||
    (/\=/.test(t) && (/[{}\\]/.test(t) || /\\/.test(t)))
  );
}

/**
 * Turn AI-style
 *   [
 *   \\sum_i x_i
 *   ]
 * into $$…$$ so KaTeX runs (helps existing chat history without re-sending).
 */
function replaceAiBracketDisplayMath(text: string): string {
  return text.replace(/(^|\n)\[\s*\n([\s\S]*?)\n\]\s*(?=\n|$)/g, (full, lead: string, body: string) => {
    if (!looksLikeLatexChunk(body)) {
      return full;
    }

    return `${lead}\n$$\n${body.trim()}\n$$\n`;
  });
}

/** Apply `fn` only to segments outside `$$ … $$` so bare `\\begin` inside display dollars stays one KaTeX pass. */
function mapOutsideMathDollars(text: string, fn: (chunk: string) => string): string {
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf("$$", i);
    if (open === -1) {
      out.push(fn(text.slice(i)));
      break;
    }

    out.push(fn(text.slice(i, open)));
    const close = text.indexOf("$$", open + 2);
    if (close === -1) {
      out.push(text.slice(open));
      break;
    }

    out.push(text.slice(open, close + 2));
    i = close + 2;
  }

  return out.join("");
}

function findMatchingEndAfterBegin(text: string, bodyStart: number, env: string): number | null {
  const stack: string[] = [env];
  const tokenRe = /\\begin\{([^}]+)\}|\\end\{([^}]+)\}/g;
  tokenRe.lastIndex = bodyStart;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(text))) {
    if (m[1]) {
      stack.push(m[1]);
    } else if (m[2]) {
      const closeEnv = m[2];
      if (stack.length === 0) {
        return null;
      }

      if (closeEnv !== stack[stack.length - 1]) {
        return null;
      }

      stack.pop();

      if (stack.length === 0) {
        return m.index + m[0].length;
      }
    }
  }

  return null;
}

/**
 * OpenAI (and other models) often send matrices as
 *   `$A = \begin{bmatrix}...\end{bmatrix}$`
 * If we only replace `\begin…\end` with KaTeX, the remainder is a broken inline pair `$A = … $`
 * across newlines, which the `$…$` regex never matches, then `$A = $` (or `+ = $`) is parsed
 * alone as bad inline TeX. Merge the outer `$` pair into one display KaTeX pass.
 */
function findClosingDollarAfterEnd(text: string, endPos: number): number {
  let j = endPos;
  while (j < text.length && /\s/.test(text[j]!)) {
    j++;
  }
  return j < text.length && text[j] === "$" ? j : -1;
}

const MERGE_PREFIX_LIKE = /^[\sA-Za-z0-9=+*/().,;:^_\-|[\]{}'"]*$/;

function tryMergeDollarWrappedBeginBlock(
  text: string,
  i: number,
  start: number,
  endPos: number
): { emitBefore: string; katexInput: string; nextI: number } | null {
  const dollarClose = findClosingDollarAfterEnd(text, endPos);
  if (dollarClose === -1) {
    return null;
  }

  const dollarOpen = text.lastIndexOf("$", start - 1);
  if (dollarOpen < i) {
    return null;
  }

  const betweenDollarAndBegin = text.slice(dollarOpen + 1, start);
  if (/\$/.test(betweenDollarAndBegin)) {
    return null;
  }
  if (/^\d+$/.test(betweenDollarAndBegin.replace(/\s/g, ""))) {
    return null;
  }
  if (betweenDollarAndBegin.length > 0 && !MERGE_PREFIX_LIKE.test(betweenDollarAndBegin)) {
    return null;
  }

  const katexInput = text.slice(dollarOpen + 1, dollarClose);
  if (!/\\begin\{/.test(katexInput) || katexInput.length > 20_000) {
    return null;
  }

  return {
    emitBefore: text.slice(i, dollarOpen),
    katexInput,
    nextI: dollarClose + 1
  };
}

function logKatexRenderIssue(tex: string, rendered: string, mode: "display" | "inline"): void {
  if (!rendered.includes("katex-error")) {
    return;
  }
  const dev = typeof import.meta !== "undefined" && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  if (!dev) {
    return;
  }
  const preview = tex.length > 500 ? `${tex.slice(0, 500)}…` : tex;
  console.warn(`[Trellis math] KaTeX ${mode} error; raw LaTeX (JSON):`, JSON.stringify(preview));
}

/** Undelimited `\\begin{env}…\\end{env}` (common in model output) must run before `marked` so `_` / `\\` are not corrupted. */
function replaceLatexBeginEndBlocks(text: string, stash?: TrellisMathStash): string {
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    const start = text.indexOf("\\begin{", i);
    if (start === -1) {
      out.push(text.slice(i));
      break;
    }

    const header = text.slice(start).match(/^\\begin\{([^}]+)\}/);
    if (!header) {
      out.push(text.slice(i, start));
      out.push("\\");
      i = start + 1;
      continue;
    }

    const env = header[1]!;
    const headerLen = header[0].length;
    const endPos = findMatchingEndAfterBegin(text, start + headerLen, env);
    if (endPos === null) {
      out.push(text.slice(i, start));
      out.push(text.slice(start, start + headerLen));
      i = start + headerLen;
      continue;
    }

    const merged = tryMergeDollarWrappedBeginBlock(text, i, start, endPos);
    if (merged) {
      out.push(merged.emitBefore);
      out.push(katexDisplayHtml(merged.katexInput, "delim", stash));
      i = merged.nextI;
      continue;
    }

    out.push(text.slice(i, start));
    const full = text.slice(start, endPos);
    out.push(katexDisplayHtml(full, "delim", stash));
    i = endPos;
  }

  return out.join("");
}

/**
 * Process each `$$…$$` pair independently so a broken or unclosed `$$` does not make other math steps fail
 * the way a global regex on malformed text can. Unmatched `$$` and everything after is left as literal markdown.
 */
function replaceDisplayDollarPairs(text: string, stash: TrellisMathStash | undefined): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("$$", i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    const end = text.indexOf("$$", start + 2);
    if (end === -1) {
      out += text.slice(start);
      break;
    }
    const body = text.slice(start + 2, end);
    const afterBegin = replaceLatexBeginEndBlocks(body, stash);
    if (texContainsStashPlaceholder(afterBegin)) {
      out += `\n${afterBegin}\n`;
    } else {
      out += katexDisplayHtml(afterBegin, "delim", stash);
    }
    i = end + 2;
  }
  return out;
}

function replaceDelimitedMathInText(text: string, stash?: TrellisMathStash): string {
  let out = replaceAiBracketDisplayMath(text);
  out = mapOutsideMathDollars(out, (chunk) => replaceLatexBeginEndBlocks(chunk, stash));
  out = replaceDisplayDollarPairs(out, stash);
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => {
    const afterBegin = replaceLatexBeginEndBlocks(body, stash);
    if (texContainsStashPlaceholder(afterBegin)) {
      return `\n${afterBegin}\n`;
    }
    return katexDisplayHtml(afterBegin, "delim", stash);
  });
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => {
    const afterBegin = replaceLatexBeginEndBlocks(body, stash);
    if (texContainsStashPlaceholder(afterBegin)) {
      return afterBegin;
    }
    return katexInlineHtml(afterBegin, stash);
  });
  // Single `$…$` only; `(?<!$)` / `(?!$)` avoid treating `$$` as two inline pairs.
  out = out.replace(
    /(?<!\$)\$((?:\\.|[^$])+?)\$(?!\$)/g,
    (_full, body: string) => {
      const afterBegin = replaceLatexBeginEndBlocks(body, stash);
      if (texContainsStashPlaceholder(afterBegin)) {
        return afterBegin;
      }
      return katexInlineHtml(afterBegin, stash);
    }
  );
  return out;
}

function applyOutsideFences(markdown: string, fn: (chunk: string) => string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let chunkLines: string[] = [];

  const flushChunk = (): void => {
    if (chunkLines.length === 0) {
      return;
    }

    const processed = fn(chunkLines.join("\n"));
    out.push(...processed.split("\n"));
    chunkLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      if (!inFence) {
        flushChunk();
        inFence = true;
        out.push(line);
      } else {
        inFence = false;
        out.push(line);
      }
      continue;
    }

    if (inFence) {
      out.push(line);
    } else {
      chunkLines.push(line);
    }
  }

  flushChunk();
  return out.join("\n");
}

function replaceLatexCodeBlocksInHtml(html: string): string {
  return html.replace(
    /<pre>\s*<code class="[^"]*language-(?:latex|math|tex)(?:\s|")[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_full, inner: string) => {
      const tex = decodeHtmlEntities(inner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
      return katexDisplayHtml(tex, "fence").trim();
    }
  );
}

function externalLinkPreviewHtml(url: string, label: string): string {
  let domain = url;

  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    domain = url;
  }

  return [
    `<div class="trellis-link-preview" data-trellis-link-preview="true" data-preview-url="${escapeHtml(url)}">`,
    `<a href="${escapeHtml(url)}" class="trellis-link-preview-title">${escapeHtml(label || url)}</a>`,
    `<span class="trellis-link-preview-domain">${escapeHtml(domain)}</span>`,
    `</div>`
  ].join("");
}

function withLocalExternalLinkPreviews(markdown: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence || !trimmed) {
      out.push(line);
      continue;
    }

    const linked = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i);
    if (linked) {
      const label = linked[1]?.trim() ?? "";
      const url = linked[2]?.trim() ?? "";
      out.push(`${line}\n\n${externalLinkPreviewHtml(url, label)}`);
      continue;
    }

    const bare = trimmed.match(/^(https?:\/\/[^\s<]+)$/i);
    if (bare) {
      const url = bare[1]?.trim() ?? "";
      out.push(`${line}\n\n${externalLinkPreviewHtml(url, url)}`);
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

export function renderWikiMarkdown(
  markdown: string,
  existingSlugs: Set<string>
): MarkdownRenderResult {
  const links: string[] = [];
  const mathSlots: string[] = [];
  const markdownRepaired = repairPersistedMathSlotArtifacts(markdown);
  const stash: TrellisMathStash = {
    pushBlock(html) {
      const idx = mathSlots.length;
      mathSlots.push(html);
      return MATH_STASH_BLOCK(idx);
    },
    pushInline(html) {
      const idx = mathSlots.length;
      mathSlots.push(html);
      return MATH_STASH_INLINE(idx);
    }
  };
  const markdownWithPreviews = withLocalExternalLinkPreviews(markdownRepaired);
  const markdownWithMath = applyOutsideFences(markdownWithPreviews, (chunk) => replaceDelimitedMathInText(chunk, stash));
  const preprocessed = markdownWithMath.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, rawTitle: string) => {
      const title = rawTitle.trim();
      const slug = slugifyNoteTitle(title);

      if (!slug) {
        return escapeHtml(title);
      }

      links.push(slug);
      const linkClass = existingSlugs.has(slug)
        ? "trellis-link trellis-link-internal"
        : "trellis-link trellis-link-internal trellis-link-missing";

      return `<a href="${notesHashHref(slug)}" class="${linkClass}">${escapeHtml(title)}</a>`;
    }
  );
  let html = marked.parse(preprocessed, {
    breaks: true,
    gfm: true
  }) as string;

  html = expandTrellisMathPlaceholders(html, mathSlots);
  const htmlWithCodeMath = replaceLatexCodeBlocksInHtml(html);

  ensureWikiSpanStyleSanitizeHook();

  return {
    html: DOMPurify.sanitize(htmlWithCodeMath, {
      ADD_TAGS: ["math", "semantics", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "munderover", "munder", "mover", "mtable", "mtr", "mtd", "annotation", "svg", "path", "g", "line", "rect", "use", "defs", "clipPath"],
      ADD_ATTR: ["xmlns", "focusable", "accent", "accentunder", "align", "columnalign", "columnlines", "columnspacing", "displaystyle", "fence", "frame", "linethickness", "lspace", "mathvariant", "maxsize", "minsize", "movablelimits", "rowalign", "rowlines", "rowspacing", "rspace", "scriptlevel", "separator", "stretchy", "symmetric", "voffset", "width", "height", "x", "y", "xlink:href", "viewBox", "preserveAspectRatio", "fill", "stroke", "stroke-width", "d", "aria-hidden", "encoding"]
    }),
    links
  };
}
