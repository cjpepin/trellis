import { useEffect, useId, useState } from "react";
import { CircleHelp, Plus, Trash2, X } from "lucide-react";
import type { WikiNote } from "@electron/ipc/types";
import { RichTextRenderer } from "@/components/shared/RichTextRenderer";
import { EditableNoteTitle } from "@/components/wiki/EditableNoteTitle";
import { WikiRichTextEditor } from "@/components/wiki/WikiRichTextEditor";
import { cn, formatDateLabel } from "@/lib/utils";

interface Props {
  note: WikiNote;
  existingSlugs: string[];
  /** For [[…]] autocomplete in the rich editor */
  wikiNotes?: Array<{ slug: string; title: string }>;
  allTags?: string[];
  editable?: boolean;
  variant?: "page" | "preview";
  onOpenLink: (slug: string, options?: { linkText?: string }) => void;
  onSave?: (content: string, slug: string) => void;
  onSaveTitle?: (title: string, slug: string) => void | Promise<void>;
  onSelectTag?: (tag: string) => void;
  onAddTag?: (tag: string) => void | Promise<void>;
  onRemoveTag?: (tag: string) => void | Promise<void>;
  onDeleteNote?: () => void | Promise<void>;
}

export function NoteViewer({
  note,
  existingSlugs,
  wikiNotes,
  allTags = [],
  editable = false,
  variant = "page",
  onOpenLink,
  onSave,
  onSaveTitle,
  onSelectTag,
  onAddTag,
  onRemoveTag,
  onDeleteNote
}: Props) {
  const isPage = variant === "page";
  const [tagDraft, setTagDraft] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const tagSuggestionsId = useId();

  useEffect(() => {
    setTagDraft("");
    setIsAddingTag(false);
  }, [note.slug]);
  const suggestedTags = allTags.filter((tag) => !note.tags.includes(tag));

  return (
    <article
      className={cn(
        isPage ? "trellis-document-page pt-4 md:pt-5" : "space-y-4"
      )}
    >
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", isPage ? "trellis-document-meta" : "text-xs text-trellis-muted")}>
        <span>{note.type}</span>
        <span>{note.sources} sources</span>
        <span>Updated {formatDateLabel(note.updated)}</span>
      </div>
      {isPage ? (
        <header className="mt-4 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {editable && onSaveTitle ? (
                <EditableNoteTitle title={note.title} slug={note.slug} onSaveTitle={onSaveTitle} />
              ) : (
                <h1 className="trellis-document-title">{note.title}</h1>
              )}
            </div>
            <div className="flex items-center gap-2">
              {editable ? (
                <button
                  type="button"
                  className="group relative inline-flex items-center rounded-full border border-trellis-border/80 px-2 py-2 text-trellis-faint transition hover:border-trellis-accent/25 hover:text-trellis-text"
                  aria-label="Editing tips"
                >
                  <CircleHelp className="h-4 w-4" />
                  <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2 text-left text-xs leading-6 text-trellis-muted shadow-lg group-hover:block">
                    Type [[ to link notes (autocomplete). Wiki links use [[brackets]] in the file; use the Link toolbar control for https links only. Cmd/Ctrl+click a wiki link to open or create the note; Cmd/Ctrl+click a web link to open in the browser.
                  </span>
                </button>
              ) : null}
              {editable && onDeleteNote ? (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-trellis-border px-2 py-2 text-trellis-muted transition hover:border-red-400/40 hover:text-red-200"
                  aria-label="Delete note"
                  title="Delete note"
                  onClick={() => {
                    void onDeleteNote();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="flex flex-wrap gap-2.5">
              {note.tags.map((tag) => (
                <div
                  key={tag}
                  className="flex items-center overflow-hidden rounded-full border border-trellis-border bg-trellis-surface-2"
                >
                  <button
                    type="button"
                    className="px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-trellis-muted transition hover:text-trellis-text"
                    onClick={() => onSelectTag?.(tag)}
                  >
                    {tag}
                  </button>
                  {editable && onRemoveTag ? (
                    <button
                      type="button"
                      className="border-l border-trellis-border px-2 py-1 text-trellis-faint transition hover:text-trellis-text"
                      aria-label={`Remove ${tag} tag`}
                      onClick={() => {
                        void onRemoveTag(tag);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ))}
              {editable && onAddTag ? (
                isAddingTag ? (
                  <div className="flex items-center rounded-full border border-trellis-accent/25 bg-trellis-surface-2 px-2 py-1">
                    <Plus className="h-3.5 w-3.5 text-trellis-faint" />
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setTagDraft("");
                          setIsAddingTag(false);
                          return;
                        }

                        if (event.key !== "Enter") {
                          return;
                        }

                        event.preventDefault();
                        const value = tagDraft.trim();
                        if (!value) {
                          return;
                        }

                        setTagDraft("");
                        setIsAddingTag(false);
                        void onAddTag(value);
                      }}
                      onBlur={() => {
                        if (tagDraft.trim().length === 0) {
                          setIsAddingTag(false);
                        }
                      }}
                      list={tagSuggestionsId}
                      className="min-w-[7rem] bg-transparent px-2 text-[11px] uppercase tracking-[0.14em] text-trellis-text outline-none placeholder:text-trellis-faint"
                      placeholder="tag"
                      aria-label="Add a tag"
                      autoFocus
                    />
                    <datalist id={tagSuggestionsId}>
                      {suggestedTags.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full border border-dashed border-trellis-border px-2.5 py-1 text-trellis-faint transition hover:border-trellis-accent/25 hover:text-trellis-text"
                    aria-label="Add tag"
                    title="Add tag"
                    onClick={() => {
                      setIsAddingTag(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )
              ) : null}
            </div>
          </div>
        </header>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="trellis-chip-surface rounded-tag border border-trellis-border px-2 py-1 text-xs text-trellis-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </>
      )}
      {editable && onSave ? (
        <WikiRichTextEditor
          key={note.slug}
          noteSlug={note.slug}
          markdown={note.content}
          existingSlugs={existingSlugs}
          wikiNotes={wikiNotes}
          className={cn("max-w-none", isPage ? "trellis-document-content" : "trellis-note-preview")}
          onOpenNote={onOpenLink}
          onSave={onSave}
        />
      ) : (
        <RichTextRenderer
          key={note.slug}
          markdown={note.content}
          existingSlugs={existingSlugs}
          className={cn("max-w-none", isPage ? "trellis-document-content" : "trellis-note-preview")}
          editable={editable}
          onOpenNote={onOpenLink}
          onSave={onSave ? (markdown) => onSave(markdown, note.slug) : undefined}
        />
      )}
    </article>
  );
}
