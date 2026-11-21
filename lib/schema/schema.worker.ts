/**
 * Validates off the page (see ./client.ts): a big document or a slow pattern never holds up typing. It keeps the
 * last schema compiled and the last document parsed, so a request may leave out the text that didn't change.
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
}

export type WorkerReply = { id: number; result: ValidateResult } | { id: number; error: true };

const session = new SchemaSession();
let doc = '';
let schema = '';

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const r = e.data;
  if (r.doc !== null) doc = r.doc;
  if (r.schema !== null) schema = r.schema;
  let reply: WorkerReply;
  try {
    reply = { id: r.id, result: session.run({ doc, schema, draft: r.draft, formats: r.formats, max: r.max, unread: r.unread }) };
  } catch {
    reply = { id: r.id, error: true };
  }
  self.postMessage(reply);
};
