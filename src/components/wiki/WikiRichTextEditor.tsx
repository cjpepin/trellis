import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement
} from "react";
import type { Editor } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table/kit";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { WikiAwareLink } from "@/components/wiki/wikiAwareLink";
import { WikiNoteLinkAutocomplete } from "@/components/wiki/WikiNoteLinkAutocomplete";
import { TemplateMacroAutocomplete } from "@/components/wiki/TemplateMacroAutocomplete";
import {
  Bold,
  Code,
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

const WIKI_TEXT_COLORS: Array<{ label: string; value: string }> = [
  { label: "Default", value: "" },
  { label: "Accent", value: "#c8a96e" },
  { label: "Muted", value: "#9a9185" },
  { label: "Soft red", value: "#c97a6b" },
  { label: "Soft green", value: "#8fb87a" },
  { label: "Soft blue", value: "#7a9cc8" }
];

interface WikiNoteSummary {
  slug: string;
  title: string;
}

function isInternalNoteLinkHref(href: unknown): href is string {
  return typeof href === "string" && isInternalNoteHashHref(href);
}

interface Props {
  noteSlug: string;
  noteRelativePath: string;
  markdown: string;
  existingSlugs: string[];
  /** Titles for [[…]] autocomplete and missing-link hints */
  wikiNotes?: WikiNoteSummary[];
  className?: string;
  onOpenNote?: (slug: string, options?: { linkText?: string }) => void;
  onSave?: (markdown: string, slug: string) => void;
}

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
          className={toolbarButtonClass(false)}
          aria-label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass(false)}
          aria-label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-trellis-border/80" aria-hidden />

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
              ? "Note links are edited as text"
              : editor.isActive("link")
                ? "Edit web link"
                : "Add web link"
          }
          title={
            isInternalNoteLink
              ? "Links to other notes use [[note title]] in the text. Use the Link control for https addresses only."
              : editor.isActive("link")
                ? "Edit web link"
                : "Add https link"
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
          <span className="text-[11px] uppercase tracking-[0.12em]">Link</span>
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

export function WikiRichTextEditor({
  noteSlug,
  noteRelativePath,
  markdown,
  existingSlugs,
  wikiNotes = [],
  className,
  onOpenNote,
  onSave
}: Props): ReactElement {
  const [manualLinkOpen, setManualLinkOpen] = useState(false);
  const [imageImportError, setImageImportError] = useState<string | null>(null);
  const rendered = useMemo(
    () => renderWikiMarkdown(markdown, new Set(existingSlugs)),
    [existingSlugs, markdown]
  );

  const saveTimerRef = useRef<number | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const pendingSlugRef = useRef<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const scheduleSave = useCallback((html: string) => {
    if (!onSaveRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    const md = htmlToMarkdown(html);
    pendingMarkdownRef.current = md;
    pendingSlugRef.current = noteSlug;

    saveTimerRef.current = window.setTimeout(() => {
      const markdownToSave = pendingMarkdownRef.current;
      const slug = pendingSlugRef.current;
      pendingMarkdownRef.current = null;
      pendingSlugRef.current = null;
      saveTimerRef.current = null;

      if (markdownToSave !== null && slug) {
        onSaveRef.current?.(markdownToSave, slug);
      }
    }, 500);
  }, [noteSlug]);

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

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: rendered.html,
    editorProps: {
      attributes: {
        class: cn(
          "trellis-rich-text min-h-[12rem] max-w-none px-2 py-2 text-sm leading-7 text-trellis-text outline-none",
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

    if (editor.isFocused) {
      return;
    }

    editor.commands.setContent(rendered.html, {
      emitUpdate: false
    });
    resolveRenderedNoteImages(editor.view.dom, noteRelativePath);
  }, [editor, noteRelativePath, rendered.html]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      const pendingMd = pendingMarkdownRef.current;
      const slug = pendingSlugRef.current;
      pendingMarkdownRef.current = null;
      pendingSlugRef.current = null;

      if (pendingMd !== null && slug) {
        onSaveRef.current?.(pendingMd, slug);
      }
    };
  }, []);

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
      <TemplateMacroAutocomplete editor={editor} />
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
