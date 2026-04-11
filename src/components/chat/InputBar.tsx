import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronsUpDown,
  FileText,
  ImagePlus,
  Link2,
  LoaderCircle,
  Lock,
  Mic,
  Paperclip,
  RotateCcw,
  Wand2
} from "lucide-react";
import type {
  ChatModel,
  NoteSummary,
  ProviderKeyStatus,
  SubscriptionTier
} from "@electron/ipc/types";
import type { PendingChatAttachment, PendingImageAttachment } from "@/lib/chatAttachments";
import {
  chatModelOptions,
  getChatModelAccess,
  getChatModelOption
} from "@/lib/chatModels";
import {
  getSlashCommandMatch,
  insertNoteReference
} from "@/lib/noteReferences";
import {
  buildTemplateCreationPrompt,
  buildTemplateUsePrompt,
  isTemplateNote
} from "@/lib/chatTemplates";
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
  model: ChatModel;
  subscriptionTier: SubscriptionTier;
  providerKeys: ProviderKeyStatus[];
  notes: NoteSummary[];
  value: string;
  submitLabel?: string;
  onChange: (value: string) => void;
  onCancel?: () => void;
  onSelectModel: (model: ChatModel) => void;
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
  onCreateTemplate: (input: { title: string; content: string }) => Promise<boolean>;
  onGenerateImageWithPrompt: (prompt: string) => Promise<boolean>;
  privacyLocal: boolean;
  cloudMediaAllowed: boolean;
  visionAllowed: boolean;
  speechAllowed: boolean;
  imageGenAllowed: boolean;
  accessToken: string | null;
  /** Unlocks every catalog model in the picker (preview workspace). */
  previewWorkspace?: boolean;
}

