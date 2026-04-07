import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NoteViewer } from "@/components/wiki/NoteViewer";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function Wiki() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const newNoteTitleRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const notes = useWikiStore((state) => state.notes);
  const noteCache = useWikiStore((state) => state.noteCache);
  const activeNoteSlug = useWikiStore((state) => state.activeNoteSlug);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setNote = useWikiStore((state) => state.setNote);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const pushToast = useUiStore((state) => state.pushToast);
  const filteredNotes = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return notes;
    }

    return notes.filter((note) =>
      `${note.title} ${note.tags.join(" ")}`.toLowerCase().includes(normalized)
    );
  }, [notes, query]);
  const activeNote = activeNoteSlug ? noteCache[activeNoteSlug] : null;

  useEffect(() => {
    const requestedNote = searchParams.get("note");

    if (!requestedNote || requestedNote === activeNoteSlug) {
      return;
    }

    setActiveNote(requestedNote);
  }, [activeNoteSlug, searchParams, setActiveNote]);

  useEffect(() => {
    if (!activeNoteSlug || activeNote) {
      return;
    }

    const slug = activeNoteSlug;
    const hadSummary = notes.some((note) => note.slug === slug);

    void window.trellis.vault
      .readNote(slug)
      .then(async (note) => {
        setNote(note);
        if (!hadSummary) {
          const snapshot = await window.trellis.vault.listIndex();
          replaceIndex({
            notes: snapshot.notes,
            graph: snapshot.graph
          });
        }
      })
      .catch((error) => {
        pushToast({
          title: error instanceof Error ? error.message : "Could not load that note.",
          tone: "warning"
        });
      });
  }, [activeNote, activeNoteSlug, notes, pushToast, replaceIndex, setNote]);

  async function openNote(slug: string): Promise<void> {
    try {
      setActiveNote(slug);

      if (!noteCache[slug]) {
        const note = await window.trellis.vault.readNote(slug);
        setNote(note);
      }
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that note.",
        tone: "warning"
      });
    }
  }

  function closeNewNoteForm(): void {
    setNewNoteOpen(false);
    setNewNoteTitle("");
  }

  async function handleCreateNewNote(): Promise<void> {
    const title = newNoteTitle.trim();

    if (title.length < 1) {
      pushToast({
        title: "Enter a title for the new note.",
        tone: "warning"
      });
      return;
    }

    if (title.length > 120) {
      pushToast({
        title: "Title must be 120 characters or fewer.",
        tone: "warning"
      });
      return;
    }

    setIsCreatingNote(true);

    try {
      const result = await window.trellis.vault.createStub({ title });
      setNote(result.note);
      setActiveNote(result.note.slug);
      const snapshot = await window.trellis.vault.listIndex();
      replaceIndex({
        notes: snapshot.notes,
        graph: snapshot.graph
      });
      navigate(`/wiki?note=${encodeURIComponent(result.note.slug)}`);
      closeNewNoteForm();
      pushToast({
        title: "Note created",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not create that note.",
        tone: "warning"
      });
    } finally {
      setIsCreatingNote(false);
    }
  }

  async function handleOpenLink(slug: string): Promise<void> {
    if (notes.some((note) => note.slug === slug)) {
      await openNote(slug);
      return;
    }

    const result = await window.trellis.vault.createStub({
      title: humanizeSlug(slug)
    });
    setNote(result.note);
    setActiveNote(result.note.slug);
    const snapshot = await window.trellis.vault.listIndex();
    replaceIndex({
      notes: snapshot.notes,
      graph: snapshot.graph
    });
    pushToast({
      title: "Stub note created",
      tone: "success"
    });
  }

  async function handleSaveTitle(title: string, slug: string): Promise<void> {
    const trimmed = title.trim();

    if (trimmed.length < 1) {
      pushToast({
        title: "Title cannot be empty.",
        tone: "warning"
      });
      return;
    }

    if (trimmed.length > 120) {
      pushToast({
        title: "Title must be 120 characters or fewer.",
        tone: "warning"
      });
      return;
    }

    const note = useWikiStore.getState().noteCache[slug];

    if (!note || note.slug !== slug) {
      return;
    }

    if (trimmed === note.title) {
      return;
    }

    try {
      const result = await window.trellis.vault.writeNote({
        slug: note.slug,
        title: trimmed,
        content: note.content,
        frontmatter: {
          tags: note.tags,
          type: note.type,
          sources: note.sources
        }
      });

      setNote(result.note);
      const snapshot = await window.trellis.vault.listIndex();
      replaceIndex({
        notes: snapshot.notes,
        graph: snapshot.graph
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that title.",
        tone: "error"
      });
    }
  }

  async function handleSave(content: string, slug: string): Promise<void> {
    const note = useWikiStore.getState().noteCache[slug];

    if (!note || note.slug !== slug) {
      return;
    }

    try {
      const result = await window.trellis.vault.writeNote({
        slug: note.slug,
        title: note.title,
        content,
        frontmatter: {
          tags: note.tags,
          type: note.type,
          sources: note.sources
        }
      });

      setNote(result.note);
      const snapshot = await window.trellis.vault.listIndex();
      replaceIndex({
        notes: snapshot.notes,
        graph: snapshot.graph
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that note.",
        tone: "error"
      });
    }
  }

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)] gap-6 p-6">
      <section className="trellis-panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-trellis-border px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-2xl text-trellis-text">Wiki</p>
            <button
              type="button"
              className="trellis-accent-button inline-flex shrink-0 items-center gap-2 rounded-field border px-3 py-2 text-sm transition"
              aria-expanded={newNoteOpen}
              onClick={() => {
                if (newNoteOpen) {
                  closeNewNoteForm();
                } else {
                  setNewNoteOpen(true);
                  queueMicrotask(() => {
                    newNoteTitleRef.current?.focus();
                  });
                }
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              New note
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="trellis-input mt-4"
            placeholder="Search notes…"
          />
          {newNoteOpen ? (
            <div className="mt-4 space-y-3">
              <input
                ref={newNoteTitleRef}
                value={newNoteTitle}
                onChange={(event) => setNewNoteTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateNewNote();
                  }
                  if (event.key === "Escape") {
                    closeNewNoteForm();
                  }
                }}
                className="trellis-input"
                placeholder="Title for the new note…"
                disabled={isCreatingNote}
                aria-label="Title for the new note"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="trellis-accent-button rounded-field border px-4 py-2 text-sm transition disabled:border-trellis-border disabled:opacity-60"
                  disabled={isCreatingNote}
                  onClick={() => {
                    void handleCreateNewNote();
                  }}
                >
                  Create
                </button>
                <button
                  type="button"
                  className="rounded-field border border-trellis-border px-4 py-2 text-sm text-trellis-muted transition hover:border-trellis-accent/25 hover:text-trellis-text"
                  disabled={isCreatingNote}
                  onClick={closeNewNoteForm}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="trellis-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {filteredNotes.map((note) => (
              <button
                key={note.slug}
                type="button"
                className={`w-full rounded-field border px-3 py-3 text-left transition ${
                  activeNoteSlug === note.slug
                    ? "trellis-selected-surface border-trellis-accent/25"
                    : "border-transparent hover:border-trellis-border hover:bg-trellis-surface-2"
                }`}
                onClick={() => {
                  void openNote(note.slug);
                }}
              >
                <p className="text-sm text-trellis-text">{note.title}</p>
                <p className="mt-1 text-xs leading-5 text-trellis-muted">{note.excerpt}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="trellis-panel min-h-0 overflow-hidden">
        {activeNote ? (
          <div className="flex h-full flex-col">
            <div className="trellis-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
              <NoteViewer
                note={activeNote}
                existingSlugs={notes.map((note) => note.slug)}
                editable
                variant="page"
                onOpenLink={(slug) => {
                  void handleOpenLink(slug);
                }}
                onSave={(content, slug) => {
                  void handleSave(content, slug);
                }}
                onSaveTitle={(title, slug) => {
                  void handleSaveTitle(title, slug);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <FileText className="h-8 w-8 text-trellis-accent/80" />
            <p className="mt-4 font-display text-2xl text-trellis-text">Choose a note</p>
            <p className="mt-2 max-w-md text-sm leading-7 text-trellis-muted">
              As chats and ingests accumulate, this becomes your living notebook rather
              than a disposable transcript list. Use{" "}
              <span className="text-trellis-text">New note</span> in the sidebar to start a
              page by hand.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
