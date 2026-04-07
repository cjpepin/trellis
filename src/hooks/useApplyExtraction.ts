import { useCallback } from "react";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";
import type { ExtractionResponse } from "@/lib/api";

interface ApplyOptions {
  sessionId?: string;
  messageCount?: number;
  vaultId?: string;
}

function slugFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

function mergeTags(existingTags: string[], nextTags: string[]): string[] {
  return [...new Set([...existingTags, ...nextTags])];
}

export function useApplyExtraction() {
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const upsertSession = useChatStore((state) => state.upsertSession);
  const markExtracted = useChatStore((state) => state.markExtracted);
  const pushToast = useUiStore((state) => state.pushToast);

  return useCallback(
    async (response: ExtractionResponse, options: ApplyOptions = {}) => {
      for (const update of response.updates) {
        const slug = slugFromFileName(update.file);
        let existingNote: Awaited<ReturnType<typeof window.trellis.vault.readNote>> | null = null;

        try {
          existingNote = await window.trellis.vault.readNote(slug, options.vaultId);
        } catch {
          existingNote = null;
        }

        const nextContent =
          update.action === "append" && existingNote
            ? [existingNote.content.trim(), update.content.trim()].filter(Boolean).join("\n\n")
            : update.content;
        const nextTitle = existingNote?.title ?? update.title;
        const nextTags = existingNote ? mergeTags(existingNote.tags, update.tags) : update.tags;
        const nextSources = existingNote
          ? existingNote.sources + (update.sources ?? 0)
          : (update.sources ?? 1);

        await window.trellis.vault.writeNote({
          vaultId: options.vaultId,
          slug,
          title: nextTitle,
          content: nextContent,
          frontmatter: {
            tags: nextTags,
            type: existingNote?.type ?? update.type,
            sources: nextSources,
            url: update.url
          }
        });
      }

      if (response.updates.length > 0) {
        await window.trellis.db.recordWikiOps(
          response.updates.map((update) => ({
            sessionId: options.sessionId,
            file: update.file,
            action: update.action
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
          graph: snapshot.graph
        });
      }

      if (response.updates.length > 0 && options.sessionId && response.sessionTitle) {
        const updatedSession = await window.trellis.db.updateSession({
          id: options.sessionId,
          title: response.sessionTitle
        });
        upsertSession(updatedSession);
      }

      if (options.sessionId && options.messageCount) {
        markExtracted(options.sessionId, options.messageCount);
      }

      if (response.updates.length > 0) {
        pushToast({
          title: `✦ ${response.updates.length} notes updated`,
          tone: "success"
        });
      }
    },
    [markExtracted, pushToast, replaceIndex, upsertSession]
  );
}
