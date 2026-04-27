// Runtime asset-path rewriter.
// Inline HTML strings (src/pages/raw/*.html.js) and external public scripts
// (public/*.js) hard-code paths like /assets/foo.png. When Vite is configured
// with a non-root base (e.g. /daemu-website/ for GitHub Pages), those absolute
// paths break. We rewrite at injection time.

const RAW_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export function fixAssetPaths(text) {
  if (!RAW_BASE || !text) return text;
  // Match: "/assets/foo", '/assets/foo', =/assets/foo, (/assets/foo
  // i.e. /assets/ preceded by ", ', =, ( and not already prefixed
  return text.replace(/(["'=(])\/assets\//g, `$1${RAW_BASE}/assets/`);
}

export function asset(path) {
  return RAW_BASE + (path.startsWith('/') ? path : '/' + path);
}
