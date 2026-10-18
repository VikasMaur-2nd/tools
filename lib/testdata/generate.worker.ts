import { generateFixture } from './generate';
import { PUBLISHED_FIXTURES } from './published';
import type { GeneratorMessage, GeneratorRequest } from './protocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<GeneratorRequest>) => void;
  postMessage: (message: GeneratorMessage, transfer?: Transferable[]) => void;
};
let acknowledge: (() => void) | undefined;
let started = false;
scope.onmessage = async ({ data }) => {
  if (data.type === 'ack') { acknowledge?.(); acknowledge = undefined; return; }
  if (started) return;
  started = true;
  try {
    const summary = await generateFixture(data.options, chunk => new Promise<void>(resolve => {
      acknowledge = resolve;
      scope.postMessage({ type: 'chunk', chunk }, [chunk.buffer]);
    }), progress => scope.postMessage({ type: 'progress', progress }));
    const published = PUBLISHED_FIXTURES.find(f => f.targetBytes === data.options.targetBytes && f.pretty === !!data.options.pretty);
    const match = !published ? 'unpublished' : published.sha256 === summary.sha256 && published.bytes === summary.bytes && published.records === summary.records ? 'matched' : 'mismatch';
    scope.postMessage({ type: 'done', summary, match });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Generation failed.' });
  }
};
