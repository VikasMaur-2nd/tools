// Graph view: frame cost while panning at a few zoom levels (from Fit, then '+' presses of ×1.25).
// Measures each requestAnimationFrame callback's run time inside the page, so a busy machine changes
// how many frames are painted more than how long each one takes.
import { defaults, test } from '../../lib/api.mjs';
import { quantile } from '../../lib/stats.mjs';

defaults({ tags: ['perf'], engines: ['chromium'], timeout: 240_000, width: 1440, height: 900 });

for (const doc of ['bench-1mb', 'bench-5mb']) {
  test(`graph pan on ${doc}`, async (t) => {
    const { page } = t;
    await page.addInitScript(() => {
      const b = (window.__zp = { cb: [], on: false });
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (fn) =>
        raf((ts) => {
          const s = performance.now();
          try {
            return fn(ts);
          } finally {
            if (b.on) b.cb.push(performance.now() - s);
          }
        });
    });
    await t.open('/');
    await t.app.openFile(page, doc);
    await t.app.waitValid(page, { timeout: 120_000 });
    await t.app.view(page, 'graph');
    await page.waitForFunction(() => !!window.__vis('.gv-pct'), null, { timeout: 120_000, polling: 50 });
    const host = page.locator('.gv:visible').first();
    const box = await page.locator('canvas.gv-canvas:visible').first().boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (const presses of [0, 10, 25]) {
      await host.focus();
      await page.keyboard.press('0'); // Fit
      for (let i = 0; i < presses; i++) await page.keyboard.press('+');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => {
        window.__zp.cb = [];
        window.__zp.on = true;
      });
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 120; i++) {
        const f = i / 120;
        await page.mouse.move(cx + Math.sin(f * Math.PI * 4) * 200, cy + (Math.cos(f * Math.PI * 4) - 1) * 150);
      }
      await page.mouse.up();
      const cb = (await page.evaluate(() => ((window.__zp.on = false), window.__zp.cb))).filter((x) => x > 0.05);
      t.check(cb.length > 10, `zoom +${presses}: frames painted while panning`, cb.length);
      t.metric(`zoom +${presses} frame p50 ms`, quantile(cb, 0.5));
      t.metric(`zoom +${presses} frame p95 ms`, quantile(cb, 0.95));
    }
  });
}
