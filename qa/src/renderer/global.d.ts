import type { QaApi } from '../preload/preload';

declare global {
  interface Window {
    qa: QaApi;
  }
}

export {};
