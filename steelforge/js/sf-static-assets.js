/**
 * SteelForge static asset helpers (no bundler — works on python -m http.server and Vercel).
 * Fetched page fragments use ./assets/ or ../assets/; once injected into index.html, relative
 * resolution can point at the wrong folder. This module resolves paths against the directory
 * that contains index.html and optionally rewrites injected HTML / live DOM.
 */
(function (global) {
  /** @returns {URL} Base URL of the app folder (trailing slash), e.g. https://host/ or https://host/steelforge/ */
  function getAppStaticBaseUrl() {
    const u = new URL(global.location.href);
    let p = u.pathname || '/';
    if (p !== '/' && !p.endsWith('/')) {
      const last = p.slice(p.lastIndexOf('/') + 1);
      if (last.includes('.')) {
        p = p.slice(0, p.lastIndexOf('/') + 1) || '/';
      } else {
        p += '/';
      }
    }
    if (p === '') p = '/';
    u.pathname = p;
    u.hash = '';
    u.search = '';
    return u;
  }

  /**
   * @param {string} raw href or path from HTML
   * @returns {string}
   */
  function resolveAssetHref(raw) {
    if (!raw) return raw;
    const t = String(raw).trim();
    if (/^(?:https?:|data:|blob:)/i.test(t) || t.startsWith('//')) return t;
    if (t.startsWith('/assets/')) {
      return new URL(t, global.location.origin).href;
    }
    const base = getAppStaticBaseUrl();
    if (t.startsWith('./assets/')) {
      return new URL(t.replace(/^\.\//, ''), base.href).href;
    }
    if (t.startsWith('../assets/')) {
      const rest = t.slice('../assets/'.length);
      return new URL(`assets/${rest}`, base.href).href;
    }
    return raw;
  }

  /**
   * Rewrite ./assets/ and ../assets/ in fetched HTML to absolute URLs (production-safe).
   * @param {string} html
   * @returns {string}
   */
  function rewriteFragmentHtml(html) {
    if (!html) return html;
    return html
      .replace(/\.\.\/assets\/([^"'>\s]+)/g, (_, rest) => resolveAssetHref(`../assets/${rest}`))
      .replace(/\.\/assets\/([^"'>\s]+)/g, (_, rest) => resolveAssetHref(`./assets/${rest}`));
  }

  /**
   * Fix any remaining relative asset URLs on injected nodes (src / href pointing at assets/).
   * @param {ParentNode} root
   */
  function normalizeInjectedRoot(root) {
    if (!root || !root.querySelectorAll) return;
    const sel = '[src],[href]';
    root.querySelectorAll(sel).forEach((el) => {
      const tag = (el.tagName && el.tagName.toLowerCase()) || '';
      if (tag === 'script' || tag === 'iframe') return;
      if (el.hasAttribute('src')) {
        const src = el.getAttribute('src');
        if (src && (src.startsWith('./') || src.startsWith('../'))) {
          const abs = resolveAssetHref(src);
          if (abs && abs !== src) el.setAttribute('src', abs);
        }
      }
      if (el.hasAttribute('href')) {
        const href = el.getAttribute('href');
        if (
          href &&
          (href.startsWith('./assets/') || href.startsWith('../assets/')) &&
          tag === 'link'
        ) {
          const abs = resolveAssetHref(href);
          if (abs && abs !== href) el.setAttribute('href', abs);
        }
      }
    });
  }

  var PLACEHOLDER_SVG =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100">' +
        '<rect fill="#f1f5f9" width="160" height="100" rx="10" stroke="#94a3b8" stroke-width="1"/>' +
        '<text x="80" y="54" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="11">Unavailable</text>' +
      '</svg>'
    );

  /**
   * One-shot error handler so broken deploys show a neutral tile and a console hint.
   * @param {ParentNode} root
   */
  function attachImageFallbacks(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('img[src]').forEach(function (img) {
      if (img.dataset.sfAssetBound === '1') return;
      img.dataset.sfAssetBound = '1';
      img.addEventListener(
        'error',
        function onImgErr() {
          if (img.dataset.sfAssetFailed === '1') return;
          img.dataset.sfAssetFailed = '1';
          var was = img.getAttribute('src');
          if (global.console && console.warn) {
            console.warn('[SteelForge] Missing image asset:', was);
          }
          if (!img.getAttribute('alt')) img.setAttribute('alt', 'Image unavailable');
          img.removeEventListener('error', onImgErr);
          img.src = PLACEHOLDER_SVG;
        }
      );
    });
  }

  global.SteelForge = global.SteelForge || {};
  global.SteelForge.assets = {
    getAppStaticBaseUrl: getAppStaticBaseUrl,
    resolveAssetHref: resolveAssetHref,
    rewriteFragmentHtml: rewriteFragmentHtml,
    normalizeInjectedRoot: normalizeInjectedRoot,
    attachImageFallbacks: attachImageFallbacks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
