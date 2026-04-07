import type { TrellisBridge } from "@electron/ipc/types";

declare global {
  interface Window {
    trellis: TrellisBridge;
  }
}

export {};

