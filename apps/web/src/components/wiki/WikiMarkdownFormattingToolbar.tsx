import { useEffect, useReducer, type RefObject } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table,
  Type,
  Underline
} from "lucide-react";
import { ListboxSelect } from "@/components/ListboxSelect";
import { WIKI_TEXT_COLORS } from "@/components/wiki/wikiEditorConstants";
import {
  cursorInPipeTable,
  insertHttpsLink,
  insertPipeTable,
  insertRaw,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeadingLevel,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleUnderline,
  wrapColoredSpan,
  insertHorizontalRule,
  type MarkdownEditResult,
  type MarkdownSourceSlice
} from "@/lib/wikiMarkdownSourceEdits";
import { normalizeExternalHttpsUrl } from "@trellis/shared/shell/externalHttpsUrl";
import { cn } from "@/lib/utils";

function toolbarButtonClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1 rounded-field border px-2 py-1.5 text-trellis-text transition",
    active
      ? "trellis-selected-surface border-trellis-accent/30"
      : "border-transparent bg-trellis-surface-2 hover:border-trellis-accent/25"
  );
}

export function WikiMarkdownFormattingToolbar({
  textareaRef,
  value,
  applyEdit,
  textColorFieldId,
  onPickImage
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  applyEdit: (edit: (slice: MarkdownSourceSlice) => MarkdownEditResult) => void;
  textColorFieldId: string;
  onPickImage: () => void;
}): JSX.Element {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) {
      return;
    }

    function refresh(): void {
      tick();
    }

    function onSelectionChange(): void {
      if (document.activeElement !== ta) {
        return;
      }
      tick();
    }

    ta.addEventListener("select", refresh);
    ta.addEventListener("keyup", refresh);
    ta.addEventListener("click", refresh);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      ta.removeEventListener("select", refresh);
      ta.removeEventListener("keyup", refresh);
      ta.removeEventListener("click", refresh);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [textareaRef, value]);

  const ta = textareaRef.current;
  const start = ta?.selectionStart ?? 0;
  const end = ta?.selectionEnd ?? 0;
  const inPipeTable = ta ? cursorInPipeTable(value, start) : false;

  function onLinkClick(): void {
    const raw = window.prompt("https link URL");
    if (raw === null) {
      return;
    }
    const normalized = normalizeExternalHttpsUrl(raw.trim());
    if (!normalized) {
      window.alert("Enter a valid https URL.");
      return;
    }
    applyEdit((s) => {
      const r = insertHttpsLink(s, normalized);
      if (!r) {
        return { value: s.value, selectionStart: s.start, selectionEnd: s.end };
      }
      return r;
    });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 bg-transparent px-1.5 py-1.5"
      role="toolbar"
      aria-label="Note formatting"
    >
      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Bold"
          onClick={() => {
            applyEdit(toggleBold);
          }}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Italic"
          onClick={() => {
            applyEdit(toggleItalic);
          }}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Underline"
          onClick={() => {
            applyEdit(toggleUnderline);
          }}
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Strikethrough"
          onClick={() => {
            applyEdit(toggleStrikethrough);
          }}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Inline code"
          onClick={() => {
            applyEdit(toggleInlineCode);
          }}
        >
          <Code className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Heading 1"
          onClick={() => {
            applyEdit((s) => toggleHeadingLevel(s, 1));
          }}
        >
          <Heading1 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Heading 2"
          onClick={() => {
            applyEdit((s) => toggleHeadingLevel(s, 2));
          }}
        >
          <Heading2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Heading 3"
          onClick={() => {
            applyEdit((s) => toggleHeadingLevel(s, 3));
          }}
        >
          <Heading3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Body text"
          onClick={() => {
            applyEdit((s) => toggleHeadingLevel(s, null));
          }}
        >
          <Type className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Bullet list"
          onClick={() => {
            applyEdit(toggleBulletList);
          }}
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Numbered list"
          onClick={() => {
            applyEdit(toggleOrderedList);
          }}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Quote"
          onClick={() => {
            applyEdit(toggleBlockquote);
          }}
        >
          <Quote className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Code block"
          onClick={() => {
            applyEdit(toggleCodeBlock);
          }}
        >
          <span className="font-mono text-[11px]">{`{ }`}</span>
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Horizontal rule"
          onClick={() => {
            applyEdit(insertHorizontalRule);
          }}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Link — add https address"
          title="Link — add an https link at the cursor"
          onClick={onLinkClick}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>

        <ListboxSelect
          id={textColorFieldId}
          variant="compact"
          ariaLabel="Text color"
          className="max-w-[7.5rem] self-center"
          options={WIKI_TEXT_COLORS.map((opt) => ({ id: opt.value, label: opt.label }))}
          value=""
          listboxAriaLabel="Text color"
          onSelect={(color) => {
            applyEdit((s) => wrapColoredSpan(s, color));
          }}
        />
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button type="button" className={toolbarButtonClass(false)} aria-label="Attach image" onClick={onPickImage}>
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Insert table"
          onClick={() => {
            applyEdit((s) => insertRaw(s, insertPipeTable()));
          }}
        >
          <Table className="h-3.5 w-3.5" />
        </button>
      </div>
      {inPipeTable ? (
        <>
          <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />
          <div className="flex flex-wrap items-center gap-0.5">
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Add column before"
              disabled
              title="Switch to preview to change table structure"
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">+ Col</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Delete column"
              disabled
              title="Switch to preview to change table structure"
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">- Col</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Add row after"
              disabled
              title="Switch to preview to change table structure"
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">+ Row</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Delete row"
              disabled
              title="Switch to preview to change table structure"
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">- Row</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Toggle header row"
              disabled
              title="Switch to preview to change table structure"
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">Header</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
