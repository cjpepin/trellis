import type { MessageRecord, NoteSummary } from "@trellis/contracts";
import type { MessageMeta } from "@/store/chatStore";
import type { TranscriptFindMatch } from "@/lib/chatTranscriptFind";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: MessageRecord[];
  columnClassName: string;
  existingSlugs: string[];
  bucketId: string;
  notes: NoteSummary[];
  messageMetaById: Record<string, MessageMeta>;
  awaitingFirstToken: boolean;
  isStreaming: boolean;
  onEditMessage: (messageId: string) => void;
  onOpenNote: (slug: string) => void;
  onRetryMessage: (messageId: string) => void;
  onReadAloud?: (messageId: string, text: string) => void | Promise<void>;
  readAloudActiveMessageId?: string | null;
  /** True while waiting for the first audio chunk for the active read-aloud message. */
  readAloudAwaitingFirstChunk?: boolean;
  readAloudDisabled?: boolean;
  onApproveNoteAction?: (messageId: string, actionId: string) => void | Promise<void>;
  onRejectNoteAction?: (messageId: string, actionId: string) => void | Promise<void>;
  onNoteActionDraftChange?: (
    messageId: string,
    actionId: string,
    afterMarkdown: string
  ) => void;
  busyNoteActionId?: string | null;
  /** Active Cmd/Ctrl+F transcript find match (highlights in rendered markdown when possible). */
  transcriptFindActive?: TranscriptFindMatch | null;
}

export function MessageList({
  messages,
  columnClassName,
  existingSlugs,
  bucketId,
  notes,
  messageMetaById,
  awaitingFirstToken,
  isStreaming,
  onEditMessage,
  onOpenNote,
  onRetryMessage,
  onReadAloud,
  readAloudActiveMessageId,
  readAloudAwaitingFirstChunk = false,
  readAloudDisabled,
  onApproveNoteAction,
  onRejectNoteAction,
  onNoteActionDraftChange,
  busyNoteActionId,
  transcriptFindActive = null
}: Props) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="font-display text-4xl text-trellis-text">What are you thinking through?</p>
        <p className="mt-4 max-w-xl text-base leading-7 text-trellis-muted">
          Start a conversation, link Strands with <code>/</code> or <code>@</code>, pin what
          matters, and let the thread compound into durable memory in your vault.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto flex w-full ${columnClassName} flex-col gap-8 px-6 pb-5 pt-10 md:gap-10 md:px-10`}
    >
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          transcriptFindHighlight={
            transcriptFindActive?.messageId === message.id ? transcriptFindActive : null
          }
          existingSlugs={existingSlugs}
          bucketId={bucketId}
          notes={notes}
          meta={messageMetaById[message.id]}
          canEdit={message.role === "user" && !isStreaming}
          canRetry={message.role === "user" && !isStreaming}
          onEdit={() => onEditMessage(message.id)}
          onOpenNote={onOpenNote}
          onRetry={() => onRetryMessage(message.id)}
          waitingForTokens={awaitingFirstToken && index === messages.length - 1}
          onReadAloud={onReadAloud}
          readAloudActive={readAloudActiveMessageId === message.id}
          readAloudLoading={
            readAloudActiveMessageId === message.id && readAloudAwaitingFirstChunk
          }
          readAloudDisabled={readAloudDisabled}
          onApproveNoteAction={onApproveNoteAction}
          onRejectNoteAction={onRejectNoteAction}
          onNoteActionDraftChange={onNoteActionDraftChange}
          busyNoteActionId={busyNoteActionId}
        />
      ))}
    </div>
  );
}
