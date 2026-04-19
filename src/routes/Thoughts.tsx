import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { AppSettings, ThoughtRecord } from "@electron/ipc/types";
import { ThoughtRelatedContext } from "@/components/thoughts/ThoughtRelatedContext";
import { getActiveVault } from "@/lib/settings";
import { notesRoutePath } from "@/lib/noteRoutes";
import { useThoughtStore } from "@/store/thoughtStore";
import { useUiStore } from "@/store/uiStore";
interface Props {
  settings: AppSettings;
}

export function Thoughts({ settings }: Props) {
  const vault = getActiveVault(settings);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pushToast = useUiStore((state) => state.pushToast);

  const thoughts = useThoughtStore((state) => state.thoughts);
  const hydrate = useThoughtStore((state) => state.hydrate);
  const prependThought = useThoughtStore((state) => state.prependThought);
  const upsertThought = useThoughtStore((state) => state.upsertThought);

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedId = searchParams.get("id");
  const selected = selectedId ? thoughts.find((row) => row.id === selectedId) ?? null : null;

  const thoughtIndex = useMemo(() => new Map(thoughts.map((row) => [row.id, row])), [thoughts]);

  const refreshThought = useCallback(
    async (id: string) => {
      const latest = await window.trellis.db.getThought(id);

      if (latest) {
        upsertThought(latest);
      }
    },
    [upsertThought]
  );

  useEffect(() => {
    void hydrate(vault.id);
  }, [hydrate, vault.id]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    if (!selected) {
      void refreshThought(selectedId);
    }
  }, [selectedId, selected, refreshThought]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();

    if (text.length === 0 || saving) {
      return;
    }

    setSaving(true);

    try {
      const created = await window.trellis.db.createThought({
        vaultId: vault.id,
        content: text,
        sourceType: "manual"
      });
      prependThought(created);
      setDraft("");
      setSearchParams({ id: created.id });
      pushToast({
        title: "Thought captured — linking in the background",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save thought",
        tone: "warning"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRetryEnrichment(): Promise<void> {
    if (!selected) {
      return;
    }

    try {
      await window.trellis.db.retryThoughtEnrichment(selected.id);
      await refreshThought(selected.id);
      pushToast({ title: "Retry scheduled", tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not retry",
        tone: "warning"
      });
    }
  }

  async function handleSaveAsStrand(): Promise<void> {
    if (!selected) {
      return;
    }

    const firstLine = selected.content.trim().split(/\n/)[0]?.trim() ?? "Captured thought";
    const title =
      firstLine.length > 80 ? `${firstLine.slice(0, 77).trimEnd()}…` : firstLine;

    try {
      const result = await window.trellis.vault.writeNote({
        vaultId: vault.id,
        title,
        content: selected.content,
        frontmatter: {
          type: "synthesis",
          tags: selected.tags.length > 0 ? selected.tags : ["capture"],
          sources: 0
        },
        strandRevision: { actor: "user" }
      });
      pushToast({
        title: "Saved as Strand",
        tone: "success",
        noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
      });
      navigate(notesRoutePath(result.note.slug));
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not create Strand",
        tone: "warning"
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-6" data-testid="route-thoughts">
      <header className="shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-trellis-accent" aria-hidden />
          <h1 className="font-display text-2xl text-trellis-text">Thoughts</h1>
        </div>
        <p className="max-w-xl text-sm text-trellis-muted">
          Capture quickly. Strands stay the durable files — Thoughts are the fast layer on top, enriched
          after you save.
        </p>
      </header>

      <form onSubmit={(event) => void handleSubmit(event)} className="shrink-0 space-y-3">
        <label htmlFor="thought-capture" className="text-xs font-medium text-trellis-faint">
          What are you thinking?
        </label>
        <textarea
          id="thought-capture"
          data-testid="thought-capture-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="A sentence or two is enough. You can link or polish later."
          className="w-full resize-y rounded-panel border border-trellis-border bg-trellis-surface/80 px-4 py-3 text-sm text-trellis-text outline-none placeholder:text-trellis-faint focus:border-trellis-accent/45"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            data-testid="thought-capture-submit"
            disabled={saving || draft.trim().length === 0}
            className="trellis-accent-button rounded-field border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Capture"}
          </button>
          <span className="text-xs text-trellis-faint">Saved locally · enrichment runs in the background</span>
        </div>
      </form>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="trellis-panel flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-trellis-border px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-trellis-faint">
              Recent captures
            </p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {thoughts.length === 0 ? (
              <li className="px-4 py-8 text-sm text-trellis-muted">
                Nothing here yet — add a thought above to seed your living graph.
              </li>
            ) : (
              thoughts.map((row) => {
                const active = row.id === selectedId;
                const line = row.content.trim().split(/\n/)[0]?.trim() ?? "Empty";
                const preview = line.length > 96 ? `${line.slice(0, 96)}…` : line;

                return (
                  <li key={row.id} className="border-b border-trellis-border/70 last:border-b-0">
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-trellis-surface-2/80 ${
                        active ? "bg-trellis-accent/8" : ""
                      }`}
                      onClick={() => {
                        setSearchParams({ id: row.id });
                      }}
                    >
                      <span className="line-clamp-2 text-sm text-trellis-text">{preview}</span>
                      <span className="text-[11px] text-trellis-faint">
                        {new Date(row.createdAt).toLocaleString()} · {row.status}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="trellis-panel flex min-h-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-trellis-border px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-trellis-faint">
              Detail
            </p>
            {selected && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-field border border-trellis-border px-3 py-1.5 text-xs text-trellis-muted transition hover:border-trellis-accent/35"
                  onClick={() => void handleRetryEnrichment()}
                >
                  Retry enrichment
                </button>
                <button
                  type="button"
                  className="rounded-field border border-trellis-border px-3 py-1.5 text-xs text-trellis-muted transition hover:border-trellis-accent/35"
                  onClick={() => void handleSaveAsStrand()}
                >
                  Save as Strand
                </button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {!selected ? (
              <p className="text-sm text-trellis-muted">
                Select a capture to see related Strands, earlier thoughts, and light temporal context.
              </p>
            ) : (
              <div className="space-y-4">
                <pre className="whitespace-pre-wrap rounded-field border border-trellis-border/80 bg-trellis-surface/50 p-3 text-sm text-trellis-text">
                  {selected.content}
                </pre>
                <ThoughtRelatedContext
                  thought={selected}
                  thoughtIndex={thoughtIndex}
                  onOpenThought={(id) => {
                    setSearchParams({ id });
                  }}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
