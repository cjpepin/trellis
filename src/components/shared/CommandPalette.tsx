import { Command } from "cmdk";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkspaceInfo } from "@electron/ipc/types";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";
import { useChatStore } from "@/store/chatStore";

interface Props {
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  onSwitchWorkspace: (workspaceId: WorkspaceInfo["id"]) => Promise<void>;
  onResetPreview?: () => Promise<void>;
}

export function CommandPalette({
  workspace,
  workspaces,
  onSwitchWorkspace,
  onResetPreview
}: Props) {
  const navigate = useNavigate();
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const pushToast = useUiStore((state) => state.pushToast);
  const notes = useWikiStore((state) => state.notes);
  const activeNoteSlug = useWikiStore((state) => state.activeNoteSlug);
  const noteCache = useWikiStore((state) => state.noteCache);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setActiveSession = useChatStore((state) => state.setActiveSession);

  const currentNote = activeNoteSlug ? noteCache[activeNoteSlug] : null;
  const noteCommands = useMemo(() => notes.slice(0, 12), [notes]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/45 px-4 pt-24">
      <div className="trellis-elevated w-full max-w-xl overflow-hidden">
        <Command label="Command palette" className="bg-transparent">
          <Command.Input
            className="w-full border-b border-trellis-border bg-transparent px-4 py-4 text-sm text-trellis-text outline-none"
            placeholder="Search notes, views, and actions…"
            autoFocus
          />
          <Command.List className="max-h-[420px] overflow-y-auto px-2 py-2">
            <Command.Empty className="px-3 py-6 text-sm text-trellis-muted">
              Nothing matched that search.
            </Command.Empty>

            <Command.Group heading="Navigate" className="px-2 py-1 text-xs text-trellis-faint">
              <Command.Item
                className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface"
                onSelect={() => {
                  setActiveSession(null);
                  setOpen(false);
                  navigate("/chat");
                }}
              >
                New chat
              </Command.Item>
              <Command.Item
                className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface"
                onSelect={() => {
                  setOpen(false);
                  navigate("/graph");
                }}
              >
                Go to graph
              </Command.Item>
              <Command.Item
                className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface"
                onSelect={() => {
                  setOpen(false);
                  navigate("/ingest");
                }}
              >
                Import file
              </Command.Item>
              <Command.Item
                className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface"
                onSelect={() => {
                  setOpen(false);
                  navigate("/settings");
                }}
              >
                Go to settings
              </Command.Item>
              <Command.Item
                disabled={!currentNote}
                className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface data-[disabled=true]:text-trellis-faint"
                onSelect={() => {
                  if (currentNote) {
                    void navigator.clipboard.writeText(currentNote.content).catch((error) => {
                      pushToast({
                        title:
                          error instanceof Error
                            ? error.message
                            : "Could not copy the current note.",
                        tone: "warning"
                      });
                    });
                  }
                  setOpen(false);
                }}
              >
                Copy note as markdown
              </Command.Item>
            </Command.Group>

            <Command.Separator className="my-2 h-px bg-trellis-border" />

            <Command.Group heading="Workspace" className="px-2 py-1 text-xs text-trellis-faint">
              {workspaces.map((item) => (
                <Command.Item
                  key={item.id}
                  disabled={item.id === workspace.id}
                  className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface data-[disabled=true]:text-trellis-faint"
                  onSelect={() => {
                    if (item.id !== workspace.id) {
                      void onSwitchWorkspace(item.id);
                    }
                    setOpen(false);
                  }}
                >
                  Switch to {item.isPreview ? "preview" : "personal"}
                </Command.Item>
              ))}
              {workspace.canReset && onResetPreview && (
                <Command.Item
                  className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface"
                  onSelect={() => {
                    void onResetPreview();
                    setOpen(false);
                  }}
                >
                  Reset preview workspace
                </Command.Item>
              )}
            </Command.Group>

            <Command.Separator className="my-2 h-px bg-trellis-border" />

            <Command.Group heading="Open note" className="px-2 py-1 text-xs text-trellis-faint">
              {noteCommands.map((note) => (
                <Command.Item
                  key={note.slug}
                  value={`${note.title} ${note.tags.join(" ")}`}
                  className="rounded-field px-3 py-2 text-sm text-trellis-text aria-selected:bg-trellis-surface"
                  onSelect={() => {
                    setActiveNote(note.slug);
                    setOpen(false);
                    navigate("/wiki");
                  }}
                >
                  {note.title}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
      <button
        type="button"
        className="absolute inset-0 -z-10"
        onClick={() => setOpen(false)}
      />
    </div>
  );
}
