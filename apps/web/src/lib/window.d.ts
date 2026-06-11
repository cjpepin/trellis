import type { TrellisBridge } from "@trellis/contracts";

declare global {
  interface Window {
    trellis: TrellisBridge;
  }
}

export {};

