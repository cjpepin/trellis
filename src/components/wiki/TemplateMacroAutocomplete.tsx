import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Braces } from "lucide-react";
import { templateMacroReference } from "@/lib/chatTemplates";
import { cn } from "@/lib/utils";
import { findTemplateMacroQuery } from "@/components/wiki/findTemplateMacroQuery";

interface Props {
  editor: Editor | null;
}

type MacroPick = {
  insert: string;
  filterText: string;
  description: string;
};

const MAX_ITEMS = 20;

function tokenFromMacro(macro: string): string {
  return macro.replace(/^\{\{|\}\}$/g, "");
}

function buildMacroPicks(): MacroPick[] {
  const picks: MacroPick[] = [];

  for (const row of templateMacroReference) {
    picks.push({
      insert: row.macro,
      filterText: tokenFromMacro(row.macro),
      description: row.description
    });

    for (const alias of row.aliases ?? []) {
      picks.push({
        insert: alias,
        filterText: tokenFromMacro(alias),
        description: row.description
      });
    }
  }

  return picks;
}

const MACRO_PICKS = buildMacroPicks();

function filterMacroPicks(query: string): MacroPick[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return MACRO_PICKS.slice(0, MAX_ITEMS);
  }

  const scored = MACRO_PICKS.map((pick) => {
    const ft = pick.filterText.toLowerCase();
    let score = 0;

    if (ft === q) {
      score = 3;
    } else if (ft.startsWith(q)) {
      score = 2;
    } else if (ft.includes(q)) {
      score = 1;
    }

    return { pick, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.pick.filterText.localeCompare(b.pick.filterText);
    })
    .map((x) => x.pick);

  return scored.slice(0, MAX_ITEMS);
}

function insertMacro(editor: Editor, from: number, to: number, insert: string): void {
  editor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContent({
      type: "text",
      text: insert
    })
    .run();
}

export function TemplateMacroAutocomplete({ editor }: Props): JSX.Element | null {
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

      const macro = findTemplateMacroQuery(ed);
      if (!macro) {
        setState(null);
        return;
      }

      const start = ed.view.coordsAtPos(macro.from);
      const end = ed.view.coordsAtPos(macro.to);
      const left = (start.left + end.right) / 2;
      const top = Math.max(start.bottom, end.bottom) + 4;

      setState((prev) => ({
        from: macro.from,
        to: macro.to,
        query: macro.query,
        top,
        left,
        activeIndex:
          prev?.from === macro.from && prev?.query === macro.query ? prev.activeIndex : 0
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
      const macro = findTemplateMacroQuery(ed);
      if (!macro) {
        return;
      }

      const start = ed.view.coordsAtPos(macro.from);
      const end = ed.view.coordsAtPos(macro.to);
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
      const macro = findTemplateMacroQuery(ed);
      if (!macro) {
        return;
      }

      const picks = filterMacroPicks(macro.query);

      if (picks.length === 0) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        ed.chain().focus().deleteRange({ from: macro.from, to: macro.to }).run();
        setState(null);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setState((s) =>
          s ? { ...s, activeIndex: Math.min(s.activeIndex + 1, picks.length - 1) } : null
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
          const m = findTemplateMacroQuery(ed);
          if (!s || !m) {
            return s;
          }

          const currentPicks = filterMacroPicks(m.query);
          if (currentPicks.length === 0) {
            return null;
          }

          const idx = Math.min(s.activeIndex, currentPicks.length - 1);
          const picked = currentPicks[idx];
          if (picked) {
            insertMacro(ed, m.from, m.to, picked.insert);
          }

          return null;
        });
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editor, state]);

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

  const picks = filterMacroPicks(state.query);

  if (picks.length === 0) {
    return null;
  }

  return createPortal(
    <div
      ref={listRef}
      className="fixed z-[250] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-panel border border-trellis-border bg-trellis-surface-2 py-1 shadow-[var(--trellis-elevated-shadow)]"
      style={{
        left: state.left,
        top: state.top,
        transform: "translate(-50%, 0)"
      }}
      role="listbox"
      aria-label="Template macros"
    >
      {picks.map((pick, i) => (
        <button
          key={`${pick.insert}-${pick.filterText}-${i}`}
          type="button"
          data-index={i}
          role="option"
          aria-selected={i === state.activeIndex}
          className={cn(
            "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition",
            i === state.activeIndex ? "trellis-selected-surface" : "hover:bg-trellis-surface"
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            const m = findTemplateMacroQuery(editor);
            if (!m) {
              return;
            }
            insertMacro(editor, m.from, m.to, pick.insert);
            setState(null);
          }}
        >
          <span className="flex items-center gap-2 text-sm text-trellis-text">
            <Braces className="h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{pick.insert}</span>
          </span>
          <span className="pl-[1.375rem] text-[11px] leading-4 text-trellis-faint">{pick.description}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
