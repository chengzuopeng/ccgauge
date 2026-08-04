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
      id: page.id,
      path: page.path,
      locale,
      theme,
    })),
  ),
);

// These screenshots are captured against the author's real history, so they
// carry real project names, repo paths, skill names and prompt text. Redaction
// blurs those in the page BEFORE capture rather than editing PNGs afterwards,
// so it survives a re-shoot and can't drift out of sync with the layout.
//
// Selected by ROLE, not by value: the rule is "this field renders user
// content", so it keeps working when the underlying data changes. Anything
// that is a fact about the tool — model names, token counts, costs, dates —
// stays sharp, since blurring those would make the screenshots useless.
const REDACT = {
  // prompt preview (3) and project (5)
  usage: ['table tbody td:nth-child(3)', 'table tbody td:nth-child(5)'],
  // session title (1) and project (2)
  sessions: ['table tbody td:nth-child(1)', 'table tbody td:nth-child(2)'],
  // card title and the cwd line under it
  projects: ['a[href^="/projects/"] .font-semibold .truncate', 'a[href^="/projects/"] div[title]'],
  // tool / skill / MCP-server names
  tools: ['main span.truncate'],
};

// Absolute home paths leak the account name and machine layout on any page —
// most visibly Settings' scanned-directory list. Matched by content because
// they turn up in more places than a selector list would keep up with.
const HOME_PATH = /(^|\s)(\/Users\/|\/home\/|[A-Z]:\\Users\\)/;

async function redact(page, pageId) {
  const applied = await page.evaluate(
    ({ selectors, homePathSource }) => {
      const BLUR = 'blur(4px)';
      const seen = new Set();
      const mark = (el) => {
        if (!el || seen.has(el)) return;
        seen.add(el);
        el.style.filter = BLUR;
        // Keeps the blur from bleeding past the cell it belongs to.
        el.style.borderRadius = '3px';
      };

      for (const sel of selectors) document.querySelectorAll(sel).forEach(mark);

      const homePath = new RegExp(homePathSource);
      document.querySelectorAll('main *').forEach((el) => {
        if (el.children.length) return;
        if (homePath.test(el.textContent || '')) mark(el);
      });

      return seen.size;
    },
    { selectors: REDACT[pageId] ?? [], homePathSource: HOME_PATH.source },
  );
  return applied;
}

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

    // After the wait, so client-rendered rows (usage, overview) are in the DOM.
    const redacted = await redact(page, s.id);
    if (REDACT[s.id] && redacted === 0) {
      throw new Error(
        `${s.name}: redaction matched nothing. A selector in REDACT has gone stale — ` +
          `fix it before shipping, this page renders user content.`,
      );
    }

    const out = `${OUT}/${s.name}`;
    await page.screenshot({ path: out, type: 'png', fullPage: false });
    console.log(`✓ ${s.name}${redacted ? `  (redacted ${redacted})` : ''}`);
    await page.close();
  }

  await browser.close();
  console.log(`\nDone. ${SHOTS.length} screenshots written to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
