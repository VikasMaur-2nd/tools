/** Re-indents big documents off the main thread (see Engine.outputFirst). */
import { formatDoc, reindent } from '../json/format';

import type { Settings } from './store';
import { parse, type ParseResult } from '../json/parser';

export interface AnalysisResult {
  res: ParseResult;
  formatted: string;
  min: string;
  ms: number;
  converted?: { out: string; error: string | null };
}

self.onmessage = async (e: MessageEvent<{ id: number; text: string; indent: string; warm?: number; compare?: boolean; analysis?: { lines: boolean; sort: boolean; minify: boolean; convert?: { target: string; rootName: string; tsStyle: Settings['tsStyle']; csharpLib: Settings['csharpLib'] } } }>) => {
  const { id, text, indent, warm } = e.data;
  if (e.data.analysis || e.data.compare) {
    const { lines = false, sort = false, minify = false } = e.data.analysis ?? {};
    const t0 = performance.now();
    const res = parse(text, { lines });
    const ms = performance.now() - t0;
    if (e.data.compare) {
      const diags = [
        ...res.issues.slice(0, 300).map(({ p }) => ({ p, cls: 'me' })),
        ...(res.error ? [{ p: res.error.p, cls: 'me' }] : []),
        ...res.warnings.slice(0, 300).map(({ p }) => ({ p, cls: 'mw' })),
      ];
      self.postMessage({ id, diags });
      return;
    }
    const formatted = res.root ? formatDoc(text, res, minify ? '' : indent, sort) : '';
    const min = res.root ? minify && !sort ? formatted : formatDoc(text, res, '') : '';
    const analysis: AnalysisResult = { res, formatted, min, ms };
    if (res.root && e.data.analysis?.convert) {
      const opts = e.data.analysis?.convert;
      try {
        const mod = await import('../convert');
        const csv = opts.target === 'csv' || opts.target === 'xlsx' ? await import('../convert/xlsx') : null;
        analysis.converted = { out: csv ? csv.toCsv(csv.records(res.root)) : mod.convert(res.root, opts.target, opts), error: null };
      } catch (error) {
        analysis.converted = { out: '', error: error instanceof Error ? error.message : 'Conversion failed' };
      }
    }
    self.postMessage({ id, analysis });
    return;
  }
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(text, k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  self.postMessage({ id, out: reindent(text, indent) });
};
