import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Link2,
  LoaderCircle,
  Paperclip,
  Pin,
  Pencil,
  RotateCcw,
  StickyNote,
  TriangleAlert,
  Volume2
} from "lucide-react";
import {
  TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG,
  type MessageRecord,
  type NoteSummary
} from "@electron/ipc/types";
import { markdownWithTranscriptFindMark, type TranscriptFindMatch } from "@/lib/chatTranscriptFind";
import { cn } from "@/lib/utils";
import type { MessageMeta } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";
import { RichTextRenderer } from "@/components/shared/RichTextRenderer";
import { NoteActionReviewCard } from "@/components/chat/NoteActionReviewCard";
import { StreamingIndicator } from "./StreamingIndicator";

interface Props {
  message: MessageRecord;
  existingSlugs: string[];
  vaultId: string;
  notes: NoteSummary[];
  meta?: MessageMeta;
  canEdit?: boolean;
  canRetry?: boolean;
  onEdit?: () => void;
  onOpenNote?: (slug: string) => void;
  onRetry?: () => void;
  waitingForTokens?: boolean;
  onReadAloud?: (messageId: string, text: string) => void | Promise<void>;
  /** True while this message is in a read-aloud session (loading or playing). */
  readAloudActive?: boolean;
  /** True until the first audio chunk arrives for this message’s read-aloud session. */
  readAloudLoading?: boolean;
  readAloudDisabled?: boolean;
  onApproveNoteAction?: (messageId: string, actionId: string) => void | Promise<void>;
  onRejectNoteAction?: (messageId: string, actionId: string) => void | Promise<void>;
  onNoteActionDraftChange?: (
    messageId: string,
    actionId: string,
    afterMarkdown: string
  ) => void;
  busyNoteActionId?: string | null;
  /** When set, wraps this range in the rendered markdown for transcript find. */
  transcriptFindHighlight?: TranscriptFindMatch | null;
}

function GeneratedImageSkeleton() {
  return (
    <div
      data-testid="generated-image-skeleton"
      className="flex h-52 w-full max-w-sm flex-col justify-end gap-2 rounded-field border border-trellis-border bg-trellis-surface-2 p-3"
      aria-busy
    >
      <div className="flex flex-1 flex-col justify-center gap-2">
        <span className="block h-2.5 w-full max-w-[90%] animate-pulse rounded-full bg-trellis-accent/10" />
        <span className="block h-2.5 w-full max-w-[70%] animate-pulse rounded-full bg-trellis-accent/10 [animation-delay:150ms]" />
        <span className="block h-2.5 w-2/3 max-w-[50%] animate-pulse rounded-full bg-trellis-accent/10 [animation-delay:300ms]" />
      </div>
      <p className="text-[11px] text-trellis-muted">Generating image…</p>
    </div>
  );
}

