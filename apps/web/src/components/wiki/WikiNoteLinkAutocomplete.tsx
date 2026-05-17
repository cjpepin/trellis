import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { FileText, Plus } from "lucide-react";
import { slugifyNoteTitle } from "@/lib/noteReferences";
import { cn } from "@/lib/utils";
import { findWikiBracketQuery } from "@/components/wiki/findWikiBracketQuery";
import { notesHashHref } from "@/lib/noteRoutes";

export interface WikiNoteSuggestion {
  slug: string;
  title: string;
}

interface Props {
  editor: Editor | null;
  notes: WikiNoteSuggestion[];
  existingSlugs: Set<string>;
}

const MAX_ITEMS = 8;

export function WikiNoteLinkAutocomplete({ editor, notes, existingSlugs }: Props): JSX.Element | null {
  const [state, setState] = useState<{
    from: number;
    to: number;
    query: string;
    top: number;
    left: number;
    activeIndex: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const ed = editor;

    function refresh(): void {
      if (!ed.isFocused) {
        setState(null);
        return;
      }

      const bracket = findWikiBracketQuery(ed);
      if (!bracket) {
        setState(null);
        return;
      }

      const start = ed.view.coordsAtPos(bracket.from);
      const end = ed.view.coordsAtPos(bracket.to);
      const left = (start.left + end.right) / 2;
      const top = Math.max(start.bottom, end.bottom) + 4;

      setState((prev) => ({
        from: bracket.from,
        to: bracket.to,
        query: bracket.query,
        top,
        left,
        activeIndex: prev?.from === bracket.from && prev?.query === bracket.query ? prev.activeIndex : 0
      }));
    }

    ed.on("selectionUpdate", refresh);
    ed.on("transaction", refresh);

    return () => {
      ed.off("selectionUpdate", refresh);
      ed.off("transaction", refresh);
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (!state || !editor) {
      return;
    }

    const ed = editor;

    function onScroll(): void {
      const bracket = findWikiBracketQuery(ed);
      if (!bracket) {
        return;
      }

      const start = ed.view.coordsAtPos(bracket.from);
      const end = ed.view.coordsAtPos(bracket.to);
      const left = (start.left + end.right) / 2;
      const top = Math.max(start.bottom, end.bottom) + 4;
      setState((s) => (s ? { ...s, top, left } : null));
    }

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [editor, state]);

  useEffect(() => {
    if (!state || !editor) {
      return;
    }

    const ed = editor;

    function onKeyDown(event: KeyboardEvent): void {
      const bracket = findWikiBracketQuery(ed);
      if (!bracket) {
        return;
      }

      const q = bracket.query.trim().toLowerCase();
      const filtered = notes
        .filter((n) => n.title.toLowerCase().includes(q))
        .slice(0, MAX_ITEMS);
      const slugNew = slugifyNoteTitle(bracket.query.trim());
      const showCreateRow =
        bracket.query.trim().length > 0 && Boolean(slugNew) && !existingSlugs.has(slugNew);
      const total = filtered.length + (showCreateRow ? 1 : 0);

      if (total === 0) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        ed.chain().focus().deleteRange({ from: bracket.from, to: bracket.to }).run();
        setState(null);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setState((s) =>
          s ? { ...s, activeIndex: Math.min(s.activeIndex + 1, total - 1) } : null
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setState((s) => (s ? { ...s, activeIndex: Math.max(s.activeIndex - 1, 0) } : null));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        setState((s) => {
          const b = findWikiBracketQuery(ed);
          if (!s || !b) {
            return s;
          }

          const qn = b.query.trim().toLowerCase();
          const filteredNotes = notes
            .filter((n) => n.title.toLowerCase().includes(qn))
            .slice(0, MAX_ITEMS);
          const slugPart = slugifyNoteTitle(b.query.trim());
          const showCreate =
            b.query.trim().length > 0 &&
            Boolean(slugPart) &&
            !existingSlugs.has(slugPart);
          const total = filteredNotes.length + (showCreate ? 1 : 0);
          const idx = Math.min(s.activeIndex, Math.max(total - 1, 0));

          if (idx < filteredNotes.length) {
            const picked = filteredNotes[idx];
            if (picked) {
              insertWikiLink(ed, b.from, b.to, picked.title);
            }
          } else if (showCreate) {
            insertWikiLink(ed, b.from, b.to, b.query.trim());
          }

          return null;
        });
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editor, existingSlugs, notes, state]);

  useEffect(() => {
    if (state === null || !listRef.current) {
      return;
    }

    const el = listRef.current.querySelector(`[data-index="${state.activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [state]);

  if (!editor || !state) {
    return null;
  }

  const q = state.query.trim().toLowerCase();
  const filtered = notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, MAX_ITEMS);
  const canCreate = state.query.trim().length > 0 && slugifyNoteTitle(state.query).length > 0;
  const slugForCreate = slugifyNoteTitle(state.query.trim());
  const createMissing = canCreate && slugForCreate && !existingSlugs.has(slugForCreate);
  const totalItems = filtered.length + (createMissing ? 1 : 0);

  if (totalItems === 0) {
    return null;
  }

  return createPortal(
    <div
      ref={listRef}
      className="fixed z-[250] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-panel border border-trellis-border bg-trellis-surface-2 py-1 shadow-[var(--trellis-elevated-shadow)]"
      style={{
        left: state.left,
        top: state.top,
        transform: "translate(-50%, 0)"
      }}
      role="listbox"
      aria-label="Link to note"
    >
      {filtered.map((note, i) => {
        const missing = !existingSlugs.has(note.slug);
        return (
          <button
            key={note.slug}
            type="button"
            data-index={i}
            role="option"
            aria-selected={i === state.activeIndex}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
              i === state.activeIndex ? "trellis-selected-surface" : "hover:bg-trellis-surface"
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              insertWikiLink(editor, state.from, state.to, note.title);
              setState(null);
            }}
          >
            <FileText className="h-4 w-4 shrink-0 text-trellis-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{note.title}</span>
            {missing ? (
              <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-trellis-faint">
                new
              </span>
            ) : null}
          </button>
        );
      })}
      {createMissing ? (
        <button
          type="button"
          data-index={filtered.length}
          role="option"
          aria-selected={filtered.length === state.activeIndex}
          className={cn(
            "flex w-full items-center gap-2 border-t border-trellis-border px-3 py-2 text-left text-sm transition",
            filtered.length === state.activeIndex ? "trellis-selected-surface" : "hover:bg-trellis-surface"
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            insertWikiLink(editor, state.from, state.to, state.query.trim());
            setState(null);
          }}
        >
          <Plus className="h-4 w-4 shrink-0 text-trellis-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Link “{state.query.trim()}”
            <span className="text-trellis-muted"> (create on follow)</span>
          </span>
        </button>
      ) : null}
    </div>,
    document.body
  );
}

function insertWikiLink(editor: Editor, from: number, to: number, title: string): void {
  const slug = slugifyNoteTitle(title);
  if (!slug) {
    return;
  }

  const href = notesHashHref(slug);

  editor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContent({
      type: "text",
      text: title,
      marks: [
        {
          type: "link",
          attrs: { href }
        }
      ]
    })
    .insertContent(" ")
    .run();
}
