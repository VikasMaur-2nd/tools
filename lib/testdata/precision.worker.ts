import { checkPrecision } from './precision';
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ original: string; output: string }>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ result: checkPrecision(data.original, data.output) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : 'Could not compare these documents.' }); }
};