export function MessageBubble({
  message,
  existingSlugs,
  vaultId,
  notes,
  meta,
  canEdit = false,
  canRetry = false,
  onEdit,
  onOpenNote,
  onRetry,
  waitingForTokens = false,
  onReadAloud,
  readAloudActive = false,
  readAloudLoading = false,
  readAloudDisabled = false,
  onApproveNoteAction,
  onRejectNoteAction,
  onNoteActionDraftChange,
  busyNoteActionId = null,
  transcriptFindHighlight = null
}: Props) {
  const isUser = message.role === "user";
  const isFailed = meta?.status === "failed";
  const isPending = meta?.status === "pending";
  const roleLabel = isUser ? "You" : "Trellis";
  const contentWidthClassName = isUser ? "max-w-[38rem]" : "max-w-[42rem]";
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [addMenuFileId, setAddMenuFileId] = useState<string | null>(null);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [appendingFileId, setAppendingFileId] = useState<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const [generatedImageCaptionOpen, setGeneratedImageCaptionOpen] = useState(false);
  const [replyContextOpen, setReplyContextOpen] = useState(false);
  const pushToast = useUiStore((state) => state.pushToast);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);

  const hasCompletedGeneratedImage = useMemo(
    () =>
      message.mediaArtifacts?.some(
        (item) => item.kind === "generated_image" && !item.pendingGeneration
      ) ?? false,
    [message.mediaArtifacts]
  );

  const defaultCaptureLabel = useMemo(() => {
    return (
      notes.find((item) => item.slug === TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG)?.title ??
      "Trellis captures"
    );
  }, [notes]);

  const filteredPickNotes = useMemo(() => {
    const q = noteSearchQuery.trim().toLowerCase();

    if (!q) {
      return notes.slice(0, 12);
    }

    return notes
      .filter((item) => `${item.title} ${item.tags.join(" ")}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [noteSearchQuery, notes]);

  useEffect(() => {
    let cancelled = false;
    const artifacts = message.mediaArtifacts;

    if (!artifacts?.length) {
      setMediaUrls({});
      return;
    }

    void (async () => {
      const next: Record<string, string> = {};

      for (const artifact of artifacts) {
        if (artifact.pendingGeneration) {
          continue;
        }

        const url = await window.trellis.media.readDataUrl(artifact.fileId);

        if (url) {
          next[artifact.fileId] = url;
        }
      }

      if (!cancelled) {
        setMediaUrls(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [message.mediaArtifacts, message.id]);

  useEffect(() => {
    if (!addMenuFileId) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (addMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setAddMenuFileId(null);
      setNoteSearchQuery("");
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [addMenuFileId]);

  useEffect(() => {
    setReplyContextOpen(false);
  }, [message.id]);

  const hasRenderableText = message.content.trim().length > 0;
  const hasMedia = (message.mediaArtifacts?.length ?? 0) > 0;
  const collapsibleGeneratedImageCaption =
    !isUser && hasCompletedGeneratedImage && hasRenderableText;

  const markdownForDisplay = markdownWithTranscriptFindMark(
    message.content,
    transcriptFindHighlight
  );

  return (
    <div className={cn("flex w-full animate-fade-rise", isUser ? "justify-end" : "justify-start")}>
      <article
        data-chat-message-id={message.id}
        className={cn("flex w-full flex-col gap-3", isUser ? "items-end" : "items-start")}
      >
        <div
          className={cn(
            `flex w-full ${contentWidthClassName} items-center gap-3 text-[10px] uppercase tracking-[0.22em]`,
            isUser ? "justify-end text-trellis-faint" : "justify-start text-trellis-accent"
          )}
        >
          {isUser ? (
            <>
              <span>{roleLabel}</span>
              <span className="h-px w-12 bg-current/35" />
            </>
          ) : (
            <>
              <span className="h-px w-12 bg-current/35" />
              <span>{roleLabel}</span>
            </>
          )}
        </div>
        <div
          className={cn(
            `w-full ${contentWidthClassName}`,
            isUser ? "text-right" : "text-left",
            isUser
              ? "border-r border-trellis-border pr-5 md:pr-6"
              : "border-l border-trellis-accent/25 pl-5 md:pl-6",
            isFailed && "border-trellis-error"
          )}
        >
          {isUser && message.attachments && message.attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((attachment, index) => (
                <span
                  key={`${attachment.label}-${index}`}
                  className="inline-flex max-w-[min(100%,220px)] items-center gap-1 rounded-full border border-trellis-border bg-trellis-surface-2 px-2.5 py-0.5 text-[11px] text-trellis-muted"
                >
                  {attachment.kind === "url" ? (
                    <Link2 className="h-3 w-3 shrink-0 text-trellis-accent" aria-hidden />
                  ) : (
                    <Paperclip className="h-3 w-3 shrink-0 text-trellis-accent" aria-hidden />
                  )}
                  <span className="min-w-0 truncate text-trellis-text">{attachment.label}</span>
                </span>
              ))}
            </div>
          )}
          {isUser && message.composerPins && message.composerPins.length > 0 && (
            <div className="mb-3 flex flex-wrap justify-end gap-1.5">
              <span className="w-full text-right text-[10px] uppercase tracking-wide text-trellis-faint">
                Context for this send
              </span>
              {message.composerPins.map((pin) => (
                <span
                  key={pin.slug}
                  title="Pinned in the composer for stronger on-device retrieval for this message."
                  className="inline-flex max-w-[min(100%,240px)] items-center gap-1 rounded-full border border-trellis-accent/30 bg-trellis-accent/5 px-2 py-0.5 text-[11px] text-trellis-text"
                >
                  <Pin className="h-3 w-3 shrink-0 text-trellis-accent" aria-hidden />
                  <span className="min-w-0 truncate">{pin.title}</span>
                </span>
              ))}
            </div>
          )}
          {hasMedia && (
            <div
              className={cn(
                "mb-3 flex flex-col gap-2",
                isUser ? "items-end" : "items-start"
              )}
            >
              {message.mediaArtifacts?.map((artifact) => {
                if (artifact.pendingGeneration) {
                  return <GeneratedImageSkeleton key={artifact.fileId} />;
                }

                const src = mediaUrls[artifact.fileId];

                if (!src) {
                  return (
                    <div
                      key={artifact.fileId}
                      className="h-40 w-full max-w-sm rounded-field border border-trellis-border bg-trellis-surface-2"
                    />
                  );
                }

                const showGeneratedActions =
                  artifact.kind === "generated_image" && !artifact.pendingGeneration;

                return (
                  <div key={artifact.fileId} className="flex max-w-full flex-col gap-2">
                    <img
                      src={src}
                      alt={artifact.label}
                      className="max-h-80 max-w-full rounded-field border border-trellis-border object-contain"
                    />
                    {showGeneratedActions && (
                      <div
                        ref={addMenuFileId === artifact.fileId ? addMenuRef : undefined}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <button
                          type="button"
                          title="Download"
                          aria-label="Download"
                          className="rounded-full border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:bg-trellis-surface hover:text-trellis-accent"
                          onClick={() => {
                            const anchor = document.createElement("a");
                            anchor.href = src;
                            anchor.download = `trellis-generated-${artifact.fileId.slice(0, 8)}.png`;
                            anchor.rel = "noopener";
                            anchor.click();
                          }}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            title="Add image to a note"
                            aria-label="Add image to a note"
                            aria-expanded={addMenuFileId === artifact.fileId}
                            disabled={appendingFileId === artifact.fileId}
                            className="rounded-full border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:bg-trellis-surface hover:text-trellis-accent disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => {
                              setAddMenuFileId((current) =>
                                current === artifact.fileId ? null : artifact.fileId
                              );
                              setNoteSearchQuery("");
                            }}
                          >
                            {appendingFileId === artifact.fileId ? (
                              <LoaderCircle className="h-4 w-4 animate-spin text-trellis-accent" aria-hidden />
                            ) : (
                              <StickyNote className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                          {addMenuFileId === artifact.fileId && (
                            <div className="absolute left-0 top-full z-20 mt-1 w-[min(calc(100vw-3rem),288px)] rounded-field border border-trellis-border bg-trellis-surface p-2 shadow-lg">
                              <p className="px-1 pb-2 text-[10px] uppercase tracking-[0.16em] text-trellis-faint">
                                Add to note
                              </p>
                              <button
                                type="button"
                                className="w-full rounded-field border border-trellis-border px-2.5 py-2 text-left text-xs text-trellis-text transition hover:border-trellis-accent/35"
                                onClick={() => {
                                  void (async () => {
                                    setAppendingFileId(artifact.fileId);
                                    try {
                                      await window.trellis.vault.appendChatImageToNote({
                                        vaultId,
                                        fileId: artifact.fileId
                                      });
                                      const snapshot = await window.trellis.vault.listIndex(vaultId);
                                      replaceIndex({
                                        notes: snapshot.notes,
                                        folders: snapshot.folders,
                                        graph: snapshot.graph
                                      });
                                      pushToast({
                                        title: `Image added to ${defaultCaptureLabel}.`,
                                        tone: "success",
                                        noteLinks: [
                                          {
                                            label: defaultCaptureLabel,
                                            noteSlug: TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG
                                          }
                                        ]
                                      });
                                      setAddMenuFileId(null);
                                      setNoteSearchQuery("");
                                    } catch (error) {
                                      pushToast({
                                        title:
                                          error instanceof Error
                                            ? error.message
                                            : "Could not add image to that note.",
                                        tone: "warning"
                                      });
                                    } finally {
                                      setAppendingFileId(null);
                                    }
                                  })();
                                }}
                              >
                                <span className="font-medium text-trellis-text">{defaultCaptureLabel}</span>
                                <span className="mt-0.5 block text-[11px] text-trellis-muted">
                                  Default capture note
                                </span>
                              </button>
                              <label className="mt-2 block px-1 text-[10px] uppercase tracking-[0.16em] text-trellis-faint">
                                Or choose a note
                              </label>
                              <input
                                type="search"
                                value={noteSearchQuery}
                                placeholder="Search notes…"
                                className="trellis-input mt-1 w-full rounded-field px-2 py-1.5 text-xs"
                                onChange={(event) => {
                                  setNoteSearchQuery(event.target.value);
                                }}
                              />
                              <ul className="mt-1 max-h-40 overflow-y-auto rounded-field border border-trellis-border/60">
                                {filteredPickNotes.length === 0 ? (
                                  <li className="px-2 py-2 text-xs text-trellis-muted">No matches.</li>
                                ) : (
                                  filteredPickNotes.map((item) => (
                                    <li key={item.slug}>
                                      <button
                                        type="button"
                                        className="w-full px-2 py-1.5 text-left text-xs text-trellis-text transition hover:bg-trellis-surface-2"
                                        onClick={() => {
                                          void (async () => {
                                            setAppendingFileId(artifact.fileId);
                                            try {
                                              await window.trellis.vault.appendChatImageToNote({
                                                vaultId,
                                                fileId: artifact.fileId,
                                                slug: item.slug
                                              });
                                              const snapshot = await window.trellis.vault.listIndex(
                                                vaultId
                                              );
                                              replaceIndex({
                                                notes: snapshot.notes,
                                                folders: snapshot.folders,
                                                graph: snapshot.graph
                                              });
                                              pushToast({
                                                title: `Image added to ${item.title}.`,
                                                tone: "success",
                                                noteLinks: [
                                                  { label: item.title, noteSlug: item.slug }
                                                ]
                                              });
                                              setAddMenuFileId(null);
                                              setNoteSearchQuery("");
                                            } catch (error) {
                                              pushToast({
                                                title:
                                                  error instanceof Error
                                                    ? error.message
                                                    : "Could not add image to that note.",
                                                tone: "warning"
                                              });
                                            } finally {
                                              setAppendingFileId(null);
                                            }
                                          })();
                                        }}
                                      >
                                        {item.title}
                                      </button>
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {waitingForTokens && message.content.length === 0 ? (
            <StreamingIndicator />
          ) : collapsibleGeneratedImageCaption ? (
            <div className="w-full">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-trellis-muted transition hover:text-trellis-text"
                aria-expanded={generatedImageCaptionOpen}
                onClick={() => {
                  setGeneratedImageCaptionOpen((current) => !current);
                }}
              >
                {generatedImageCaptionOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                {generatedImageCaptionOpen ? "Hide image description" : "Show image description"}
              </button>
              {generatedImageCaptionOpen ? (
                <div className="mt-2">
                  <RichTextRenderer
                    markdown={markdownForDisplay}
                    existingSlugs={existingSlugs}
                    className={cn("trellis-chat-copy", "text-left")}
                    onOpenNote={onOpenNote}
                  />
                </div>
              ) : null}
            </div>
          ) : hasRenderableText ? (
            <RichTextRenderer
              markdown={markdownForDisplay}
              existingSlugs={existingSlugs}
              className={cn("trellis-chat-copy", isUser ? "text-right" : "text-left")}
              onOpenNote={onOpenNote}
            />
          ) : (
            <p className={cn("text-sm italic text-trellis-muted", isUser && "text-right")}>
              {hasMedia ? "No message text (see image above)." : "No message text (attachments only)."}
            </p>
          )}
          {!isUser && message.replyContext && message.replyContext.items.length > 0 && (
            <div className="mt-3 w-full border-t border-trellis-border/50 pt-3 text-left">
              <button
                type="button"
                className="flex max-w-full flex-wrap items-center gap-1.5 text-xs text-trellis-muted transition hover:text-trellis-text"
                aria-expanded={replyContextOpen}
                title="Strands listed here are grounded for this reply (linked, pinned, open in Wiki, or marked relevant). Other on-device search hits may still be in the prompt; they are omitted from this list."
                onClick={() => {
                  setReplyContextOpen((current) => !current);
                }}
              >
                {replyContextOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span>What informed this reply</span>
                {message.replyContext.sourceLabels.length > 0 ? (
                  <span
                    className="ml-0.5 rounded-full border border-trellis-border px-1.5 py-px text-[10px] font-normal uppercase tracking-wide text-trellis-faint"
                    title="Categories of context included with this reply"
                  >
                    {message.replyContext.sourceLabels.join(" · ")}
                  </span>
                ) : null}
              </button>
              {replyContextOpen ? (
                <ul className="mt-2 space-y-2 text-sm leading-snug text-trellis-muted">
                  {message.replyContext.items.map((item, index) => (
                    <li
                      key={`${item.kind}-${item.title}-${index}`}
                      className="flex items-start gap-2"
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-trellis-accent/70"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        {item.kind === "note" && item.slug && onOpenNote ? (
                          <button
                            type="button"
                            title="Open this Strand"
                            className="text-left text-trellis-text underline decoration-trellis-border decoration-1 underline-offset-2 transition hover:decoration-trellis-accent"
                            onClick={() => {
                              onOpenNote(item.slug ?? "");
                            }}
                          >
                            {item.title}
                            {item.pinned ? (
                              <span
                                className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-trellis-accent"
                                title="You pinned this note in the composer for this turn"
                              >
                                pinned
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <span className="text-trellis-text">
                            {item.title}
                            {item.kind === "note" && item.pinned ? (
                              <span
                                className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-trellis-accent"
                                title="You pinned this note in the composer for this turn"
                              >
                                pinned
                              </span>
                            ) : null}
                          </span>
                        )}
                        {item.kind === "memory" ? (
                          <span
                            className="ml-1.5 text-[10px] uppercase tracking-wide text-trellis-faint"
                            title="From Trellis local memory (not a vault Strand)"
                          >
                            memory
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {hasRenderableText && (
            <div
              className={cn(
                "mt-3 flex w-full gap-1",
                isUser ? "justify-end" : "justify-start"
              )}
            >
              <button
                type="button"
                data-testid="chat-message-copy"
                className="rounded-full border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:bg-trellis-surface hover:text-trellis-accent"
                title="Copy message"
                aria-label="Copy message"
                onClick={() => {
                  void navigator.clipboard.writeText(message.content).then(
                    () => {
                      pushToast({
                        title: "Copied to clipboard.",
                        tone: "success"
                      });
                    },
                    () => {
                      pushToast({
                        title: "Could not copy to clipboard.",
                        tone: "warning"
                      });
                    }
                  );
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
              </button>
              {!isUser && onReadAloud ? (
                <button
                  type="button"
                  disabled={!readAloudActive && readAloudDisabled}
                  className={cn(
                    "rounded-full border border-transparent p-1.5 transition hover:border-trellis-border hover:bg-trellis-surface disabled:cursor-not-allowed disabled:opacity-40",
                    readAloudActive && !readAloudLoading
                      ? "text-trellis-accent hover:text-trellis-accent"
                      : "text-trellis-muted hover:text-trellis-accent"
                  )}
                  title={
                    readAloudActive
                      ? readAloudLoading
                        ? "Preparing audio…"
                        : "Stop read aloud"
                      : "Read this reply aloud with text-to-speech"
                  }
                  aria-label={
                    readAloudActive
                      ? readAloudLoading
                        ? "Preparing read aloud"
                        : "Stop read aloud"
                      : "Read aloud"
                  }
                  onClick={() => {
                    void onReadAloud(message.id, message.content);
                  }}
                >
                  {readAloudActive && readAloudLoading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-trellis-accent" aria-hidden />
                  ) : (
                    <Volume2 className="h-4 w-4" aria-hidden />
                  )}
                </button>
              ) : null}
            </div>
          )}
          {!isUser && message.noteActions && message.noteActions.length > 0 && (
            <div className="mt-3 grid gap-3">
              {message.noteActions.map((action) => (
                <NoteActionReviewCard
                  key={action.id}
                  action={action}
                  busy={busyNoteActionId === action.id}
                  onApprove={() => {
                    void onApproveNoteAction?.(message.id, action.id);
                  }}
                  onReject={() => {
                    void onRejectNoteAction?.(message.id, action.id);
                  }}
                  onDraftChange={
                    onNoteActionDraftChange
                      ? (next) => {
                          onNoteActionDraftChange(message.id, action.id, next);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
        {(isFailed || isPending || canEdit || canRetry) && (
          <div
            className={cn(
              `flex w-full ${contentWidthClassName} items-center gap-3 text-xs`,
              isUser ? "justify-end" : "justify-start"
            )}
          >
            {isPending && <span className="text-trellis-muted">Sending…</span>}
            {isFailed && (
              <span className="flex max-w-[min(100%,24rem)] items-start gap-1.5 text-left text-trellis-error">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 whitespace-normal leading-snug">
                  {meta?.errorMessage ?? "Not sent"}
                </span>
              </span>
            )}
            {canEdit && onEdit && (
              <button
                type="button"
                className="text-trellis-muted transition hover:text-trellis-text"
                onClick={onEdit}
              >
                <span className="flex items-center gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </span>
              </button>
            )}
            {canRetry && onRetry && (
              <button
                type="button"
                className="text-trellis-accent transition hover:text-trellis-text"
                onClick={onRetry}
              >
                <span className="flex items-center gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry
                </span>
              </button>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
