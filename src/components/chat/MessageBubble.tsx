import { Link2, Paperclip, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import type { MessageRecord } from "@electron/ipc/types";
import { cn } from "@/lib/utils";
import type { MessageMeta } from "@/store/chatStore";
import { RichTextRenderer } from "@/components/shared/RichTextRenderer";
import { StreamingIndicator } from "./StreamingIndicator";

interface Props {
  message: MessageRecord;
  existingSlugs: string[];
  meta?: MessageMeta;
  canEdit?: boolean;
  canRetry?: boolean;
  onEdit?: () => void;
  onOpenNote?: (slug: string) => void;
  onRetry?: () => void;
  waitingForTokens?: boolean;
}

export function MessageBubble({
  message,
  existingSlugs,
  meta,
  canEdit = false,
  canRetry = false,
  onEdit,
  onOpenNote,
  onRetry,
  waitingForTokens = false
}: Props) {
  const isUser = message.role === "user";
  const isFailed = meta?.status === "failed";
  const isPending = meta?.status === "pending";
  const roleLabel = isUser ? "You" : "Trellis";
  const contentWidthClassName = isUser ? "max-w-[38rem]" : "max-w-[42rem]";

  return (
    <div className={cn("flex w-full animate-fade-rise", isUser ? "justify-end" : "justify-start")}>
      <article className={cn("flex w-full flex-col gap-3", isUser ? "items-end" : "items-start")}>
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
            `w-full ${contentWidthClassName} text-left`,
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
          {waitingForTokens && message.content.length === 0 ? (
            <StreamingIndicator />
          ) : message.content.trim().length > 0 ? (
            <RichTextRenderer
              markdown={message.content}
              existingSlugs={existingSlugs}
              className="trellis-chat-copy text-left"
              onOpenNote={onOpenNote}
            />
          ) : (
            <p className="text-sm italic text-trellis-muted">No message text (attachments only).</p>
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
              <span className="flex items-center gap-1.5 text-trellis-error">
                <TriangleAlert className="h-3.5 w-3.5" />
                {meta?.errorMessage ?? "Not sent"}
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