export function InputBar({
  disabled = false,
  isStreaming = false,
  model,
  subscriptionTier,
  providerKeys,
  notes,
  value,
  submitLabel = "Send",
  onChange,
  onCancel,
  onSelectModel,
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
  onCreateTemplate,
  onGenerateImageWithPrompt,
  privacyLocal,
  cloudMediaAllowed,
  visionAllowed,
  speechAllowed,
  imageGenAllowed,
  accessToken,
  previewWorkspace = false
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const [cursor, setCursor] = useState(value.length);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [linkEntryOpen, setLinkEntryOpen] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState("");
  const [clipUrlBusy, setClipUrlBusy] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateBodyDraft, setTemplateBodyDraft] = useState("");
  const [templateCreateBusy, setTemplateCreateBusy] = useState(false);
  const [templateAiDraft, setTemplateAiDraft] = useState("");
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [imageGenDraft, setImageGenDraft] = useState("");
  const [imageGenBusy, setImageGenBusy] = useState(false);
  const selectedModel = useMemo(() => getChatModelOption(model), [model]);
  const selectedModelAccess = useMemo(
    () =>
      getChatModelAccess(model, subscriptionTier, providerKeys, {
        previewWorkspace
      }),
    [model, previewWorkspace, providerKeys, subscriptionTier]
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

  const slashCommand = useMemo(() => getSlashCommandMatch(value, cursor), [cursor, value]);
  const slashSuggestions = useMemo(() => {
    if (!slashCommand) {
      return [];
    }

    const normalizedQuery = slashCommand.query.trim().toLowerCase();
    const filteredNotes = normalizedQuery
      ? notes.filter((note) =>
          `${note.title} ${note.tags.join(" ")}`.toLowerCase().includes(normalizedQuery)
        )
      : notes;

    return filteredNotes.slice(0, 6);
  }, [notes, slashCommand]);
  const templateNotes = useMemo(() => notes.filter(isTemplateNote), [notes]);
  const activeInputTool = linkEntryOpen || templateMenuOpen || imageGenOpen;

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [slashCommand?.from, slashCommand?.query]);

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (modelMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setModelMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (disabled) {
      setModelMenuOpen(false);
      setTemplateMenuOpen(false);
    }
  }, [disabled]);

  function syncCursor(): void {
    if (!textareaRef.current) {
      return;
    }

    setCursor(textareaRef.current.selectionStart ?? value.length);
  }

  function selectSlashSuggestion(index: number): void {
    if (!textareaRef.current || !slashCommand) {
      return;
    }

    const suggestion = slashSuggestions[index];

    if (!suggestion) {
      return;
    }

    const { nextValue, nextCursor } = insertNoteReference(value, slashCommand, suggestion.title);
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

  async function submitTemplateCreate(): Promise<void> {
    const title = templateTitleDraft.trim();
    const content = templateBodyDraft.trim();

    if (!title || templateCreateBusy) {
      return;
    }

    setTemplateCreateBusy(true);

    try {
      const ok = await onCreateTemplate({ title, content });

      if (ok) {
        setTemplateTitleDraft("");
        setTemplateBodyDraft("");
      }
    } finally {
      setTemplateCreateBusy(false);
    }
  }

  function submitTemplateAiDraft(): void {
    const description = templateAiDraft.trim();

    if (!description) {
      return;
    }

    onAppendDraft(buildTemplateCreationPrompt(description));
    setTemplateAiDraft("");
    setTemplateMenuOpen(false);
  }

  return (
    <div className="trellis-chat-composer w-full px-3 pb-2.5 pt-2">
      <div className="flex items-start gap-2.5">
        <div className="relative flex-1">
          <ComposerPendingPreviews
            pendingAttachments={pendingAttachments}
            pendingImages={pendingImages}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveImage={onRemoveImage}
          />
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
          ) : templateMenuOpen ? (
            <div className="flex min-h-[42px] flex-col gap-3 py-1">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
                    Templates
                  </p>
                  <button
                    type="button"
                    className="rounded-full border border-transparent px-2 py-1 text-xs text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
                    onClick={() => {
                      setTemplateMenuOpen(false);
                    }}
                  >
                    Close
                  </button>
                </div>
                {templateNotes.length > 0 ? (
                  <div className="mt-2 grid gap-1">
                    {templateNotes.slice(0, 6).map((template) => (
                      <button
                        key={template.slug}
                        type="button"
                        className="w-full rounded-field px-3 py-2 text-left transition hover:bg-trellis-surface"
                        onClick={() => {
                          onAppendDraft(buildTemplateUsePrompt(template.title));
                          setTemplateMenuOpen(false);
                        }}
                      >
                        <p className="text-sm text-trellis-text">{template.title}</p>
                        <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-trellis-muted">
                          {template.excerpt || "Use this structure in chat."}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-trellis-muted">
                    No saved templates yet. Create one here, or ask Trellis to make one.
                  </p>
                )}
              </div>
              <div className="grid gap-2 border-t border-trellis-border pt-3 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label
                    className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint"
                    htmlFor="chat-template-title"
                  >
                    Save a template
                  </label>
                  <input
                    id="chat-template-title"
                    className="trellis-input min-h-0 py-2 text-sm"
                    placeholder="Daily reflection template"
                    value={templateTitleDraft}
                    disabled={disabled || templateCreateBusy}
                    onChange={(event) => {
                      setTemplateTitleDraft(event.target.value);
                    }}
                  />
                  <textarea
                    className="trellis-input min-h-[92px] resize-y py-2 text-sm"
                    placeholder={"## Wins\n\n## Friction\n\n## Tomorrow"}
                    value={templateBodyDraft}
                    disabled={disabled || templateCreateBusy}
                    onChange={(event) => {
                      setTemplateBodyDraft(event.target.value);
                    }}
                  />
                  <button
                    type="button"
                    disabled={disabled || templateCreateBusy || templateTitleDraft.trim().length === 0}
                    className="w-fit rounded-full border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:opacity-40"
                    onClick={() => {
                      void submitTemplateCreate();
                    }}
                  >
                    {templateCreateBusy ? (
                      <span className="inline-flex items-center gap-2">
                        <LoaderCircle className="h-4 w-4 animate-spin text-trellis-accent" aria-hidden />
                        Saving...
                      </span>
                    ) : (
                      "Save template"
                    )}
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint"
                    htmlFor="chat-template-ai"
                  >
                    Ask Trellis
                  </label>
                  <textarea
                    id="chat-template-ai"
                    className="trellis-input min-h-[92px] resize-y py-2 text-sm"
                    placeholder="a daily reflection with mood, energy, gratitude, and tomorrow"
                    value={templateAiDraft}
                    disabled={disabled}
                    onChange={(event) => {
                      setTemplateAiDraft(event.target.value);
                    }}
                  />
                  <button
                    type="button"
                    disabled={disabled || templateAiDraft.trim().length === 0}
                    className="w-fit rounded-full border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:opacity-40"
                    onClick={submitTemplateAiDraft}
                  >
                    Draft with chat
                  </button>
                </div>
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
                if (slashCommand) {
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
                    selectSlashSuggestion(activeCommandIndex);
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
          {!activeInputTool && slashCommand && (
            <div className="trellis-elevated absolute bottom-full left-0 right-0 z-20 mb-3 overflow-hidden">
              <div className="border-b border-trellis-border px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
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
                        selectSlashSuggestion(index);
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
            ? "Add a message or attachment to send"
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
                setTemplateMenuOpen(false);
                setLinkEntryOpen((current) => !current);
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
            >
              <Link2 className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
            <ComposerIconButton
              title="Use or create a template"
              ariaLabel="Use or create template"
              disabled={disabled || isStreaming}
              active={templateMenuOpen}
              onClick={() => {
                setLinkEntryOpen(false);
                setImageGenOpen(false);
                setTemplateMenuOpen((current) => !current);
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
              dataTestId="chat-template-menu"
            >
              <FileText className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
            <ComposerIconButton
              title={
                privacyLocal
                  ? "Vision needs cloud chat — turn off local-only privacy to attach images"
                  : !visionAllowed
                    ? "Attach an image file — your current model is not vision-capable; switch to GPT-4o Mini, GPT-4o, or Claude, or Trellis will remind you when you click"
                    : "Attach an image file (PNG, JPEG, WebP, GIF) for vision-capable models"
              }
              ariaLabel="Attach image file"
              disabled={
                disabled ||
                isStreaming ||
                privacyLocal ||
                pendingAttachments.length + pendingImages.length >= 12
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
                    ? "Speech input is not available for this model or setup"
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
                    ? "Describe an image to generate — requires GPT-4o; Trellis will remind you if your model cannot generate"
                    : imageGenBusy
                      ? "Generating an image…"
                      : "Generate a PNG with AI from a short description (opens prompt below)"
              }
              ariaLabel="Generate image with AI"
              disabled={disabled || isStreaming || !cloudMediaAllowed || privacyLocal || imageGenBusy}
              active={imageGenOpen}
              onClick={() => {
                setLinkEntryOpen(false);
                setTemplateMenuOpen(false);
                setImageGenOpen((current) => !current);
              }}
              buttonClassName="text-trellis-muted hover:text-trellis-text"
            >
              <Wand2 className="h-4 w-4" aria-hidden />
            </ComposerIconButton>
          </div>
          <p className="min-w-0 text-xs text-trellis-muted">
            Type <code>/</code> for notes. Templates, files, links, and images can guide the chat. Enter sends ·
            Shift+Enter newline.
          </p>
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
        <div className="flex items-center gap-2">
          {submitLabel !== "Send" && (
            <span className="rounded-full border border-trellis-accent/25 px-2.5 py-1 text-xs text-trellis-accent">
              {submitLabel}
            </span>
          )}
          <div className="relative" ref={modelMenuRef}>
            <span
              title={disabled ? "Choose which model generates replies" : undefined}
              className={cn("inline-flex max-w-[200px]", disabled && "cursor-not-allowed")}
            >
              <button
                type="button"
                disabled={disabled}
                title={disabled ? undefined : "Choose which model generates replies"}
                aria-label="Choose chat model"
                aria-expanded={modelMenuOpen}
                className={cn(
                  "trellis-accent-button flex max-w-[200px] items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs transition hover:border-trellis-accent/50 disabled:border-trellis-border disabled:text-trellis-faint",
                  disabled && "pointer-events-none"
                )}
                onClick={() => {
                  setModelMenuOpen((current) => !current);
                }}
              >
                <span className="min-w-0 truncate text-trellis-text">{selectedModel.label}</span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-trellis-muted" aria-hidden />
              </button>
            </span>
            {modelMenuOpen && (
              <div className="trellis-elevated absolute bottom-full right-0 z-30 mb-3 w-[340px] overflow-hidden">
                <div className="border-b border-trellis-border px-3 py-2">
                  <p className="text-xs leading-5 text-trellis-muted">
                    {subscriptionTier === "pro"
                      ? "All models on this account."
                      : subscriptionTier === "byok"
                        ? "BYOK unlocks providers you’ve configured locally."
                      : "Trial includes fast models; upgrade for premium."}
                  </p>
                </div>
                <div className="max-h-[360px] overflow-y-auto px-2 py-2">
                  <div className="space-y-1">
                    {chatModelOptions.map((option) => {
                      const isSelected = option.id === model;
                      const access = getChatModelAccess(option.id, subscriptionTier, providerKeys, {
                        previewWorkspace
                      });
                      const isAccessible = access.allowed;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={!isAccessible}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-field px-3 py-2 text-left transition",
                            isSelected
                              ? "trellis-selected-surface"
                              : "hover:bg-trellis-surface",
                            !isAccessible && "cursor-not-allowed opacity-70"
                          )}
                          onClick={() => {
                            if (!isAccessible) {
                              return;
                            }

                            onSelectModel(option.id);
                            setModelMenuOpen(false);
                          }}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className="pt-1">
                              {isSelected ? (
                                <Check className="h-4 w-4 text-trellis-accent" />
                              ) : isAccessible ? (
                                <div className="h-2 w-2 rounded-full bg-trellis-accent/60" />
                              ) : (
                                <Lock className="h-4 w-4 text-trellis-faint" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm text-trellis-text">{option.label}</p>
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                                    option.tier === "cheap"
                                      ? "border-trellis-border text-trellis-muted"
                                      : "border-trellis-accent/25 text-trellis-accent"
                                  )}
                                >
                                  {option.tier === "cheap" ? "Fast" : "Premium"}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-trellis-muted">
                                {option.summary}
                              </p>
                              {!isAccessible && access.reason && (
                                <p className="mt-1 text-[11px] leading-5 text-trellis-faint">
                                  {access.reason}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          {!selectedModelAccess.allowed && selectedModelAccess.reason && (
            <span className="max-w-[260px] text-right text-[11px] leading-5 text-trellis-muted">
              {selectedModelAccess.reason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
