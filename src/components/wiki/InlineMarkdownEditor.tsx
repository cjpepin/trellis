import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderWikiMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

interface Props {
  /** Identifies which note is being edited; included with each debounced save so writes cannot target the wrong file after navigation. */
  noteSlug: string;
  markdown: string;
  existingSlugs: string[];
  className?: string;
  onOpenNote?: (slug: string) => void;
  onSave?: (markdown: string, slug: string) => void;
}

interface MarkdownBlock {
  id: string;
  markdown: string;
}

let blockCounter = 0;

function createBlock(markdown = ""): MarkdownBlock {
  blockCounter += 1;

  return {
    id: `markdown-block-${blockCounter}`,
    markdown
  };
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let currentLines: string[] = [];
  let fenceMarker: string | null = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[2];

      if (!marker) {
        continue;
      }

      if (!fenceMarker) {
        fenceMarker = marker;
      } else if (marker.startsWith(fenceMarker.charAt(0))) {
        fenceMarker = null;
      }
    }

    if (!fenceMarker && line.trim() === "") {
      if (currentLines.length > 0) {
        blocks.push(createBlock(currentLines.join("\n")));
        currentLines = [];
      }

      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    blocks.push(createBlock(currentLines.join("\n")));
  }

  return blocks.length > 0 ? blocks : [createBlock("")];
}

function serializeMarkdownBlocks(blocks: MarkdownBlock[]): string {
  const normalizedBlocks = [...blocks];

  while (
    normalizedBlocks.length > 1 &&
    normalizedBlocks[normalizedBlocks.length - 1]?.markdown === ""
  ) {
    normalizedBlocks.pop();
  }

  return normalizedBlocks.map((block) => block.markdown).join("\n\n");
}

function resizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 44)}px`;
}

export function InlineMarkdownEditor({
  noteSlug,
  markdown,
  existingSlugs,
  className,
  onOpenNote,
  onSave
}: Props) {
  const [blocks, setBlocks] = useState<MarkdownBlock[]>(() => splitMarkdownBlocks(markdown));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<string | null>(null);
  const pendingSaveSlugRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  const serializedBlocks = useMemo(() => serializeMarkdownBlocks(blocks), [blocks]);
  const slugSet = useMemo(() => new Set(existingSlugs), [existingSlugs]);

  onSaveRef.current = onSave;

  const scheduleSave = useCallback((nextMarkdown: string) => {
    if (!onSaveRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    const slugForSave = noteSlug;
    pendingSaveRef.current = nextMarkdown;
    pendingSaveSlugRef.current = slugForSave;
    saveTimerRef.current = window.setTimeout(() => {
      const markdownToSave = pendingSaveRef.current;
      const slug = pendingSaveSlugRef.current;
      pendingSaveRef.current = null;
      pendingSaveSlugRef.current = null;
      saveTimerRef.current = null;

      if (markdownToSave && slug) {
        onSaveRef.current?.(markdownToSave, slug);
      }
    }, 500);
  }, [noteSlug]);

  useEffect(() => {
    if (activeBlockId) {
      return;
    }

    const normalizedMarkdown = normalizeMarkdown(markdown);

    if (normalizedMarkdown === serializedBlocks) {
      return;
    }

    setBlocks(splitMarkdownBlocks(markdown));
  }, [activeBlockId, markdown, serializedBlocks]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draftValue]);

  useEffect(() => {
    if (!activeBlockId || !textareaRef.current) {
      return;
    }

    textareaRef.current.focus();
    const cursor = textareaRef.current.value.length;
    textareaRef.current.setSelectionRange(cursor, cursor);
    resizeTextarea(textareaRef.current);
  }, [activeBlockId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      const markdown = pendingSaveRef.current;
      const slug = pendingSaveSlugRef.current;
      pendingSaveRef.current = null;
      pendingSaveSlugRef.current = null;

      if (markdown && slug) {
        onSaveRef.current?.(markdown, slug);
      }
    };
  }, []);

  function beginEditingBlock(blockId: string): void {
    const block = blocks.find((candidate) => candidate.id === blockId);

    if (!block) {
      return;
    }

    setActiveBlockId(block.id);
    setDraftValue(block.markdown);
  }

  function commitActiveBlock(options?: {
    currentMarkdown?: string;
    insertAfter?: MarkdownBlock;
    focusBlockId?: string | null;
  }): void {
    if (!activeBlockId) {
      return;
    }

    const blockIndex = blocks.findIndex((block) => block.id === activeBlockId);

    if (blockIndex === -1) {
      return;
    }

    const nextBlocks = [...blocks];
    const currentBlock = nextBlocks[blockIndex];

    if (!currentBlock) {
      return;
    }

    nextBlocks[blockIndex] = {
      ...currentBlock,
      markdown: options?.currentMarkdown ?? draftValue
    };

    if (options?.insertAfter) {
      nextBlocks.splice(blockIndex + 1, 0, options.insertAfter);
    }

    const normalizedBlocks = nextBlocks.length > 0 ? nextBlocks : [createBlock("")];
    const nextFocusBlockId = options?.focusBlockId ?? null;
    const nextFocusBlock = nextFocusBlockId
      ? normalizedBlocks.find((block) => block.id === nextFocusBlockId) ?? null
      : null;

    setBlocks(normalizedBlocks);
    setActiveBlockId(nextFocusBlockId);
    setDraftValue(nextFocusBlock?.markdown ?? "");
    scheduleSave(serializeMarkdownBlocks(normalizedBlocks));
  }

  function handleBlockMouseDown(
    event: React.MouseEvent<HTMLDivElement>,
    blockId: string
  ): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const link = target.closest("a");

    if (link && (event.metaKey || event.ctrlKey)) {
      return;
    }

    if (activeBlockId && activeBlockId !== blockId) {
      pendingFocusRef.current = blockId;
    }
  }

  function handleBlockClick(
    event: React.MouseEvent<HTMLDivElement>,
    blockId: string
  ): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const link = target.closest("a");

    if (link && (event.metaKey || event.ctrlKey)) {
      const href = link.getAttribute("href");

      if (href?.startsWith("#/wiki?note=") && onOpenNote) {
        event.preventDefault();
        onOpenNote(decodeURIComponent(href.replace("#/wiki?note=", "")));
        return;
      }

      if (href?.startsWith("http")) {
        event.preventDefault();
        void window.trellis.shell.openExternal(href);
        return;
      }
    }

    beginEditingBlock(blockId);
  }

  return (
    <div className={cn("trellis-markdown-blocks", className)}>
      {blocks.map((block) => {
        const isActive = block.id === activeBlockId;
        const rendered = renderWikiMarkdown(block.markdown, slugSet);

        return (
          <div
            key={block.id}
            className={cn("trellis-markdown-block", isActive && "is-active")}
            onMouseDown={(event) => {
              handleBlockMouseDown(event, block.id);
            }}
            onClick={(event) => {
              handleBlockClick(event, block.id);
            }}
            onKeyDown={(event) => {
              if (isActive) {
                return;
              }

              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              beginEditingBlock(block.id);
            }}
            role="button"
            tabIndex={isActive ? -1 : 0}
          >
            {isActive ? (
              <textarea
                ref={textareaRef}
                value={draftValue}
                className="trellis-markdown-textarea"
                placeholder="Write markdown here..."
                onChange={(event) => {
                  setDraftValue(event.target.value);
                }}
                onBlur={() => {
                  const nextFocusBlockId = pendingFocusRef.current;
                  pendingFocusRef.current = null;
                  commitActiveBlock({
                    focusBlockId: nextFocusBlockId
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    pendingFocusRef.current = null;
                    setActiveBlockId(null);
                    setDraftValue("");
                    return;
                  }

                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                    return;
                  }

                  event.preventDefault();

                  if (!textareaRef.current) {
                    commitActiveBlock();
                    return;
                  }

                  const selectionStart =
                    textareaRef.current.selectionStart ?? draftValue.length;
                  const selectionEnd = textareaRef.current.selectionEnd ?? draftValue.length;

                  if (draftValue === "" && selectionStart === 0 && selectionEnd === 0) {
                    commitActiveBlock();
                    return;
                  }

                  const currentMarkdown = draftValue.slice(0, selectionStart);
                  const nextMarkdown = draftValue.slice(selectionEnd);
                  const nextBlock = createBlock(nextMarkdown);

                  commitActiveBlock({
                    currentMarkdown,
                    insertAfter: nextBlock,
                    focusBlockId: nextBlock.id
                  });
                }}
              />
            ) : block.markdown ? (
              <div
                className="trellis-markdown-block-render trellis-rich-text"
                dangerouslySetInnerHTML={{ __html: rendered.html }}
              />
            ) : (
              <div className="trellis-markdown-block-render trellis-markdown-placeholder">
                Click to write in markdown...
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
