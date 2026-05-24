/**
 * Short UI strings shared across pages (nav, footer, button labels, CTAs).
 *
 * Long-form page copy (hero headlines, feature paragraphs, etc.) lives
 * inline in the individual `.astro` files so the page is readable as a
 * single document. Only put a string here if it's reused in 2+ places.
 */

export const ui = {
  en: {
    'nav.home': 'Home',
    'nav.features': 'Features',
    'nav.cli': 'CLI',
    'nav.mcp': 'MCP',
    'nav.privacy': 'Privacy',
    'nav.github': 'GitHub',
    'nav.npm': 'npm',

    'cta.install': 'Install with npx',
    'cta.viewOnGitHub': 'View on GitHub',
    'cta.readMore': 'Read more',
    'cta.tryNow': 'Try it now',

    'lang.label': 'Language',
    'lang.en': 'English',
    'lang.zh': '中文',

    'theme.label': 'Theme',
    'theme.dark': 'Dark',
    'theme.light': 'Light',
    'theme.system': 'System',

    'common.copy': 'Copy',
    'common.copied': 'Copied!',
    'common.copyFailed': 'Copy failed',
    'common.openInNewTab': 'Open in new tab',

    'footer.tagline': 'Local usage dashboard for Claude Code & Codex CLI.',
    'footer.license': 'MIT licensed.',
    'footer.builtBy': 'Built by',
    'footer.sourceOn': 'Source on GitHub',
  },
  zh: {
    'nav.home': '首页',
    'nav.features': '功能',
    'nav.cli': '命令行',
    'nav.mcp': 'MCP',
    'nav.privacy': '隐私',
    'nav.github': 'GitHub',
    'nav.npm': 'npm',

    'cta.install': '一键安装',
    'cta.viewOnGitHub': '查看源码',
    'cta.readMore': '了解更多',
    'cta.tryNow': '立刻试试',

    'lang.label': '语言',
    'lang.en': 'English',
    'lang.zh': '中文',

    'theme.label': '主题',
    'theme.dark': '深色',
    'theme.light': '浅色',
    'theme.system': '跟随系统',

    'common.copy': '复制',
    'common.copied': '已复制！',
    'common.copyFailed': '复制失败',
    'common.openInNewTab': '新标签页打开',

    'footer.tagline': 'Claude Code 与 Codex CLI 的本地用量看板。',
    'footer.license': '采用 MIT 协议开源。',
    'footer.builtBy': '作者',
    'footer.sourceOn': '源码在 GitHub',
  },
} as const;

export type UIKey = keyof (typeof ui)['en'];
