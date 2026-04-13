import { randomUUID } from "node:crypto";
import type {
  AppSettings,
  ChatNoteActionKind,
  ChatNoteActionProposal,
  MessageRecord,
  NoteFrontmatter,
  NoteSummary,
  ProposeChatNoteActionsInput,
  ProposeChatNoteActionsResult,
  VaultDefinition
} from "../../ipc/types";
import {
  buildSnapshot,
  readNoteOrCreateIfMissing,
  resolveVault
} from "../../ipc/vault";
import { slugifyExtractionTitle } from "../../../shared/extraction/wikiLinks";
import { stripAssistantTemplateDraftMarkdown } from "../../../shared/chat/templateDraftCleanup";

const templateTag = "template";

type ProposalMessage = ProposeChatNoteActionsInput["messages"][number];

interface ExistingNoteTarget {
  note: NoteSummary;
  content: string;
  sources: number;
}

function slugifyNoteTitle(title: string): string {
  return slugifyExtractionTitle(title) || "untitled-note";
}

function normalizeFolderPath(folderPath: string): string {
  return folderPath
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/");
}

function isTemplateTag(tag: string): boolean {
  return tag.trim().toLowerCase() === templateTag;
}

export function hasDirectNoteActionIntent(content: string): boolean {
  const text = content.trim();

  if (!text) {
    return false;
  }

  const asksForDraftOnly =
    /\bhelp me\b/i.test(text) &&
    /\b(?:create|make|draft|design|build)\b/i.test(text) &&
    /\btemplate\b/i.test(text) &&
    !/\b(?:save|store|persist|write|update|append)\b/i.test(text);

  if (asksForDraftOnly) {
    return false;
  }

  if (/\b(?:save|store|persist|write)\b/i.test(text)) {
    return /\b(?:note|template|it|this|that|vault|wiki)\b/i.test(text);
  }

  if (/\b(?:update|append|add)\b/i.test(text)) {
    return /\[\[[^\]]+\]\]/.test(text) || /\b(?:note|template|wiki|vault)\b/i.test(text);
  }

  return /\bcreate\s+(?:a\s+|an\s+|new\s+)?(?:note|template)\b/i.test(text);
}

/** True when the user is asking to persist something as a reusable template (diff review may apply). */
export function hasTemplateCreationReviewIntent(content: string): boolean {
  if (!hasDirectNoteActionIntent(content)) {
    return false;
  }

  const text = content.trim();
  if (!/\btemplate\b/i.test(text)) {
    return false;
  }

  // Linked-note updates (e.g. "template approvals") mention "template" but are not template saves.
  if (/\b(?:update|append|add)\b/i.test(text) && /\[\[[^\]]+\]\]/.test(text)) {
    return false;
  }

  return true;
}

/**
 * User asked the assistant to produce the template body in this same turn (often ends with
 * "save as a reusable template"). Pre-LLM proposals run before any reply exists; pairing the
 * latest user with an older assistant would capture the wrong markdown.
 */
export function isCombinedTemplateDraftAndSaveRequest(content: string): boolean {
  const text = content.trim();

  if (!/\btemplate\b/i.test(text)) {
    return false;
  }

  if (!/\b(?:save|store|persist)\b/i.test(text)) {
    return false;
  }

  if (/\b(?:help me|can we)\b/i.test(text)) {
    return true;
  }

  if (/\binclude a clear markdown structure\b/i.test(text)) {
    return true;
  }

  if (text.length < 140) {
    return false;
  }

  return /\b(?:create|draft|design|build|structure|markdown|prompt)\b/i.test(text);
}

/** Short follow-up that approves persisting a template draft from the last assistant message. */
function looksLikeTemplateSaveApprovalTurn(content: string): boolean {
  const text = content.trim();

  if (text.length > 320) {
    return false;
  }

  if (!/\btemplate\b/i.test(text)) {
    return false;
  }

  if (!/\b(?:save|store|persist|approve)\b/i.test(text)) {
    return false;
  }

  return true;
}

