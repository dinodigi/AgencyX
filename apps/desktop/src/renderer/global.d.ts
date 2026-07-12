import type { LeadEngineBridge } from "../preload/index.ts";

declare global {
  interface Window {
    leadEngine: LeadEngineBridge;
  }
}

export {};
