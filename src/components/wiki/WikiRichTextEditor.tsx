import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import type { AppWorkspaceId } from "@electron/ipc/types";
import type { Editor } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table/kit";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { WikiAwareLink } from "@/components/wiki/wikiAwareLink";
import { WikiNoteLinkAutocomplete } from "@/components/wiki/WikiNoteLinkAutocomplete";
import {
  Bold,
  Code,
  Eye,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Image as ImageIcon,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Trash2,
  Type,
  Underline,
  Undo2
} from "lucide-react";
import { renderWikiMarkdown } from "@/lib/markdown";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";
import { fileToBase64, resolveRenderedNoteImages } from "@/lib/noteAssets";
import { isInternalNoteHashHref, slugFromInternalNoteHashHref } from "@/lib/noteRoutes";
import { cn } from "@/lib/utils";
import { normalizeExternalHttpsUrl } from "@shared/shell/externalHttpsUrl";
import { ListboxSelect } from "@/components/ListboxSelect";
import { WikiLinkEditBubble } from "@/components/wiki/WikiLinkEditBubble";
import {
  usePersistedNoteEditorViewMode,
  type NoteEditorViewMode
} from "@/hooks/usePersistedNoteEditorViewMode";
import { useMarkdownUndoRedo } from "@/hooks/useMarkdownUndoRedo";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { insertMarkdownImage, type MarkdownEditResult, type MarkdownSourceSlice } from "@/lib/wikiMarkdownSourceEdits";
import { WikiMarkdownFormattingToolbar } from "@/components/wiki/WikiMarkdownFormattingToolbar";
import { WIKI_TEXT_COLORS } from "@/components/wiki/wikiEditorConstants";

/** Matches rich-text and markdown editing surfaces to the available note column (~viewport minus chrome). */
const NOTE_EDITOR_BODY_MIN_HEIGHT_CLASS = "min-h-[max(12rem,calc(100dvh-13.5rem))]";

const WIKI_NOTE_COLUMN_SCROLL_SELECTOR = "[data-trellis-wiki-note-scroll]";

/** After this idle period following an edit, a user strand revision checkpoint is recorded (if content changed). */
const STRAND_REVISION_IDLE_MS = 45_000;

interface WikiNoteSummary {
  slug: string;
  title: string;
}

function isInternalNoteLinkHref(href: unknown): href is string {
  return typeof href === "string" && isInternalNoteHashHref(href);
}

interface Props {
  /** When set, note editor view mode (preview vs markdown) is persisted per workspace. */
  workspaceId?: AppWorkspaceId;
  noteSlug: string;
  noteRelativePath: string;
  markdown: string;
  existingSlugs: string[];
  /** Titles for [[…]] autocomplete and missing-link hints */
  wikiNotes?: WikiNoteSummary[];
  className?: string;
  onOpenNote?: (slug: string, options?: { linkText?: string }) => void;
  onSave?: (
    markdown: string,
    slug: string,
    options?: { recordStrandRevision?: boolean }
  ) => void | Promise<void>;
}

export type WikiRichTextPreviewPanelHandle = {
  flushMarkdown: () => string;
};

type WikiRichTextPreviewPanelProps = Omit<Props, "workspaceId"> & {
  viewModeToggle: ReactNode;
};

function toolbarButtonClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1 rounded-field border px-2 py-1.5 text-trellis-text transition",
    active
      ? "trellis-selected-surface border-trellis-accent/30"
      : "border-transparent bg-trellis-surface-2 hover:border-trellis-accent/25"
  );
}