/** Prior assistant drafted a structured note (H1 + section headings); used to pair with short "yes / please do" replies. */
function draftAssistantLooksLikeTemplatedMarkdown(content: string): boolean {
  const text = content.trim();
  if (text.length < 40) {
    return false;
  }

  const body = text
    .replace(/^```[a-z0-9_-]*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  return /(^|\n)#\s+[^\n]+/.test(body) && /(^|\n)##\s+[^\n]+/.test(body);
}

/**
 * User confirmed they want the draft saved without repeating "template" or "save"
 * (e.g. "please do!", "yes", "go ahead").
 */
function isShortTemplateSaveAffirmation(content: string): boolean {
  const text = content.trim();
  if (text.length === 0 || text.length > 200 || text.includes("\n")) {
    return false;
  }

  const core = text.replace(/[.!…\s]+$/u, "").trim();
  if (core.length === 0) {
    return false;
  }

  return /^(?:yes|yeah|yep|sure|ok|okay|please do|go ahead|save it|do it|proceed|sounds good|that works|please save|save please)$/i.test(
    core
  );
}

function isImplicitTemplateSaveApprovalPair(input: {
  latestUserContent: string;
  draftAssistantContent: string;
}): boolean {
  return (
    draftAssistantLooksLikeTemplatedMarkdown(input.draftAssistantContent) &&
    isShortTemplateSaveAffirmation(input.latestUserContent)
  );
}

function isTemplateRequest(content: string): boolean {
  return /\btemplate\b/i.test(content);
}

function hasTemplateDraftRequestIntent(content: string): boolean {
  const text = content.trim();

  if (!/\btemplate\b/i.test(text)) {
    return false;
  }

  if (/\[\[[^\]]+\]\]/.test(text)) {
    return false;
  }

  if (/\b(?:use|fill|apply)\b/i.test(text)) {
    return false;
  }

  return /\b(?:create|make|draft|design|build)\b/i.test(text);
}

function titleFromAssistantMarkdown(content: string): string | null {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();

  if (heading) {
    return heading;
  }

  const boldTitle = content.match(/\*\*([^*\n]{4,120})\*\*/)?.[1]?.trim();
  return boldTitle ?? null;
}

function stripTemplateWord(title: string): string {
  return title
    .replace(/\btemplate\b/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTemplateTitle(title: string): string {
  const stripped = stripTemplateWord(title);
  const base = stripped.length > 0 ? stripped : title.trim();
  return /\btemplate\b/i.test(base) ? base : `${base} Template`;
}

function inferQuotedTitle(content: string): string | null {
  return (
    content.match(/(?:called|named|titled)\s+"([^"]{1,120})"/i)?.[1]?.trim() ??
    content.match(/(?:called|named|titled)\s+'([^']{1,120})'/i)?.[1]?.trim() ??
    null
  );
}

function inferAssistantNamedTitle(content: string): string | null {
  const match =
    content.match(/\bcalled\s+([^:\n]{1,120}?)\s+with\b/i)?.[1]?.trim() ??
    content.match(/\bcalled\s+([^:\n]{1,120}?)(?:\.|:|\n|$)/i)?.[1]?.trim() ??
    null;

  if (!match) {
    return null;
  }

  return match.replace(/[`*_]/g, "").trim() || null;
}

function summarizeForBody(content: string): string {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return "Captured from chat.";
  }

  return trimmed;
}

function buildAction(input: {
  kind: ChatNoteActionKind;
  targetTitle: string;
  targetSlug: string;
  targetFolderPath: string;
  beforeMarkdown: string;
  afterMarkdown: string;
  frontmatter: Partial<NoteFrontmatter>;
  rationale: string;
  sourceMessageIds: string[];
}): ChatNoteActionProposal {
  return {
    id: randomUUID(),
    status: "pending",
    createdAt: Date.now(),
    ...input
  };
}

async function readExistingTarget(
  vault: VaultDefinition,
  note: NoteSummary | undefined
): Promise<ExistingNoteTarget | null> {
  if (!note) {
    return null;
  }

  const existing = await readNoteOrCreateIfMissing(vault.path, note.slug);

  return {
    note,
    content: existing.content,
    sources: existing.sources
  };
}

async function proposeTemplateSave(input: {
  latestUser: ProposalMessage;
  draftAssistant: ProposalMessage | null;
  vault: VaultDefinition;
  notes: NoteSummary[];
}): Promise<ChatNoteActionProposal | null> {
  if (!input.draftAssistant) {
    return null;
  }

  const implicitPair = isImplicitTemplateSaveApprovalPair({
    latestUserContent: input.latestUser.content,
    draftAssistantContent: input.draftAssistant.content
  });

  if (!isTemplateRequest(input.latestUser.content) && !implicitPair) {
    return null;
  }

  const cleanedDraft = stripAssistantTemplateDraftMarkdown(input.draftAssistant.content);
  const rawTitle =
    inferQuotedTitle(input.latestUser.content) ??
    inferAssistantNamedTitle(input.draftAssistant.content) ??
    titleFromAssistantMarkdown(cleanedDraft) ??
    "Reusable Template";
  const targetTitle = normalizeTemplateTitle(rawTitle);
  const targetSlug = slugifyNoteTitle(targetTitle);
  const existing = await readExistingTarget(
    input.vault,
    input.notes.find((note) => note.slug === targetSlug)
  );
  const afterMarkdown = summarizeForBody(cleanedDraft);

  return buildAction({
    kind: existing ? "update_template" : "create_template",
    targetTitle,
    targetSlug,
    targetFolderPath: "templates",
    beforeMarkdown: existing?.content ?? "",
    afterMarkdown,
    frontmatter: {
      tags: [templateTag],
      type: "concept",
      sources: existing?.sources ?? 0
    },
    rationale: existing
      ? `Update ${targetTitle} with the template we just drafted.`
      : `Save the template we just drafted as ${targetTitle}.`,
    sourceMessageIds: [input.draftAssistant.id, input.latestUser.id]
  });
}

