/**
 * Converts a big input in another format (YAML, CSV, XML, TOML) to JSON off the page (see Engine.convertBig): on the
 * page, a few megabytes of YAML would hold it for seconds after each pause in typing. It also finds where values of
 * what a big input converts to are in it (Engine.locateSource, for the Schema view's errors).
 */
import { importToJson, locateImport, type CsvOptions, type ImportFormat, type Place } from '../convert/import';

export interface SourceRequest {
  seq: number;
  text: string;
  format: ImportFormat;
  csv: CsvOptions;
  /** Not converting: where these JSON Pointers' values (with `keys[i]`, property names) are (see locateImport). */
  locate?: { pointers: string[]; keys: boolean[] };
}

/** Its JSON (compact), or where and why it doesn't convert; or the places asked for (null: it doesn't convert). */
export type SourceReply = { seq: number; json: string } | { seq: number; error: string; p: number } | { seq: number; places: Place[] | null };

self.onmessage = (e: MessageEvent<SourceRequest>) => {
  const { seq, text, format, csv, locate } = e.data;
  let reply: SourceReply;
  if (locate) {
    try {
      reply = { seq, places: locateImport(text, format, csv, locate.pointers, locate.keys) };
    } catch {
      reply = { seq, places: null };
    }
    return self.postMessage(reply);
  }
  try {
    const r = importToJson(text, format, '', csv);
    reply = 'json' in r ? { seq, json: r.json } : { seq, error: r.error, p: Math.max(0, Math.min(text.length, r.p ?? 0)) };
  } catch {
    reply = { seq, error: 'Conversion failed', p: 0 };
  }
  self.postMessage(reply);
};
