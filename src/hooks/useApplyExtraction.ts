import { useCallback } from "react";
import {
  prepareExtractionWrite,
  skipIfDuplicatePreparedExtractionContent
} from "@electron/lib/extraction/guardrails";
import { foldIncrementalCreatesOntoSessionAnchor } from "@shared/extraction/foldIncrementalCreates";
import { buildExtractionIndex } from "@/lib/extractionIndex";
import { isUnsetChatSessionTitle } from "@shared/chat/chatSessionTitle";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";
import type { ExtractionResponse, ExtractionUpdate } from "@/lib/api";

interface ApplyOptions {
  sessionId?: string;
  messageCount?: number;
  vaultId?: string;
}

function isWritableUpdate(
  update: ExtractionUpdate
): update is ExtractionUpdate & {
  operation: "create" | "append" | "rewrite" | "merge";
} {
  return update.operation !== "noop";
}

export function useApplyExtraction() {
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const graph = useWikiStore((state) => state.graph);
  const upsertSession = useChatStore((state) => state.upsertSession);
  const markExtracted = useChatStore((state) => state.markExtracted);
  const pushToast = useUiStore((state) => state.pushToast);

  return useCallback(
    async (response: ExtractionResponse, options: ApplyOptions = {}) => {
      const extractionIndex = buildExtractionIndex(graph);
      const noteTitleBySlug = new Map(extractionIndex.map((entry) => [entry.slug, entry.title]));

      let folded: ExtractionResponse = response;
      if (options.sessionId) {
        const priorSessionSlugs = await window.trellis.db.getSessionNoteSlugs(options.sessionId);
        folded = foldIncrementalCreatesOntoSessionAnchor(response, {
          transcriptStartIndex: 0,
          priorSessionSlugs,
          noteTitleBySlug
        });
      }

      const appliedUpdates = folded.updates.filter(isWritableUpdate);
      const appliedOps: Array<{ file: string; action: "create" | "append" | "rewrite" | "merge" }> =
        [];
      const appliedNotes: Array<{ slug: string; title: string }> = [];
      let appliedUpdateCount = 0;
      const seenPreparedBodies = new Set<string>();

      for (const update of appliedUpdates) {
        let existingNote: Awaited<ReturnType<typeof window.trellis.vault.readNote>> | null = null;
        const indexEntry = extractionIndex.find((entry) => entry.slug === update.targetSlug);

        if (indexEntry && !indexEntry.isPlaceholder) {
          try {
            existingNote = await window.trellis.vault.readNote(update.targetSlug, options.vaultId);
          } catch {
            existingNote = null;
          }
        }

        const preparedWrite = prepareExtractionWrite({
          update,
          existingNote,
          index: extractionIndex
        });

        if (!preparedWrite) {
          continue;
        }

        if (skipIfDuplicatePreparedExtractionContent(seenPreparedBodies, preparedWrite.content)) {
          continue;
        }

        await window.trellis.vault.writeNote({
          vaultId: options.vaultId,
          slug: preparedWrite.slug,
          title: preparedWrite.title,
          content: preparedWrite.content,
          folderPath: preparedWrite.folderPath,
          frontmatter: {
            tags: preparedWrite.tags,
            type: preparedWrite.type,
            sources: preparedWrite.sources,
            url: preparedWrite.url
          },
          strandRevision: { actor: "trellis", sessionId: options.sessionId }
        });

        appliedUpdateCount += 1;
        appliedNotes.push({ slug: preparedWrite.slug, title: preparedWrite.title });
        appliedOps.push({
          file: `${preparedWrite.slug}.md`,
          action: preparedWrite.operation
        });
      }

      if (appliedUpdateCount > 0) {
        await window.trellis.db.recordWikiOps(
          appliedOps.map((operation) => ({
            sessionId: options.sessionId,
            file: operation.file,
            action: operation.action
          }))
        );
      }

      if (appliedUpdateCount > 0) {
        const appSettings = await window.trellis.app.getSettings();
        const shouldRefreshIndex =
          !options.vaultId || appSettings.activeVaultId === options.vaultId;

        if (shouldRefreshIndex) {
          const snapshot = await window.trellis.vault.listIndex(options.vaultId);
          replaceIndex({
            notes: snapshot.notes,
            folders: snapshot.folders,
            graph: snapshot.graph
          });
        }
      }

      if (appliedUpdateCount > 0 && options.sessionId && folded.sessionTitle) {
        const session = useChatStore.getState().sessions.find((s) => s.id === options.sessionId);
        if (session && isUnsetChatSessionTitle(session.title)) {
          const updatedSession = await window.trellis.db.updateSession({
            id: options.sessionId,
            title: folded.sessionTitle
          });
          upsertSession(updatedSession);
        }
      }

      if (options.sessionId && options.messageCount) {
        markExtracted(options.sessionId, options.messageCount);
      }

      if (appliedUpdateCount > 0) {
        const maxLinks = 3;
        pushToast({
          title: `✦ ${appliedUpdateCount} notes updated`,
          tone: "success",
          noteLinks: appliedNotes.slice(0, maxLinks).map((note) => ({
            label: note.title,
            noteSlug: note.slug
          }))
        });
      }
    },
    [graph, markExtracted, pushToast, replaceIndex, upsertSession]
  );
}
