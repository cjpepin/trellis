import { useRef, useState } from "react";
import { FileUp, Globe, LoaderCircle } from "lucide-react";
import type { AppSettings, WorkspaceInfo } from "@electron/ipc/types";
import { extractIngestedSource, type IngestProgress } from "@/lib/api";
import { buildExtractionIndex } from "@/lib/extractionIndex";
import { useApplyExtraction } from "@/hooks/useApplyExtraction";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

interface Props {
  settings: AppSettings;
  workspace: WorkspaceInfo;
}

export function Ingest({ settings, workspace }: Props) {
  const [url, setUrl] = useState("");
  const [progress, setProgress] = useState<IngestProgress[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const graph = useWikiStore((state) => state.graph);
  const pushToast = useUiStore((state) => state.pushToast);
  const applyExtraction = useApplyExtraction();
  const extractionIndex = buildExtractionIndex(graph);

  async function runIngest(draft: {
    title: string;
    content: string;
    sourcePath: string;
    sourceType: "pdf" | "web" | "text";
  }): Promise<void> {
    setProgress([
      {
        step: "reading",
        message: "Reading source locally…"
      }
    ]);
    setIsWorking(true);

    try {
      const relatedNotes = await window.trellis.retrieval.searchNotes({
        query: draft.content,
        limit: 6
      });
      const response = await extractIngestedSource({
        accessToken,
        index: extractionIndex,
        transcript: [],
        relatedNotes,
        mode: settings.extraction.mode,
        preferredLocalModelId: settings.extraction.preferredLocalModelId,
        sourceType: draft.sourceType,
        sourceTitle: draft.title,
        sourcePath: draft.sourcePath,
        sourceContent: draft.content,
        onProgress: (event) => {
          setProgress((current) => [...current, event]);
        }
      });

      await applyExtraction(response);
      setProgress((current) => [
        ...current,
        {
          step: "done",
          message: "Done."
        }
      ]);
    } catch (error) {
      setProgress((current) => [
        ...current,
        {
          step: "error",
          message:
            error instanceof Error ? error.message : "Trellis couldn’t process that source."
        }
      ]);
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePdfFile(file: File): Promise<void> {
    try {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Please choose a PDF file.");
      }

      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const draft = await window.trellis.ingest.parsePdf({
        fileName: file.name,
        bytes
      });
      await runIngest(draft);
    } catch (error) {
      setProgress([
        {
          step: "error",
          message: error instanceof Error ? error.message : "Could not import that PDF."
        }
      ]);
    }
  }

  async function handleUrlSubmit(): Promise<void> {
    if (!url.trim()) {
      return;
    }

    try {
      const draft = await window.trellis.ingest.clipUrl({
        url: url.trim()
      });
      await runIngest(draft);
    } catch (error) {
      setProgress([
        {
          step: "error",
          message: error instanceof Error ? error.message : "Could not clip that URL."
        }
      ]);
    }
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] gap-6 p-6">
      <section className="flex min-h-0 flex-col gap-6">
        <div className="trellis-panel px-6 py-6">
          <p className="font-display text-3xl text-trellis-text">Ingest Sources</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-trellis-muted">
            Drag in a PDF or clip a URL. Trellis reads it locally first, then folds the
            useful concepts back into your wiki.
          </p>
        </div>

        {workspace.localOnly && (
          <div className="trellis-accent-surface rounded-panel border border-trellis-accent/20 px-5 py-4 text-sm text-trellis-text">
            Preview workspace keeps ingest local. If your on-device note processor is not ready,
            install the model in Settings or switch to your personal workspace for cloud-backed
            ingest.
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-6">
          <div
            className={`trellis-panel flex flex-col justify-between px-6 py-6 ${
              isDraggingPdf ? "trellis-selected-surface border-trellis-accent/40" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingPdf(true);
            }}
            onDragLeave={() => setIsDraggingPdf(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingPdf(false);
              const file = event.dataTransfer.files?.[0];

              if (file) {
                void handlePdfFile(file);
              }
            }}
          >
            <div>
              <div className="flex items-center gap-3">
                <FileUp className="h-5 w-5 text-trellis-accent" />
                <p className="text-lg text-trellis-text">PDF import</p>
              </div>
              <p className="mt-3 text-sm leading-7 text-trellis-muted">
                Drop a paper, report, or book chapter. The original file is copied into
                your vault’s `raw/` directory.
              </p>
            </div>
            <button
              type="button"
              className="trellis-accent-button mt-8 rounded-field border border-trellis-accent/25 px-4 py-3 text-sm text-trellis-accent transition hover:border-trellis-accent/45"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose PDF
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file) {
                  void handlePdfFile(file);
                }
              }}
            />
          </div>

          <div className="trellis-panel flex flex-col justify-between px-6 py-6">
            <div>
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-trellis-accent" />
                <p className="text-lg text-trellis-text">Web clip</p>
              </div>
              <p className="mt-3 text-sm leading-7 text-trellis-muted">
                Paste an article URL. Trellis fetches and distills the readable text before
                turning it into notes.
              </p>
            </div>
            <div className="mt-8 flex gap-3">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="trellis-input"
                placeholder="https://example.com/article"
              />
              <button
                type="button"
                className="trellis-accent-button rounded-field border border-trellis-accent/25 px-4 py-3 text-sm text-trellis-accent transition hover:border-trellis-accent/45"
                onClick={() => {
                  void handleUrlSubmit();
                }}
              >
                Clip
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="trellis-panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-trellis-border px-5 py-4">
          <p className="font-display text-2xl text-trellis-text">Progress</p>
        </div>
        <div className="trellis-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {isWorking && progress.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-trellis-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Preparing import…
            </div>
          ) : progress.length > 0 ? (
            <div className="space-y-3">
              {progress.map((item, index) => (
                <div
                  key={`${item.step}-${index}`}
                  className="rounded-field border border-trellis-border bg-trellis-surface-2 px-4 py-3 text-sm text-trellis-text"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">
                    {item.step}
                  </p>
                  <p className="mt-2 leading-6">{item.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-7 text-trellis-muted">
              Reading the source, shaping concepts, updating notes, and final confirmation all
              show up here as the source moves through the pipeline.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
