import { useCallback } from "react";
import { prepareExtractionWrite } from "@electron/lib/extraction/guardrails";
import { buildExtractionIndex } from "@/lib/extractionIndex";
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
  operation: "create" | "append" | "rewrite";
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
      const appliedUpdates = response.updates.filter(isWritableUpdate);
      const appliedOps: Array<{ file: string; action: "create" | "append" | "rewrite" }> = [];
      const extractionIndex = buildExtractionIndex(graph);
      let appliedUpdateCount = 0;

      for (const update of appliedUpdates) {
        let existingNote: Awaited<ReturnType<typeof window.trellis.vault.readNote>> | null = null;

        try {
          existingNote = await window.trellis.vault.readNote(update.targetSlug, options.vaultId);
        } catch {
          existingNote = null;
        }

        const preparedWrite = prepareExtractionWrite({
          update,
          existingNote,
          index: extractionIndex
        });

        if (!preparedWrite) {
          continue;
        }

        await window.trellis.vault.writeNote({
          vaultId: options.vaultId,
          slug: preparedWrite.slug,
          title: preparedWrite.title,
          content: preparedWrite.content,
          frontmatter: {
            tags: preparedWrite.tags,
            type: preparedWrite.type,
            sources: preparedWrite.sources,
            url: preparedWrite.url
          }
        });

        appliedUpdateCount += 1;
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

      if (appliedUpdateCount > 0 && options.sessionId && response.sessionTitle) {
        const updatedSession = await window.trellis.db.updateSession({
          id: options.sessionId,
          title: response.sessionTitle
        });
        upsertSession(updatedSession);
      }

      if (options.sessionId && options.messageCount) {
        markExtracted(options.sessionId, options.messageCount);
      }

      if (appliedUpdateCount > 0) {
        pushToast({
          title: `✦ ${appliedUpdateCount} notes updated`,
          tone: "success"
        });
      }
    },
    [graph, markExtracted, pushToast, replaceIndex, upsertSession]
  );
}
