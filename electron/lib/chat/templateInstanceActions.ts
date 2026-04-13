import type {
  AppSettings,
  ApplyChatTemplateInstanceInput,
  ApplyChatTemplateInstanceResult,
  ChatTemplateInstanceState,
  MessageRecord,
  NoteSummary,
  VaultDefinition
} from "../../ipc/types";
import {
  buildSnapshot,
  readNoteOrCreateIfMissing,
  resolveVault,
  writeNoteFile
} from "../../ipc/vault";
import { recordWikiOps } from "../database";
import { extractWikiLinkTitles, normalizeTitleKey } from "../../../shared/extraction/wikiLinks";
import {
  buildTemplateInstanceSlug,
  buildTemplateInstanceTitle
} from "../../../shared/chat/templateInstance";
import {
  buildDeterministicTemplateFillBody,
  trySynthesizeTemplateInstanceMarkdown
} from "./templateInstanceFill";

const templateTag = "template";

type TemplateMessage = ApplyChatTemplateInstanceInput["messages"][number];

function isTemplateNote(note: Pick<NoteSummary, "tags">): boolean {
  return note.tags.some((tag) => tag.trim().toLowerCase() === templateTag);
}

export function findActiveTemplateInstance(
  messages: Array<Pick<MessageRecord, "templateInstance">>
): ChatTemplateInstanceState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const state = messages[index]?.templateInstance;

    if (state?.status === "active") {
      return state;
    }
  }

  return null;
}

export function isTemplateInstanceDoneMessage(content: string): boolean {
  const text = content.trim();

  if (text.length === 0 || text.length > 120 || text.includes("\n")) {
    return false;
  }

  const normalized = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.!…\s]+$/u, "")
    .trim();

  return /^(?:perfect|done|looks good|look good|that'?s it|thats it|all set|finished|complete|completed|great|nice|that works|this works|thank you|thanks)$/i.test(
    normalized
  );
}

function getLatestUserMessage(input: ApplyChatTemplateInstanceInput): TemplateMessage | null {
  return (
    input.messages.find(
      (message) => message.id === input.userMessageId && message.role === "user"
    ) ?? null
  );
}

export function findTemplateFromLinkedTitle(
  content: string,
  notes: NoteSummary[]
): NoteSummary | null {
  const templatesByTitle = new Map(
    notes
      .filter(isTemplateNote)
      .map((note) => [normalizeTitleKey(note.title), note] as const)
  );

  for (const title of extractWikiLinkTitles(content)) {
    const note = templatesByTitle.get(normalizeTitleKey(title));

    if (note) {
      return note;
    }
  }

  return null;
}

function removeWikiLinks(content: string): string {
  return content.replace(/\[\[[^\]]+\]\]/g, " ");
}

