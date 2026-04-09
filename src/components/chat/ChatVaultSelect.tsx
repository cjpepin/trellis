import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import type { VaultDefinition } from "@electron/ipc/types";
import { cn } from "@/lib/utils";

interface Props {
  vaults: VaultDefinition[];
  activeVaultId: string;
  disabled?: boolean;
  onSelectVault: (vaultId: string) => void;
  onAddVault: () => Promise<void>;
}

export function ChatVaultSelect({
  vaults,
  activeVaultId,
  disabled = false,
  onSelectVault,
  onAddVault
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = vaults.find((vault) => vault.id === activeVaultId) ?? vaults[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div className="relative w-full shrink-0" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        className="flex h-[42px] w-full min-w-0 items-center gap-2 rounded-field border border-trellis-border bg-trellis-surface px-3 text-left text-sm text-trellis-text transition hover:border-trellis-accent/35 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Vault for new conversation"
      >
        <span className="min-w-0 flex-1 truncate">{active?.name ?? "Vault"}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-trellis-muted" aria-hidden />
      </button>
      {open && (
        <div className="trellis-elevated absolute bottom-full right-0 z-40 mb-2 min-w-[min(260px,100%)] max-w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-field border border-trellis-border">
          <ul className="max-h-[240px] overflow-y-auto p-1.5" role="listbox" aria-label="Vaults">
            {vaults.map((vault) => (
              <li key={vault.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={vault.id === activeVaultId}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-field px-3 py-2 text-left text-sm transition",
                    vault.id === activeVaultId
                      ? "trellis-selected-surface"
                      : "hover:bg-trellis-surface"
                  )}
                  onClick={() => {
                    onSelectVault(vault.id);
                    setOpen(false);
                  }}
                >
                  {vault.id === activeVaultId ? (
                    <Check className="h-4 w-4 shrink-0 text-trellis-accent" aria-hidden />
                  ) : (
                    <span className="inline-block w-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{vault.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-trellis-border p-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-field px-3 py-2 text-left text-sm text-trellis-accent transition hover:bg-trellis-surface"
              onClick={() => {
                setOpen(false);
                void onAddVault();
              }}
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden />
              Add vault…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
