#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = resolve(here, '..', 'public', 'images');
mkdirSync(imagesDir, { recursive: true });

const BG = '#0A0A0A';
const BG_SURFACE = '#161616';
const BORDER = '#2A2A2C';
const TEXT_DIM = '#787880';
const INDIGO_400 = '#818CF8';
const INDIGO_500 = '#6366F1';
const INDIGO_600 = '#4F46E5';

function frame({ width = 1600, height = 1000, label, decoration }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label} placeholder">
  <defs>
    <radialGradient id="glow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="${INDIGO_400}" stop-opacity="0.18"/>
      <stop offset="60%" stop-color="${INDIGO_400}" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="${INDIGO_400}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_SURFACE}"/>
      <stop offset="100%" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${BG}"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${decoration ?? ''}
  <g transform="translate(${width / 2}, ${height - 60})" text-anchor="middle">
    <text font-family="Geist, Inter, system-ui, sans-serif" font-size="14" letter-spacing="0.06em" fill="${TEXT_DIM}" font-weight="600">
      ${label.toUpperCase()} · PLACEHOLDER
    </text>
  </g>
</svg>`;
}

const placeholders = {

  'hero-dashboard.svg': frame({
    label: 'hero-dashboard',
    decoration: `
      <g transform="translate(450, 240)">
        <rect width="700" height="440" rx="20" fill="url(#cardGrad)" stroke="${BORDER}" stroke-width="1.5"/>
        <g transform="translate(40, 40)">
          <rect width="180" height="80" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>
          <rect x="200" width="180" height="80" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>
          <rect x="400" width="180" height="80" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>
        </g>
        <g transform="translate(40, 160)">
          <rect width="380" height="240" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>
          ${Array.from({ length: 14 }, (_, i) => {
            const h = 30 + ((i * 17) % 170);
            return `<rect x="${20 + i * 25}" y="${220 - h}" width="14" height="${h}" rx="2" fill="${INDIGO_400}" fill-opacity="${0.4 + (i % 5) * 0.12}"/>`;
          }).join('')}
        </g>
        <g transform="translate(440, 160)">
          <rect width="220" height="240" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>
          ${Array.from({ length: 7 }, (_, r) =>
            Array.from({ length: 12 }, (_, c) => {
              const intensity = ((r * 7 + c * 3) % 11) / 11;
              return `<rect x="${20 + c * 16}" y="${20 + r * 28}" width="12" height="22" rx="3" fill="${INDIGO_400}" fill-opacity="${0.08 + intensity * 0.7}"/>`;
            }).join(''),
          ).join('')}
        </g>
      </g>
    `,
  }),

  'feature-cli.svg': frame({
    label: 'feature-cli',
    decoration: `
      <g transform="translate(280, 200)">
        <rect width="1040" height="620" rx="14" fill="url(#cardGrad)" stroke="${BORDER}" stroke-width="1.5"/>
        <rect width="1040" height="42" rx="14" fill="${BG_SURFACE}" stroke="${BORDER}"/>
        <circle cx="22" cy="21" r="6" fill="#F87171" fill-opacity="0.7"/>
        <circle cx="44" cy="21" r="6" fill="#FBBF24" fill-opacity="0.7"/>
        <circle cx="66" cy="21" r="6" fill="#4ADE80" fill-opacity="0.7"/>
        <text x="100" y="26" font-family="Geist Mono, monospace" font-size="13" fill="${TEXT_DIM}">ccgauge report</text>
        <g transform="translate(40, 80)" font-family="Geist Mono, monospace" font-size="16">
          <text fill="${INDIGO_400}" font-weight="700">▸ Tokens</text>
          <g transform="translate(0, 38)">
            <text fill="${TEXT_DIM}">Input</text>
            <text x="120" fill="#FAFAFA">351</text>
            <text x="280" fill="${TEXT_DIM}">Output</text>
            <text x="400" fill="#FAFAFA">91.0K</text>
          </g>
          <g transform="translate(0, 70)">
            <text fill="${TEXT_DIM}">Cache R</text>
            <text x="120" fill="#34D399">36.3M</text>
            <text x="280" fill="${TEXT_DIM}">Cache W</text>
            <text x="400" fill="#FAFAFA">2.64M</text>
          </g>
          <g transform="translate(0, 120)">
            <text fill="${INDIGO_400}" font-weight="700">▸ Trend</text>
          </g>
          ${Array.from({ length: 7 }, (_, i) => {
            const w = 80 + ((i * 90) % 600);
            return `<g transform="translate(0, ${160 + i * 36})">
              <text fill="${TEXT_DIM}" font-size="13">05/${7 + i}</text>
              <text x="80" fill="#FAFAFA" font-size="13">$${(15 + ((i * 9) % 40)).toFixed(2)}</text>
              <rect x="180" y="-10" width="${w}" height="14" rx="2" fill="${INDIGO_400}" fill-opacity="0.85"/>
            </g>`;
          }).join('')}
        </g>
      </g>
    `,
  }),

  'feature-mcp.svg': frame({
    label: 'feature-mcp',
    decoration: `
      <g transform="translate(${1600 / 2}, ${1000 / 2})">
        <line x1="-380" y1="0" x2="0" y2="0" stroke="${INDIGO_400}" stroke-opacity="0.4" stroke-width="2"/>
        <line x1="0" y1="0" x2="380" y2="0" stroke="${INDIGO_400}" stroke-opacity="0.4" stroke-width="2"/>
        <line x1="-380" y1="0" x2="380" y2="0" stroke="${INDIGO_400}" stroke-opacity="0.15" stroke-width="2" stroke-dasharray="4 8"/>
        <circle r="50" fill="${INDIGO_500}" fill-opacity="0.18" stroke="${INDIGO_400}" stroke-width="2"/>
        <circle r="32" fill="${INDIGO_500}"/>
        <circle r="60" fill="none" stroke="${INDIGO_400}" stroke-opacity="0.25" stroke-width="1"/>
        <g transform="translate(-380, 0)">
          <circle r="40" fill="${INDIGO_500}" fill-opacity="0.1" stroke="${INDIGO_400}" stroke-width="1.5"/>
          <circle r="22" fill="${INDIGO_400}" fill-opacity="0.8"/>
        </g>
        <g transform="translate(380, 0)">
          <circle r="40" fill="${INDIGO_500}" fill-opacity="0.1" stroke="${INDIGO_400}" stroke-width="1.5"/>
          <circle r="22" fill="${INDIGO_400}" fill-opacity="0.8"/>
        </g>
      </g>
    `,
  }),

  'feature-dashboard.svg': frame({
    label: 'feature-dashboard',
    decoration: `
      <g transform="translate(250, 220)">
        <rect width="1100" height="560" rx="14" fill="url(#cardGrad)" stroke="${BORDER}" stroke-width="1.5"/>
        <rect width="1100" height="48" fill="${BG_SURFACE}" stroke="${BORDER}"/>
        <text x="32" y="30" font-family="Geist, sans-serif" font-size="13" fill="${TEXT_DIM}" font-weight="600">ccgauge — Overview</text>
        ${Array.from({ length: 4 }, (_, i) =>
          `<rect x="${32 + i * 270}" y="76" width="252" height="100" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>` +
          `<rect x="${48 + i * 270}" y="96" width="40" height="10" rx="2" fill="${TEXT_DIM}" fill-opacity="0.6"/>` +
          `<rect x="${48 + i * 270}" y="120" width="${120 - i * 20}" height="22" rx="3" fill="${INDIGO_400}" fill-opacity="${0.5 + i * 0.1}"/>`,
        ).join('')}
        <rect x="32" y="200" width="1036" height="320" rx="10" fill="${BG_SURFACE}" stroke="${BORDER}"/>
        ${Array.from({ length: 24 }, (_, i) => {
          const h = 30 + ((i * 19) % 260);
          return `<rect x="${56 + i * 42}" y="${500 - h}" width="28" height="${h}" rx="3" fill="${INDIGO_400}" fill-opacity="${0.4 + ((i % 4) * 0.15)}"/>`;
        }).join('')}
      </g>
    `,
  }),

  'feature-privacy.svg': frame({
    label: 'feature-privacy',
    decoration: `
      <g transform="translate(${1600 / 2}, ${1000 / 2})">
        <rect x="-220" y="-90" width="440" height="180" rx="14" fill="${BG_SURFACE}" stroke="${BORDER}" stroke-width="2"/>
        <g transform="translate(-200, -70)">
          ${Array.from({ length: 3 }, (_, r) =>
            Array.from({ length: 10 }, (_, c) =>
              `<rect x="${c * 40}" y="${r * 50}" width="32" height="36" rx="3" fill="${BG}" stroke="${BORDER}"/>`,
            ).join(''),
          ).join('')}
        </g>
        <g transform="translate(0, -40)">
          <path
            d="M0 -120 L 100 -90 L 100 0 Q 100 90 0 130 Q -100 90 -100 0 L -100 -90 Z"
            fill="${INDIGO_500}"
            fill-opacity="0.22"
            stroke="${INDIGO_400}"
            stroke-width="2.5"
          />
          <path d="M -38 5 L -10 35 L 42 -25" stroke="${INDIGO_400}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
    `,
  }),

  'feature-i18n.svg': frame({
    label: 'feature-i18n',
    decoration: `
      <g transform="translate(360, 200)">
        <rect width="880" height="260" rx="12" fill="url(#cardGrad)" stroke="${BORDER}" stroke-width="1.5"/>
        <rect width="880" height="34" rx="12" fill="${BG_SURFACE}" stroke="${BORDER}"/>
        <circle cx="18" cy="17" r="4" fill="${TEXT_DIM}" fill-opacity="0.4"/>
        <circle cx="32" cy="17" r="4" fill="${TEXT_DIM}" fill-opacity="0.4"/>
        <circle cx="46" cy="17" r="4" fill="${TEXT_DIM}" fill-opacity="0.4"/>
        ${Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: 14 }, (_, c) => {
            const w = 30 + ((r * c) % 4) * 16;
            return `<rect x="${40 + c * 56}" y="${70 + r * 36}" width="${w}" height="14" rx="3" fill="${INDIGO_400}" fill-opacity="${0.25 + ((c + r) % 4) * 0.18}"/>`;
          }).join(''),
        ).join('')}
      </g>
      <path d="M 800 460 Q 800 540 ${1600 / 2} 540 Q ${1600 / 2 - 400} 540 ${1600 / 2 - 400} 600" stroke="${INDIGO_400}" stroke-opacity="0.5" stroke-width="2" fill="none" stroke-dasharray="6 6"/>
      <g transform="translate(360, 580)">
        <rect width="880" height="260" rx="12" fill="url(#cardGrad)" stroke="${BORDER}" stroke-width="1.5"/>
        <rect width="880" height="34" rx="12" fill="${BG_SURFACE}" stroke="${BORDER}"/>
        <circle cx="18" cy="17" r="4" fill="${TEXT_DIM}" fill-opacity="0.4"/>
        <circle cx="32" cy="17" r="4" fill="${TEXT_DIM}" fill-opacity="0.4"/>
        <circle cx="46" cy="17" r="4" fill="${TEXT_DIM}" fill-opacity="0.4"/>
        ${Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: 10 }, (_, c) => {
            return `<rect x="${40 + c * 80}" y="${70 + r * 36}" width="64" height="20" rx="3" fill="${INDIGO_500}" fill-opacity="${0.3 + ((c + r) % 3) * 0.2}"/>`;
          }).join(''),
        ).join('')}
      </g>
    `,
  }),

  'og-default.svg': frame({
    width: 1200,
    height: 630,
    label: 'og-default',
    decoration: `
      <g transform="translate(80, 240)">
        <rect width="64" height="64" rx="14" fill="${INDIGO_600}"/>
        <g transform="translate(32, 32)" stroke="white" stroke-width="3" stroke-linecap="round" fill="none">
          <path d="M-12 0 A 12 12 0 1 0 12 0"/>
          <path d="M0 0 V -12"/>
          <path d="M0 0 L 8 -8"/>
        </g>
      </g>
      <text x="170" y="320" font-family="Geist, sans-serif" font-size="96" font-weight="700" fill="#FAFAFA" letter-spacing="-0.02em">ccgauge</text>
      <text x="170" y="372" font-family="Geist, sans-serif" font-size="22" fill="${TEXT_DIM}" letter-spacing="0.02em">
        Local usage dashboard for Claude Code &amp; Codex CLI
      </text>
      <g transform="translate(820, 350)">
        ${Array.from({ length: 6 }, (_, i) => {
          const h = 40 + ((i * 23) % 160);
          return `<rect x="${i * 50}" y="${-h}" width="32" height="${h}" rx="3" fill="${INDIGO_400}" fill-opacity="${0.4 + i * 0.1}"/>`;
        }).join('')}
      </g>
    `,
  }),

  'og-cli.svg': frame({
    width: 1200,
    height: 630,
    label: 'og-cli',
    decoration: `
      <g transform="translate(200, 200)">
        <rect width="800" height="240" rx="14" fill="${BG_SURFACE}" stroke="${BORDER}" stroke-width="2"/>
        <rect width="800" height="34" rx="14" fill="${BG}" stroke="${BORDER}"/>
        <circle cx="20" cy="17" r="5" fill="#F87171" fill-opacity="0.7"/>
        <circle cx="42" cy="17" r="5" fill="#FBBF24" fill-opacity="0.7"/>
        <circle cx="64" cy="17" r="5" fill="#4ADE80" fill-opacity="0.7"/>
        <text x="40" y="120" font-family="Geist Mono, monospace" font-size="36" fill="#FAFAFA">$ ccgauge report</text>
        <rect x="368" y="98" width="14" height="34" fill="${INDIGO_400}"/>
        <g transform="translate(40, 160)">
          ${Array.from({ length: 5 }, (_, i) => {
            const w = 80 + ((i * 90) % 500);
            return `<rect x="0" y="${i * 14}" width="${w}" height="8" rx="2" fill="${INDIGO_400}" fill-opacity="${0.8 - i * 0.1}"/>`;
          }).join('')}
        </g>
      </g>
    `,
  }),
};

for (const [name, content] of Object.entries(placeholders)) {
  const out = resolve(imagesDir, name);
  writeFileSync(out, content, 'utf8');
  console.log(`  ✓ ${name}  (${content.length.toLocaleString()} bytes)`);
}

console.log(`\nDone — ${Object.keys(placeholders).length} placeholders generated under public/images/.`);
