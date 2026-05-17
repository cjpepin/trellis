/** Progress events while downloading the on-device GGUF into app data. */
export type ExtractionInstallProgressEvent =
  | { kind: "status"; status: string }
  | { kind: "layer"; digest?: string; completed?: number; total?: number }
  | { kind: "complete" }
  | { kind: "aborted" };
