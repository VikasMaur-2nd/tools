// Re-reads each tool's accessible names the way the keyboard check does (protocol 5.8, amendment 5): the input's name
// from the element that takes the focus when the input is clicked, and the format control's name, both from
// Playwright's aria snapshot. Used to correct names the keyboard check misread before nameFromSnapshot handled quoted
// snapshots; the output goes to results/corrections.json with its date.
//
//   xvfb-run -a node dev/names.mjs [--tools a,b]
import { parseArgs } from 'node:util';
import { ADAPTERS } from '../adapters/index.mjs';
import { focusInput, formatControl, launch, nameFromSnapshot, newContext, openTool } from '../lib/harness.mjs';

const { values: o } = parseArgs({ options: { tools: { type: 'string' } } });
const tools = (o.tools ? o.tools.split(',') : ADAPTERS.filter((a) => !a.blocked).map((a) => a.id)).map((id) => ADAPTERS.find((a) => a.id === id));
const browser = await launch('chromium');
const out = {};
for (const adapter of tools) {
  const context = await newContext(browser, 'chromium');
  try {
    const { page } = await openTool(context, adapter);
    await focusInput(page, adapter);
    const focused = page.locator('*:focus').first();
    const inputSnap = (await focused.count()) ? await focused.ariaSnapshot({ timeout: 20_000 }) : '';
    const controlSnap = adapter.format ? await (await formatControl(page, adapter)).ariaSnapshot({ timeout: 20_000 }) : null;
    out[adapter.id] = {
      inputName: nameFromSnapshot(inputSnap),
      controlName: adapter.format ? nameFromSnapshot(controlSnap) : 'formats on paste',
      inputSnapshot: inputSnap.split('\n')[0],
      controlSnapshot: controlSnap?.split('\n')[0] ?? null,
    };
  } catch (e) {
    out[adapter.id] = { error: e.message.split('\n')[0] };
  }
  console.error(adapter.id, JSON.stringify(out[adapter.id]));
  await context.close().catch(() => {});
}
await browser.close();
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), names: out }, null, 1));
