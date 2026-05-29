import {
  USAGE_OVERVIEW_HIDDEN_KEY,
  USAGE_OVERVIEW_DATA_ATTR,
  USAGE_OVERVIEW_HIDDEN_VALUE,
} from '@/lib/storage-keys';

export function NoFlashScript() {
  const overviewKey = JSON.stringify(USAGE_OVERVIEW_HIDDEN_KEY);
  const overviewAttr = JSON.stringify(USAGE_OVERVIEW_DATA_ATTR);
  const overviewHiddenValue = JSON.stringify(USAGE_OVERVIEW_HIDDEN_VALUE);
  const code = `
(function(){
  try {
    var t = null;
    try { t = localStorage.getItem('ccgauge.theme'); } catch (_) {}
    if (!t) {
      var m = document.cookie.match(/(?:^|; )ccgauge_theme=([^;]+)/);
      if (m) t = decodeURIComponent(m[1]);
    }
    if (t !== 'light' && t !== 'dark' && t !== 'system') t = 'dark';
    var resolved = t;
    if (t === 'system') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    var root = document.documentElement;
    root.classList.remove('theme-light','theme-dark');
    root.classList.add(resolved === 'light' ? 'theme-light' : 'theme-dark');
    root.setAttribute('data-theme', resolved);
  } catch (e) {}
  try {
    var hidden = null;
    try { hidden = localStorage.getItem(${overviewKey}); } catch (_) {}
    if (hidden === '1') document.documentElement.setAttribute(${overviewAttr}, ${overviewHiddenValue});
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
