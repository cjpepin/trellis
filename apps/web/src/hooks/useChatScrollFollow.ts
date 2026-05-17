import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** Distance from the bottom (px) still treated as "following" the stream. */
const BOTTOM_PIN_THRESHOLD_PX = 72;

function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_PIN_THRESHOLD_PX;
}

/**
 * Keeps a scroll container aligned to the bottom while the user stays near the end;
 * when they scroll up, automatic following stops until they return to the bottom.
 */
export function useChatScrollFollow({
  scrollRef,
  contentSignature,
  followResponsesEnabled,
  sessionKey
}: {
  scrollRef: RefObject<HTMLElement | null>;
  contentSignature: string;
  followResponsesEnabled: boolean;
  sessionKey: string | null;
}): { onScroll: () => void } {
  const pinnedToBottomRef = useRef(true);

  useLayoutEffect(() => {
    pinnedToBottomRef.current = true;
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [sessionKey, scrollRef]);

  useLayoutEffect(() => {
    if (!followResponsesEnabled || !pinnedToBottomRef.current) {
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [contentSignature, followResponsesEnabled, scrollRef]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    pinnedToBottomRef.current = isPinnedToBottom(el);
  }, [scrollRef]);

  return { onScroll };
}