function WikiEditorToolbar({
  editor,
  onOpenLinkBubble,
  onPickImage
}: {
  editor: Editor | null;
  onOpenLinkBubble: () => void;
  onPickImage: () => void;
}): JSX.Element | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const textColorFieldId = useId();

  useEffect(() => {
    if (!editor) {
      return;
    }

    const refresh = (): void => {
      tick();
    };

    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);

    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  const instance = editor;
  const textStyle = instance.getAttributes("textStyle") as { color?: string };
  const currentColor = typeof textStyle.color === "string" ? textStyle.color : "";
  const colorSelectValue = WIKI_TEXT_COLORS.some((o) => o.value === currentColor)
    ? currentColor
    : "";

  const linkHref = instance.getAttributes("link").href;
  const isInternalNoteLink = instance.isActive("link") && isInternalNoteLinkHref(linkHref);

  return (
    <div
      className="flex flex-wrap items-center gap-1 bg-transparent px-1.5 py-1.5"
      role="toolbar"
      aria-label="Note formatting"
    >
      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("bold"))}
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("italic"))}
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("underline"))}
          aria-label="Underline"
          aria-pressed={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("strike"))}
          aria-label="Strikethrough"
          aria-pressed={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("code"))}
          aria-label="Inline code"
          aria-pressed={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("heading", { level: 1 }))}
          aria-label="Heading 1"
          aria-pressed={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("heading", { level: 2 }))}
          aria-label="Heading 2"
          aria-pressed={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("heading", { level: 3 }))}
          aria-label="Heading 3"
          aria-pressed={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(
            editor.isActive("paragraph") && !editor.isActive("heading")
          )}
          aria-label="Body text"
          aria-pressed={editor.isActive("paragraph") && !editor.isActive("heading")}
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          <Type className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("bulletList"))}
          aria-label="Bullet list"
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("orderedList"))}
          aria-label="Numbered list"
          aria-pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("blockquote"))}
          aria-label="Quote"
          aria-pressed={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("codeBlock"))}
          aria-label="Code block"
          aria-pressed={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <span className="font-mono text-[11px]">{`{ }`}</span>
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(editor.isActive("link") && !isInternalNoteLink)}
          aria-label={
            isInternalNoteLink
              ? "Link — note links are edited as text"
              : editor.isActive("link")
                ? "Link — edit https link"
                : "Link — add https address"
          }
          title={
            isInternalNoteLink
              ? "Link — links to other notes use [[note title]] in the text. Use this control for https addresses only."
              : editor.isActive("link")
                ? "Link — edit the selected https link"
                : "Link — add an https link at the cursor"
          }
          aria-pressed={editor.isActive("link") && !isInternalNoteLink}
          onClick={() => {
            editor.chain().focus().run();
            if (isInternalNoteLink) {
              return;
            }
            onOpenLinkBubble();
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>

        <ListboxSelect
          id={textColorFieldId}
          variant="compact"
          ariaLabel="Text color"
          className="max-w-[7.5rem] self-center"
          options={WIKI_TEXT_COLORS.map((opt) => ({ id: opt.value, label: opt.label }))}
          value={colorSelectValue}
          listboxAriaLabel="Text color"
          onSelect={(value) => {
            if (value === "") {
              editor.chain().focus().unsetColor().run();
              return;
            }

            editor.chain().focus().setColor(value).run();
          }}
        />
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Attach image"
          onClick={onPickImage}
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Insert table"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <Table className="h-3.5 w-3.5" />
        </button>
        {editor.isActive("table") ? (
          <button
            type="button"
            className={toolbarButtonClass(false)}
            aria-label="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {editor.isActive("table") ? (
        <>
          <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />
          <div className="flex flex-wrap items-center gap-0.5">
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Add column before"
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">+ Col</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Delete column"
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">- Col</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Add row after"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">+ Row</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Delete row"
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">- Row</span>
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Toggle header row"
              onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            >
              <span className="text-[11px] uppercase tracking-[0.12em]">Header</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function WikiImageSelectionControls({ editor }: { editor: Editor | null }): JSX.Element | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const refresh = (): void => {
      tick();
    };

    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);

    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  if (!editor || !editor.isActive("image")) {
    return null;
  }

  const attrs = editor.getAttributes("image") as { alt?: string };

  return (
    <div className="border-t border-trellis-border bg-trellis-surface px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-trellis-muted">
          Alt
          <input
            className="trellis-input min-w-0 flex-1 py-1.5 text-xs normal-case tracking-normal"
            value={attrs.alt ?? ""}
            onChange={(event) => {
              editor.chain().focus().updateAttributes("image", { alt: event.target.value }).run();
            }}
            placeholder="Describe this image"
          />
        </label>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-field border border-transparent bg-trellis-surface-2 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
          onClick={() => editor.chain().focus().deleteSelection().run()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove image
        </button>
      </div>
    </div>
  );
}

function NoteEditorViewModeToggle({
  viewMode,
  onChange
}: {
  viewMode: NoteEditorViewMode;
  onChange: (mode: NoteEditorViewMode) => void | Promise<void>;
}): JSX.Element {
  const segmentClass = (active: boolean): string =>
    cn(
      "inline-flex h-8 w-8 items-center justify-center rounded-[calc(var(--radius-field)-2px)] transition",
      active ? "trellis-selected-surface text-trellis-text" : "text-trellis-muted hover:text-trellis-text"
    );

  return (
    <div
      className="inline-flex rounded-field border border-trellis-border bg-trellis-surface-2 p-0.5 shadow-[inset_0_1px_0_var(--trellis-border)]"
      data-testid="note-editor-view-mode"
      role="group"
      aria-label="Note content view"
    >
      <button
        type="button"
        className={segmentClass(viewMode === "preview")}
        aria-label="Preview — rich text"
        title="Preview — formatted note"
        aria-pressed={viewMode === "preview"}
        onClick={() => {
          void onChange("preview");
        }}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className={segmentClass(viewMode === "markdown")}
        aria-label="Markdown — source"
        title="Markdown — plain source"
        aria-pressed={viewMode === "markdown"}
        onClick={() => {
          void onChange("markdown");
        }}
      >
        <FileCode className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function NoteEditorTopBar({
  editor,
  markdownUndo,
  viewModeToggle
}: {
  editor: Editor | null;
  markdownUndo?: {
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
  };
  viewModeToggle: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-trellis-border/80 px-2 py-2">
      <div className="flex min-w-0 shrink-0 items-center gap-0.5">
        {editor ? (
          <>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Undo"
              title="Undo"
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Redo"
              title="Redo"
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : markdownUndo ? (
          <>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Undo"
              title="Undo"
              disabled={!markdownUndo.canUndo}
              onClick={() => {
                markdownUndo.onUndo();
              }}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonClass(false)}
              aria-label="Redo"
              title="Redo"
              disabled={!markdownUndo.canRedo}
              onClick={() => {
                markdownUndo.onRedo();
              }}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
      </div>
      <div className="shrink-0">{viewModeToggle}</div>
    </div>
  );
}

const WikiRichTextPreviewPanel = forwardRef<WikiRichTextPreviewPanelHandle, WikiRichTextPreviewPanelProps>(
  function WikiRichTextPreviewPanel(
    {
      noteSlug,
      noteRelativePath,
      markdown,
      existingSlugs,
      wikiNotes = [],
      className,
      onOpenNote,
      onSave,
      viewModeToggle
    },
    ref
  ): ReactElement {
  const [manualLinkOpen, setManualLinkOpen] = useState(false);
  const [imageImportError, setImageImportError] = useState<string | null>(null);
  const rendered = useMemo(
    () => renderWikiMarkdown(markdown, new Set(existingSlugs)),
    [existingSlugs, markdown]
  );

  const saveTimerRef = useRef<number | null>(null);
  const revisionIdleTimerRef = useRef<number | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const pendingSlugRef = useRef<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const clearRevisionIdle = useCallback(() => {
    if (revisionIdleTimerRef.current !== null) {
      window.clearTimeout(revisionIdleTimerRef.current);
      revisionIdleTimerRef.current = null;
    }
  }, []);

  const scheduleRevisionIdle = useCallback(() => {
    clearRevisionIdle();
    revisionIdleTimerRef.current = window.setTimeout(() => {
      revisionIdleTimerRef.current = null;
      const ed = editorRef.current;
      if (!ed || !onSaveRef.current) {
        return;
      }

      void onSaveRef.current(htmlToMarkdown(ed.getHTML()), noteSlug, {
        recordStrandRevision: true
      });
    }, STRAND_REVISION_IDLE_MS);
  }, [clearRevisionIdle, noteSlug]);

  const scheduleSave = useCallback(
    (html: string) => {
      if (!onSaveRef.current) {
        return;
      }

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      const md = htmlToMarkdown(html);
      pendingMarkdownRef.current = md;
      pendingSlugRef.current = noteSlug;

      scheduleRevisionIdle();

      saveTimerRef.current = window.setTimeout(() => {
        const markdownToSave = pendingMarkdownRef.current;
        const slug = pendingSlugRef.current;
        pendingMarkdownRef.current = null;
        pendingSlugRef.current = null;
        saveTimerRef.current = null;

        if (markdownToSave !== null && slug) {
          void onSaveRef.current?.(markdownToSave, slug);
        }
      }, 500);
    },
    [noteSlug, scheduleRevisionIdle]
  );

  useImperativeHandle(
    ref,
    () => ({
      flushMarkdown: (): string => {
        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }

        pendingMarkdownRef.current = null;
        pendingSlugRef.current = null;

        const ed = editorRef.current;
        const md = ed ? htmlToMarkdown(ed.getHTML()) : markdown;
        void onSaveRef.current?.(md, noteSlug, { recordStrandRevision: true });
        return md;
      }
    }),
    [markdown, noteSlug]
  );

  const importImageFromCache = useCallback(
    async (fileId: string, label: string): Promise<void> => {
      const editorInstance = editorRef.current;

      if (!editorInstance) {
        return;
      }

      const alt = label.replace(/\.[a-z0-9]+$/i, "").trim() || "Attached image";
      const imported = await window.trellis.vault.importNoteImage({
        fileId,
        noteRelativePath,
        alt
      });

      editorInstance.chain().focus().setImage({
        src: imported.markdownPath,
        alt: imported.alt
      }).run();
      resolveRenderedNoteImages(editorInstance.view.dom, noteRelativePath);
    },
    [noteRelativePath]
  );

  const importImageFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      const images = files.filter((file) => file.type.startsWith("image/"));

      if (images.length === 0) {
        return false;
      }

      setImageImportError(null);

      try {
        for (const file of images) {
          const base64 = await fileToBase64(file);
          const cached = await window.trellis.media.writeCache({
            base64,
            mimeType: file.type
          });
          await importImageFromCache(cached.fileId, file.name);
        }
      } catch (error) {
        setImageImportError(
          error instanceof Error ? error.message : "Could not attach that image."
        );
      }

      return true;
    },
    [importImageFromCache]
  );

  const pickImage = useCallback(() => {
    void (async () => {
      setImageImportError(null);
      try {
        const picked = await window.trellis.media.pickImage();

        if (!picked) {
          return;
        }

        await importImageFromCache(picked.fileId, picked.name);
      } catch (error) {
        setImageImportError(
          error instanceof Error ? error.message : "Could not attach that image."
        );
      }
    })();
  }, [importImageFromCache]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        },
        link: false
      }),
      WikiAwareLink.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {}
      }),
      TableKit.configure({
        table: { resizable: true }
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {}
      }),
      TextStyle,
      Color.configure({
        types: ["textStyle"]
      })
    ],
    []
  );

  const existingSlugSet = useMemo(() => new Set(existingSlugs), [existingSlugs]);

  const prevNoteSlugForPropSyncRef = useRef<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: rendered.html,
    editorProps: {
      attributes: {
        class: cn(
          "trellis-rich-text max-w-none px-2 py-2 text-sm leading-7 text-trellis-text outline-none",
          NOTE_EDITOR_BODY_MIN_HEIGHT_CLASS,
          className
        )
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);

        if (files.length === 0) {
          return false;
        }

        void importImageFiles(files);
        return files.some((file) => file.type.startsWith("image/"));
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []);

        if (files.length === 0) {
          return false;
        }

        void importImageFiles(files);
        return files.some((file) => file.type.startsWith("image/"));
      }
    },
    onCreate({ editor: instance }) {
      editorRef.current = instance;
      resolveRenderedNoteImages(instance.view.dom, noteRelativePath);
    },
    onDestroy() {
      editorRef.current = null;
    },
    onUpdate({ editor: instance }) {
      scheduleSave(instance.getHTML());
      resolveRenderedNoteImages(instance.view.dom, noteRelativePath);
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    function onBlur(): void {
      const ed = editorRef.current;
      if (!ed || !onSaveRef.current) {
        return;
      }

      void onSaveRef.current(htmlToMarkdown(ed.getHTML()), noteSlug, {
        recordStrandRevision: true
      });
    }

    editor.on("blur", onBlur);
    return () => {
      editor.off("blur", onBlur);
    };
  }, [editor, noteSlug]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const prevSlug = prevNoteSlugForPropSyncRef.current;
    if (prevSlug === noteSlug) {
      return;
    }
    prevNoteSlugForPropSyncRef.current = noteSlug;

    if (editor.isFocused) {
      return;
    }

    editor.commands.setContent(rendered.html, {
      emitUpdate: false
    });
    resolveRenderedNoteImages(editor.view.dom, noteRelativePath);
  }, [editor, noteRelativePath, rendered.html, noteSlug]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      clearRevisionIdle();

      const pendingMd = pendingMarkdownRef.current;
      const slug = pendingSlugRef.current;
      pendingMarkdownRef.current = null;
      pendingSlugRef.current = null;

      if (pendingMd !== null && slug) {
        onSaveRef.current?.(pendingMd, slug, { recordStrandRevision: true });
      }
    };
  }, [clearRevisionIdle]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const ed = editor;

    function closeBubbleIfWikiLink(): void {
      if (!manualLinkOpen) {
        return;
      }

      if (ed.isActive("link") && isInternalNoteLinkHref(ed.getAttributes("link").href)) {
        setManualLinkOpen(false);
      }
    }

    ed.on("selectionUpdate", closeBubbleIfWikiLink);
    ed.on("transaction", closeBubbleIfWikiLink);
    return () => {
      ed.off("selectionUpdate", closeBubbleIfWikiLink);
      ed.off("transaction", closeBubbleIfWikiLink);
    };
  }, [editor, manualLinkOpen]);

  const openLinkBubbleAfterSelection = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setManualLinkOpen(true);
      });
    });
  }, []);

  const [modifierNav, setModifierNav] = useState(false);

  useEffect(() => {
    function syncModifier(ev: KeyboardEvent | MouseEvent): void {
      setModifierNav(ev.metaKey || ev.ctrlKey);
    }

    function onKeyDown(ev: KeyboardEvent): void {
      syncModifier(ev);
    }

    function onKeyUp(ev: KeyboardEvent): void {
      syncModifier(ev);
    }

    function onWindowBlur(): void {
      setModifierNav(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  return (
    <div
      className="trellis-panel isolate flex flex-col"
      onClick={(event) => {
        const target = event.target;

        if (!(target instanceof HTMLElement)) {
          return;
        }

        const link = target.closest("a");

        if (!link) {
          return;
        }

        const href = link.getAttribute("href");

        if (href && isInternalNoteHashHref(href)) {
          event.preventDefault();

          if (onOpenNote && (event.metaKey || event.ctrlKey)) {
            const slug = slugFromInternalNoteHashHref(href);
            if (!slug) {
              return;
            }
            const linkText = link.textContent?.trim();
            onOpenNote(slug, { linkText });
            return;
          }

          return;
        }

        const externalHttps = href ? normalizeExternalHttpsUrl(href) : null;

        if (externalHttps) {
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            void window.trellis.shell.openExternal(externalHttps);
            return;
          }

          event.preventDefault();
          openLinkBubbleAfterSelection();
        }
      }}
    >
      <div className="sticky top-0 z-20 shrink-0 border-b border-trellis-border bg-trellis-surface shadow-[0_1px_0_var(--trellis-border)]">
        <NoteEditorTopBar editor={editor} viewModeToggle={viewModeToggle} />
        <WikiEditorToolbar
          editor={editor}
          onPickImage={pickImage}
          onOpenLinkBubble={() => {
            setManualLinkOpen(true);
          }}
        />
        <WikiImageSelectionControls editor={editor} />
        {imageImportError ? (
          <p className="border-t border-trellis-border px-3 py-2 text-xs text-trellis-accent">
            {imageImportError}
          </p>
        ) : null}
      </div>
      <WikiLinkEditBubble
        editor={editor}
        manualOpen={manualLinkOpen}
        onManualOpenChange={setManualLinkOpen}
      />
      <WikiNoteLinkAutocomplete
        editor={editor}
        notes={wikiNotes}
        existingSlugs={existingSlugSet}
      />
      <div
        className={cn(
          "relative z-0 min-w-0 bg-trellis-surface",
          modifierNav && "trellis-rich-text-modifier-nav"
        )}
        onMouseMove={(event) => {
          setModifierNav(event.metaKey || event.ctrlKey);
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
  }
);

export function WikiRichTextEditor(props: Props): ReactElement {
  const {
    workspaceId: workspaceIdProp,
    noteSlug,
    noteRelativePath,
    markdown,
    existingSlugs,
    wikiNotes,
    className,
    onOpenNote,
    onSave
  } = props;
  const workspaceId = workspaceIdProp ?? getActiveWorkspaceId();
  const { viewMode, setViewMode } = usePersistedNoteEditorViewMode(workspaceId);
  const previewRef = useRef<WikiRichTextPreviewPanelHandle | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState(markdown);
  const mdSaveTimerRef = useRef<number | null>(null);
  const mdRevisionIdleTimerRef = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const markdownDraftRef = useRef(markdownDraft);
  markdownDraftRef.current = markdownDraft;
  const markdownPropRef = useRef(markdown);
  markdownPropRef.current = markdown;
  const prevNoteSlugForDraftRef = useRef<string | null>(null);
  const noteSlugRef = useRef(noteSlug);
  noteSlugRef.current = noteSlug;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const clearMdRevisionIdle = useCallback(() => {
    if (mdRevisionIdleTimerRef.current !== null) {
      window.clearTimeout(mdRevisionIdleTimerRef.current);
      mdRevisionIdleTimerRef.current = null;
    }
  }, []);

  const scheduleMdRevisionIdle = useCallback(() => {
    clearMdRevisionIdle();
    mdRevisionIdleTimerRef.current = window.setTimeout(() => {
      mdRevisionIdleTimerRef.current = null;
      if (!onSaveRef.current) {
        return;
      }

      void onSaveRef.current(markdownDraftRef.current, noteSlug, {
        recordStrandRevision: true
      });
    }, STRAND_REVISION_IDLE_MS);
  }, [clearMdRevisionIdle, noteSlug]);

  useEffect(() => {
    return () => {
      if (mdSaveTimerRef.current) {
        window.clearTimeout(mdSaveTimerRef.current);
        mdSaveTimerRef.current = null;
      }

      clearMdRevisionIdle();

      if (viewModeRef.current === "markdown" && onSaveRef.current) {
        void onSaveRef.current(markdownDraftRef.current, noteSlugRef.current, {
          recordStrandRevision: true
        });
      }
    };
  }, [clearMdRevisionIdle]);

  const scheduleMarkdownSave = useCallback(
    (next: string) => {
      if (!onSaveRef.current) {
        return;
      }

      scheduleMdRevisionIdle();

      if (mdSaveTimerRef.current) {
        window.clearTimeout(mdSaveTimerRef.current);
      }

      mdSaveTimerRef.current = window.setTimeout(() => {
        mdSaveTimerRef.current = null;
        void onSaveRef.current?.(next, noteSlug);
      }, 500);
    },
    [noteSlug, scheduleMdRevisionIdle]
  );

  const scheduleMarkdownSaveRef = useRef(scheduleMarkdownSave);
  scheduleMarkdownSaveRef.current = scheduleMarkdownSave;

  const {
    commitBeforeEdit,
    undo: mdUndo,
    redo: mdRedo,
    canUndo: mdCanUndo,
    canRedo: mdCanRedo,
    onTextareaIdleInput,
    syncAnchor,
    reset: resetMdUndo
  } = useMarkdownUndoRedo(markdownDraft, setMarkdownDraft, noteSlug);

  useEffect(() => {
    if (prevNoteSlugForDraftRef.current === noteSlug) {
      return;
    }
    prevNoteSlugForDraftRef.current = noteSlug;
    const next = markdownPropRef.current;
    setMarkdownDraft(next);
    resetMdUndo(next);
  }, [noteSlug, resetMdUndo]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textColorFieldId = useId();
  const [mdImageError, setMdImageError] = useState<string | null>(null);

  const applyMarkdownEdit = useCallback(
    (edit: (s: MarkdownSourceSlice) => MarkdownEditResult) => {
      const ta = textareaRef.current;
      if (!ta) {
        return;
      }
      commitBeforeEdit();
      const slice: MarkdownSourceSlice = {
        value: markdownDraftRef.current,
        start: ta.selectionStart,
        end: ta.selectionEnd
      };
      const result = edit(slice);
      setMarkdownDraft(result.value);
      syncAnchor(result.value);
      scheduleMarkdownSaveRef.current(result.value);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [commitBeforeEdit, syncAnchor]
  );

  const importImageFromCacheMd = useCallback(
    async (fileId: string, label: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        return;
      }

      const alt = label.replace(/\.[a-z0-9]+$/i, "").trim() || "Attached image";
      commitBeforeEdit();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      const imported = await window.trellis.vault.importNoteImage({
        fileId,
        noteRelativePath,
        alt
      });

      setMarkdownDraft((prev) => {
        const r = insertMarkdownImage({ value: prev, start, end }, imported.alt, imported.markdownPath);
        syncAnchor(r.value);
        scheduleMarkdownSaveRef.current(r.value);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) {
            return;
          }
          el.focus();
          el.setSelectionRange(r.selectionStart, r.selectionEnd);
        });
        return r.value;
      });
    },
    [commitBeforeEdit, noteRelativePath, syncAnchor]
  );

  const importImageFilesMd = useCallback(
    async (files: File[]): Promise<boolean> => {
      const images = files.filter((file) => file.type.startsWith("image/"));

      if (images.length === 0) {
        return false;
      }

      setMdImageError(null);

      try {
        for (const file of images) {
          const base64 = await fileToBase64(file);
          const cached = await window.trellis.media.writeCache({
            base64,
            mimeType: file.type
          });
          await importImageFromCacheMd(cached.fileId, file.name);
        }
      } catch (error) {
        setMdImageError(error instanceof Error ? error.message : "Could not attach that image.");
      }

      return true;
    },
    [importImageFromCacheMd]
  );

  const pickImageMd = useCallback(() => {
    void (async () => {
      setMdImageError(null);
      try {
        const picked = await window.trellis.media.pickImage();

        if (!picked) {
          return;
        }

        await importImageFromCacheMd(picked.fileId, picked.name);
      } catch (error) {
        setMdImageError(error instanceof Error ? error.message : "Could not attach that image.");
      }
    })();
  }, [importImageFromCacheMd]);

  const wikiNoteScrollToRestore = useRef<number | null>(null);

  const handleViewModeChange = useCallback(
    async (next: NoteEditorViewMode) => {
      if (next === viewMode) {
        return;
      }

      if (next === "markdown" && viewMode === "preview") {
        const column = document.querySelector<HTMLElement>(WIKI_NOTE_COLUMN_SCROLL_SELECTOR);
        wikiNoteScrollToRestore.current = column?.scrollTop ?? 0;
        const flushed = previewRef.current?.flushMarkdown() ?? markdown;
        resetMdUndo(flushed);
        setMarkdownDraft(flushed);
        setViewMode("markdown");
        return;
      }

      if (next === "preview" && viewMode === "markdown") {
        if (mdSaveTimerRef.current) {
          window.clearTimeout(mdSaveTimerRef.current);
          mdSaveTimerRef.current = null;
        }
        try {
          await onSaveRef.current?.(markdownDraftRef.current, noteSlug, {
            recordStrandRevision: true
          });
        } finally {
          // Capture after save: parent/layout may have shifted the column during `await`.
          const column = document.querySelector<HTMLElement>(WIKI_NOTE_COLUMN_SCROLL_SELECTOR);
          wikiNoteScrollToRestore.current = column?.scrollTop ?? 0;
          setViewMode("preview");
        }
      }
    },
    [markdown, noteSlug, resetMdUndo, setViewMode, viewMode]
  );

  const viewModeToggle = (
    <NoteEditorViewModeToggle viewMode={viewMode} onChange={handleViewModeChange} />
  );

  useLayoutEffect(() => {
    if (viewMode !== "markdown") {
      return;
    }
    const ta = textareaRef.current;
    if (!ta) {
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [markdownDraft, viewMode]);

  useLayoutEffect(() => {
    if (wikiNoteScrollToRestore.current === null) {
      return;
    }
    const y = wikiNoteScrollToRestore.current;
    wikiNoteScrollToRestore.current = null;
    const scrollColumn = document.querySelector<HTMLElement>(WIKI_NOTE_COLUMN_SCROLL_SELECTOR);
    if (!scrollColumn) {
      return;
    }
    const apply = (): void => {
      scrollColumn.scrollTop = y;
    };
    apply();
    // ProseMirror/layout can run after this effect and reset scroll; re-apply on the next frame(s).
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }, [viewMode]);

  if (viewMode === "preview") {
    return (
      <WikiRichTextPreviewPanel
        ref={previewRef}
        className={className}
        existingSlugs={existingSlugs}
        markdown={markdown}
        noteRelativePath={noteRelativePath}
        noteSlug={noteSlug}
        onOpenNote={onOpenNote}
        onSave={onSave}
        viewModeToggle={viewModeToggle}
        wikiNotes={wikiNotes}
      />
    );
  }

  return (
    <div className="trellis-panel isolate flex flex-col">
      <div className="sticky top-0 z-20 shrink-0 border-b border-trellis-border bg-trellis-surface shadow-[0_1px_0_var(--trellis-border)]">
        <NoteEditorTopBar
          editor={null}
          markdownUndo={{
            onUndo: mdUndo,
            onRedo: mdRedo,
            canUndo: mdCanUndo,
            canRedo: mdCanRedo
          }}
          viewModeToggle={viewModeToggle}
        />
        <WikiMarkdownFormattingToolbar
          applyEdit={applyMarkdownEdit}
          onPickImage={pickImageMd}
          textColorFieldId={textColorFieldId}
          textareaRef={textareaRef}
          value={markdownDraft}
        />
        {mdImageError ? (
          <p className="border-t border-trellis-border px-3 py-2 text-xs text-trellis-accent">{mdImageError}</p>
        ) : null}
      </div>
      <div className="relative z-0 min-w-0 bg-trellis-surface">
        <textarea
          ref={textareaRef}
          aria-label="Note content"
          className={cn(
            "trellis-rich-text block w-full max-w-none resize-none overflow-x-hidden overflow-y-hidden whitespace-pre-wrap border-0 bg-trellis-surface px-2 py-2 text-sm leading-7 text-trellis-text outline-none [field-sizing:content]",
            NOTE_EDITOR_BODY_MIN_HEIGHT_CLASS,
            className
          )}
          spellCheck={false}
          value={markdownDraft}
          onChange={(event) => {
            const next = event.target.value;
            setMarkdownDraft(next);
            onTextareaIdleInput();
            scheduleMarkdownSave(next);
          }}
          onBlur={() => {
            void onSaveRef.current?.(markdownDraftRef.current, noteSlug, {
              recordStrandRevision: true
            });
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer?.files ?? []);
            void importImageFilesMd(files);
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) {
              return;
            }
            void importImageFilesMd(files);
          }}
        />
      </div>
    </div>
  );
}
