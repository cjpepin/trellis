import { CircleHelp } from "lucide-react";
import type { WorkspaceInfo } from "@electron/ipc/types";

interface Props {
  workspaces: WorkspaceInfo[];
  onSelect: (workspaceId: WorkspaceInfo["id"]) => Promise<void>;
}

export function WorkspaceChooser({ workspaces, onSelect }: Props) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(200,169,110,0.18),_transparent_42%),linear-gradient(180deg,_rgba(18,18,18,0.98),_rgba(10,10,10,1))] px-6 py-12"
      data-testid="workspace-chooser"
    >
      <div className="w-full max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-display text-5xl text-trellis-text">Choose your workspace</p>
          <p className="mt-4 text-base leading-8 text-trellis-muted">
            Start in your normal Trellis workspace or open a fully seeded preview that shows how
            the app feels after months of steady use.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <section
              key={workspace.id}
              data-testid={`workspace-card-${workspace.id}`}
              className="trellis-elevated flex min-h-[320px] flex-col justify-between rounded-panel border border-trellis-border px-6 py-6"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">
                  {workspace.isPreview ? "Guided preview" : "Your space"}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2 lg:justify-start">
                  <p className="font-display text-3xl text-trellis-text">{workspace.label}</p>
                  {workspace.isPreview ? (
                    <button
                      type="button"
                      className="group relative inline-flex items-center rounded-full border border-trellis-border/80 px-2 py-2 text-trellis-faint transition hover:border-trellis-accent/25 hover:text-trellis-text"
                      aria-label="Preview workspace details"
                    >
                      <CircleHelp className="h-4 w-4" />
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2 text-left text-xs leading-6 text-trellis-muted shadow-lg group-hover:block">
                        {workspace.description}
                      </span>
                    </button>
                  ) : null}
                </div>
                {!workspace.isPreview ? (
                  <p className="mt-4 text-sm leading-7 text-trellis-muted">{workspace.description}</p>
                ) : null}
                <div className="mt-6 space-y-2 text-sm text-trellis-text">
                  <p>
                    {workspace.isPreview
                      ? "Seeded chats, notes, graph links, and raw sources."
                      : "Your own vaults, account session, and live cloud chat."}
                  </p>
                  <p>
                    {workspace.localOnly
                      ? "Local-only by default, editable, and resettable."
                      : workspace.isPreview
                        ? "Resettable sample data with your normal account and live chat."
                        : "Best for real work and your normal daily flow."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                data-testid={`workspace-option-${workspace.id}`}
                className="trellis-accent-button mt-8 rounded-field border px-4 py-3 text-sm transition"
                onClick={() => {
                  void onSelect(workspace.id);
                }}
              >
                {workspace.isPreview ? "Explore preview workspace" : "Start personal workspace"}
              </button>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