function isInitialTemplateUseOnly(content: string): boolean {
  if (!/\[\[[^\]]+\]\]/.test(content)) {
    return false;
  }

  if (!/\b(?:use|fill|fill out|apply|create|make)\b/i.test(content)) {
    return false;
  }

  const withoutLinks = removeWikiLinks(content)
    .replace(/\b(?:can we|could we|please|use|fill|out|apply|create|make|from|with|for|today|today's|todays|template|note|new|a|an|the|this|that)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();

  return withoutLinks.length < 80;
}

function isSubstantiveTemplateAnswer(content: string): boolean {
  const text = content.trim();

  if (text.length < 3 || isTemplateInstanceDoneMessage(text)) {
    return false;
  }

  return !isInitialTemplateUseOnly(text);
}

function uniqueAppend(values: string[], next: string): string[] {
  return values.includes(next) ? values : [...values, next];
}

function transcriptForAnswers(
  messages: TemplateMessage[],
  answerUserMessageIds: string[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const answerIds = new Set(answerUserMessageIds);

  return messages
    .filter((message) => message.role === "user" && answerIds.has(message.id))
    .map((message) => ({ role: "user" as const, content: message.content }));
}

async function writeTemplateInstance(input: {
  vault: VaultDefinition;
  state: ChatTemplateInstanceState;
  templateSlug: string;
  answerTranscript: Array<{ role: "user" | "assistant"; content: string }>;
  sessionId: string;
  operation: "create" | "rewrite";
}): Promise<{ slug: string; title: string }> {
  const template = await readNoteOrCreateIfMissing(input.vault.path, input.templateSlug);
  const now = new Date(input.state.updatedAt);
  const synthesized =
    input.answerTranscript.length > 0
      ? await trySynthesizeTemplateInstanceMarkdown({
          templateTitle: template.title,
          templateContent: template.content,
          transcript: input.answerTranscript,
          now
        })
      : null;
  const body =
    synthesized ??
    buildDeterministicTemplateFillBody(template, input.answerTranscript, {
      now
    });

  const result = await writeNoteFile(input.vault.path, input.vault.id, {
    vaultId: input.vault.id,
    slug: input.state.instanceSlug,
    title: input.state.instanceTitle,
    folderPath: "",
    content: body,
    frontmatter: {
      tags: template.tags.filter((tag) => tag.trim().toLowerCase() !== templateTag),
      type: template.type,
      sources: 0
    }
  });

  try {
    await recordWikiOps([
      {
        sessionId: input.sessionId,
        file: `${result.note.slug}.md`,
        action: input.operation
      }
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("Database has not been initialized")) {
      throw error;
    }
  }

  return {
    slug: result.note.slug,
    title: result.note.title
  };
}

export async function applyChatTemplateInstance(
  getSettings: () => AppSettings,
  input: ApplyChatTemplateInstanceInput
): Promise<ApplyChatTemplateInstanceResult> {
  const latestUser = getLatestUserMessage(input);

  if (!latestUser) {
    return {
      applied: false,
      action: "none",
      state: null,
      message: null
    };
  }

  const settings = getSettings();
  const vault = resolveVault(settings, input.vaultId);
  const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
  const active = findActiveTemplateInstance(input.messages);
  const linkedTemplate = findTemplateFromLinkedTitle(latestUser.content, snapshot.notes);
  const nowMs = Date.now();

  if (linkedTemplate && (!active || active.templateSlug !== linkedTemplate.slug)) {
    const template = await readNoteOrCreateIfMissing(vault.path, linkedTemplate.slug);
    const instanceTitle = buildTemplateInstanceTitle(template.title, new Date(nowMs));
    const instanceSlug = buildTemplateInstanceSlug(linkedTemplate.slug, input.sessionId, new Date(nowMs));
    const answerUserMessageIds = isSubstantiveTemplateAnswer(latestUser.content)
      ? [latestUser.id]
      : [];
    const state: ChatTemplateInstanceState = {
      templateSlug: linkedTemplate.slug,
      templateTitle: template.title,
      instanceSlug,
      instanceTitle,
      status: "active",
      sourceUserMessageIds: [latestUser.id],
      answerUserMessageIds,
      createdAt: nowMs,
      updatedAt: nowMs
    };
    const note = await writeTemplateInstance({
      vault,
      state,
      templateSlug: linkedTemplate.slug,
      answerTranscript: transcriptForAnswers(input.messages, answerUserMessageIds),
      sessionId: input.sessionId,
      operation: "create"
    });

    return {
      applied: true,
      action: "created",
      state,
      note,
      message: `${state.instanceTitle} started from ${state.templateTitle}.`
    };
  }

  if (!active) {
    return {
      applied: false,
      action: "none",
      state: null,
      message: null
    };
  }

  const nextSourceUserMessageIds = uniqueAppend(active.sourceUserMessageIds, latestUser.id);

  if (
    isTemplateInstanceDoneMessage(latestUser.content) &&
    active.answerUserMessageIds.length > 0
  ) {
    const state: ChatTemplateInstanceState = {
      ...active,
      status: "completed",
      sourceUserMessageIds: nextSourceUserMessageIds,
      updatedAt: nowMs,
      completedAt: nowMs
    };

    return {
      applied: true,
      action: "completed",
      state,
      note: {
        slug: state.instanceSlug,
        title: state.instanceTitle
      },
      message: `${state.instanceTitle} is complete.`
    };
  }

  if (!isSubstantiveTemplateAnswer(latestUser.content)) {
    return {
      applied: false,
      action: "none",
      state: active,
      note: {
        slug: active.instanceSlug,
        title: active.instanceTitle
      },
      message: null
    };
  }

  const answerUserMessageIds = uniqueAppend(active.answerUserMessageIds, latestUser.id);
  const state: ChatTemplateInstanceState = {
    ...active,
    sourceUserMessageIds: nextSourceUserMessageIds,
    answerUserMessageIds,
    updatedAt: nowMs
  };
  const note = await writeTemplateInstance({
    vault,
    state,
    templateSlug: state.templateSlug,
    answerTranscript: transcriptForAnswers(input.messages, answerUserMessageIds),
    sessionId: input.sessionId,
    operation: "rewrite"
  });

  return {
    applied: true,
    action: "updated",
    state,
    note,
    message: `${state.instanceTitle} updated.`
  };
}
