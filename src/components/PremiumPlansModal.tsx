import { useEffect } from "react";
import { Check, KeyRound, Sparkles, X, Zap } from "lucide-react";
import type { CheckoutPlanCode, SubscriptionTier } from "@electron/ipc/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  subscriptionTier: SubscriptionTier;
  canCheckout: boolean;
  checkoutPlan: CheckoutPlanCode | null;
  onSubscribe: (plan: CheckoutPlanCode) => void;
}

export function PremiumPlansModal({
  open,
  onClose,
  subscriptionTier,
  canCheckout,
  checkoutPlan,
  onSubscribe
}: Props) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function renderPlanButton(plan: CheckoutPlanCode): JSX.Element {
    const isCurrent = subscriptionTier === plan;
    const isBusy = checkoutPlan === plan;

    if (isCurrent) {
      return (
        <button
          type="button"
          disabled
          className="mt-6 w-full cursor-default rounded-field border border-trellis-border py-2.5 text-xs font-medium text-trellis-text"
        >
          Current plan
        </button>
      );
    }

    if (!canCheckout) {
      return (
        <button
          type="button"
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-field border border-trellis-border py-2.5 text-xs text-trellis-faint"
        >
          Sign in to upgrade
        </button>
      );
    }

    return (
      <button
        type="button"
        disabled={isBusy}
        className="trellis-accent-button mt-6 w-full rounded-field border py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70"
        onClick={() => {
          onSubscribe(plan);
        }}
      >
        {isBusy ? "Opening checkout…" : plan === "byok" ? "Choose BYOK" : "Upgrade to Pro"}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="premium-plans-modal-title"
      onClick={onClose}
    >
      <div
        className="trellis-elevated relative max-h-[min(92vh,880px)] w-full max-w-5xl overflow-y-auto rounded-panel border border-trellis-border shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="border-b border-trellis-border/80 bg-trellis-surface-2/40 px-5 py-5 sm:px-8 sm:py-6">
          <button
            type="button"
            className="absolute right-4 top-4 rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
          <p
            id="premium-plans-modal-title"
            className="font-display text-2xl tracking-tight text-trellis-text sm:text-[1.65rem]"
          >
            Choose your plan
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-trellis-muted">
            Pick the tier that fits how you want Trellis to handle AI costs on this device.
          </p>
        </div>

        <div className="grid gap-4 px-5 py-6 sm:gap-5 sm:px-8 sm:py-8 lg:grid-cols-3">
          <div className="flex min-h-0 flex-col rounded-panel border border-trellis-border bg-trellis-surface-2/80 px-5 pb-5 pt-6">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-trellis-muted" aria-hidden />
                <p className="text-sm font-semibold text-trellis-text">Trial</p>
              </div>
              {subscriptionTier === "trial" && (
                <span className="rounded-full bg-trellis-chip-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-trellis-muted">
                  Current
                </span>
              )}
            </div>
            <p className="mt-4 font-display text-3xl tabular-nums text-trellis-text">$0</p>
            <p className="text-xs text-trellis-muted">per month · core access</p>
            <p className="mt-4 text-xs leading-relaxed text-trellis-muted">
              Core chat, vault, and standard models with baseline limits.
            </p>
            <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-xs leading-snug text-trellis-muted">
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Fast hosted models</span>
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Full vault and notes workflows</span>
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Usage-limited cloud chat</span>
              </li>
            </ul>
            <button
              type="button"
              disabled
              className="mt-6 w-full rounded-field border border-trellis-border py-2.5 text-xs font-medium text-trellis-text disabled:cursor-default disabled:opacity-80"
            >
              {subscriptionTier === "trial" ? "Your plan" : "Available by default"}
            </button>
          </div>

          <div
            className={cn(
              "relative flex min-h-0 flex-col rounded-panel border px-5 pb-5 pt-6 shadow-[inset_0_1px_0_0_rgba(200,169,110,0.1)]",
              subscriptionTier === "byok"
                ? "border-trellis-accent/45 bg-trellis-surface ring-1 ring-trellis-accent/20"
                : "border-trellis-accent/35 bg-trellis-surface-2/90 ring-1 ring-trellis-accent/15"
            )}
          >
            <span
              className="trellis-accent-surface pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-trellis-accent/45 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-trellis-accent shadow-sm"
              aria-hidden
            >
              Discounted
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-trellis-accent" aria-hidden />
                <p className="text-sm font-semibold text-trellis-text">BYOK</p>
              </div>
              {subscriptionTier === "byok" && (
                <span className="rounded-full bg-trellis-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-trellis-accent">
                  Current
                </span>
              )}
            </div>
            <p className="mt-4 font-display text-2xl tracking-tight text-trellis-text">
              Trellis BYOK
            </p>
            <p className="text-xs text-trellis-muted">Lower monthly price · provider billed chat</p>
            <p className="mt-4 text-xs leading-relaxed text-trellis-muted">
              Bring your own OpenAI or Anthropic key for chat while Trellis keeps the vault,
              sessions, and local-first workflow.
            </p>
            <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-xs leading-snug text-trellis-muted">
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Use any supported OpenAI or Anthropic chat model</span>
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Keys stay on your device</span>
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Notes from chats run on-device only</span>
              </li>
            </ul>
            {renderPlanButton("byok")}
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-col rounded-panel border px-5 pb-5 pt-6",
              subscriptionTier === "pro"
                ? "border-trellis-accent/45 bg-trellis-surface ring-1 ring-trellis-accent/20"
                : "border-trellis-border bg-trellis-surface-2/60"
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-trellis-accent" aria-hidden />
                <p className="text-sm font-semibold text-trellis-text">Pro</p>
              </div>
              {subscriptionTier === "pro" && (
                <span className="rounded-full bg-trellis-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-trellis-accent">
                  Current
                </span>
              )}
            </div>
            <p className="mt-4 font-display text-2xl tracking-tight text-trellis-text">
              Trellis Pro
            </p>
            <p className="text-xs text-trellis-muted">Monthly billing · hosted AI included</p>
            <p className="mt-4 text-xs leading-relaxed text-trellis-muted">
              Premium models, hosted inference, and the fullest Trellis workflow with cloud-backed
              convenience.
            </p>
            <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-xs leading-snug text-trellis-muted">
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Premium hosted models and priority access</span>
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Cloud-backed notes from chats and richer defaults</span>
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trellis-accent" aria-hidden />
                <span>Best fit when you want Trellis to handle provider costs</span>
              </li>
            </ul>
            {renderPlanButton("pro")}
          </div>
        </div>

        <div className="border-t border-trellis-border/80 px-5 py-4 sm:px-8">
          <p className="text-center text-[11px] leading-relaxed text-trellis-faint">
            Secure payment via Stripe. BYOK uses your own provider bill for chat; Pro includes
            hosted inference through Trellis.
          </p>
        </div>
      </div>
    </div>
  );
}
