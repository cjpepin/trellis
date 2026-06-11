import { Link } from "react-router-dom";
import { appShellPath } from "@/lib/appRoutes";
import { useUiStore } from "@/store/uiStore";

export function GuestQuotaModal() {
  const open = useUiStore((state) => state.guestQuotaModalOpen);
  const setOpen = useUiStore((state) => state.setGuestQuotaModalOpen);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4">
      <div className="trellis-elevated w-full max-w-lg rounded-panel border border-trellis-border bg-trellis-surface px-6 py-6">
        <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Guest limit reached</p>
        <h2 className="mt-3 font-display text-4xl text-trellis-text">Create a free account to keep going.</h2>
        <p className="mt-4 text-sm leading-7 text-trellis-muted">
          Guest sessions include `5 messages / 24 hours`. Create a free account to continue with the
          normal `25 messages / 24 hours` allowance and unlock a path to sync across devices.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="trellis-accent-button rounded-field border px-4 py-3 text-sm transition"
            onClick={() => setOpen(false)}
          >
            Create account
          </Link>
          <Link
            to={appShellPath("/settings")}
            className="rounded-field border border-trellis-border px-4 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35"
            onClick={() => setOpen(false)}
          >
            Sign in instead
          </Link>
          <button
            type="button"
            className="rounded-field border border-trellis-border px-4 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35"
            onClick={() => setOpen(false)}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
