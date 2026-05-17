import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Link2, Trash2, X } from "lucide-react";
import { isInternalNoteHashHref, notesHashHref } from "@/lib/noteRoutes";
import { slugifyNoteTitle } from "@/lib/noteReferences";

function readWikiLinkLabel(editor: Editor): string {
  const sel = { from: editor.state.selection.from, to: editor.state.selection.to };
  editor.chain().focus().extendMarkRange("link").run();
  const { from, to } = editor.state.selection;
  const label = editor.state.doc.textBetween(from, to, "");
  editor.chain().setTextSelection(sel).run();
  return label;
}

function applyLinkHref(editor: Editor, href: string, label: string): void {
  const { from, to } = editor.state.selection;

  if (from === to && editor.isActive("link")) {
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    return;
  }

  if (from === to) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: label,
        marks: [
          {
            type: "link",
            attrs: { href }
          }
        ]
      })
      .run();
    return;
  }

  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function resolveLinkInput(raw: string): { href: string; label: string } | "empty" | "invalid" {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return "empty";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { href: trimmed, label: trimmed };
  }

  const slug = slugifyNoteTitle(trimmed);

  if (!slug) {
    return "invalid";
  }

  return {
    href: notesHashHref(slug),
    label: trimmed
  };
}

interface Props {
  editor: Editor | null;
  manualOpen: boolean;
  onManualOpenChange: (open: boolean) => void;
}

export function WikiLinkEditBubble({ editor, manualOpen, onManualOpenChange }: Props): JSX.Element | null {
  const formId = useId();
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const inLink = Boolean(editor?.isActive("link"));
  const visible = Boolean(editor && manualOpen);

  useEffect(() => {
    if (!editor || !manualOpen) {
      return;
    }

    const ed = editor;

    function syncDraft(): void {
      if (ed.isActive("link")) {
        const href = ed.getAttributes("link").href;
        if (typeof href === "string" && isInternalNoteHashHref(href)) {
          setDraft(readWikiLinkLabel(ed));
        } else {
          setDraft(typeof href === "string" ? href : "");
        }
      } else {
        setDraft("");
      }
    }

    syncDraft();
    ed.on("selectionUpdate", syncDraft);

    return () => {
      ed.off("selectionUpdate", syncDraft);
    };
  }, [editor, manualOpen]);

  const updatePosition = useCallback(() => {
    if (!editor || !manualOpen) {
      setPos(null);
      return;
    }

    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const left = (start.left + end.right) / 2;
    const top = Math.max(start.bottom, end.bottom) + 6;
    setPos({ left, top });
  }, [editor, manualOpen]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, manualOpen]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const run = (): void => {
      updatePosition();
    };

    editor.on("selectionUpdate", run);
    editor.on("transaction", run);
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);

    return () => {
      editor.off("selectionUpdate", run);
      editor.off("transaction", run);
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
    };
  }, [editor, updatePosition]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target;

      if (target instanceof Element && target.closest('[role="toolbar"]')) {
        return;
      }

      if (target instanceof Element && target.closest('[role="listbox"]')) {
        return;
      }

      const el = bubbleRef.current;

      if (el?.contains(event.target as Node)) {
        return;
      }

      onManualOpenChange(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onManualOpenChange, visible]);

  const apply = useCallback(() => {
    if (!editor) {
      return;
    }

    const resolved = resolveLinkInput(draft);

    if (resolved === "invalid") {
      return;
    }

    if (resolved === "empty") {
      if (inLink) {
        editor.chain().focus().extendMarkRange("link").unsetLink().run();
      }

      onManualOpenChange(false);
      return;
    }

    applyLinkHref(editor, resolved.href, resolved.label);
    onManualOpenChange(false);
  }, [draft, editor, inLink, onManualOpenChange]);

  const removeLink = useCallback(() => {
    if (!editor || !inLink) {
      return;
    }

    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onManualOpenChange(false);
  }, [editor, inLink, onManualOpenChange]);

  const cancel = useCallback(() => {
    onManualOpenChange(false);
  }, [onManualOpenChange]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [cancel, visible]);

  if (!editor || !visible || !pos) {
    return null;
  }

  const draftTrim = draft.trim();
  const isWebUrl = /^https?:\/\//i.test(draftTrim);

  return createPortal(
    <div
      ref={bubbleRef}
      role="dialog"
      aria-label="Edit link"
      aria-modal="false"
      className="fixed z-[200] w-[min(22rem,calc(100vw-1.5rem))] rounded-panel border border-trellis-border bg-trellis-surface-2 p-2 shadow-[var(--trellis-elevated-shadow)]"
      style={{
        left: pos.left,
        top: pos.top,
        transform: "translate(-50%, 0)"
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <form
        id={formId}
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="block text-[11px] font-medium uppercase tracking-[0.12em] text-trellis-muted">
          {isWebUrl ? "Web URL" : "Linked note title"}
          <input
            type="text"
            className="trellis-input mt-1 w-full py-1.5 text-xs"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder={isWebUrl ? "https://…" : "Note title (saved as [[title]])"}
            autoComplete="off"
            autoFocus
          />
        </label>
        <p className="text-[11px] leading-relaxed text-trellis-muted">
          {isWebUrl
            ? "External links open in the browser. Cmd/Ctrl+click while editing."
            : "Internal links use [[brackets]] in the file. Cmd/Ctrl+click follows or creates the note. Clear and apply to remove."}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-field border border-trellis-accent/35 bg-trellis-accent-surface px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-trellis-text transition hover:border-trellis-accent/50"
          >
            <Link2 className="h-3.5 w-3.5" />
            Apply
          </button>
          {inLink ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-field border border-transparent bg-trellis-surface px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
              onClick={removeLink}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded-field border border-transparent px-2 py-1.5 text-[11px] uppercase tracking-[0.12em] text-trellis-muted transition hover:text-trellis-text"
            aria-label="Close"
            onClick={cancel}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
