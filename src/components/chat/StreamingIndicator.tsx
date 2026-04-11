function ThinkingLabel() {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-live="polite"
      aria-label="Thinking"
    >
      <span>Thinking</span>
      <span className="inline-flex" aria-hidden>
        <span className="animate-thinkingEllipsis [animation-delay:0ms] motion-reduce:animate-none motion-reduce:opacity-100">
          .
        </span>
        <span className="animate-thinkingEllipsis [animation-delay:200ms] motion-reduce:animate-none motion-reduce:opacity-100">
          .
        </span>
        <span className="animate-thinkingEllipsis [animation-delay:400ms] motion-reduce:animate-none motion-reduce:opacity-100">
          .
        </span>
      </span>
    </span>
  );
}

export function StreamingIndicator() {
  return (
    <div className="space-y-4 py-1">
      <div className="flex items-center gap-2 text-sm text-trellis-muted">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-trellis-accent/70 [animation-delay:-200ms] animate-pulseDots motion-reduce:animate-none motion-reduce:opacity-70" />
          <span className="h-1.5 w-1.5 rounded-full bg-trellis-accent/70 [animation-delay:-100ms] animate-pulseDots motion-reduce:animate-none motion-reduce:opacity-70" />
          <span className="h-1.5 w-1.5 rounded-full bg-trellis-accent/70 animate-pulseDots motion-reduce:animate-none motion-reduce:opacity-70" />
        </span>
        <ThinkingLabel />
      </div>
      <div className="space-y-2.5">
        <span className="block h-2.5 w-full max-w-[38rem] rounded-full bg-trellis-accent/10 animate-pulse" />
        <span className="block h-2.5 w-full max-w-[34rem] rounded-full bg-trellis-accent/10 [animation-delay:150ms] animate-pulse" />
        <span className="block h-2.5 w-2/3 max-w-[26rem] rounded-full bg-trellis-accent/10 [animation-delay:300ms] animate-pulse" />
      </div>
    </div>
  );
}
