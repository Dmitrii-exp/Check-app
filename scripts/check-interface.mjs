// Public visual regression checks; no account or production data is used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright')); }
const root = process.cwd();
const output = process.env.CHECK_UI_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    let name = new URL(req.url, 'http://localhost').pathname;
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) throw Error('Outside root');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/css');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const legal = (await readdir('docs/legal')).filter(name => name.endsWith('.html'));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/');
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('.price-card').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'landing overflow at ' + width);
    assert.equal(await page.locator('.mock').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.equal(await page.locator('.hero').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    assert.ok(await page.locator('.price-card p').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 14);
    for (const button of await page.locator('.price-card .btn').all()) {
      const box = await button.boundingBox();
      assert.ok(box.height >= 44, 'tariff touch target at ' + width);
    }
    const planBoxes = await page.locator('.price-card').evaluateAll(els => els.map(el => ({ x: el.offsetLeft, y: el.offsetTop })));
    if (width <= 560) assert.equal(new Set(planBoxes.map(box => box.x)).size, 1);
    const anchors = await page.locator('a[href^="#"]').evaluateAll(els => els.map(el => el.hash.slice(1)));
    for (const id of anchors) assert.equal(await page.locator('[id="' + id + '"]').count(), 1);
    if (output && [390, 1440].includes(width)) await page.screenshot({ path: path.join(output, 'landing-' + width + '.png'), fullPage: true });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
    for (const name of legal) {
      await page.goto(base + '/docs/legal/' + name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' overflow at ' + width);
      assert.ok(await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16);
      assert.ok(await page.locator('main').isVisible());
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: landing + 7 legal pages at 320/390/768/1440px; no horizontal overflow, six readable plans, touch targets, anchor targets, keyboard focus and reduced motion; no JS errors');
} finally { if (browser) await browser.close(); server.close(); }
