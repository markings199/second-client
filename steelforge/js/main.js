// Simple client-side loader:
// Loads `pages/<module>.html` into the #dynamicPanel.
// Hash routes: `#overview`, `#bending`, `#bending/design`, etc.
(() => {
  const panel = document.getElementById('dynamicPanel');
  const buttons = Array.from(document.querySelectorAll('.page-btn'));

  if (!panel || buttons.length === 0) return;

  const allowedPages = new Set(
    buttons
      .map((b) => b.getAttribute('data-page'))
      .filter(Boolean)
  );

  function setActiveButton(activeId) {
    buttons.forEach((btn) => {
      const page = btn.getAttribute('data-page');
      btn.classList.toggle('active', page === activeId);
    });
  }

  /** @returns {{ page: string, mode: 'design' | null }} */
  function parseHash() {
    const raw = (window.location.hash || '').replace(/^#/, '').trim();
    if (!raw) return { page: 'overview', mode: null };
    const slash = raw.indexOf('/');
    if (slash === -1) {
      const page = allowedPages.has(raw) ? raw : 'overview';
      return { page, mode: null };
    }
    const pageId = raw.slice(0, slash).trim();
    const rest = raw.slice(slash + 1).trim().toLowerCase();
    const page = allowedPages.has(pageId) ? pageId : 'overview';
    const mode = rest === 'design' ? 'design' : null;
    return { page, mode };
  }

  function setHash(pageId, mode) {
    let next;
    if (!pageId || pageId === 'overview') next = '#overview';
    else if (mode === 'design') next = `#${pageId}/design`;
    else next = `#${pageId}`;
    if (window.location.hash !== next) window.location.hash = next;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function initOverviewNavigation(root) {
    if (!root) return;
    const actions = Array.from(root.querySelectorAll('[data-overview-page]'));
    if (actions.length === 0) return;
    const allowed = new Set(Array.from(allowedPages));
    actions.forEach((el) => {
      const target = el.getAttribute('data-overview-page');
      if (!target || !allowed.has(target)) return;
      el.style.cursor = 'pointer';
      const modeAttr = (el.getAttribute('data-overview-mode') || 'analysis').toLowerCase();
      const mode = modeAttr === 'design' ? 'design' : null;
      const go = () => loadPage(target, { pushHash: true, mode });
      el.addEventListener('click', go);
      if (el.tagName !== 'BUTTON') {
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            go();
          }
        });
      }
    });
  }

  async function animatePanelOut() {
    // If CSS isn't loaded yet, or user prefers reduced motion, keep it instant.
    if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    panel.classList.remove('sf-panel--enter');
    panel.classList.add('sf-panel--exit');

    // Wait for transition (CSS uses ~220ms). Timeout guards against missed events.
    await Promise.race([
      new Promise((resolve) => {
        const onEnd = (e) => {
          if (e && e.target !== panel) return;
          panel.removeEventListener('transitionend', onEnd);
          resolve();
        };
        panel.addEventListener('transitionend', onEnd);
      }),
      sleep(260),
    ]);
  }

  function animatePanelIn() {
    if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    panel.classList.remove('sf-panel--exit');
    panel.classList.add('sf-panel--enter');
    requestAnimationFrame(() => {
      // next frame -> settle to normal state
      requestAnimationFrame(() => {
        panel.classList.remove('sf-panel--enter');
      });
    });
  }

  const MODE_PAGES = new Set(['bending', 'compression', 'tension', 'shear', 'tension-rod']);

  function applyRouteMode(safeId, modeWant) {
    if (!MODE_PAGES.has(safeId) || !window.SteelForge?.activateModuleMode) return;
    window.SteelForge.activateModuleMode(panel, modeWant);
  }

  async function loadPage(pageId, { pushHash = true, mode: modeOption } = {}) {
    const safeId = allowedPages.has(pageId) ? pageId : 'overview';
    const resolvedMode = modeOption === 'design' ? 'design' : 'analysis';

    setActiveButton(safeId);
    if (pushHash) setHash(safeId, modeOption === 'design' ? 'design' : null);

    const url = `./pages/${encodeURIComponent(safeId)}.html`;

    try {
      await animatePanelOut();
      panel.setAttribute('aria-busy', 'true');
      panel.innerHTML = `
        <div class="placeholder-content">
          <div class="section-header">Loading…</div>
          <div class="desc-text">Opening <strong>${safeId}</strong> module.</div>
        </div>
      `;

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
      const html = await res.text();

      // Expect each page file to contain a fragment (no <html>/<head>/<body>).
      panel.innerHTML = html;
      panel.classList.remove('comp-design-active');
      const isDashboard = safeId === 'dashboard';
      panel.classList.toggle('dash-no-scroll', isDashboard);
      panel.classList.toggle('dash-panel', isDashboard);
      document.body.classList.toggle('dash-fullscreen', isDashboard);
      // Apply the "Bending-style" panel chrome to all pages.
      // Compression keeps its existing calculator-fit rules; other pages use a scrollable shell.
      const isCompression = safeId === 'compression';
      panel.classList.toggle('comp-panel', true);
      panel.classList.toggle('comp-shell', !isCompression);
      panel.classList.toggle('sheet-panel', false);

      // Initialize calculators that need JS binding after HTML injection.
      try {
        if (safeId === 'compression' && window.SteelForge?.initCompression) {
          window.SteelForge.initCompression(panel);
        }
        if (safeId === 'bending' && window.SteelForge?.initBending) {
          window.SteelForge.initBending(panel);
        }
        if (safeId === 'tension' && window.SteelForge?.initTension) {
          window.SteelForge.initTension(panel);
        }
        if (safeId === 'shear' && window.SteelForge?.initShear) {
          window.SteelForge.initShear(panel, { initialMode: resolvedMode });
        }
        if (safeId === 'steel-grade' && window.SteelForge?.initSteelGrade) {
          window.SteelForge.initSteelGrade(panel);
        }
        if (safeId === 'section-props' && window.SteelForge?.initSectionProps) {
          window.SteelForge.initSectionProps(panel);
        }
        if (safeId === 'tension-rod' && window.SteelForge?.initTensionRod) {
          window.SteelForge.initTensionRod(panel);
        }
        if (safeId === 'overview') {
          initOverviewNavigation(panel);
        }
        if (safeId !== 'shear') {
          applyRouteMode(safeId, resolvedMode);
        }
      } catch (_) {
        // ignore init failures to avoid breaking navigation
      }
    } catch (err) {
      panel.innerHTML = `
        <div class="placeholder-content">
          <div class="section-header">Module not found</div>
          <div class="desc-text">
            Couldn’t load <strong>${safeId}</strong>.
            Make sure <code>pages/${safeId}.html</code> exists.
          </div>
          <div class="calc-card" style="max-width: 900px;">
            <div class="sub-meta">${String(err)}</div>
          </div>
        </div>
      `;
    } finally {
      panel.removeAttribute('aria-busy');
      animatePanelIn();
    }
  }

  // Button click => load corresponding page file.
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-page');
      if (page) loadPage(page, { pushHash: true, mode: null });
    });
  });

  // Back/forward navigation.
  window.addEventListener('hashchange', () => {
    const { page, mode } = parseHash();
    loadPage(page, { pushHash: false, mode });
  });

  // Initial load.
  const { page: startPage, mode: startMode } = parseHash();
  loadPage(startPage, { pushHash: false, mode: startMode });
})();
