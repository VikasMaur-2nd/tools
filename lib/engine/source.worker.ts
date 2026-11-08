/**
 * Converts a big input in another format (YAML, CSV, XML, TOML) to JSON off the page (see Engine.convertBig): on the
 * page, a few megabytes of YAML would hold it for seconds after each pause in typing.
 */
import { importToJson, type CsvOptions, type ImportFormat } from '../convert/import';

export interface SourceRequest {
  seq: number;
  text: string;
  format: ImportFormat;
  csv: CsvOptions;
}

/** Its JSON (compact), or where and why it doesn't convert. */
export type SourceReply = { seq: number; json: string } | { seq: number; error: string; p: number };

self.onmessage = (e: MessageEvent<SourceRequest>) => {
  const { seq, text, format, csv } = e.data;
  let reply: SourceReply;
  try {
    const r = importToJson(text, format, '', csv);
    reply = 'json' in r ? { seq, json: r.json } : { seq, error: r.error, p: Math.max(0, Math.min(text.length, r.p ?? 0)) };
  } catch {
    reply = { seq, error: 'Conversion failed', p: 0 };
  }
  self.postMessage(reply);
};