/**
 * Template-save review pairs the latest user with the assistant reply that immediately precedes
 * it, but only when that assistant is a real turn (some user spoke before it). This avoids
 * treating seeded or welcome assistant messages as the draft when the user sends their first
 * message, and avoids walking up to an unrelated older assistant when the user sent several
 * messages in a row.
 */
function getLatestUserAndDraftAssistant(messages: ProposalMessage[]): {
  latestUser: ProposalMessage | null;
  draftAssistant: ProposalMessage | null;
} {
  let latestUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex === -1) {
    return {
      latestUser: null,
      draftAssistant: null
    };
  }

  const latestUser = messages[latestUserIndex] ?? null;
  const immediatePrior = messages[latestUserIndex - 1];

  if (immediatePrior?.role !== "assistant") {
    return {
      latestUser,
      draftAssistant: null
    };
  }

  let hasUserBeforeImmediateAssistant = false;

  for (let index = latestUserIndex - 2; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      hasUserBeforeImmediateAssistant = true;
      break;
    }
  }

  if (!hasUserBeforeImmediateAssistant) {
    return {
      latestUser,
      draftAssistant: null
    };
  }

  return {
    latestUser,
    draftAssistant: immediatePrior
  };
}

function getLatestUserAndDraftAssistantFromPostResponse(messages: ProposalMessage[]): {
  latestUser: ProposalMessage | null;
  draftAssistant: ProposalMessage | null;
} {
  let latestAssistantIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      latestAssistantIndex = index;
      break;
    }
  }

  if (latestAssistantIndex === -1) {
    return {
      latestUser: null,
      draftAssistant: null
    };
  }

  const draftAssistant = messages[latestAssistantIndex] ?? null;

  for (let index = latestAssistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return {
        latestUser: null,
        draftAssistant
      };
    }
    if (message?.role === "user") {
      return {
        latestUser: message,
        draftAssistant
      };
    }
  }

  return {
    latestUser: null,
    draftAssistant
  };
}

export async function proposeChatNoteActions(
  getSettings: () => AppSettings,
  input: ProposeChatNoteActionsInput
): Promise<ProposeChatNoteActionsResult> {
  const phase = input.phase ?? "pre_response";
  const { latestUser, draftAssistant } =
    phase === "post_response"
      ? getLatestUserAndDraftAssistantFromPostResponse(input.messages)
      : getLatestUserAndDraftAssistant(input.messages);

  let implicitApproval = false;
  if (latestUser && draftAssistant) {
    implicitApproval = isImplicitTemplateSaveApprovalPair({
      latestUserContent: latestUser.content,
      draftAssistantContent: draftAssistant.content
    });
  }

  const postResponseTemplateDraftReview =
    phase === "post_response" &&
    Boolean(latestUser && draftAssistant) &&
    hasTemplateDraftRequestIntent(latestUser?.content ?? "") &&
    draftAssistantLooksLikeTemplatedMarkdown(draftAssistant?.content ?? "");

  if (
    !latestUser ||
    (
      !hasTemplateCreationReviewIntent(latestUser.content) &&
      !implicitApproval &&
      !postResponseTemplateDraftReview
    )
  ) {
    return {
      actions: [],
      clarification: null
    };
  }

  if (
    phase === "pre_response" &&
    !implicitApproval &&
    isCombinedTemplateDraftAndSaveRequest(latestUser.content)
  ) {
    return {
      actions: [],
      clarification: null
    };
  }

  if (
    phase === "pre_response" &&
    !looksLikeTemplateSaveApprovalTurn(latestUser.content) &&
    !implicitApproval
  ) {
    return {
      actions: [],
      clarification: null
    };
  }

  const settings = getSettings();
  const vault = resolveVault(settings, input.vaultId);
  const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
  const notes = snapshot.notes.map((note) => ({
    ...note,
    folderPath: normalizeFolderPath(note.folderPath)
  }));

  const templateSave = await proposeTemplateSave({
    latestUser,
    draftAssistant,
    vault,
    notes
  });

  if (
    templateSave &&
    (templateSave.kind === "create_template" || templateSave.kind === "update_template")
  ) {
    return {
      actions: [templateSave],
      clarification: null
    };
  }

  return {
    actions: [],
    clarification: null
  };
}
