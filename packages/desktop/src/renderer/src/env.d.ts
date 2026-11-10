import type { JagraApi } from "../../shared/api";

declare global {
  interface Window {
    /** The preload API, the renderer's only way to main (SEC-6). */
    readonly jagra: JagraApi;
  }
}
