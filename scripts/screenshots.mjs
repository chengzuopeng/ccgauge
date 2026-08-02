#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'docs/screenshots');
const BASE = process.env.CCGAUGE_BASE || 'http://127.0.0.1:3738';

const VIEWPORT = { width: 1440, height: 900 };

const LOCALES = ['en', 'zh'];
const THEMES = ['dark', 'light'];
const PAGES = [
  { id: 'overview', path: '/' },
  { id: 'usage', path: '/usage' },
  { id: 'sessions', path: '/sessions' },
  { id: 'projects', path: '/projects' },
  { id: 'models', path: '/models' },
  { id: 'tools', path: '/tools' },
  { id: 'settings', path: '/settings' },
];

const SHOTS = PAGES.flatMap((page) =>
  LOCALES.flatMap((locale) =>
    THEMES.map((theme) => ({
      name: `${page.id}-${locale}-${theme}.png`,
      path: page.path,
      locale,
      theme,
    })),
  ),
);

async function hideDevChrome(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      next-route-announcer,
      [data-nextjs-dev-overlay],
      [data-nextjs-dialog-overlay],
      [data-nextjs-toast],
      [data-nextjs-dev-tools-button] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `,
  });
  await page.evaluate(() => {
    document.querySelector('nextjs-portal')?.remove();
    document.querySelector('[data-nextjs-dev-overlay]')?.remove();
    document.querySelector('next-route-announcer')?.remove();
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });

  const url = new URL(BASE);

  for (const s of SHOTS) {
    await context.clearCookies();
    await context.addCookies([
      { name: 'ccgauge_locale', value: s.locale, domain: url.hostname, path: '/' },
      { name: 'ccgauge_theme', value: s.theme, domain: url.hostname, path: '/' },
    ]);
    const page = await context.newPage();
    await page.goto(BASE + s.path, { waitUntil: 'networkidle' });
    await hideDevChrome(page);

    await page.evaluate(() => document.activeElement?.blur?.());

    await page.waitForTimeout(800);

    const out = `${OUT}/${s.name}`;
    await page.screenshot({ path: out, type: 'png', fullPage: false });
    console.log(`✓ ${s.name}`);
    await page.close();
  }

  await browser.close();
  console.log(`\nDone. ${SHOTS.length} screenshots written to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
