import type { WikiNote } from "@electron/ipc/types";
import { RichTextRenderer } from "@/components/shared/RichTextRenderer";
import { EditableNoteTitle } from "@/components/wiki/EditableNoteTitle";
import { InlineMarkdownEditor } from "@/components/wiki/InlineMarkdownEditor";
import { cn, formatDateLabel } from "@/lib/utils";

interface Props {
  note: WikiNote;
  existingSlugs: string[];
  editable?: boolean;
  variant?: "page" | "preview";
  onOpenLink: (slug: string) => void;
  onSave?: (content: string, slug: string) => void;
  onSaveTitle?: (title: string, slug: string) => void | Promise<void>;
}

export function NoteViewer({
  note,
  existingSlugs,
  editable = false,
  variant = "page",
  onOpenLink,
  onSave,
  onSaveTitle
}: Props) {
  const isPage = variant === "page";

  return (
    <article className={cn(isPage ? "trellis-document-page" : "space-y-4")}>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", isPage ? "trellis-document-meta" : "text-xs text-trellis-muted")}>
        <span>{note.type}</span>
        <span>{note.sources} sources</span>
        <span>Updated {formatDateLabel(note.updated)}</span>
      </div>
      {isPage ? (
        <header className="mt-5 border-b border-trellis-border/70 pb-6">
          {editable && onSaveTitle ? (
            <EditableNoteTitle title={note.title} slug={note.slug} onSaveTitle={onSaveTitle} />
          ) : (
            <h1 className="trellis-document-title">{note.title}</h1>
          )}
          {editable ? (
            <p className="mt-3 max-w-2xl text-sm leading-7 text-trellis-muted">
              Click the title or body to edit. Use Cmd/Ctrl+click on wiki links to open them while you’re
              writing.
            </p>
          ) : null}
          {note.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2.5">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="trellis-chip-surface rounded-full border border-trellis-border px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-trellis-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
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
        <InlineMarkdownEditor
          key={note.slug}
          noteSlug={note.slug}
          markdown={note.content}
          existingSlugs={existingSlugs}
          className={cn("max-w-none", isPage ? "trellis-document-content" : "trellis-note-preview")}
          onOpenNote={onOpenLink}
          onSave={onSave}
        />
      ) : (
        <RichTextRenderer
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
