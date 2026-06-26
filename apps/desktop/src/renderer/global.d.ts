import type { PassDeckApi } from '@passdeck/shared';

declare global {
  interface Window {
    passdeck: PassDeckApi;
  }
}

export {};
