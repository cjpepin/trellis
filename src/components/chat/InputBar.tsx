import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronsUpDown, Lock, RotateCcw, Sparkles } from "lucide-react";
import type { ChatModel, NoteSummary } from "@electron/ipc/types";
import {
  canUseChatModel,
  chatModelOptions,
  getChatModelOption,
  getChatModelProviderLabel
} from "@/lib/chatModels";
import {
  getSlashCommandMatch,
  insertNoteReference
} from "@/lib/noteReferences";
import { cn } from "@/lib/utils";

interface Props {
  disabled?: boolean;
  isStreaming?: boolean;
  model: ChatModel;
  subscriptionTier: "trial" | "pro";
  notes: NoteSummary[];
  value: string;
  submitLabel?: string;
  onChange: (value: string) => void;
  onCancel?: () => void;
  onSelectModel: (model: ChatModel) => void;
  onSubmit: (value: string) => Promise<void>;
}

export function InputBar({
  disabled = false,
  isStreaming = false,
  model,
  subscriptionTier,
  notes,
  value,
  submitLabel = "Send",
  onChange,
  onCancel,
  onSelectModel,
  onSubmit
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState(value.length);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const selectedModel = useMemo(() => getChatModelOption(model), [model]);
  const canUsePremiumModels = subscriptionTier === "pro";
  const modelSections = useMemo(
    () => [
      {
        label: "OpenAI",
        options: chatModelOptions.filter((option) => option.provider === "openai")
      },
      {
        label: "Claude",
        options: chatModelOptions.filter((option) => option.provider === "anthropic")
      }
    ],
    []
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

  async function handleSubmit() {
    const nextValue = value.trim();

    if (!nextValue || disabled || isStreaming) {
      return;
    }

    await onSubmit(nextValue);
  }

  return (
    <div className="trellis-elevated w-full px-3 pb-2.5 pt-2">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-2 h-4 w-4 text-trellis-accent" />
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled}
            placeholder="What are you thinking about?"
            className="min-h-[42px] w-full resize-none bg-transparent py-1 text-[15px] leading-6 text-trellis-text outline-none placeholder:text-trellis-faint"
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

              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          {slashCommand && (
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
        <button
          type="button"
          disabled={disabled || value.trim().length === 0 || isStreaming}
          className={cn(
            "mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition",
            disabled || value.trim().length === 0 || isStreaming
              ? "border-trellis-border text-trellis-faint"
              : "trellis-accent-surface border-trellis-accent/35 text-trellis-accent hover:border-trellis-accent"
          )}
          onClick={() => {
            void handleSubmit();
          }}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-xs text-trellis-muted">
            Type <code>/</code> to link a note. Enter adds a new line. Cmd/Ctrl+Enter sends.
          </p>
          {onCancel && (
            <button
              type="button"
              className="rounded-full border border-trellis-border px-2.5 py-1 text-xs text-trellis-text transition hover:border-trellis-accent/35"
              onClick={onCancel}
            >
              <span className="flex items-center gap-1.5">
                <RotateCcw className="h-3 w-3" />
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
            <button
              type="button"
              disabled={disabled}
              className="trellis-accent-button flex items-center gap-2 rounded-full border px-3 py-1 text-left text-xs transition hover:border-trellis-accent/50 disabled:cursor-not-allowed disabled:border-trellis-border disabled:text-trellis-faint"
              onClick={() => {
                setModelMenuOpen((current) => !current);
              }}
            >
              <div className="min-w-0">
                <p className="truncate text-[10px] uppercase tracking-[0.18em] text-trellis-faint">
                  {getChatModelProviderLabel(model)}
                </p>
                <p className="truncate text-xs text-trellis-text">{selectedModel.label}</p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-trellis-muted" />
            </button>
            {modelMenuOpen && (
              <div className="trellis-elevated absolute bottom-full right-0 z-30 mb-3 w-[340px] overflow-hidden">
                <div className="border-b border-trellis-border px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
                    Model
                  </p>
                  <p className="mt-2 text-xs leading-6 text-trellis-muted">
                    {canUsePremiumModels
                      ? "All popular OpenAI and Claude models are available on this account."
                      : "Free tier includes the faster lower-cost models. Upgrade to unlock premium options."}
                  </p>
                </div>
                <div className="max-h-[360px] overflow-y-auto px-2 py-2">
                  {modelSections.map((section) => (
                    <div key={section.label} className="mb-3 last:mb-0">
                      <p className="px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
                        {section.label}
                      </p>
                      <div className="space-y-1">
                        {section.options.map((option) => {
                          const isSelected = option.id === model;
                          const isAccessible = canUseChatModel(option.id, subscriptionTier);

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
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
