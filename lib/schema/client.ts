/**
 * The page's side of validation: one worker (./schema.worker.ts), the latest request only. A request that comes
 * while a run is short waits for it (the worker keeps what it parsed); one that comes during a long run (a big
 * document, a catastrophic pattern) stops it: the worker is ended and a new one starts. A run past its time limit
 * ends the same way, reported as a timeout instead of hanging.
 */
import type { Resources, ValidateRequest, ValidateResult } from './index';
import type { WorkerReply, WorkerRequest } from './schema.worker';

/** What the client needs of a Worker (tests pass a fake). */
export interface Port {
  postMessage(m: WorkerRequest): void;
  onmessage: ((e: { data: WorkerReply }) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  terminate(): void;
}

export type Outcome = ValidateResult | 'timeout' | 'failed';

export interface ClientOptions {
  create?: () => Port;
  /** A run that has taken this long gives way to a newer request (ms). */
  yieldAfter?: number;
  /** Time limit for a run: a base, plus per million characters of input (ms). */
  limit?: (chars: number) => number;
}

interface Wanted {
  req: ValidateRequest;
  done: (o: Outcome) => void;
}

const defaultLimit = (chars: number) => 5000 + Math.ceil(chars / 1e6) * 2000;
/** No fetched schemas. */
const NONE: Resources = {};

export class SchemaClient {
  private port: Port | null = null;
  private busy: (Wanted & { id: number; since: number; timer: ReturnType<typeof setTimeout> }) | null = null;
  private wanted: Wanted | null = null;
  private sentDoc: string | null = null;
  private sentSchema: string | null = null;
  /** The fetched schemas the worker has (the same object: not sent again). */
  private sentResources: Resources | null = null;
  private seq = 0;
  private create: () => Port;
  private yieldAfter: number;
  private limit: (chars: number) => number;
  /** Workers started (a new one after each stop). */
  starts = 0;

  constructor(opts: ClientOptions = {}) {
    this.create = opts.create ?? (() => new Worker(new URL('./schema.worker.ts', import.meta.url)) as unknown as Port);
    this.yieldAfter = opts.yieldAfter ?? 300;
    this.limit = opts.limit ?? defaultLimit;
  }

  /** Validates; `done` is called for this request unless a newer one replaces it first. */
  validate(req: ValidateRequest, done: (o: Outcome) => void) {
    this.wanted = { req, done };
    if (!this.busy) this.send();
    else if (performance.now() - this.busy.since > this.yieldAfter) {
      this.stop();
      this.send();
    }
  }

  /** Whether a run is going on (or waiting). */
  get pending() {
    return !!this.busy || !!this.wanted;
  }

  destroy() {
    this.wanted = null;
    this.stop();
  }

  private send() {
    const w = this.wanted;
    if (!w) return;
    this.wanted = null;
    let port = this.port;
    if (!port) {
      try {
        port = this.port = this.create();
        this.starts++;
      } catch {
        w.done('failed');
        return;
      }
      port.onmessage = (e) => this.reply(e.data);
      port.onerror = () => this.crash();
    }
    const id = ++this.seq;
    const { doc, schema } = w.req;
    const resources = w.req.resources ?? NONE;
    port.postMessage({ id, doc: doc === this.sentDoc ? null : doc, schema: schema === this.sentSchema ? null : schema, draft: w.req.draft, formats: w.req.formats, max: w.req.max ?? 1000, unread: w.req.unread, resources: resources === this.sentResources ? null : resources });
    this.sentDoc = doc;
    this.sentSchema = schema;
    this.sentResources = resources;
    const timer = setTimeout(() => this.expire(id), this.limit(doc.length + schema.length));
    this.busy = { ...w, id, since: performance.now(), timer };
  }

  private reply(m: WorkerReply) {
    const b = this.busy;
    if (!b || m.id !== b.id) return;
    clearTimeout(b.timer);
    this.busy = null;
    // (A newer request is waiting: this result is already out of date.)
    if (this.wanted) return this.send();
    b.done('result' in m ? m.result : 'failed');
  }

  private expire(id: number) {
    const b = this.busy;
    if (!b || b.id !== id) return;
    this.stop();
    if (this.wanted) this.send();
    else b.done('timeout');
  }

  private crash() {
    const b = this.busy;
    this.stop();
    if (this.wanted) this.send();
    else b?.done('failed');
  }

  private stop() {
    if (this.busy) clearTimeout(this.busy.timer);
    this.busy = null;
    this.port?.terminate();
    this.port = null;
    this.sentDoc = this.sentSchema = null;
    this.sentResources = null;
  }
}
