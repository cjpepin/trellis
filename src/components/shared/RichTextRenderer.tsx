import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { renderWikiMarkdown } from "@/lib/markdown";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";
import { cn } from "@/lib/utils";

interface Props {
  markdown: string;
  existingSlugs: string[];
  className?: string;
  editable?: boolean;
  onOpenNote?: (slug: string) => void;
  onSave?: (markdown: string) => void;
}

export function RichTextRenderer({
  markdown,
  existingSlugs,
  className,
  editable = false,
  onOpenNote,
  onSave
}: Props) {
  const rendered = useMemo(
    () => renderWikiMarkdown(markdown, new Set(existingSlugs)),
    [existingSlugs, markdown]
  );
  const saveTimerRef = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const scheduleSave = useCallback(
    (html: string) => {
      if (!onSaveRef.current) {
        return;
      }

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        const md = htmlToMarkdown(html);
        onSaveRef.current?.(md);
      }, 1200);
    },
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        }
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-trellis-accent transition hover:text-[var(--trellis-accent-hover)]"
        }
      })
    ],
    content: rendered.html,
    editorProps: {
      attributes: {
        class: cn(
          "trellis-rich-text text-sm leading-7 text-trellis-text outline-none",
          editable && "cursor-text",
          className
        )
      }
    },
    onUpdate({ editor: instance }) {
      if (editable) {
        scheduleSave(instance.getHTML());
      }
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(editable);
  }, [editor, editable]);

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
  }, [editor, rendered.html]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  return (
    <div
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

        if (href?.startsWith("#/wiki?note=") && onOpenNote) {
          event.preventDefault();

          if (editable && !(event.metaKey || event.ctrlKey)) {
            return;
          }

          onOpenNote(decodeURIComponent(href.replace("#/wiki?note=", "")));
          return;
        }

        if (href?.startsWith("http")) {
          event.preventDefault();
          void window.trellis.shell.openExternal(href);
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
