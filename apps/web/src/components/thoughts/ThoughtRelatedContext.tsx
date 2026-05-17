import type { ThoughtRecord } from "@trellis/contracts";

interface Props {
  thought: ThoughtRecord;
  thoughtIndex: Map<string, ThoughtRecord>;
  onOpenThought: (id: string) => void;
}

function previewLine(content: string): string {
  const line = content.trim().split(/\n/)[0]?.trim() ?? "";

  if (line.length === 0) {
    return "…";
  }

  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

export function ThoughtRelatedContext({ thought, thoughtIndex, onOpenThought }: Props) {
  const enrichment = thought.enrichment;

  if (!enrichment && thought.status === "processing") {
    return (
      <p className="text-xs text-trellis-muted">
        Connecting this capture to your Strands and prior thoughts…
      </p>
    );
  }

  if (thought.status === "failed" && thought.enrichmentError) {
    return (
      <div className="rounded-field border border-trellis-border/80 bg-trellis-surface/60 px-3 py-2 text-xs text-trellis-muted">
        <p className="font-medium text-trellis-text">Enrichment paused</p>
        <p className="mt-1 text-trellis-faint">{thought.enrichmentError}</p>
      </div>
    );
  }

  if (!enrichment) {
    return null;
  }

  const hasRelated =
    enrichment.relatedThoughts.length > 0 ||
    enrichment.relatedNotes.length > 0 ||
    enrichment.temporalSignals.length > 0;

  if (!hasRelated) {
    return (
      <p className="text-xs text-trellis-faint">
        No strong links yet — try a few more words so retrieval can anchor this capture.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {enrichment.temporalSignals.length > 0 && (
        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-trellis-faint">
            Memory over time
          </p>
          <ul className="mt-2 space-y-2">
            {enrichment.temporalSignals.map((signal) => (
              <li
                key={`${signal.kind}-${signal.label}`}
                className="rounded-field border border-trellis-border/70 bg-trellis-surface/50 px-3 py-2 text-xs text-trellis-muted"
              >
                <span className="text-trellis-text">{signal.label}</span>
                {signal.detail ? (
                  <span className="mt-1 block text-trellis-faint">{signal.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {enrichment.relatedThoughts.length > 0 && (
        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-trellis-faint">
            Related thoughts
          </p>
          <ul className="mt-2 space-y-2">
            {enrichment.relatedThoughts.map((item) => {
              const other = thoughtIndex.get(item.id);

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full rounded-field border border-trellis-border/70 bg-trellis-surface/40 px-3 py-2 text-left text-xs transition hover:border-trellis-accent/35"
                    onClick={() => {
                      onOpenThought(item.id);
                    }}
                  >
                    <span className="text-trellis-muted">{item.reason}</span>
                    {other ? (
                      <span className="mt-1 block text-trellis-text">{previewLine(other.content)}</span>
                    ) : (
                      <span className="mt-1 block text-trellis-faint">Earlier capture</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {enrichment.relatedNotes.length > 0 && (
        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-trellis-faint">
            Possibly connected Strands
          </p>
          <ul className="mt-2 space-y-2">
            {enrichment.relatedNotes.map((note) => (
              <li
                key={note.slug}
                className="rounded-field border border-trellis-border/70 bg-trellis-surface/40 px-3 py-2 text-xs"
              >
                <span className="text-trellis-text">{note.title}</span>
                <span className="mt-0.5 block text-trellis-faint">
                  {note.reason} · confidence is heuristic, not certainty
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
