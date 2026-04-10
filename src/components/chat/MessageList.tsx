import { useEffect, useMemo, useRef } from "react";
import type { MessageRecord } from "@electron/ipc/types";
import type { MessageMeta } from "@/store/chatStore";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: MessageRecord[];
  columnClassName: string;
  existingSlugs: string[];
  messageMetaById: Record<string, MessageMeta>;
  awaitingFirstToken: boolean;
  isStreaming: boolean;
  onEditMessage: (messageId: string) => void;
  onOpenNote: (slug: string) => void;
  onRetryMessage: (messageId: string) => void;
  onReadAloud?: (messageId: string, text: string) => void | Promise<void>;
  readAloudLoadingMessageId?: string | null;
  readAloudDisabled?: boolean;
}

export function MessageList({
  messages,
  columnClassName,
  existingSlugs,
  messageMetaById,
  awaitingFirstToken,
  isStreaming,
  onEditMessage,
  onOpenNote,
  onRetryMessage,
  onReadAloud,
  readAloudLoadingMessageId,
  readAloudDisabled
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessageSignature = useMemo(() => {
    const lastMessage = messages.at(-1);

    return `${lastMessage?.id ?? "none"}:${lastMessage?.content.length ?? 0}`;
  }, [messages]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({
        block: "end"
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [awaitingFirstToken, lastMessageSignature]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="font-display text-4xl text-trellis-text">What are you thinking through?</p>
        <p className="mt-4 max-w-xl text-base leading-7 text-trellis-muted">
          Start a conversation, pull in notes with <code>/</code>, and let the thread turn
          into durable wiki knowledge over time.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto flex w-full ${columnClassName} flex-col gap-8 px-6 pb-14 pt-10 md:gap-10 md:px-10`}
    >
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          existingSlugs={existingSlugs}
          meta={messageMetaById[message.id]}
          canEdit={message.role === "user" && !isStreaming}
          canRetry={message.role === "user" && !isStreaming}
          onEdit={() => onEditMessage(message.id)}
          onOpenNote={onOpenNote}
          onRetry={() => onRetryMessage(message.id)}
          waitingForTokens={awaitingFirstToken && index === messages.length - 1}
          onReadAloud={onReadAloud}
          readAloudLoading={readAloudLoadingMessageId === message.id}
          readAloudDisabled={readAloudDisabled}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
