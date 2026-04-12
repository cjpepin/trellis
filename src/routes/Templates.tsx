import { useMemo, useState } from "react";
import { FolderOpen, LayoutTemplate, LoaderCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  defaultNewTemplateMarkdown,
  isTemplateNote,
  templateMacroReference,
  templateTag
} from "@/lib/chatTemplates";
import { notesRoutePath } from "@/lib/noteRoutes";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

function formatFolderLabel(folderPath: string): string {
  return folderPath || "Root";
}

export function Templates() {
  const navigate = useNavigate();
  const notes = useWikiStore((state) => state.notes);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setNote = useWikiStore((state) => state.setNote);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const pushToast = useUiStore((state) => state.pushToast);
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const templateNotes = useMemo(() => {
    return [...notes.filter(isTemplateNote)].sort(
      (left, right) =>
        left.title.localeCompare(right.title) || right.updated.localeCompare(left.updated)
    );
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      return templateNotes;
    }

    return templateNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.excerpt.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [query, templateNotes]);

  async function handleCreateTemplate(): Promise<void> {
    const title = newTitle.trim();

    if (title.length < 1) {
      pushToast({
        title: "Enter a name for the template.",
        tone: "warning"
      });
      return;
    }

    setCreating(true);

    try {
      const result = await window.trellis.vault.writeNote({
        title,
        folderPath: "templates",
        content: defaultNewTemplateMarkdown(title),
        frontmatter: {
          tags: [templateTag],
          type: "concept",
          sources: 0
        }
      });
      const snapshot = await window.trellis.vault.listIndex();
      replaceIndex({
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      });
      setNote(result.note);
      setActiveNote(result.note.slug);
      setNewTitle("");
      navigate(notesRoutePath(result.note.slug));
      pushToast({
        title: `${title} saved as a template.`,
        tone: "success",
        noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not create that template.",
        tone: "warning"
      });
    } finally {
      setCreating(false);
    }
  }

  function openInNotes(slug: string): void {
    setActiveNote(slug);
    navigate(notesRoutePath(slug));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-trellis-bg">
      <header className="shrink-0 border-b border-trellis-border px-6 py-6 md:px-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-3">
              <LayoutTemplate className="h-7 w-7 text-trellis-accent" aria-hidden />
              <h1 className="font-display text-3xl text-trellis-text">Templates</h1>
            </div>
            <p className="mt-3 text-sm leading-7 text-trellis-muted">
              Reusable structures for new notes. Templates are vault notes tagged{" "}
              <span className="text-trellis-text">{templateTag}</span>, usually under{" "}
              <code className="rounded-tag bg-trellis-surface-2 px-1.5 py-0.5 font-mono text-xs text-trellis-muted">
                wiki/templates
              </code>
              . They appear when you start a note from the wiki or use a template in chat.
            </p>
            <details className="mt-4 rounded-field border border-trellis-border bg-trellis-surface/80 px-4 py-3 text-sm text-trellis-muted">
              <summary className="cursor-pointer select-none font-medium text-trellis-text">
                Placeholder macros for new notes
              </summary>
              <p className="mt-3 text-xs leading-5 text-trellis-faint">
                Use double curly braces in the template body. When you create a note from the template,
                Trellis substitutes the values below (local date and time).
              </p>
              <ul className="mt-3 space-y-2 border-t border-trellis-border pt-3 font-mono text-[11px] leading-5 text-trellis-muted">
                {templateMacroReference.map((row) => (
                  <li key={row.macro}>
                    <span className="text-trellis-accent">{row.macro}</span>
                    {row.aliases && row.aliases.length > 0 ? (
                      <span className="text-trellis-faint">
                        {" "}
                        ({row.aliases.join(", ")})
                      </span>
                    ) : null}
                    <span className="block font-sans text-[11px] text-trellis-faint">{row.description}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <div
            className="flex w-full flex-col gap-3 rounded-panel border border-trellis-border bg-trellis-surface p-4 sm:max-w-md lg:w-[min(100%,380px)]"
            data-testid="templates-new-form"
          >
            <label className="text-[10px] uppercase tracking-[0.18em] text-trellis-faint">
              New template
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={newTitle}
                placeholder="Name (e.g. Weekly review)"
                className="trellis-input min-w-0 flex-1"
                aria-label="New template name"
                disabled={creating}
                onChange={(event) => {
                  setNewTitle(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateTemplate();
                  }
                }}
              />
              <button
                type="button"
                className={cn(
                  "trellis-accent-button inline-flex shrink-0 items-center justify-center gap-2 rounded-field border border-trellis-accent/25 px-4 py-2.5 text-sm transition",
                  creating && "pointer-events-none opacity-70"
                )}
                disabled={creating}
                onClick={() => {
                  void handleCreateTemplate();
                }}
              >
                {creating ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                Create
              </button>
            </div>
            <p className="text-xs leading-5 text-trellis-faint">
              Opens in Notes so you can edit the body and prompts.
            </p>
          </div>
        </div>
      </header>

      <div className="trellis-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8 md:px-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search templates by title or excerpt…"
              className="trellis-input w-full"
              aria-label="Search templates"
            />
          </div>

          {templateNotes.length === 0 ? (
            <div className="rounded-panel border border-dashed border-trellis-border bg-trellis-surface/60 px-6 py-12 text-center">
              <p className="font-display text-xl text-trellis-text">No templates yet</p>
              <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-trellis-muted">
                Create one with the form above, or ask Trellis in chat to draft a reusable template
                and approve it when you are ready to save it to the vault.
              </p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <p className="text-sm text-trellis-muted">No templates match that search.</p>
          ) : (
            <ul className="grid gap-3" data-testid="templates-list">
              {filteredNotes.map((note) => (
                <li key={note.slug}>
                  <button
                    type="button"
                    className="group flex w-full flex-col gap-2 rounded-panel border border-trellis-border bg-trellis-surface px-4 py-4 text-left transition hover:border-trellis-accent/35 hover:bg-trellis-surface-2"
                    onClick={() => {
                      openInNotes(note.slug);
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 font-medium text-trellis-text">{note.title}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-trellis-muted">
                        <FolderOpen className="h-3.5 w-3.5 text-trellis-faint" aria-hidden />
                        {formatFolderLabel(note.folderPath)}
                      </span>
                    </div>
                    {note.excerpt.trim().length > 0 ? (
                      <p className="line-clamp-2 text-sm text-trellis-muted">{note.excerpt}</p>
                    ) : (
                      <p className="text-sm italic text-trellis-faint">No preview yet.</p>
                    )}
                    <span className="text-[11px] text-trellis-accent/90 opacity-0 transition group-hover:opacity-100">
                      Open in Notes
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
