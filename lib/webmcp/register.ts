/**
 * Registers the WebMCP tools (./tools.ts) with the browser and runs them against the live
 * engine. Loaded only where the browser has WebMCP (./index.ts).
 */
import { reportError, track, withVia } from '../analytics';
import type { Engine } from '../engine/engine';
import { getEngine } from '../engine/instance';
import { TOOLS, type AgentTool, type Page } from './tools';

/** The browser's WebMCP object: `document.modelContext`, or `navigator.modelContext` in Chrome's first origin-trial builds. */
export interface ModelContext {
  registerTool(tool: object, options?: { signal?: AbortSignal }): unknown;
  /** Only in the first builds, which unregistered tools by name instead of by signal. */
  unregisterTool?(name: string): unknown;
}

const engine = (): Engine => {
  const e = getEngine();
  if (!e) throw new Error('The JSON tool is not on the page');
  return e;
};

/** Runs a page action for the agent: its analytics events say `via: agent`. */
const agent = (fn: (e: Engine) => void) => withVia('agent', () => fn(engine()));

const page: Page = {
  doc: () => engine().agentDoc(),
  indent: () => engine().indent,
  open: (text, name) =>
    agent((e) => {
      e.load(text, name);
      e.toast(`Opened a document from your AI agent · ${e.mod}Z to undo`, 'ok');
    }),
  show: (view) => agent((e) => e.setView(view)),
  format: ({ style, sortKeys, indent }) =>
    agent((e) => {
      if (indent) e.setIndent(indent);
      e.setFormat({ minify: style === 'minified', escape: style === 'escaped', sortKeys });
    }),
  convert: ({ target, rootName, tsStyle, csharpLib }) =>
    agent((e) => e.setConvert({ target, ...(rootName && { rootName }), ...(tsStyle && { tsStyle }), ...(csharpLib && { csharpLib }) })),
  repair: () => agent((e) => e.repair()),
  imported: (json, from) =>
    agent((e) => {
      e.replaceText(json, `Converted ${from.toUpperCase()} to JSON`);
      track('feature_used', { feature: from === 'yaml' ? 'import_yaml' : from === 'xml' ? 'import_xml' : from === 'toml' ? 'import_toml' : 'import_csv' });
    }),
  compare: (modified) =>
    agent((e) => {
      e.loadCompare(modified, null);
      e.setView('compare');
    }),
};

/** Runs a tool for the agent. Its answer is text, failures included: the agent never sees why a call rejected. */
async function call(tool: AgentTool, input: unknown): Promise<string> {
  let ok = false;
  try {
    let args = input;
    // (Chrome's first builds passed the arguments as JSON text.)
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    const r = await tool.run(args && typeof args === 'object' ? (args as Record<string, unknown>) : {}, page);
    ok = r.ok;
    return r.text;
  } catch (error) {
    reportError(error, 'webmcp');
    return 'Error: this tool failed unexpectedly. The user can do the same in the page.';
  } finally {
    track('agent_tool_used', { tool: tool.name, ok });
  }
}

/** Registers every tool until `signal` aborts (the JSON tool left the page). */
export function register(mc: ModelContext, signal: AbortSignal) {
  if (signal.aborted) return;
  for (const t of TOOLS) {
    const { name, title, description, inputSchema, annotations } = t;
    try {
      const r = mc.registerTool({ name, title, description, inputSchema, annotations, execute: (input: unknown) => call(t, input) }, { signal });
      // Refused (the page may not register tools, or another frame has the name): the agent does without it.
      Promise.resolve(r).catch(() => {});
    } catch {}
  }
  const unregister = mc.unregisterTool;
  if (unregister) {
    signal.addEventListener('abort', () => {
      for (const t of TOOLS) {
        try {
          unregister.call(mc, t.name);
        } catch {}
      }
    }, { once: true });
  }
}
