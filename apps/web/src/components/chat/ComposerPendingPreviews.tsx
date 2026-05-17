import { useEffect, useState } from "react";
import { FileText, Link2, LoaderCircle, X } from "lucide-react";
import type { PendingChatAttachment, PendingImageAttachment } from "@/lib/chatAttachments";
import { readChatMediaDataUrl } from "@/lib/chat/readChatMediaDataUrl";
import { cn } from "@/lib/utils";

function fileExtensionHint(label: string): string | null {
  const trimmed = label.trim();

  if (!trimmed.includes(".")) {
    return null;
  }

  const ext = trimmed.split(".").pop();

  if (!ext || ext.length === 0) {
    return null;
  }

  return ext.slice(0, 5).toUpperCase();
}

function PendingFileTile({
  attachment,
  onRemove
}: {
  attachment: PendingChatAttachment;
  onRemove: () => void;
}) {
  const isUrl = attachment.kind === "url";
  const ext = !isUrl ? fileExtensionHint(attachment.label) : null;

  return (
    <div className="relative flex w-[4.75rem] flex-col items-center gap-1.5">
      <div
        className={cn(
          "flex h-[4.75rem] w-[4.75rem] flex-col items-center justify-center rounded-field border border-trellis-border bg-trellis-surface-2",
          isUrl && "border-trellis-accent/25"
        )}
      >
        {isUrl ? (
          <Link2 className="h-7 w-7 text-trellis-accent" aria-hidden />
        ) : (
          <>
            <FileText className="h-7 w-7 text-trellis-muted" aria-hidden />
            {ext ? (
              <span className="mt-1 max-w-full truncate px-1 text-[9px] font-medium uppercase tracking-wide text-trellis-faint">
                {ext}
              </span>
            ) : null}
          </>
        )}
      </div>
      <p
        className="w-full max-w-[4.75rem] break-words text-center text-[10px] leading-tight text-trellis-text"
        title={attachment.label}
      >
        {attachment.label}
      </p>
      <button
        type="button"
        className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-trellis-border bg-trellis-surface text-trellis-muted shadow-sm transition hover:border-trellis-accent/35 hover:text-trellis-text"
        aria-label={`Remove ${attachment.label}`}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function PendingImageTile({
  image,
  onRemove
}: {
  image: PendingImageAttachment;
  onRemove: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const url = await readChatMediaDataUrl(image.fileId);

      if (!cancelled && url) {
        setSrc(url);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [image.fileId]);

  return (
    <div className="relative flex w-[4.75rem] flex-col items-center gap-1.5">
      <div className="relative h-[4.75rem] w-[4.75rem] overflow-hidden rounded-field border border-trellis-border bg-trellis-surface-2">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-trellis-muted"
            aria-busy
            aria-label="Loading image preview"
          >
            <LoaderCircle className="h-6 w-6 animate-spin text-trellis-accent" aria-hidden />
          </div>
        )}
      </div>
      <p
        className="w-full max-w-[4.75rem] break-words text-center text-[10px] leading-tight text-trellis-text"
        title={image.label}
      >
        {image.label}
      </p>
      <button
        type="button"
        className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-trellis-border bg-trellis-surface text-trellis-muted shadow-sm transition hover:border-trellis-accent/35 hover:text-trellis-text"
        aria-label={`Remove ${image.label}`}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

interface Props {
  pendingAttachments: PendingChatAttachment[];
  pendingImages: PendingImageAttachment[];
  onRemoveAttachment: (clientId: string) => void;
  onRemoveImage: (clientId: string) => void;
}

export function ComposerPendingPreviews({
  pendingAttachments,
  pendingImages,
  onRemoveAttachment,
  onRemoveImage
}: Props) {
  if (pendingAttachments.length === 0 && pendingImages.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap items-start gap-3">
      {pendingAttachments.map((attachment) => (
        <PendingFileTile
          key={attachment.clientId}
          attachment={attachment}
          onRemove={() => {
            onRemoveAttachment(attachment.clientId);
          }}
        />
      ))}
      {pendingImages.map((image) => (
        <PendingImageTile
          key={image.clientId}
          image={image}
          onRemove={() => {
            onRemoveImage(image.clientId);
          }}
        />
      ))}
    </div>
  );
}
