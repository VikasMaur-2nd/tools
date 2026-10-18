import type { FixtureOptions, FixtureProgress, FixtureSummary } from './generate';
export type GeneratorRequest = { type: 'start'; options: FixtureOptions } | { type: 'ack' };
export type GeneratorMessage =
  | { type: 'progress'; progress: FixtureProgress }
  | { type: 'chunk'; chunk: Uint8Array<ArrayBuffer> }
  | { type: 'done'; summary: FixtureSummary; match: 'matched' | 'mismatch' | 'unpublished' }
  | { type: 'error'; message: string };
