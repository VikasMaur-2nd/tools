/**
 * Validates off the page (see ./client.ts): a big document or a slow pattern never holds up typing. It keeps the
 * last schema compiled and the last document parsed, so a request may leave out the text that didn't change.
 * The official meta-schemas (./meta.ts) are fetched from the app the first time a schema names one.
 */
import { SchemaSession, type ValidateRequest, type ValidateResult } from './index';

export interface WorkerRequest {
  id: number;
  /** null: the same document as the last request's. */
  doc: string | null;
  schema: string | null;
  draft: ValidateRequest['draft'];
  formats: boolean;
  max: number;
  /** The document can't be read as its format (see ValidateRequest). */
  unread?: boolean;
  /** Fetched schemas (see ValidateRequest); null: the same as the last request's. */
  resources: Record<string, string> | null;
}

export type WorkerReply = { id: number; result: ValidateResult } | { id: number; error: true };

const session = new SchemaSession();
let doc = '';
let schema = '';
let resources: Record<string, string> = {};

/** Loading the meta-schemas into the session (false: it failed; the next schema that names one tries again). */
let meta: Promise<boolean> | null = null;
const loadMeta = (): Promise<boolean> =>
  (meta ??= fetch(new URL('./meta/meta-schemas.json', import.meta.url))
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((file: { schemas: Record<string, unknown> }) => {
      session.setMeta(Object.fromEntries(Object.entries(file.schemas).map(([url, s]) => [url, JSON.stringify(s)])));
      return true;
    })
    .catch(() => {
      meta = null;
      return false;
    }));

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const r = e.data;
  if (r.doc !== null) doc = r.doc;
  if (r.schema !== null) schema = r.schema;
  if (r.resources !== null) resources = r.resources;
  const req: ValidateRequest = { doc, schema, draft: r.draft, formats: r.formats, max: r.max, unread: r.unread, resources };
  let reply: WorkerReply;
  try {
    // (Before validating: the document is checked once, with them. Without them, they are reported as not loaded.)
    if (session.wantsMeta(req)) await loadMeta();
    reply = { id: r.id, result: session.run(req) };
  } catch {
    reply = { id: r.id, error: true };
  }
  self.postMessage(reply);
};
