// Simple client-side loader:
// Loads `pages/<module>.html` into the #dynamicPanel.
(() => {
  const panel = document.getElementById('dynamicPanel');
  const buttons = Array.from(document.querySelectorAll('.page-btn'));

  if (!panel || buttons.length === 0) return;

  // #region agent log
  fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'979d53'},body:JSON.stringify({sessionId:'979d53',runId:'pre-fix',hypothesisId:'H_sizes',location:'js/main.js:11',message:'Computed UI sizes + logo info on load',data:(() => { try { const bicol=document.querySelector('.sf-uni-bicol'); const uni=document.querySelector('.sf-uni-university'); const sub=document.querySelector('.sf-uni-sub'); const bu=document.querySelector('.sf-uni-logo--bu'); const buceng=document.querySelector('.sf-uni-logo--buceng'); const badge=document.querySelector('.sf-uni-badge'); const b=document.querySelector('.page-btn'); const bi=document.querySelector('.page-btn i'); const out={}; out.dpr=window.devicePixelRatio||1; if(bicol) out.bicolFont=getComputedStyle(bicol).fontSize; if(uni) out.universityFont=getComputedStyle(uni).fontSize; if(sub) out.deptFont=getComputedStyle(sub).fontSize; if(badge) out.badgeSize={w:getComputedStyle(badge).width,h:getComputedStyle(badge).height}; const logoInfo=(img) => img ? ({src:img.currentSrc||img.getAttribute('src'),natural:{w:img.naturalWidth,h:img.naturalHeight},size:{w:getComputedStyle(img).width,h:getComputedStyle(img).height},blend:getComputedStyle(img).mixBlendMode,filter:getComputedStyle(img).filter,rendering:getComputedStyle(img).imageRendering}) : null; out.buLogo=logoInfo(bu); out.bucengLogo=logoInfo(buceng); if(b){ out.buttonFont=getComputedStyle(b).fontSize; out.buttonPadding=getComputedStyle(b).padding; } if(bi) out.buttonIconFont=getComputedStyle(bi).fontSize; return out; } catch(e){ return {error:String(e)}; } })(),timestamp:Date.now()})}).catch(()=>{});
  // #endregion agent log

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

  function setHash(pageId) {
    const next = `#${pageId}`;
    if (window.location.hash !== next) window.location.hash = next;
  }

  function getPageFromHash() {
    const raw = (window.location.hash || '').replace(/^#/, '').trim();
    return raw || 'overview';
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
      el.addEventListener('click', () => loadPage(target));
      if (el.tagName !== 'BUTTON') {
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            loadPage(target);
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

  async function loadPage(pageId, { pushHash = true } = {}) {
    const safeId = allowedPages.has(pageId) ? pageId : 'overview';
    setActiveButton(safeId);
    if (pushHash) setHash(safeId);

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
          window.SteelForge.initShear(panel);
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
      } catch (_) {
        // ignore init failures to avoid breaking navigation
      }

      // #region agent log
      try {
        if (safeId === 'shear') {
          const link = document.getElementById('sfStyles');
          const comp = panel.querySelector('.sf-comp.sf-comp--shear');
          const mode = comp?.querySelector('.sf-comp__mode.is-active');
          const card = mode?.querySelector('.sf-comp__card');

          const rect = (el) => {
            if (!el?.getBoundingClientRect) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };

          const cs = (el, keys) => {
            if (!el) return null;
            const s = getComputedStyle(el);
            const out = {};
            keys.forEach((k) => (out[k] = s[k]));
            return out;
          };

          fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '095c19' },
            body: JSON.stringify({
              sessionId: '095c19',
              runId: 'pre-fix',
              hypothesisId: 'H_shear_gray_width',
              location: 'steelforge/js/main.js:afterLoadPage(shear)',
              message: 'Measure shear gray card + stylesheet href',
              data: {
                stylesheet: link ? { href: link.getAttribute('href'), resolved: link.href } : null,
                viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
                rects: { panel: rect(panel), comp: rect(comp), mode: rect(mode), card: rect(card) },
                cardStyle: cs(card, ['width', 'maxWidth', 'minWidth', 'height', 'maxHeight', 'minHeight', 'marginLeft', 'marginRight', 'paddingLeft', 'paddingRight', 'boxSizing', 'flex']),
                compStyle: cs(comp, ['paddingLeft', 'paddingRight', 'width', 'maxWidth']),
                panelStyle: cs(panel, ['paddingLeft', 'paddingRight', 'width']),
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
        }
      } catch (_) {}
      // #endregion

      // #region agent log
      if (isDashboard) {
        const hero = panel.querySelector('.dash-hero');
        const titleRow = panel.querySelector('.dash-calculator__titleRow');
        const card = panel.querySelector('.dash-card');
        const imgWrap = panel.querySelector('.dash-card__imgWrap');
        const img = panel.querySelector('.dash-card__img');
        const head = panel.querySelector('.dash-card__head');
        const btn = panel.querySelector('.dash-btn');
        const actions = panel.querySelector('.dash-card__actions');
        const dotsCard = panel.querySelector('.dash-dots--card');
        const landing = panel.querySelector('.dash-landing');
        const grid = panel.querySelector('.dash-grid');

        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };

        const collect = () => (() => {
          try {
            const out = {
              viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
              found: {
                hero: !!hero,
                titleRow: !!titleRow,
                card: !!card,
                imgWrap: !!imgWrap,
                img: !!img,
                head: !!head,
                btn: !!btn,
                actions: !!actions,
                dotsCard: !!dotsCard,
              },
            };
            out.panel = { clientH: panel.clientHeight, scrollH: panel.scrollHeight, className: panel.className };
            out.body = { overflow: getComputedStyle(document.body).overflow };
            if (landing) out.landing = { clientH: landing.clientHeight, scrollH: landing.scrollHeight };
            if (grid) out.grid = { clientH: grid.clientHeight, scrollH: grid.scrollHeight };
            out.rects = {
              panel: rect(panel),
              landing: rect(landing),
              hero: rect(hero),
              titleRow: rect(titleRow),
              grid: rect(grid),
              card: rect(card),
              imgWrap: rect(imgWrap),
              actions: rect(actions),
              dotsCard: rect(dotsCard),
            };
            if (card) {
              const cs = getComputedStyle(card);
              out.card = { background: cs.backgroundColor, radius: cs.borderRadius, shadow: cs.boxShadow, padding: cs.padding, transform: cs.transform };
            }
            if (img) {
              const cs = getComputedStyle(img);
              out.img = { height: cs.height, width: cs.width, margin: cs.margin, objectFit: cs.objectFit };
            }
            if (head) {
              const cs = getComputedStyle(head);
              out.head = { background: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding };
            }
            if (btn) {
              const cs = getComputedStyle(btn);
              out.btn = { background: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding, fontSize: cs.fontSize };
            }
            if (actions) {
              const cs = getComputedStyle(actions);
              out.actions = { gap: cs.gap, display: cs.display, alignItems: cs.alignItems };
            }
            if (hero) {
              const cs = getComputedStyle(hero);
              out.hero = { margin: cs.margin, padding: cs.padding, radius: cs.borderRadius, background: cs.backgroundColor };
            }
            if (imgWrap) {
              const cs = getComputedStyle(imgWrap);
              out.imgWrap = { padding: cs.padding, radius: cs.borderRadius, background: cs.backgroundColor };
            }
            return out;
          } catch (e) {
            return { error: String(e) };
          }
        })();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const data = collect();
            fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'651544'},body:JSON.stringify({sessionId:'651544',runId:'pre-fix',hypothesisId:'H_card_css_applied',location:'js/main.js:~70',message:'Dashboard card computed styles',data,timestamp:Date.now()})}).catch(()=>{});
          });
        });
      }
      // #endregion agent log
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
      if (page) loadPage(page);
    });
  });

  // Back/forward navigation.
  window.addEventListener('hashchange', () => {
    loadPage(getPageFromHash(), { pushHash: false });
  });

  // Initial load.
  loadPage(getPageFromHash(), { pushHash: false });
})();
