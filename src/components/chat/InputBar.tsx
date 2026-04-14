import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  ImagePlus,
  Link2,
  LoaderCircle,
  Mic,
  Paperclip,
  Pin,
  RotateCcw,
  Wand2,
  X
} from "lucide-react";
import type {
  ChatModel,
  NoteSummary,
  ProviderKeyStatus,
  SubscriptionTier
} from "@electron/ipc/types";
import {
  maxChatComposerAttachments,
  type PendingChatAttachment,
  type PendingImageAttachment
} from "@/lib/chatAttachments";
import { getChatModelAccess } from "@/lib/chatModels";
import {
  getAtCommandMatch,
  getSlashCommandMatch,
  insertNoteReference
} from "@/lib/noteReferences";
import { cn } from "@/lib/utils";
import { ComposerPendingPreviews } from "@/components/chat/ComposerPendingPreviews";

/** Native `title` does not show on disabled `<button>` in Chromium; wrap so the span receives hover. */
function ComposerIconButton({
  title,
  ariaLabel,
  disabled,
  onClick,
  active = false,
  buttonClassName,
  dataTestId,
  children
}: {
  title: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  active?: boolean;
  buttonClassName?: string;
  dataTestId?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={disabled ? title : undefined}
      className={cn("inline-flex items-center justify-center", disabled && "cursor-not-allowed")}
    >
      <button
        type="button"
        title={disabled ? undefined : title}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={dataTestId}
        className={cn(
          "rounded-full border border-transparent p-1.5 transition hover:border-trellis-border hover:bg-trellis-surface disabled:opacity-40",
          buttonClassName,
          active && "border-trellis-border bg-trellis-surface text-trellis-text",
          disabled && "pointer-events-none"
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </span>
  );
}

interface Props {
  disabled?: boolean;
  isStreaming?: boolean;
  busyReason?: string;
  /** Model Trellis will use for the next send (tier + complexity routing). */
  routedModel: ChatModel;
  subscriptionTier: SubscriptionTier;
  providerKeys: ProviderKeyStatus[];
  notes: NoteSummary[];
  value: string;
  submitLabel?: string;
  onChange: (value: string) => void;
  onCancel?: () => void;
  onSubmit: (value: string) => Promise<void>;
  pendingAttachments: PendingChatAttachment[];
  onRemoveAttachment: (clientId: string) => void;
  onAttachFile: () => void;
  onClipPublicUrl: (url: string) => Promise<boolean>;
  pendingImages: PendingImageAttachment[];
  onRemoveImage: (clientId: string) => void;
  onAttachImage: () => void;
  onPasteImage: (input: { base64: string; mimeType: string }) => void;
  onAppendDraft: (text: string) => void;
  onGenerateImageWithPrompt: (prompt: string) => Promise<boolean>;
  privacyLocal: boolean;
  cloudMediaAllowed: boolean;
  visionAllowed: boolean;
  speechAllowed: boolean;
  imageGenAllowed: boolean;
  accessToken: string | null;
  /** Unlocks full routing catalog checks (preview workspace for admins). */
  previewWorkspace?: boolean;
  /** Full catalog in the picker; matches server admin entitlements. */
  isAdmin?: boolean;
  /** When false (Chat privacy Off), vault retrieval is disabled for cloud replies — hide pin affordance. */
  contextRetrievalEnabled?: boolean;
  /** Notes pinned in the composer for stronger on-device retrieval before the next send. */
  pinnedWikiNotes?: Array<{ slug: string; title: string }>;
  /** Toggle a wiki note in the composer pin list (add/remove). */
  onToggleWikiComposerPin?: (slug: string, title: string) => void;
}

export function InputBar({
  disabled = false,
  isStreaming = false,
  busyReason,
  routedModel,
  subscriptionTier,
  providerKeys,
  notes,
  value,
  submitLabel = "Send",
  onChange,
  onCancel,
  onSubmit,
  pendingAttachments,
  onRemoveAttachment,
  onAttachFile,
  onClipPublicUrl,
  pendingImages,
  onRemoveImage,
  onAttachImage,
  onPasteImage,
  onAppendDraft,
  onGenerateImageWithPrompt,
  privacyLocal,
  cloudMediaAllowed,
  visionAllowed,
  speechAllowed,
  imageGenAllowed,
  accessToken,
  previewWorkspace = false,
  isAdmin = false,
  contextRetrievalEnabled = true,
  pinnedWikiNotes = [],
  onToggleWikiComposerPin
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const [cursor, setCursor] = useState(value.length);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [linkEntryOpen, setLinkEntryOpen] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState("");
  const [clipUrlBusy, setClipUrlBusy] = useState(false);
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [imageGenDraft, setImageGenDraft] = useState("");
  const [imageGenBusy, setImageGenBusy] = useState(false);
  const [wikiPinPickerOpen, setWikiPinPickerOpen] = useState(false);
  const [wikiPinSearch, setWikiPinSearch] = useState("");
  const wikiPinPickerRef = useRef<HTMLDivElement | null>(null);
  const selectedModelAccess = useMemo(
    () =>
      getChatModelAccess(routedModel, subscriptionTier, providerKeys, {
        previewWorkspace,
        isAdmin
      }),
    [isAdmin, routedModel, previewWorkspace, providerKeys, subscriptionTier]
  );

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    setCursor((current) => Math.min(current, value.length));
  }, [value.length]);

  const noteLinkCommand = useMemo(
    () => getSlashCommandMatch(value, cursor) ?? getAtCommandMatch(value, cursor),
    [cursor, value]
  );
  const slashSuggestions = useMemo(() => {
    if (!noteLinkCommand) {
      return [];
    }

    const normalizedQuery = noteLinkCommand.query.trim().toLowerCase();
    const filteredNotes = normalizedQuery
      ? notes.filter((note) =>
          `${note.title} ${note.tags.join(" ")}`.toLowerCase().includes(normalizedQuery)
        )
      : notes;

    return filteredNotes.slice(0, 6);
  }, [notes, noteLinkCommand]);
  const wikiPinSuggestions = useMemo(() => {
    const q = wikiPinSearch.trim().toLowerCase();
    const filtered = q
      ? notes.filter((note) => `${note.title} ${note.tags.join(" ")}`.toLowerCase().includes(q))
      : notes;

    return filtered.slice(0, 8);
  }, [notes, wikiPinSearch]);
  const activeInputTool = linkEntryOpen || imageGenOpen;

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [noteLinkCommand?.from, noteLinkCommand?.query]);

  useEffect(() => {
    if (!wikiPinPickerOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (wikiPinPickerRef.current?.contains(event.target as Node)) {
        return;
      }

      setWikiPinPickerOpen(false);
      setWikiPinSearch("");
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [wikiPinPickerOpen]);

  useEffect(() => {
    if (disabled) {
      setWikiPinPickerOpen(false);
    }
  }, [disabled]);

  function syncCursor(): void {
    if (!textareaRef.current) {
      return;
    }

    setCursor(textareaRef.current.selectionStart ?? value.length);
  }

  function selectNoteLinkSuggestion(index: number): void {
    if (!textareaRef.current || !noteLinkCommand) {
      return;
    }

    const suggestion = slashSuggestions[index];

    if (!suggestion) {
      return;
    }

    const { nextValue, nextCursor } = insertNoteReference(value, noteLinkCommand, suggestion.title);
    onChange(nextValue);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  }

  const canSend =
    value.trim().length > 0 || pendingAttachments.length > 0 || pendingImages.length > 0;

  async function handleSubmit() {
    const nextValue = value.trim();

    if (!canSend || disabled || isStreaming || !selectedModelAccess.allowed) {
      return;
    }

    await onSubmit(nextValue);
  }

  async function stopRecordingAndTranscribe(): Promise<void> {
    const recorder = mediaRecorderRef.current;

    if (!recorder) {
      return;
    }

    mediaRecorderRef.current = null;
    recorder.stop();
    setIsRecording(false);
  }

  async function startRecording(): Promise<void> {
    if (!cloudMediaAllowed || !speechAllowed || disabled || isStreaming || isTranscribing) {
      return;
    }

    if (!accessToken) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => {
          track.stop();
        });

        void (async () => {
          setIsTranscribing(true);
          try {
            const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
            const buffer = await blob.arrayBuffer();
            let binary = "";
            const bytes = new Uint8Array(buffer);
            const chunkSize = 8192;

            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              binary += String.fromCharCode(...chunk);
            }

            const audioBase64 = btoa(binary);

            try {
              const result = await window.trellis.media.transcribe({
                accessToken: accessToken ?? "",
                subscriptionTier,
                audioBase64,
                mimeType: blob.type || "audio/webm"
              });

              const text = result.text.trim();

              if (text.length > 0) {
                onAppendDraft(text);
              }
            } catch {
              // Parent toast via failed invoke — keep composer usable
            }
          } finally {
            setIsTranscribing(false);
          }
        })();
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  }

  async function toggleRecording(): Promise<void> {
    if (isRecording) {
      await stopRecordingAndTranscribe();
      return;
    }

    await startRecording();
  }

  async function handlePasteClipboardImages(event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const files = event.clipboardData?.files;

    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];

    if (!file?.type.startsWith("image/")) {
      return;
    }

    if (!visionAllowed || privacyLocal) {
      return;
    }

    event.preventDefault();

    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    onPasteImage({
      base64: btoa(binary),
      mimeType: file.type
    });
  }

  async function submitClipUrl(): Promise<void> {
    const next = linkUrlDraft.trim();

    if (!next) {
      return;
    }

    setClipUrlBusy(true);

    try {
      const ok = await onClipPublicUrl(next);

      if (ok) {
        setLinkEntryOpen(false);
        setLinkUrlDraft("");
      }
    } finally {
      setClipUrlBusy(false);
    }
  }

  async function submitImageGen(): Promise<void> {
    const next = imageGenDraft.trim();

    if (!next) {
      return;
    }

    setImageGenOpen(false);
    setImageGenDraft("");
    setImageGenBusy(true);

    try {
      await onGenerateImageWithPrompt(next);
    } finally {
      setImageGenBusy(false);
    }
  }

  return (
    <div className="trellis-chat-composer w-full px-3 pb-2.5 pt-2">
      <div className="flex items-start gap-2.5">
        <div className="relative flex-1">
          {pinnedWikiNotes.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pinnedWikiNotes.map((note) => (
                <span
                  key={note.slug}
                  title="Pinned for the next reply — Trellis boosts these notes when gathering local context (retrieval stays on your device in Auto)."
                  className="inline-flex max-w-[min(100%,240px)] items-center gap-1 rounded-full border border-trellis-accent/30 bg-trellis-accent/5 px-2 py-0.5 text-[11px] text-trellis-text"
                >
                  <Pin className="h-3 w-3 shrink-0 text-trellis-accent" aria-hidden />
                  <span className="min-w-0 truncate">{note.title}</span>
                  <button
                    type="button"
                    title="Remove from pinned context"
                    aria-label={`Unpin ${note.title}`}
                    className="shrink-0 rounded-full p-0.5 text-trellis-muted transition hover:bg-trellis-surface hover:text-trellis-text"
                    onClick={() => {
                      onToggleWikiComposerPin?.(note.slug, note.title);
                    }}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <ComposerPendingPreviews
            pendingAttachments={pendingAttachments}
            pendingImages={pendingImages}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveImage={onRemoveImage}
          />
          {!contextRetrievalEnabled ? (
            <p
              className="rounded-field border border-trellis-accent/25 bg-trellis-surface px-3 py-2 text-xs leading-snug text-trellis-muted"
              role="status"
            >
              Chat privacy is Off — note excerpts are not sent to the cloud. Set Chat privacy to Auto or
              Local in Settings for vault-aware replies.
            </p>
          ) : null}
          {linkEntryOpen ? (
            <div className="flex min-h-[42px] flex-col gap-2 py-1">
              <label
                className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint"
                htmlFor="chat-clip-url"
              >
                Clip a public web page
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="chat-clip-url"
                  type="url"
                  autoComplete="url"
                  className="trellis-input min-h-0 min-w-[min(100%,220px)] flex-1 py-2 text-sm"
                  placeholder="https://..."
                  value={linkUrlDraft}
                  disabled={disabled || clipUrlBusy}
                  onChange={(event) => {
                    setLinkUrlDraft(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitClipUrl();
                    }
                    if (event.key === "Escape") {
                      setLinkEntryOpen(false);
                      setLinkUrlDraft("");
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={disabled || clipUrlBusy || linkUrlDraft.trim().length === 0}
                  className="rounded-full border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:opacity-40"
                  onClick={() => {
                    void submitClipUrl();
                  }}
                >
                  {clipUrlBusy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-trellis-accent" aria-hidden />
                  ) : (
                    "Clip page"
                  )}
                </button>
                <button
                  type="button"
                  disabled={clipUrlBusy}
                  className="rounded-full border border-transparent px-2 py-2 text-xs text-trellis-muted transition hover:text-trellis-text"
                  onClick={() => {
                    setLinkEntryOpen(false);
                    setLinkUrlDraft("");
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : imageGenOpen ? (
            <div className="flex min-h-[42px] flex-col gap-2 py-1">
              <label
                className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint"
                htmlFor="chat-image-prompt"
              >
                Describe the image to generate
              </label>
              <textarea
                id="chat-image-prompt"
                className="trellis-input min-h-[80px] resize-y py-2 text-sm"
                placeholder="A calm workspace with warm light..."
                value={imageGenDraft}
                disabled={disabled || imageGenBusy}
                onChange={(event) => {
                  setImageGenDraft(event.target.value);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled || imageGenBusy || imageGenDraft.trim().length === 0}
                  className="rounded-full border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:opacity-40"
                  onClick={() => {
                    void submitImageGen();
                  }}
                >
                  {imageGenBusy ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="h-4 w-4 animate-spin text-trellis-accent" aria-hidden />
                      Generating...
                    </span>
                  ) : (
                    "Generate"
                  )}
                </button>
                <button
                  type="button"
                  disabled={imageGenBusy}
                  className="rounded-full border border-transparent px-2 py-2 text-xs text-trellis-muted transition hover:text-trellis-text"
                  onClick={() => {
                    setImageGenOpen(false);
                    setImageGenDraft("");
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              disabled={disabled}
              placeholder="What are you thinking about?"
              className="min-h-[42px] w-full resize-none bg-transparent py-1 text-left text-[15px] leading-6 text-trellis-text outline-none placeholder:text-trellis-faint"
              onPaste={(event) => {
                void handlePasteClipboardImages(event);
              }}
              onChange={(event) => {
                onChange(event.target.value);
                setCursor(event.target.selectionStart ?? event.target.value.length);
              }}
              onClick={syncCursor}
              onKeyUp={syncCursor}
              onSelect={syncCursor}
              onKeyDown={(event) => {
                if (noteLinkCommand) {
                  if (event.key === "ArrowDown" && slashSuggestions.length > 0) {
                    event.preventDefault();
                    setActiveCommandIndex((current) => (current + 1) % slashSuggestions.length);
                    return;
                  }

                  if (event.key === "ArrowUp" && slashSuggestions.length > 0) {
                    event.preventDefault();
                    setActiveCommandIndex(
                      (current) => (current - 1 + slashSuggestions.length) % slashSuggestions.length
                    );
                    return;
                  }

                  if ((event.key === "Enter" || event.key === "Tab") && slashSuggestions.length > 0) {
                    event.preventDefault();
                    selectNoteLinkSuggestion(activeCommandIndex);
                    return;
                  }
                }

                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          )}
          {!activeInputTool && noteLinkCommand && (
            <div className="trellis-elevated absolute bottom-full left-0 right-0 z-20 mb-3 overflow-hidden">
              <div
                className="border-b border-trellis-border px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-trellis-faint"
                title="Inserts a [[wiki link]]. Trellis uses links and nearby text to pull Strand content into the reply when chat privacy allows vault context."
              >
                Link a note
              </div>
              {slashSuggestions.length > 0 ? (
                <div className="p-2">
                  {slashSuggestions.map((note, index) => (
                    <button
                      key={note.slug}
                      type="button"
                      className={cn(
                        "w-full rounded-field px-3 py-2 text-left transition",
                        index === activeCommandIndex
                          ? "trellis-selected-surface"
                          : "hover:bg-trellis-surface"
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectNoteLinkSuggestion(index);
                      }}
                    >
                      <p className="text-sm text-trellis-text">{note.title}</p>
                      <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-trellis-muted">
                        {note.excerpt}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-4 text-sm text-trellis-muted">
                  No notes match that reference yet.
                </p>
              )}
            </div>
          )}
        </div>
        {!activeInputTool && (() => {
          const sendHardDisabled =
            disabled || !canSend || isStreaming || !selectedModelAccess.allowed;
          const sendTitle = sendHardDisabled
            ? busyReason ??
              (isStreaming
                ? "Wait for this chat to finish before sending another message."
                : !selectedModelAccess.allowed
                  ? selectedModelAccess.reason ?? "Adjust account settings to send."
                  : "Add a message or attachment to send")
            : "Send message (Enter)";

          return (
            <span
              title={sendHardDisabled ? sendTitle : undefined}
              className={cn(
                "mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center",
                sendHardDisabled && "cursor-not-allowed"
              )}
            >
              <button
                type="button"
                title={sendHardDisabled ? undefined : sendTitle}
                disabled={sendHardDisabled}
                aria-label="Send message"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition",
                  sendHardDisabled
                    ? "border-trellis-border text-trellis-faint"
                    : "trellis-accent-surface border-trellis-accent/35 text-trellis-accent hover:border-trellis-accent",
                  sendHardDisabled && "pointer-events-none"
                )}
                onClick={() => {
                  void handleSubmit();
                }}
              >
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          );
        })()}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1">
            <ComposerIconButton
              title="Attach a text or PDF file from your computer as context for this message"
              ariaLabel="Attach file from computer"
              disabled={disabled || isStreaming}
              onClick={() => {
                setWikiPinPickerOpen(false);
                setWikiPinSearch("");
                onAttachFile();
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
            <ComposerIconButton
              title="Clip readable text from a public web page (HTTPS) to attach as context"
              ariaLabel="Clip web page from URL"
              disabled={disabled || isStreaming}
              active={linkEntryOpen}
              onClick={() => {
                setImageGenOpen(false);
                setWikiPinPickerOpen(false);
                setWikiPinSearch("");
                setLinkEntryOpen((current) => !current);
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
            >
              <Link2 className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
            <div ref={wikiPinPickerRef} className="relative inline-flex">
              <ComposerIconButton
                title={
                  !contextRetrievalEnabled
                    ? "Chat privacy is Off — no vault snippets are sent with cloud replies. Turn on Auto or Local in Settings to use Strand context."
                    : "Pin Strands so Trellis always considers them when gathering local context for your next message."
                }
                ariaLabel="Pin Strands for context"
                disabled={
                  disabled || isStreaming || !contextRetrievalEnabled || !onToggleWikiComposerPin
                }
                active={wikiPinPickerOpen}
                onClick={() => {
                  setImageGenOpen(false);
                  setLinkEntryOpen(false);
                  setWikiPinPickerOpen((current) => {
                    if (current) {
                      setWikiPinSearch("");
                    }

                    return !current;
                  });
                }}
                buttonClassName="text-trellis-muted hover:text-trellis-text"
              >
                <Pin className="h-4 w-4" aria-hidden />
              </ComposerIconButton>
              {wikiPinPickerOpen && contextRetrievalEnabled && onToggleWikiComposerPin ? (
                <div
                  className="trellis-elevated absolute bottom-full left-0 z-30 mb-2 w-[min(100vw-2rem,320px)] overflow-hidden rounded-field border border-trellis-border bg-trellis-surface shadow-lg"
                  role="listbox"
                  aria-label="Strands to pin"
                >
                  <div className="border-b border-trellis-border px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
                    Pin for next reply
                  </div>
                  <div className="p-2">
                    <label className="sr-only" htmlFor="wiki-pin-search">
                      Search Strands
                    </label>
                    <input
                      id="wiki-pin-search"
                      type="search"
                      autoComplete="off"
                      placeholder="Search notes…"
                      className="trellis-input mb-2 w-full py-2 text-sm"
                      value={wikiPinSearch}
                      onChange={(event) => {
                        setWikiPinSearch(event.target.value);
                      }}
                    />
                    {wikiPinSuggestions.length > 0 ? (
                      <ul className="max-h-52 space-y-1 overflow-y-auto">
                        {wikiPinSuggestions.map((note) => {
                          const pinned = pinnedWikiNotes.some((item) => item.slug === note.slug);

                          return (
                            <li key={note.slug}>
                              <button
                                type="button"
                                role="option"
                                title={
                                  pinned
                                    ? "Click to unpin this note"
                                    : "Pin this note — Trellis will boost it when building context"
                                }
                                className={cn(
                                  "flex w-full items-start gap-2 rounded-field px-3 py-2 text-left transition hover:bg-trellis-surface",
                                  pinned && "trellis-selected-surface"
                                )}
                                onClick={() => {
                                  onToggleWikiComposerPin(note.slug, note.title);
                                }}
                              >
                                {pinned ? (
                                  <Check
                                    className="mt-0.5 h-4 w-4 shrink-0 text-trellis-accent"
                                    aria-hidden
                                  />
                                ) : (
                                  <Pin className="mt-0.5 h-4 w-4 shrink-0 text-trellis-muted" aria-hidden />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm text-trellis-text">{note.title}</span>
                                  <span className="mt-0.5 line-clamp-2 text-xs text-trellis-muted">
                                    {note.excerpt || "Strand"}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="px-1 py-2 text-sm text-trellis-muted">No notes match.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <ComposerIconButton
              title={
                privacyLocal
                  ? "Vision needs cloud chat — turn off local-only privacy to attach images"
                  : !visionAllowed
                    ? "Images need a vision-capable route — shorten the message or reduce attachments so Trellis can pick a vision model for your plan."
                    : "Attach an image file (PNG, JPEG, WebP, GIF)"
              }
              ariaLabel="Attach image file"
              disabled={
                disabled ||
                isStreaming ||
                privacyLocal ||
                pendingAttachments.length + pendingImages.length >= maxChatComposerAttachments
              }
              onClick={() => {
                onAttachImage();
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
            <ComposerIconButton
              title={
                privacyLocal
                  ? "Voice to text needs cloud chat — turn off local-only privacy"
                  : !speechAllowed
                    ? "Speech input is not available for this chat setup"
                    : isTranscribing
                      ? "Turning speech into text…"
                      : isRecording
                        ? "Stop recording and transcribe into the composer"
                        : "Record your voice, then transcribe it into the message box"
              }
              ariaLabel={
                isTranscribing
                  ? "Transcribing speech"
                  : isRecording
                    ? "Stop recording"
                    : "Start voice dictation"
              }
              disabled={
                disabled ||
                isStreaming ||
                !cloudMediaAllowed ||
                !speechAllowed ||
                !accessToken ||
                isTranscribing
              }
              onClick={() => {
                void toggleRecording();
              }}
              buttonClassName={cn(
                isRecording
                  ? "text-trellis-error hover:border-trellis-border hover:bg-trellis-surface"
                  : "text-trellis-muted hover:text-trellis-text"
              )}
            >
              {isTranscribing ? (
                <LoaderCircle className="h-4 w-4 animate-spin text-trellis-accent" aria-hidden />
              ) : (
                <Mic className="h-4 w-4" aria-hidden />
              )}
            </ComposerIconButton>
            <ComposerIconButton
              title={
                privacyLocal
                  ? "Image generation needs cloud chat — turn off local-only privacy"
                  : !imageGenAllowed
                    ? "Image generation needs a GPT-4o-class route — not available for this composer state or plan"
                    : imageGenBusy
                      ? "Generating an image…"
                      : "Generate a PNG with AI from a short description (opens prompt below)"
              }
              ariaLabel="Generate image with AI"
              disabled={disabled || isStreaming || !cloudMediaAllowed || privacyLocal || imageGenBusy}
              active={imageGenOpen}
              onClick={() => {
                setLinkEntryOpen(false);
                setWikiPinPickerOpen(false);
                setWikiPinSearch("");
                setImageGenOpen((current) => !current);
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
            >
              <Wand2 className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
          </div>
          <div className="group relative inline-flex shrink-0 items-center">
            <button
              type="button"
              className="rounded-full border border-transparent p-1 text-trellis-muted outline-none ring-trellis-accent/40 transition hover:border-trellis-border hover:bg-trellis-surface hover:text-trellis-text focus-visible:ring-2"
              aria-label="Composer help: type slash or at-sign to link notes; pin for priority; clip, files, and images add more context; Enter sends; Shift+Enter newline."
            >
              <CircleHelp className="h-4 w-4" aria-hidden />
            </button>
            <div
              className={cn(
                "trellis-elevated invisible absolute left-0 top-full z-40 mt-1.5 w-[min(100vw-2rem,340px)]",
                "rounded-field border border-trellis-border bg-trellis-surface px-3 py-2 shadow-lg",
                "text-xs leading-5 text-trellis-text",
                "opacity-0 transition-opacity motion-reduce:transition-none",
                "group-hover:visible group-hover:opacity-100",
                "group-focus-within:visible group-focus-within:opacity-100"
              )}
              role="tooltip"
            >
              Type{" "}
              <code className="rounded border border-trellis-border/50 px-1 py-px font-mono text-[0.95em]">/</code> or{" "}
              <code className="rounded border border-trellis-border/50 px-1 py-px font-mono text-[0.95em]">@</code> to link
              notes · pin
              for priority · clip, files, and images add more context. Enter sends · Shift+Enter newline.
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              className="rounded-full border border-trellis-border px-2.5 py-1 text-xs text-trellis-text transition hover:border-trellis-accent/35"
              title="Cancel editing this message and discard the draft"
              aria-label="Cancel edit"
              onClick={onCancel}
            >
              <span className="flex items-center gap-1.5">
                <RotateCcw className="h-3 w-3" aria-hidden />
                Cancel
              </span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {submitLabel !== "Send" && (
            <span className="rounded-full border border-trellis-accent/25 px-2.5 py-1 text-xs text-trellis-accent">
              {submitLabel}
            </span>
          )}
          {!selectedModelAccess.allowed && selectedModelAccess.reason && (
            <span className="max-w-[260px] text-[11px] leading-5 text-trellis-muted">
              {selectedModelAccess.reason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
