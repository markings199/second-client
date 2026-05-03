(() => {
  const E_MPA = 200000; // steel elastic modulus in MPa
  const PHI_C = 0.9; // AISC compression resistance factor
  const OMEGA_C = 1.67; // AISC ASD safety factor (compression)

  function $(root, sel) {
    return root.querySelector(sel);
  }

  function parseNum(v) {
    const n = Number(String(v ?? '').trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function fmtK(kN, digits = 1) {
    if (!Number.isFinite(kN)) return '—';
    return `${kN.toFixed(digits)} kN`;
  }

  function fmtKL(valM, digits = 2) {
    if (!Number.isFinite(valM)) return '—';
    return `${valM.toFixed(digits)} m`;
  }

  function nonNeg(n) {
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function maxOrNull(values) {
    const nums = values.map((v) => nonNeg(v)).filter((v) => v != null);
    if (nums.length === 0) return null;
    return Math.max(...nums);
  }

  // AISC-style column curve (metric units).
  // Inputs:
  // - Fy in MPa
  // - KL_over_r (dimensionless)
  // Returns Fcr in MPa
  function aiscFcr(Fy, KL_over_r) {
    if (!Number.isFinite(Fy) || !Number.isFinite(KL_over_r) || KL_over_r <= 0) return null;

    const Fe = (Math.PI ** 2 * E_MPA) / (KL_over_r ** 2);
    const limit = 4.71 * Math.sqrt(E_MPA / Fy);
    if (KL_over_r <= limit) {
      return (0.658 ** (Fy / Fe)) * Fy;
    }
    return 0.877 * Fe;
  }

  // Convert MPa * mm^2 to kN
  function mpaMm2ToKN(mpa, areaMm2) {
    // MPa = N/mm^2
    // N = MPa * mm^2
    // kN = N / 1000
    return (mpa * areaMm2) / 1000;
  }

  function pickSafeShapes({ series, Fy, Lx_m, Ly_m, Pu_kN, Pa_kN }) {
    const shapes = window.SteelForgeDB?.bySeries(series) ?? [];
    if (shapes.length === 0) return { lrfdSafe: [], asdSafe: [], lrfdPick: null, asdPick: null };

    const Lx_mm = Lx_m * 1000;
    const Ly_mm = Ly_m * 1000;

    const evalShape = (s) => {
      const KLr_x = Lx_mm / s.rx_mm;
      const KLr_y = Ly_mm / s.ry_mm;
      const KLr = Math.max(KLr_x, KLr_y);
      const Fcr = aiscFcr(Fy, KLr);
      if (Fcr == null) return null;
      const Pn_kN = mpaMm2ToKN(Fcr, s.area_mm2);
      const phiPn_kN = PHI_C * Pn_kN;
      const Pallow_kN = Pn_kN / OMEGA_C;
      return { ...s, KLr_x, KLr_y, KLr, Fcr, Pn_kN, phiPn_kN, Pallow_kN };
    };

    const evaluated = shapes.map(evalShape).filter(Boolean);
    // Prefer smaller area (lighter) among the safe ones.
    const byArea = (a, b) => a.area_mm2 - b.area_mm2;

    const lrfdSafe = evaluated
      .filter((s) => Number.isFinite(Pu_kN) && s.phiPn_kN >= Pu_kN)
      .sort(byArea);

    const asdSafe = evaluated
      .filter((s) => Number.isFinite(Pa_kN) && s.Pallow_kN >= Pa_kN)
      .sort(byArea);

    return {
      lrfdSafe,
      asdSafe,
      lrfdPick: lrfdSafe[0] ?? null,
      asdPick: asdSafe[0] ?? null,
    };
  }

  function renderSafeList(list, max = 4) {
    if (!list || list.length === 0) return '—';
    return list
      .slice(0, max)
      .map((s) => s.name)
      .join(', ');
  }

  function attachSolve(root) {
    const form = $(root, '#sfCompForm');
    const solveBtn = $(root, '#sfCompSolve');
    if (!solveBtn) return;

    const get = (id) => {
      const el = $(root, `#${id}`);
      return el ? parseNum(el.value) : null;
    };

    const getTextEl = (id) => $(root, `#${id}`);

    const setText = (id, text) => {
      const el = getTextEl(id);
      if (el) el.textContent = text;
    };

    function computeAndRender() {
      const DL = nonNeg(get('sfCompDL'));
      const LL = nonNeg(get('sfCompLL'));
      const L = nonNeg(get('sfCompL'));
      const x = [get('sfCompX1'), get('sfCompX2'), get('sfCompX3'), get('sfCompX4'), get('sfCompX5')];
      const y = [get('sfCompY1'), get('sfCompY2'), get('sfCompY3'), get('sfCompY4'), get('sfCompY5')];
      const Fy = nonNeg(parseNum($(root, '#sfCompSteel')?.value));
      const series = 'W';

      // Defaults:
      // - If x_i / y_i are provided, use their maximum as the governing unbraced length in that axis.
      // - Otherwise fall back to Length input.
      const govX = maxOrNull(x);
      const govY = maxOrNull(y);
      const Lx = govX ?? L ?? null;
      const Ly = govY ?? L ?? null;

      // Loads:
      // Pu (LRFD): 1.2D + 1.6L
      // Pa (ASD/service): D + L
      const Pu = DL != null && LL != null ? 1.2 * DL + 1.6 * LL : null;
      const Pa = DL != null && LL != null ? DL + LL : null;

      setText('sfCompPu', fmtK(Pu, 1));
      setText('sfCompPa', fmtK(Pa, 1));
      setText('sfCompKLx', fmtKL(Lx, 2));
      setText('sfCompKLy', fmtKL(Ly, 2));

      if (Fy == null || Lx == null || Ly == null || Pu == null || Pa == null) {
        setText('sfCompSafeLRFD', '—');
        setText('sfCompUseLRFD', '—');
        setText('sfCompSafeASD', '—');
        setText('sfCompUseASD', '—');
        return;
      }

      const { lrfdSafe, asdSafe, lrfdPick, asdPick } = pickSafeShapes({
        series,
        Fy,
        Lx_m: Lx,
        Ly_m: Ly,
        Pu_kN: Pu,
        Pa_kN: Pa,
      });

      setText('sfCompSafeLRFD', renderSafeList(lrfdSafe));
      setText('sfCompUseLRFD', lrfdPick ? lrfdPick.name : 'No safe section');
      setText('sfCompSafeASD', renderSafeList(asdSafe));
      setText('sfCompUseASD', asdPick ? asdPick.name : 'No safe section');
    }

    solveBtn.addEventListener('click', computeAndRender);

    // Nice UX: compute on Enter in any input.
    const inputs = root.querySelectorAll('.sf-comp__input, .sf-comp__select');
    inputs.forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') computeAndRender();
      });
    });

    // Pre-fill a reasonable demo case so the page "works" immediately.
    const dlEl = $(root, '#sfCompDL');
    const llEl = $(root, '#sfCompLL');
    const lEl = $(root, '#sfCompL');
    if (dlEl && !dlEl.value) dlEl.value = '400';
    if (llEl && !llEl.value) llEl.value = '250';
    if (lEl && !lEl.value) lEl.value = '3.0';
  }

  function attachAnalysis(root) {
    const solveBtn = $(root, '#sfAnaSolve');
    if (!solveBtn) return;

    const shapes = window.SteelForgeDB?.bySeries('W') ?? [];
    const sel = $(root, '#sfAnaShape');
    if (sel && sel.options.length <= 1) {
      shapes.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        sel.appendChild(opt);
      });
    }

    const get = (id) => {
      const el = $(root, `#${id}`);
      return el ? parseNum(el.value) : null;
    };

    const setText = (id, text) => {
      const el = $(root, `#${id}`);
      if (el) el.textContent = text;
    };

    const chooseShape = (Fy, Lx_m, Ly_m) => {
      const v = sel?.value || 'auto';
      if (v !== 'auto') return shapes.find((s) => s.name === v) ?? null;
      // auto: lightest shape (smallest area) for now
      return [...shapes].sort((a, b) => a.area_mm2 - b.area_mm2)[0] ?? null;
    };

    function compute() {
      const L = nonNeg(get('sfAnaL'));
      const x = [get('sfAnaX1'), get('sfAnaX2'), get('sfAnaX3'), get('sfAnaX4'), get('sfAnaX5')];
      const y = [get('sfAnaY1'), get('sfAnaY2'), get('sfAnaY3'), get('sfAnaY4'), get('sfAnaY5')];
      const Fy = nonNeg(parseNum($(root, '#sfAnaSteel')?.value));
      const govX = maxOrNull(x);
      const govY = maxOrNull(y);
      const Lx = govX ?? L ?? null;
      const Ly = govY ?? L ?? null;

      if (Fy == null || Lx == null || Ly == null) {
        [
          'sfAnaLrfdYield','sfAnaLrfdFracture','sfAnaLrfdGov','sfAnaLrfdUlt',
          'sfAnaAsdYield','sfAnaAsdFracture','sfAnaAsdGov','sfAnaAsdAllow',
        ].forEach((id) => setText(id, '—'));
        return;
      }

      const shape = chooseShape(Fy, Lx, Ly);
      if (!shape) return;

      // Compression capacity checks (AISC-style, metric):
      // - Yielding: φ * Fy * Ag
      // - Buckling: φc * Fcr * Ag (AISC column curve)
      const phiY = 0.9;
      const Py = mpaMm2ToKN(Fy, shape.area_mm2);
      const phiPy = phiY * Py;

      const Lx_mm = Lx * 1000;
      const Ly_mm = Ly * 1000;
      const KLr = Math.max(Lx_mm / shape.rx_mm, Ly_mm / shape.ry_mm);
      const Fcr = aiscFcr(Fy, KLr) ?? 0;
      const Pn = mpaMm2ToKN(Fcr, shape.area_mm2);
      const phiPn = PHI_C * Pn;

      const gov = Math.min(phiPy, phiPn);
      const asdYield = Py / OMEGA_C;
      const asdBuckling = Pn / OMEGA_C;
      const asdAllow = Math.min(asdYield, asdBuckling);

      setText('sfAnaLrfdYield', fmtK(phiPy, 1));
      setText('sfAnaLrfdFracture', fmtK(phiPn, 1)); // "Buckling" row
      setText('sfAnaLrfdGov', fmtK(gov, 1));
      setText('sfAnaLrfdUlt', fmtK(gov, 1));

      setText('sfAnaAsdYield', fmtK(asdYield, 1));
      setText('sfAnaAsdFracture', fmtK(asdBuckling, 1)); // "Buckling" row
      setText('sfAnaAsdGov', fmtK(asdAllow, 1));
      setText('sfAnaAsdAllow', fmtK(asdAllow, 1));
    }

    solveBtn.addEventListener('click', compute);

    const lEl = $(root, '#sfAnaL');
    if (lEl && !lEl.value) lEl.value = '3.0';
  }

  function attachCompressionAnalysisPanel(root) {
    const pane = root.querySelector('.sf-comp--compression .sf-comp__mode[data-comp-mode-pane="analysis"]');
    const shapeSel = pane?.querySelector('#sfCompAnaShape');
    if (!pane || !shapeSel) return;

    const input = (id) => pane.querySelector(`#${id}`);
    const shapes = window.SteelForgeDB?.bySeries('W') ?? [];

    if (shapeSel.options.length === 0 && shapes.length > 0) {
      shapes.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name.replace(/x/gi, '×');
        shapeSel.appendChild(opt);
      });
    }

    const steelEl = input('sfCompAnaSteel');
    populateStructuralSteelGradeSelect(steelEl, 'a1043_36');

    const fmtNum = (v, digits = 2) => {
      if (!Number.isFinite(v)) return '';
      return String(Number(v.toFixed(digits)));
    };
    const mm2toIn2 = (mm2) => mm2 / 645.16;
    const mmToIn = (mm) => mm / 25.4;

    const applyShape = () => {
      const name = shapeSel.value;
      const s = shapes.find((x) => x.name === name);
      if (!s) return;
      const agEl = input('sfCompAnaAg');
      const rxEl = input('sfCompAnaRx');
      const ryEl = input('sfCompAnaRy');
      if (agEl) agEl.value = fmtNum(mm2toIn2(s.area_mm2), 2);
      if (rxEl) rxEl.value = fmtNum(mmToIn(s.rx_mm), 2);
      if (ryEl) ryEl.value = fmtNum(mmToIn(s.ry_mm), 2);
    };

    const applySteelGrade = () => {
      const fyEl = input('sfCompAnaFy');
      const fuEl = input('sfCompAnaFu');
      if (!steelEl || steelEl.value === 'custom') return;
      const g = steelPropsFromStructuralGradeSelect(steelEl.value);
      if (g && fyEl) fyEl.value = String(g.fy);
      if (g && fuEl) fuEl.value = String(g.fu);
    };

    const eEl = input('sfCompAnaE');
    if (eEl && String(eEl.value).trim() === '') eEl.value = '29000';

    shapeSel.addEventListener('change', applyShape);
    steelEl?.addEventListener('change', applySteelGrade);

    applySteelGrade();
    if (shapeSel.value) applyShape();
    else if (shapes.length) {
      shapeSel.selectedIndex = 0;
      applyShape();
    }
  }

  function attachCompressionDesignPanel(root) {
    const pane = root.querySelector('.sf-comp--compression .sf-comp__mode[data-comp-mode-pane="design"]');
    if (!pane) {
      // #region agent log
      fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6de84a' },
        body: JSON.stringify({
          sessionId: '6de84a',
          runId: 'design-mount',
          hypothesisId: 'H_PANE',
          location: 'calculator.js:attachCompressionDesignPanel',
          message: 'compression design pane not found',
          data: {},
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return;
    }

    const input = (id) => pane.querySelector(`#${id}`);

    const SF_COMP_DES_CONN_K = {
      'fixed-pinned': 0.8,
      'pinned-pinned': 1,
      'fixed-fixed': 0.65,
      'free-pinned': 2,
      'fixed-free': 1.2,
    };

    const fmtKlLocal = (v) => {
      if (!Number.isFinite(v)) return '';
      if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
      return v.toFixed(2);
    };

    const applyConnKFromSelect = (sel) => {
      const kv = SF_COMP_DES_CONN_K[sel.value];
      if (kv === undefined) return;
      const kid = sel.id.replace('Sel', 'K');
      const kEl = input(kid);
      if (kEl) kEl.value = String(kv);
    };

    const syncSlenderLFromParams = () => {
      for (let i = 1; i <= 5; i++) {
        const xi = input(`sfCompDesX${i}`);
        const lx = input(`sfCompDesSlLX${i}`);
        if (xi && lx) lx.value = xi.value;
        const yi = input(`sfCompDesY${i}`);
        const ly = input(`sfCompDesSlLY${i}`);
        if (yi && ly) ly.value = yi.value;
      }
    };

    const syncLightestFromSafeTop = () => {
      const sec = input('sfCompDesSafeSec1');
      const lt = input('sfCompDesLightest');
      if (sec && lt) {
        const t = String(sec.value ?? '').trim();
        if (t && !/^NO SECTION$/i.test(t)) lt.value = t.toUpperCase();
      }
    };

    const updateGoverningKLFromSlender = () => {
      let maxX = NaN;
      let maxY = NaN;
      for (let i = 1; i <= 5; i++) {
        const Lx = parseNum(input(`sfCompDesSlLX${i}`)?.value);
        const Ly = parseNum(input(`sfCompDesSlLY${i}`)?.value);
        const klx = parseNum(input(`sfCompDesSlKLX${i}`)?.value);
        const kly = parseNum(input(`sfCompDesSlKLY${i}`)?.value);
        if (klx !== null && Lx !== null && Lx > 0) {
          maxX = Number.isFinite(maxX) ? Math.max(maxX, klx) : klx;
        }
        if (kly !== null && Ly !== null && Ly > 0) {
          maxY = Number.isFinite(maxY) ? Math.max(maxY, kly) : kly;
        }
      }
      const klxEl = input('sfCompDesGovKLx');
      const klyEl = input('sfCompDesGovKLy');
      const govEl = input('sfCompDesGovKLyAsm');
      if (klxEl) klxEl.value = Number.isFinite(maxX) ? fmtKlLocal(maxX) : '';
      if (klyEl) klyEl.value = Number.isFinite(maxY) ? fmtKlLocal(maxY) : '';
      let gov = NaN;
      if (Number.isFinite(maxX) && Number.isFinite(maxY)) gov = Math.min(maxX, maxY);
      else if (Number.isFinite(maxY)) gov = maxY;
      else if (Number.isFinite(maxX)) gov = maxX;
      if (govEl) govEl.value = Number.isFinite(gov) ? fmtKlLocal(gov) : '';
      syncLightestFromSafeTop();
    };

    const updateSlenderKL = () => {
      syncSlenderLFromParams();
      for (const ax of ['X', 'Y']) {
        for (let i = 1; i <= 5; i++) {
          const kEl = input(`sfCompDesSlK${ax}${i}`);
          const lEl = input(`sfCompDesSlL${ax}${i}`);
          const klEl = input(`sfCompDesSlKL${ax}${i}`);
          const k = parseNum(kEl?.value);
          const L = parseNum(lEl?.value);
          const kl = k !== null && L !== null ? k * L : NaN;
          if (klEl) klEl.value = Number.isFinite(kl) ? fmtKlLocal(kl) : '';
        }
      }
      updateGoverningKLFromSlender();
    };

    /** Match reference DEMAND LOAD: whole kips as integers; decimals only when needed */
    const fmtDemand = (v) => {
      if (!Number.isFinite(v)) return '—';
      if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
      return v.toFixed(2);
    };

    const setReadonlyNum = (id, v) => {
      const el = input(id);
      if (!el) return;
      el.value = fmtDemand(v);
    };

    const parseLoad = (id) => {
      const v = parseNum(input(id)?.value);
      return v != null ? v : NaN;
    };

    const updateDemand = () => {
      const methodEl = input('sfCompDesMethod');
      const isLRFD = methodEl?.value !== 'asd';
      const dl = parseLoad('sfCompDesDl');
      const ll = parseLoad('sfCompDesLl');
      const okDl = Number.isFinite(dl);
      const okLl = Number.isFinite(ll);

      const u12 = okDl && okLl ? 1.2 * dl + 1.6 * ll : NaN;
      const u14 = okDl ? 1.4 * dl : NaN;
      const svc = okDl && okLl ? dl + ll : NaN;

      pane.classList.toggle('sf-compDes--lrfd', isLRFD);
      pane.classList.toggle('sf-compDes--asd', !isLRFD);

      if (isLRFD) {
        setReadonlyNum('sfCompDesComb12', u12);
        setReadonlyNum('sfCompDesComb14', u14);
        setReadonlyNum('sfCompDesCombSvc', NaN);
        const pu = Number.isFinite(u12) && Number.isFinite(u14) ? Math.max(u12, u14) : NaN;
        setReadonlyNum('sfCompDesPu', pu);
        setReadonlyNum('sfCompDesPa', NaN);
      } else {
        setReadonlyNum('sfCompDesComb12', NaN);
        setReadonlyNum('sfCompDesComb14', NaN);
        setReadonlyNum('sfCompDesCombSvc', svc);
        setReadonlyNum('sfCompDesPu', NaN);
        setReadonlyNum('sfCompDesPa', svc);
      }

      updateSlenderKL();
    };

    const steelEl = input('sfCompDesSteel');
    const fyEl = input('sfCompDesFy');
    const fuEl = input('sfCompDesFu');
    populateStructuralSteelGradeSelect(steelEl, 'a992');

    const syncSteel = () => {
      if (!steelEl || steelEl.value === 'custom') {
        if (fuEl) fuEl.readOnly = false;
        return;
      }
      const g = steelPropsFromStructuralGradeSelect(steelEl.value);
      if (g && fyEl) fyEl.value = String(g.fy);
      if (g && fuEl) {
        fuEl.value = String(g.fu);
        fuEl.readOnly = true;
      }
    };

    pane.querySelectorAll('input:not([readonly]), select').forEach((el) => {
      el.addEventListener('input', updateDemand);
      el.addEventListener('change', () => {
        if (el.classList.contains('sf-compDes__tableSelect')) applyConnKFromSelect(el);
        syncSteel();
        updateDemand();
      });
    });

    syncSteel();
    updateDemand();

    // #region agent log
    fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6de84a' },
      body: JSON.stringify({
        sessionId: '6de84a',
        runId: 'design-mount',
        hypothesisId: 'H_DOM',
        location: 'calculator.js:attachCompressionDesignPanel',
        message: 'compression design UI mounted',
        data: {
          hasParamsCard: !!pane.querySelector('.sf-compDes__card--params'),
          hasDemandCard: !!pane.querySelector('.sf-compDes__demandCard'),
          hasDesignGridShell: (() => {
            const b = pane.querySelector('.sf-comp__grayShell-body--design');
            return !!(b && window.getComputedStyle(b).display === 'grid');
          })(),
          hasVizCol: !!pane.querySelector('.sf-compDes__vizCol'),
          hasSlenderRailViz: !!pane.querySelector('.sf-compDes__slenderRail--vizCol'),
          hasSlenderRail: !!pane.querySelector('.sf-compDes__slenderRail'),
          hasSlenderTitleTab: !!pane.querySelector('.sf-compDes__slenderTitle'),
          slenderRows: pane.querySelectorAll('.sf-compDes__slenderTable tbody tr').length,
          govKLx: input('sfCompDesGovKLx')?.value ?? null,
          method: input('sfCompDesMethod')?.value ?? null,
          midColLayout: (() => {
            const body = pane.querySelector('.sf-comp__grayShell-body--design');
            const slender = pane.querySelector('.sf-compDes__midCard--slender');
            const safe = pane.querySelector('.sf-compDes__midCard--safe');
            const tbl = pane.querySelector('.sf-compDes__slenderTable');
            if (!slender || !safe) return null;
            const scSl = window.getComputedStyle(slender);
            const rowGap = 10;
            return {
              clientH: slender.clientHeight + rowGap + safe.clientHeight,
              scrollH: body?.scrollHeight ?? null,
              safeScrollH: pane.querySelector('.sf-compDes__midScroll--safe')?.scrollHeight ?? null,
              slenderCardBg: window.getComputedStyle(slender).backgroundColor,
              slenderFit: {
                scrollHeight: slender.scrollHeight,
                clientHeight: slender.clientHeight,
                clippedLikely: slender.scrollHeight > slender.clientHeight + 1,
                flexShrink: scSl.flexShrink,
                minHeight: scSl.minHeight,
                overflowY: scSl.overflowY,
                tableOffsetH: tbl?.offsetHeight ?? null,
              },
            };
          })(),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    const __methodRow = pane.querySelector(
      '.sf-compDes__card--params > .sf-compAna__headRow:first-child',
    );
    const __methodLab = __methodRow?.querySelector('.sf-compAna__pillLabel');
    const __methodWrap = pane.querySelector(
      '.sf-compDes__card--params .sf-compAna__selectWrap--method',
    );
    const __methodSel = __methodWrap?.querySelector('.sf-compAna__select');
    if (__methodRow && __methodLab && __methodWrap && __methodSel) {
      const rR = __methodRow.getBoundingClientRect();
      const rL = __methodLab.getBoundingClientRect();
      const rW = __methodWrap.getBoundingClientRect();
      const rS = __methodSel.getBoundingClientRect();
      const cG = window.getComputedStyle(__methodRow);
      const cW = window.getComputedStyle(__methodWrap);
      const cS = window.getComputedStyle(__methodSel);
      fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6de84a' },
        body: JSON.stringify({
          sessionId: '6de84a',
          runId: 'post-fix',
          hypothesisId: 'H_GRID',
          location: 'calculator.js:attachCompressionDesignPanel',
          message: 'DESIGN METHOD column hug + LRFD pill (grid cols / heights)',
          data: {
            rowGridTemplateColumns: cG.gridTemplateColumns,
            labelRect: { w: Math.round(rL.width), h: Math.round(rL.height), x: Math.round(rL.x) },
            wrapRect: { w: Math.round(rW.width), h: Math.round(rW.height), x: Math.round(rW.x) },
            rowRect: { w: Math.round(rR.width), h: Math.round(rR.height) },
            selRect: { w: Math.round(rS.width), h: Math.round(rS.height) },
            wrapComputed: { width: cW.width, maxWidth: cW.maxWidth, justifySelf: cW.justifySelf },
            selComputed: { width: cS.width, fontSize: cS.fontSize, height: cS.height },
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
  }

  function attachModeToggle(root, { topic = 'COMPRESSION' } = {}) {
    const nav = root.querySelector('.sf-comp__modeNav');
    if (!nav) return;

    const buttons = Array.from(root.querySelectorAll('.sf-comp__modeBtn'));
    const panes = Array.from(root.querySelectorAll('.sf-comp__mode'));
    const indicator = root.querySelector('.sf-comp__indicator span');

    // #region agent log
    const __sf2Log = (hypothesisId, message, data, runId = 'pre-fix') => {
      fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f85dc2' },
        body: JSON.stringify({
          sessionId: 'f85dc2',
          runId,
          hypothesisId,
          location: 'steelforge/js/calculator.js:attachModeToggle',
          message,
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    };
    // #endregion

    // #region agent log
    const __sfLog = (hypothesisId, message, data) => {
      fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'e9cea5' },
        body: JSON.stringify({
          sessionId: 'e9cea5',
          runId: 'pre-fix',
          hypothesisId,
          location: 'steelforge/js/calculator.js:attachModeToggle',
          message,
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    };
    // #endregion

    const __rect = (el) => {
      if (!el?.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };

    // #region agent log
    const __cs = (el, keys) => {
      if (!el) return null;
      const s = window.getComputedStyle(el);
      const out = {};
      keys.forEach((k) => (out[k] = s[k]));
      return out;
    };
    // #endregion

    const __measureLayout = (mode) => {
      const pane = root.querySelector(`.sf-comp__mode[data-comp-mode-pane="${mode}"]`);
      const card = pane?.querySelector('.sf-comp__card');
      const cols = pane?.querySelector('.sf-comp__cols');
      const leftWrap = pane?.querySelector('.sf-comp__left');
      const params = pane?.querySelector('.sf-comp__panel[aria-label="Parameters"]');
      const results = pane?.querySelector('.sf-comp__panel[aria-label="Results"]');
      const paramsForm = params?.querySelector('.sf-comp__form');
      const resultsBody = results?.querySelector('.sf-comp__results');
      const anyRbar = resultsBody?.querySelector('.sf-comp__rbar');
      const anyBigBox = resultsBody?.querySelector('.sf-comp__bigBox');
      const contentPanel = root.closest('.content-panel');
      const solveSlot = pane?.querySelector('.sf-comp__solveSlot');
      const solve = solveSlot?.querySelector('.sf-comp__solve') || pane?.querySelector('.sf-comp__footer .sf-comp__solve');
      const dots = pane?.querySelector('.sf-comp__dots');
      const topline = root.querySelector('.sf-comp__topline');

      const csSolve = solve ? window.getComputedStyle(solve) : null;
      const csCard = card ? window.getComputedStyle(card) : null;
      const csSlot = solveSlot ? window.getComputedStyle(solveSlot) : null;

      // #region agent log
      // H_SOLVE_POS: SOLVE should be inside card (like reference)
      __sf2Log(
        'H_SOLVE_POS',
        'solve-position-vs-card',
        {
          topic,
          mode,
          viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
          rects: {
            pane: __rect(pane),
            contentPanel: __rect(contentPanel),
            card: __rect(card),
            cols: __rect(cols),
            leftWrap: __rect(leftWrap),
            params: __rect(params),
            results: __rect(results),
            solveSlot: __rect(solveSlot),
            solve: __rect(solve),
            dots: __rect(dots),
            topline: __rect(topline),
          },
          overflow: {
            paramsForm: paramsForm
              ? { clientH: paramsForm.clientHeight, scrollH: paramsForm.scrollHeight }
              : null,
            resultsBody: resultsBody
              ? { clientH: resultsBody.clientHeight, scrollH: resultsBody.scrollHeight }
              : null,
          },
          fields: {
            rbar: anyRbar
              ? { rect: __rect(anyRbar), style: __cs(anyRbar, ['minWidth', 'width', 'maxWidth', 'height', 'paddingLeft', 'paddingRight']) }
              : null,
            bigBox: anyBigBox
              ? { rect: __rect(anyBigBox), style: __cs(anyBigBox, ['minWidth', 'width', 'maxWidth', 'height']) }
              : null,
          },
          styles: {
            pane: __cs(pane, ['display', 'flexDirection', 'overflow', 'paddingBottom']),
            card: __cs(card, ['display', 'flexDirection', 'overflow', 'paddingBottom', 'paddingTop', 'paddingLeft', 'paddingRight']),
            cols: __cs(cols, ['display', 'gridTemplateRows', 'gridTemplateColumns', 'alignItems', 'alignContent', 'rowGap', 'gap']),
            leftWrap: __cs(leftWrap, ['display', 'flexDirection', 'alignItems', 'width']),
            solveSlot: __cs(solveSlot, ['display', 'gridRow', 'gridColumn', 'alignItems', 'justifyContent', 'paddingTop', 'paddingBottom', 'marginTop', 'marginBottom']),
            solve: __cs(solve, ['height', 'width', 'marginTop', 'marginBottom']),
          },
        },
        'pre-fix'
      );
      // #endregion

      __sfLog('H1', 'layout-measure', {
        mode,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        rects: {
          topline: __rect(topline),
          pane: __rect(pane),
          card: __rect(card),
          cols: __rect(cols),
          params: __rect(params),
          results: __rect(results),
          solveSlot: __rect(solveSlot),
          solve: __rect(solve),
          dots: __rect(dots),
        },
        solveStyle: csSolve
          ? { fontSize: csSolve.fontSize, padding: csSolve.padding, height: csSolve.height, width: csSolve.width }
          : null,
        cardStyle: csCard
          ? { padding: csCard.padding, display: csCard.display, flexDirection: csCard.flexDirection, overflow: csCard.overflow }
          : null,
        solveSlotStyle: csSlot
          ? { display: csSlot.display, justifyContent: csSlot.justifyContent, padding: csSlot.padding, alignItems: csSlot.alignItems }
          : null,
      });
    };

    const setMode = (mode) => {
      buttons.forEach((b) => {
        const on = b.getAttribute('data-comp-mode') === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach((p) => p.classList.toggle('is-active', p.getAttribute('data-comp-mode-pane') === mode));
      const dynPanel = document.getElementById('dynamicPanel');
      if (dynPanel && topic === 'COMPRESSION') {
        dynPanel.classList.toggle('comp-design-active', mode === 'design');
      }
      if (indicator) {
        indicator.innerHTML = mode === 'analysis'
          ? `ANALYSIS <span class="sf-comp__indicatorAccent">${topic}</span>`
          : `DESIGN <span class="sf-comp__indicatorAccent">${topic}</span>`;
      }

      // #region agent log
      requestAnimationFrame(() => {
        __measureLayout(mode);
        if (topic === 'COMPRESSION' && mode === 'design') {
          requestAnimationFrame(() => {
            const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="design"]');
            const slenderCard = pane?.querySelector('.sf-compDes__midCard--slender');
            const safeEl = pane?.querySelector('.sf-compDes__midScroll--safe');
            const slenderEl = pane?.querySelector('.sf-compDes__midScroll--slender');
            const beamTray = pane?.querySelector('.sf-compDes__beamPhotoTray');
            const beamImgs = beamTray ? [...beamTray.querySelectorAll('img.sf-compDes__beamPhoto')] : [];
            const slenderRail = pane?.querySelector('.sf-compDes__slenderRail');
            const safeCard = pane?.querySelector('.sf-compDes__midCard--safe');
            const demandCard = pane?.querySelector('.sf-compDes__demandCard');
            const paramsAside = pane?.querySelector('.sf-compDes__card--params');
            const demandGrid = pane?.querySelector('.sf-compDes__demandGrid');
            const lightestCard = pane?.querySelector('.sf-compDes__lightestCard');
            const shell = pane?.querySelector('.sf-comp__grayShell');
            const shellBody = pane?.querySelector('.sf-comp__grayShell-body--design');
            const ep = pane?.querySelector('.sf-comp__emptyPane');
            const csShellBody = shellBody ? window.getComputedStyle(shellBody) : null;
            const csDemandGrid = demandGrid ? window.getComputedStyle(demandGrid) : null;
            const csSafeScroll = safeEl ? window.getComputedStyle(safeEl) : null;
            const csSlenderScroll = slenderEl ? window.getComputedStyle(slenderEl) : null;
            fetch('http://127.0.0.1:7369/ingest/c2c70d86-bcd0-4894-aefe-b03a3bc89ae5', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6de84a' },
              body: JSON.stringify({
                sessionId: '6de84a',
                runId: 'bottom-row-align',
                hypothesisId: 'H_SCROLL',
                location: 'calculator.js:attachModeToggle:setMode',
                message: 'design compression scroll surfaces after tab switch',
                data: {
                  contentPadVerify: {
                    demandGridPaddingTop: csDemandGrid?.paddingTop ?? null,
                    safeScrollMarginTop: csSafeScroll?.marginTop ?? null,
                    slenderScrollPaddingTop: csSlenderScroll?.paddingTop ?? null,
                  },
                  beamPhotoVerify: {
                    imgCount: beamImgs.length,
                    allDecoded:
                      beamImgs.length > 0 &&
                      beamImgs.every((img) => img.complete && img.naturalWidth > 0),
                    src0: beamImgs[0]?.getAttribute('src') ?? null,
                    naturalW: beamImgs.map((i) => i.naturalWidth),
                  },
                  slenderRailDock:
                    slenderRail && slenderCard
                      ? (() => {
                          const mrect = slenderCard.getBoundingClientRect();
                          const r = slenderRail.getBoundingClientRect();
                          return {
                            gapPx: Math.round(r.left - mrect.right),
                            railRightOfSlenderCard: r.left + 0.5 >= mrect.right,
                          };
                        })()
                      : null,
                  slenderContainmentH_OVERFLOW:
                    slenderEl != null
                      ? {
                          overflowXComputed: csSlenderScroll?.overflowX ?? null,
                          scrollW: slenderEl.scrollWidth,
                          clientW: slenderEl.clientWidth,
                          horizontalScrollNeeded: slenderEl.scrollWidth > slenderEl.clientWidth + 2,
                          slenderRightVsRailLeft:
                            slenderRail && slenderCard
                              ? Math.round(
                                  slenderRail.getBoundingClientRect().left - slenderCard.getBoundingClientRect().right,
                                )
                              : null,
                        }
                      : null,
                  shellBodyOverflowY: csShellBody?.overflowY ?? null,
                  shellBodyOverflowX: csShellBody?.overflowX ?? null,
                  shellBodyScrollable: shellBody
                    ? shellBody.scrollHeight > shellBody.clientHeight + 1
                    : null,
                  safeScrollable: safeEl ? safeEl.scrollHeight > safeEl.clientHeight + 1 : null,
                  midStackDims:
                    slenderCard && safeCard
                      ? {
                          slenderH: slenderCard.clientHeight,
                          safeH: safeCard.clientHeight,
                          scrollH: shellBody?.scrollHeight ?? null,
                        }
                      : null,
                  /* H_ROW_ALIGN: DEMAND + SAFE share grid row 2 — card tops should match within 1px */
                  demandSafeTopAlign_H_ROW:
                    demandCard && safeCard
                      ? Math.round(
                          demandCard.getBoundingClientRect().top - safeCard.getBoundingClientRect().top,
                        )
                      : null,
                  /* H_OVERLAP: horizontal gap between DEMAND right edge and SAFE left — negative means overlap */
                  demandSafeHorizontalGap_H_OVERLAP:
                    demandCard && safeCard
                      ? Math.round(
                          safeCard.getBoundingClientRect().left -
                            demandCard.getBoundingClientRect().right,
                        )
                      : null,
                  /* H_SAFE_PAD: gap from SAFE tab pill bottom to blue table top — should be small after tighten */
                  safePackProbe_H_PAD:
                    (() => {
                      const title = pane?.querySelector('.sf-compDes__safeTitle');
                      const blue = pane?.querySelector('.sf-compDes__midScroll--safe');
                      const sc = pane?.querySelector('.sf-compDes__midCard--safe');
                      if (!title || !blue || !sc) return null;
                      const tb = title.getBoundingClientRect().bottom;
                      const bt = blue.getBoundingClientRect().top;
                      const c = window.getComputedStyle(sc);
                      return {
                        titleBottomToBlueTopPx: Math.round(bt - tb),
                        safeCardPaddingTop: c.paddingTop,
                        blueMarginTop: window.getComputedStyle(blue).marginTop,
                      };
                    })(),
                  shellDims: shell
                    ? { offsetH: shell.offsetHeight, clientH: shell.clientHeight, scrollH: shell.scrollHeight }
                    : null,
                  /* H_VSCROLL: design taupe shell must allow vertical scroll when table taller than cap */
                  grayShellDesignScroll_H_V:
                    shell != null
                      ? (() => {
                          const sh = window.getComputedStyle(shell);
                          return {
                            overflowY: sh.overflowY,
                            paddingTop: sh.paddingTop,
                            paddingBottom: sh.paddingBottom,
                            clientH: shell.clientHeight,
                            scrollH: shell.scrollHeight,
                            verticalScrollNeeded: shell.scrollHeight > shell.clientHeight + 2,
                            maxHResolved: sh.getPropertyValue('--sf-compression-gray-max-h-design').trim(),
                          };
                        })()
                      : null,
                  /* H_VIS: SAFE blue table region — full table visible, no collapsed scrollport */
                  safeTableVisibility_H_VIS:
                    safeEl != null
                      ? (() => {
                          const tbl = pane?.querySelector('.sf-compDes__safeTable');
                          const cs = window.getComputedStyle(safeEl);
                          return {
                            overflowY: cs.overflowY,
                            scrollClientH: safeEl.clientHeight,
                            scrollScrollH: safeEl.scrollHeight,
                            tableOffsetH: tbl?.offsetHeight ?? null,
                            collapsedSuspect: safeEl.clientHeight > 0 && tbl && tbl.offsetHeight > safeEl.clientHeight + 8,
                          };
                        })()
                      : null,
                  safeCardDims: safeCard
                    ? { offsetH: safeCard.offsetHeight, clientH: safeCard.clientHeight, scrollH: safeCard.scrollHeight }
                    : null,
                  emptyPaneClientH: ep?.clientHeight ?? null,
                  viewportInnerH: window.innerHeight,
                  shellFitsViewportGuess:
                    shell != null ? shell.offsetHeight <= window.innerHeight - 96 : null,
                  bottomRowAlignPx:
                    safeCard && demandCard && lightestCard
                      ? {
                          safeBottom: Math.round(safeCard.getBoundingClientRect().bottom),
                          demandBottom: Math.round(demandCard.getBoundingClientRect().bottom),
                          lightestBottom: Math.round(lightestCard.getBoundingClientRect().bottom),
                          deltaSafeDemand:
                            Math.round(
                              safeCard.getBoundingClientRect().bottom -
                                demandCard.getBoundingClientRect().bottom,
                            ),
                        }
                      : null,
                  grayShellBodyFitH_FIT:
                    shellBody != null
                      ? {
                          clientW: shellBody.clientWidth,
                          scrollW: shellBody.scrollWidth,
                          horizontalOverflow: shellBody.scrollWidth > shellBody.clientWidth + 2,
                        }
                      : null,
                  demandParamsGapH_GAP:
                    paramsAside && demandCard
                      ? {
                          px: Math.round(
                            demandCard.getBoundingClientRect().top -
                              paramsAside.getBoundingClientRect().bottom,
                          ),
                        }
                      : null,
                  slenderTitleClipH_CLIP:
                    (() => {
                      const titleEl = pane?.querySelector('.sf-compDes__slenderTitle');
                      const panelEl = document.getElementById('dynamicPanel');
                      if (!titleEl || !panelEl) return null;
                      const tr = titleEl.getBoundingClientRect();
                      const pr = panelEl.getBoundingClientRect();
                      return {
                        titleTop: Math.round(tr.top),
                        panelTop: Math.round(pr.top),
                        clippedTop: tr.top < pr.top - 0.5,
                      };
                    })(),
                  /* H_SAFE_CLIP: SAFE straddle tab clipped when midCard--safe had overflow-x:auto */
                  safeTitleClipH_CLIP:
                    (() => {
                      const titleEl = pane?.querySelector('.sf-compDes__safeTitle');
                      const safeCard = pane?.querySelector('.sf-compDes__midCard--safe');
                      const panelEl = document.getElementById('dynamicPanel');
                      if (!titleEl || !safeCard || !panelEl) return null;
                      const tr = titleEl.getBoundingClientRect();
                      const sr = safeCard.getBoundingClientRect();
                      const pr = panelEl.getBoundingClientRect();
                      const cs = window.getComputedStyle(safeCard);
                      return {
                        titleTop: Math.round(tr.top),
                        safeCardTop: Math.round(sr.top),
                        panelTop: Math.round(pr.top),
                        clippedVsPanel: tr.top < pr.top - 0.5,
                        safeCardOverflow: cs.overflow,
                      };
                    })(),
                  /* H_DESIGN_REF: unified white straddle pills — demand vs slender bg should match */
                  pillDesignVerify_H_REF:
                    (() => {
                      const d = pane?.querySelector('.sf-compDes__demandTitle');
                      const sl = pane?.querySelector('.sf-compDes__slenderTitle');
                      const g = (el) => (el ? getComputedStyle(el) : null);
                      const cd = d ? g(d) : null;
                      const csl = sl ? g(sl) : null;
                      return {
                        demandBg: cd?.backgroundColor ?? null,
                        demandBorder: cd?.borderTopColor ?? null,
                        slenderBg: csl?.backgroundColor ?? null,
                        slenderBorder: csl?.borderTopColor ?? null,
                      };
                    })(),
                  panelOverflowClip_H_CLIP:
                    (() => {
                      const p = document.getElementById('dynamicPanel');
                      if (!p) return null;
                      const o = getComputedStyle(p).overflow;
                      return {
                        overflow: o,
                        compDesignActiveClass: p.classList.contains('comp-design-active'),
                        clipsLikely: o === 'hidden' || o === 'clip',
                      };
                    })(),
                  /* H_GOV_CASCADE: governing pills must not inherit generic .pillInput cream bg — verify rgb steel vs neutral */
                  govBlockVerify_H_REF:
                    (() => {
                      const blue = pane?.querySelector('#sfCompDesGovKLx');
                      const yel = pane?.querySelector('#sfCompDesGovKLyAsm');
                      const lab = pane?.querySelector('.sf-compDes__govLab');
                      if (!blue || !yel) return null;
                      const cb = window.getComputedStyle(blue);
                      const cy = window.getComputedStyle(yel);
                      const cl = lab ? window.getComputedStyle(lab) : null;
                      return {
                        blueBg: cb.backgroundColor,
                        blueColor: cb.color,
                        yellowBg: cy.backgroundColor,
                        yellowColor: cy.color,
                        labelTextAlign: cl?.textAlign ?? null,
                      };
                    })(),
                  /* H_FMT: ref layout — three columns should share same top edge (stacked cards, no auto-gap). */
                  layoutRef_H_FMT:
                    (() => {
                      const lc = pane?.querySelector('.sf-compDes__card--params');
                      const mc = pane?.querySelector('.sf-compDes__midCard--slender');
                      const vc = pane?.querySelector('.sf-compDes__vizCol');
                      if (!lc || !mc || !vc) return null;
                      const tl = (el) => Math.round(el.getBoundingClientRect().top);
                      const a = tl(lc);
                      const b = tl(mc);
                      const c = tl(vc);
                      return {
                        topLeftCol: a,
                        topMidCol: b,
                        topVizCol: c,
                        maxDeltaPx: Math.max(Math.abs(b - a), Math.abs(c - a), Math.abs(c - b)),
                      };
                    })(),
                  /* H_REF: LIGHTEST split card — cream label col + white value col */
                  lightestSplitLayout_H_REF:
                    (() => {
                      const card = pane?.querySelector('.sf-compDes__lightestCard');
                      const lab = pane?.querySelector('.sf-compDes__lightestLabelCol');
                      const val = pane?.querySelector('.sf-compDes__lightestValueCol');
                      const viz = pane?.querySelector('.sf-compDes__vizCol');
                      const safeCard = pane?.querySelector('.sf-compDes__midCard--safe');
                      const railViz = pane?.querySelector('.sf-compDes__slenderRail--vizCol');
                      if (!card || !lab || !val) return null;
                      const cs = getComputedStyle(card);
                      const vr = viz?.getBoundingClientRect();
                      const cr = card.getBoundingClientRect();
                      const rr = railViz?.getBoundingClientRect();
                      return {
                        flexDirection: cs.flexDirection,
                        labelColW: Math.round(lab.getBoundingClientRect().width),
                        valueColW: Math.round(val.getBoundingClientRect().width),
                        lineCount: lab.querySelectorAll('.sf-compDes__lightestLine').length,
                        underMidCol: false,
                        underVizCol: !!(viz && viz.contains(card)),
                        marginTopComputed: cs.marginTop,
                        vizColHpx: vr ? Math.round(vr.height) : null,
                        railToLightestGapPx:
                          rr != null ? Math.round(cr.top - rr.bottom) : null,
                        lightestPinDeltaPx:
                          vr != null ? Math.round(vr.bottom - cr.bottom) : null,
                        gapBelowSafePx:
                          safeCard && card
                            ? Math.round(card.getBoundingClientRect().top - safeCard.getBoundingClientRect().bottom)
                            : null,
                      };
                    })(),
                },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
          });
        }
      });
      // #endregion
    };

    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.sf-comp__modeBtn');
      if (!btn) return;
      const mode = btn.getAttribute('data-comp-mode') || 'analysis';
      setMode(mode);
    });

    // default to analysis (as requested)
    setMode('analysis');
  }

  window.SteelForge = window.SteelForge || {};
  window.SteelForge.initCompression = (panelRoot) => {
    const root = panelRoot.querySelector('.sf-comp') ? panelRoot : document;
    attachSolve(root);
    attachAnalysis(root);
    attachCompressionAnalysisPanel(root);
    attachCompressionDesignPanel(root);
    attachModeToggle(root, { topic: 'COMPRESSION' });
  };

  window.SteelForge.initBending = (panelRoot) => {
    const compRoot =
      panelRoot?.querySelector?.('.sf-comp.sf-comp--bending') ??
      panelRoot?.querySelector?.('.sf-comp') ??
      panelRoot ??
      document;
    attachModeToggle(compRoot, { topic: 'BENDING' });
  };

  function attachShearThumbs(root) {
    const groups = Array.from(root.querySelectorAll('.sf-comp--shear .sf-shear__thumbs'));
    if (groups.length === 0) return;

    groups.forEach((wrap) => {
      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.sf-shear__thumb');
        if (!btn || !wrap.contains(btn)) return;
        const buttons = Array.from(wrap.querySelectorAll('.sf-shear__thumb'));
        buttons.forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });
  }

  function fmtNum(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  /** Match typical spreadsheet display for limiting slenderness values */
  function fmtShearLimit(v) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(8);
  }

  function calcShearCv(lambda, lambdaP, lambdaR, Fy, E, kv) {
    if (![lambda, lambdaP, lambdaR, Fy, E, kv].every(Number.isFinite)) return null;
    if (lambda <= 0 || lambdaP <= 0 || lambdaR <= 0 || Fy <= 0 || E <= 0 || kv <= 0) return null;

    if (lambda <= lambdaP) return 1;
    if (lambda <= lambdaR) return lambdaP / lambda;
    return (1.51 * kv * E) / (Fy * lambda ** 2);
  }

  function webShearSlendernessClass(lambda, lambdaP, lambdaR) {
    if (![lambda, lambdaP, lambdaR].every(Number.isFinite)) return '';
    if (lambda <= lambdaP) return 'compact web (Cv = 1)';
    if (lambda <= lambdaR) return 'inelastic web shear';
    return 'slender web (elastic buckling)';
  }

  function shearDebugEnabled() {
    try {
      return (
        typeof window !== 'undefined' &&
        (window.__SF_SHEAR_DEBUG__ === true ||
          (typeof location !== 'undefined' &&
            typeof URLSearchParams !== 'undefined' &&
            new URLSearchParams(location.search).get('sfShearDebug') === '1'))
      );
    } catch {
      return false;
    }
  }

  /** AISC G2: unstiffened kv = 5; stiffened interior panel kv = 5 + 5/(a/h)² when a/h > 0. */
  function shearKvFromWeb(webCond, aIn, hIn) {
    const stiff = (webCond || 'unstiffened') === 'stiffened';
    if (!stiff) return 5;
    if (!Number.isFinite(aIn) || !Number.isFinite(hIn) || hIn <= 0 || aIn <= 0) return 5;
    const ah = aIn / hIn;
    return 5 + 5 / (ah * ah);
  }

  /** Client Excel grade row; Custom Fy uses select value `custom`. */
  function steelPropsFromStructuralGradeSelect(selectValue) {
    if (selectValue === 'custom') return null;
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    return grades.find((x) => x.id === selectValue) ?? null;
  }

  function fyFromStructuralSteelGradeSelect(selectValue) {
    const g = steelPropsFromStructuralGradeSelect(selectValue);
    return Number.isFinite(g?.fy) ? g.fy : null;
  }

  function populateStructuralSteelGradeSelect(selectEl, preferredId = 'a992') {
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    if (!selectEl || grades.length === 0) return;
    const previous = selectEl.value;
    const sorted = [...grades].sort((a, b) => {
      const ca = a.catalogId;
      const cb = b.catalogId;
      if (ca != null && cb != null && ca !== cb) return ca - cb;
      if (ca != null && cb == null) return -1;
      if (ca == null && cb != null) return 1;
      return String(a.label).localeCompare(String(b.label));
    });
    selectEl.innerHTML = '';
    sorted.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      const idPart = g.catalogId != null ? `[${g.catalogId}] ` : '';
      opt.textContent = `${idPart}${g.label} — Fy=${g.fy}, Fu=${g.fu} ksi`;
      selectEl.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Fy / Fu (edit fields)';
    selectEl.appendChild(customOpt);
    const ids = new Set(grades.map((x) => x.id));
    if (previous === 'custom') selectEl.value = 'custom';
    else if (ids.has(previous)) selectEl.value = previous;
    else selectEl.value = ids.has(preferredId) ? preferredId : grades[0].id;
  }

  function attachShearAnalysis(root) {
    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="analysis"]');
    if (!pane) return;

    const shapes = window.SteelForgeShearShapes ?? [];
    /** Factors used in client workbook screenshots (differs from typical AISC φ=0.9, Ω=1.67). */
    const PHI_V_CLIENT = 1;
    const OMEGA_V_CLIENT = 1.5;

    const input = (id) => pane.querySelector(`#${id}`);
    const out = (id) => pane.querySelector(`#${id}`);
    const num = (id) => parseNum(input(id)?.value);

    const methodEl = input('sfShearAnaMethod');
    const webCondEl = input('sfShearAnaWebCond');
    const shapeSel = input('sfShearAnaShape');
    const steelEl = input('sfShearAnaSteel');

    populateStructuralSteelGradeSelect(steelEl, 'a992');

    const fmtGeom = (v, maxDecimals = 4) => {
      if (!Number.isFinite(v)) return '';
      const s = v.toFixed(maxDecimals).replace(/\.?0+$/, '');
      return s === '' ? '0' : s;
    };

    const shapeAw = (s) => (s && (s.Aw ?? s.aw)) ?? null;
    const shapeLambdaW = (s) => (s && (s.lambdaW ?? s.lambda_w)) ?? null;
    const shapeLambdaF = (s) => (s && (s.lambdaF ?? s.lambda_f)) ?? null;

    const applySteelGradeProps = () => {
      const fyEl = input('sfShearAnaFy');
      const fuEl = input('sfShearAnaFu');
      if (!steelEl || !fyEl) return;
      if (steelEl.value === 'custom') {
        if (fuEl) {
          fuEl.value = '';
          fuEl.readOnly = false;
        }
        return;
      }
      const g = steelPropsFromStructuralGradeSelect(steelEl.value);
      if (g) {
        fyEl.value = String(g.fy);
        if (fuEl) {
          fuEl.value = String(g.fu);
          fuEl.readOnly = true;
        }
      }
    };

    const applyCatalogDefaults = () => {
      const Eel = input('sfShearAnaE');
      if (Eel) Eel.value = '29000';
    };

    const syncWebSpacingAndKv = () => {
      const webCond = webCondEl?.value || 'unstiffened';
      const aEl = input('sfShearAnaA');
      const hEl = input('sfShearAnaH');
      const kvEl = input('sfShearAnaKv');
      if (webCond === 'unstiffened') {
        if (aEl) aEl.value = '0';
      }
      const a = parseNum(aEl?.value);
      const h = parseNum(hEl?.value);
      const kv = shearKvFromWeb(webCond, a, h);
      if (kvEl && Number.isFinite(kv)) kvEl.value = fmtGeom(kv, 4);
    };

    const applyShape = (name) => {
      const s = shapes.find((x) => x.name === name);
      if (!s) return;
      const awVal = shapeAw(s);
      const lamVal = shapeLambdaW(s);
      const hEl = input('sfShearAnaH');
      const lamEl = input('sfShearAnaLambda');
      const lamFEl = input('sfShearAnaLambdaF');
      const awEl = input('sfShearAnaAw');
      const lamFVal = shapeLambdaF(s);
      if (hEl) hEl.value = fmtGeom(s.h, 4);
      if (lamEl && lamVal != null) lamEl.value = fmtGeom(lamVal, 3);
      if (lamFEl) lamFEl.value = lamFVal != null ? fmtGeom(lamFVal, 3) : '';
      if (awEl && awVal != null) awEl.value = fmtGeom(awVal, 4);
      applyCatalogDefaults();
      syncWebSpacingAndKv();
    };

    const shapeNamesSorted = [...shapes].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (shapeSel && shapeSel.options.length <= 1 && shapes.length > 0) {
      shapeNamesSorted.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name.replace(/X/gi, '×');
        shapeSel.appendChild(opt);
      });
    }

    const updateImageState = () => {
      const stiffened = (webCondEl?.value || 'stiffened') === 'stiffened';
      const plainImg = pane.querySelector('.sf-shearAna__imgEl--plain');
      const stiffImg = pane.querySelector('.sf-shearAna__imgEl--stiffened');
      if (plainImg) plainImg.style.opacity = stiffened ? '0.35' : '1';
      if (stiffImg) stiffImg.style.opacity = stiffened ? '1' : '0.35';
    };

    const update = () => {
      syncWebSpacingAndKv();
      const fy = num('sfShearAnaFy');
      const aw = num('sfShearAnaAw');
      const hGeom = num('sfShearAnaH');
      const lamEl = input('sfShearAnaLambda');
      const typedLambda = parseNum(lamEl?.value);
      let lambdaWeb = null;
      if (Number.isFinite(typedLambda) && typedLambda > 0) {
        lambdaWeb = typedLambda;
      } else if (
        Number.isFinite(hGeom) &&
        hGeom > 0 &&
        Number.isFinite(aw) &&
        aw > 0
      ) {
        lambdaWeb = (hGeom * hGeom) / aw;
        if (lamEl) lamEl.value = fmtGeom(lambdaWeb, 6);
      }
      const kv = num('sfShearAnaKv');
      const E = num('sfShearAnaE');
      const demandField = input('sfShearAnaVu');
      const VuDemand = parseNum(demandField?.value);

      const lim224 =
        Number.isFinite(fy) && fy > 0 && Number.isFinite(E) && E > 0
          ? 2.24 * Math.sqrt(E / fy)
          : null;
      const lambdaP =
        Number.isFinite(fy) && fy > 0 && Number.isFinite(E) && E > 0 && Number.isFinite(kv) && kv > 0
          ? 1.10 * Math.sqrt((kv * E) / fy)
          : null;
      const lambdaR =
        Number.isFinite(fy) && fy > 0 && Number.isFinite(E) && E > 0 && Number.isFinite(kv) && kv > 0
          ? 1.37 * Math.sqrt((kv * E) / fy)
          : null;

      const lamPEl = input('sfShearAnaLambdaP');
      const lamREl = input('sfShearAnaLambdaR');
      if (lamPEl) lamPEl.value = lambdaP != null ? fmtShearLimit(lambdaP) : '';
      if (lamREl) lamREl.value = lambdaR != null ? fmtShearLimit(lambdaR) : '';

      const cv =
        lambdaWeb != null && lambdaP != null && lambdaR != null && Number.isFinite(fy)
          ? calcShearCv(lambdaWeb, lambdaP, lambdaR, fy, E, kv)
          : null;
      const Vn =
        Number.isFinite(cv) && Number.isFinite(fy) && Number.isFinite(aw) ? 0.6 * fy * aw * cv : null;
      const phiVn = Number.isFinite(Vn) ? PHI_V_CLIENT * Vn : null;
      const asdCap = Number.isFinite(Vn) ? Vn / OMEGA_V_CLIENT : null;

      const isASD = (methodEl?.value || 'lrfd') === 'asd';
      const demandLbl = out('sfShearAnaDemandLabel');
      if (demandLbl) {
        demandLbl.innerHTML = isASD ? 'V<sub>a</sub> =' : 'V<sub>u</sub> =';
      }
      const capacityLRFD = phiVn;
      const capacityASD = asdCap;

      const phiVnEl = out('sfShearAnaPhiVn');
      const asdEl = out('sfShearAnaVnOverOmega');
      if (phiVnEl) phiVnEl.textContent = fmtNum(phiVn, 2);
      if (asdEl) asdEl.textContent = fmtNum(asdCap, 2);

      const cvEl = out('sfShearAnaCv');
      const phiEl = out('sfShearAnaPhi');
      const omgEl = out('sfShearAnaOmega');
      const vnEl = out('sfShearAnaVn');
      const b1 = out('sfShearAnaBar1');
      const b2 = out('sfShearAnaBar2');
      const b3 = out('sfShearAnaBar3');

      if (cvEl) cvEl.textContent = fmtNum(cv, 6);
      if (phiEl) phiEl.textContent = fmtNum(PHI_V_CLIENT, 3);
      if (omgEl) omgEl.textContent = fmtNum(OMEGA_V_CLIENT, 2);
      if (vnEl) vnEl.textContent = fmtNum(Vn, 2);
      if (b1) b1.textContent = fmtShearLimit(lim224);
      if (b2) b2.textContent = fmtShearLimit(lambdaP);
      if (b3) b3.textContent = fmtShearLimit(lambdaR);

      const remarksEl = out('sfShearAnaRemarks');
      const webCls = webShearSlendernessClass(lambdaWeb, lambdaP, lambdaR);
      if (remarksEl) {
        const cap = isASD ? capacityASD : capacityLRFD;
        if (!Number.isFinite(cap)) {
          remarksEl.textContent = webCls
            ? `${webCls}. Enter Aw, h (or λ), E, Fy.`
            : 'Enter section geometry and material.';
        } else if (!Number.isFinite(VuDemand)) {
          remarksEl.textContent = webCls
            ? `${webCls}. Enter ${isASD ? 'Va' : 'Vu'} (demand).`
            : `Enter ${isASD ? 'Va' : 'Vu'} (demand).`;
        } else {
          const ok = isASD ? VuDemand <= cap : VuDemand <= cap;
          remarksEl.textContent = `${ok ? 'SAFE' : 'NOT SAFE'} · ${webCls || 'Shear check'}`;
        }
      }

      if (shearDebugEnabled()) {
        console.debug('[SteelForge shear · analysis]', {
          h: hGeom,
          Aw: aw,
          lambdaInput: typedLambda,
          lambdaWeb,
          lambdaP,
          lambdaR,
          kv,
          E,
          fy,
          Cv: cv,
          Vn,
          phiVn,
          VnOverOmega: asdCap,
          VuOrVaDemand: VuDemand,
          mode: isASD ? 'ASD' : 'LRFD',
        });
      }
    };

    const demandField = input('sfShearAnaVu');

    pane.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    if (steelEl) {
      steelEl.addEventListener('change', () => {
        applySteelGradeProps();
        update();
      });
    }
    if (shapeSel) {
      shapeSel.addEventListener('change', () => {
        if (shapeSel.value) applyShape(shapeSel.value);
        else {
          const lamFEl = input('sfShearAnaLambdaF');
          if (lamFEl) lamFEl.value = '';
          syncWebSpacingAndKv();
        }
        update();
      });
    }
    if (webCondEl) {
      webCondEl.addEventListener('change', () => {
        syncWebSpacingAndKv();
        updateImageState();
        update();
      });
    }

    applySteelGradeProps();
    const E0 = input('sfShearAnaE');
    const kv0 = input('sfShearAnaKv');
    if (E0 && String(E0.value).trim() === '') E0.value = '29000';
    if (kv0 && String(kv0.value).trim() === '') kv0.value = '5';
    syncWebSpacingAndKv();
    if (shapeSel?.value) applyShape(shapeSel.value);

    updateImageState();
    update();
  }

  function attachShearDesign(root) {
    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="design"]');
    if (!pane) return;

    const input = (id) => pane.querySelector(`#${id}`);
    const out = (id) => pane.querySelector(`#${id}`);
    const num = (id) => parseNum(input(id)?.value);
    const METHOD_LAYOUT = {
      lrfd: {
        loadTopLabel: '1.2DL + 1.6LL =',
        loadTopUnit: 'kips/ft',
        wCombLabel: 'W<sub>u</sub> =',
        wCombUnit: 'kips/ft',
        showBottomRow: true,
        loadBottomLabel: '1.4DL =',
        loadBottomUnit: 'kips/ft',
        momentLabel: 'ULTIMATE MOMENT (M<sub>u</sub>) =',
        momentUnit: 'kip-ft',
        shearLabel: 'ULTIMATE SHEAR (V<sub>u</sub>) =',
        shearUnit: 'kips',
        ultimateTitle: 'ULTIMATE SHEAR',
        ultimateExpr: 'V<sub>u</sub> =',
        assumedSection: 'W21X68',
        lightestSection: 'W24X68',
        beamMomentRow: 'ULTIMATE MOMENT (M<sub>u</sub>) =',
        beamDeflRow: 'ULTIMATE DEFLECTION (Δ<sub>Max</sub>)=',
        beamMomentFormula: 'WL²/8',
        beamDeflFormula: '5WL<sup>4</sup>/384EI',
      },
      asd: {
        loadTopLabel: 'DL + LL =',
        loadTopUnit: 'kips/ft',
        wCombLabel: 'W<sub>a</sub> =',
        wCombUnit: 'kips/ft',
        showBottomRow: false,
        loadBottomLabel: '1.4DL =',
        loadBottomUnit: 'kips/ft',
        momentLabel: 'ALLOWABLE MOMENT (M<sub>a</sub>) =',
        momentUnit: 'kip-ft',
        shearLabel: 'ALLOWABLE SHEAR (V<sub>a</sub>) =',
        shearUnit: 'kips',
        ultimateTitle: 'ALLOWABLE SHEAR',
        ultimateExpr: 'V<sub>a</sub> =',
        assumedSection: 'W24X62',
        lightestSection: 'W24X62',
        beamMomentRow: 'ALLOWABLE MOMENT (M<sub>a</sub>) =',
        beamDeflRow: 'ALLOWABLE DEFLECTION (Δ<sub>Max</sub>)=',
        beamMomentFormula: 'WL²/8',
        beamDeflFormula: '5WL<sup>4</sup>/384EI',
      },
    };

    const shapesSorted = window.SteelForgeShearShapesSortedByWeight ?? [];

    const phiB = 0.9;
    const omegaB = 1.67;
    const phiV = 1;
    const omegaV = 1.5;
    const kv = 5;
    const E = 29000;

    const shearStrengthForShape = (shape, fyV, EV, kvV) => {
      const lambda =
        Number.isFinite(shape.h) && Number.isFinite(shape.tw) && shape.tw > 0
          ? shape.h / shape.tw
          : Number.isFinite(shape.lambdaW)
            ? shape.lambdaW
            : null;
      const aw =
        Number.isFinite(shape.Aw) ? shape.Aw
        : Number.isFinite(shape.d) && Number.isFinite(shape.tw) ? shape.d * shape.tw
        : null;
      const lambdaP =
        Number.isFinite(fyV) && fyV > 0 && Number.isFinite(EV) && EV > 0 && Number.isFinite(kvV) && kvV > 0
          ? 1.10 * Math.sqrt((kvV * EV) / fyV)
          : null;
      const lambdaR =
        Number.isFinite(fyV) && fyV > 0 && Number.isFinite(EV) && EV > 0 && Number.isFinite(kvV) && kvV > 0
          ? 1.37 * Math.sqrt((kvV * EV) / fyV)
          : null;
      const cv = calcShearCv(lambda, lambdaP, lambdaR, fyV, EV, kvV);
      const Vn = Number.isFinite(cv) && Number.isFinite(fyV) && Number.isFinite(aw) ? 0.6 * fyV * aw * cv : null;
      const phiVn = Number.isFinite(Vn) ? phiV * Vn : null;
      const Vallow = Number.isFinite(Vn) ? Vn / omegaV : null;
      return { lambda, aw, lambdaP, lambdaR, cv, Vn, phiVn, Vallow };
    };

    const pickAssumedForMoment = (zxReqV) => {
      if (!shapesSorted.length) return null;
      const ok = shapesSorted.filter((s) => Number.isFinite(s.zx) && s.zx >= zxReqV);
      if (ok.length) return ok[0];
      return shapesSorted.reduce((a, b) => ((a.zx ?? 0) >= (b.zx ?? 0) ? a : b));
    };

    const pickLightestForShear = (zxReqV, shearVV, fyV, EV, kvV, lrfd) => {
      const passes = (shape) => {
        const { phiVn: pv, Vallow: va } = shearStrengthForShape(shape, fyV, EV, kvV);
        if (lrfd) return Number.isFinite(pv) && Number.isFinite(shearVV) && shearVV <= pv;
        return Number.isFinite(va) && Number.isFinite(shearVV) && shearVV <= va;
      };
      return shapesSorted.find((s) => Number.isFinite(s.zx) && s.zx >= zxReqV && passes(s)) ?? null;
    };

    const designShapeImgs = pane.querySelectorAll('.sf-shearDes__shapeImg');

    const update = () => {
      const method = (input('sfShearDesMethod')?.value || 'lrfd').toLowerCase();
      const isLRFD = method === 'lrfd';
      const layout = METHOD_LAYOUT[isLRFD ? 'lrfd' : 'asd'];
      if (designShapeImgs.length >= 2) {
        // Match analysis-tab behavior: emphasize top image in LRFD, bottom image in ASD.
        designShapeImgs[0].style.opacity = isLRFD ? '1' : '0.35';
        designShapeImgs[1].style.opacity = isLRFD ? '0.35' : '1';
      }

      const setText = (id, value) => {
        const el = out(id);
        if (el) el.textContent = value;
      };
      const setHtml = (id, value) => {
        const el = out(id);
        if (el) el.innerHTML = value;
      };

      const fy = num('sfShearDesFy');
      const dl = num('sfShearDesDL');
      const ll = num('sfShearDesLL');
      const L = num('sfShearDesL');

      setHtml('sfShearDesLoadTopLabel', layout.loadTopLabel);
      setText('sfShearDesLoadTopUnit', layout.loadTopUnit);
      setHtml('sfShearDesWuLabel', layout.wCombLabel);
      setText('sfShearDesWuUnit', layout.wCombUnit);
      setHtml('sfShearDesLoadBottomLabel', layout.loadBottomLabel);
      setText('sfShearDesLoadBottomUnit', layout.loadBottomUnit);
      setHtml('sfShearDesMomentLabel', layout.momentLabel);
      setText('sfShearDesMomentUnit', layout.momentUnit);
      setHtml('sfShearDesShearLabel', layout.shearLabel);
      setText('sfShearDesShearUnit', layout.shearUnit);
      setText('sfShearDesUltimateTitle', layout.ultimateTitle);
      setHtml('sfShearDesUltimateExpr', layout.ultimateExpr);

      const beamMomentLbl = pane.querySelector('#sfShearDesBeamMomentLabel');
      const beamDeflLbl = pane.querySelector('#sfShearDesBeamDeflLabel');
      const beamMomentFormula = pane.querySelector('#sfShearDesBeamMomentFormula');
      const beamDeflFormula = pane.querySelector('#sfShearDesBeamDeflFormula');
      if (beamMomentLbl) beamMomentLbl.innerHTML = layout.beamMomentRow;
      if (beamDeflLbl) beamDeflLbl.innerHTML = layout.beamDeflRow;
      if (beamMomentFormula) beamMomentFormula.innerHTML = layout.beamMomentFormula;
      if (beamDeflFormula) beamDeflFormula.innerHTML = layout.beamDeflFormula;

      const bottomRow = out('sfShearDesLoadBottomRow');
      if (bottomRow) bottomRow.style.display = layout.showBottomRow ? '' : 'none';

      const ok =
        Number.isFinite(fy) && fy > 0 &&
        Number.isFinite(dl) && dl >= 0 &&
        Number.isFinite(ll) && ll >= 0 &&
        Number.isFinite(L) && L > 0;

      if (!ok) {
        [
          'sfShearDesWult',
          'sfShearDesWu',
          'sfShearDesW14',
          'sfShearDesMu',
          'sfShearDesVu',
          'sfShearDesZx',
          'sfShearDesPlasticMod',
          'sfShearDesTw',
          'sfShearDesDepth',
          'sfShearDesLambdaWeb',
          'sfShearDesLambdaVal',
          'sfShearDesLambdaP',
          'sfShearDesLambdaR',
          'sfShearDesCv',
          'sfShearDesPhi',
          'sfShearDesOmega',
          'sfShearDesVn',
          'sfShearDesUltimateVal',
        ].forEach((id) => setText(id, '—'));
        setText('sfShearDesSectionName', '—');
        setText('sfShearDesLightest', '—');
        setText('sfShearDesRemarks', '—');
        return;
      }

      let wTop;
      let w14;
      let wComb;
      let M;
      let V;

      if (isLRFD) {
        wTop = 1.2 * dl + 1.6 * ll;
        w14 = 1.4 * dl;
        wComb = Math.max(wTop, w14);
        M = (wComb * L ** 2) / 8;
        V = (wComb * L) / 2;
      } else {
        wTop = dl + ll;
        w14 = null;
        wComb = dl + ll;
        M = (wComb * L ** 2) / 8;
        V = (wComb * L) / 2;
      }

      const zxReq =
        isLRFD
          ? (M * 12) / (phiB * fy)
          : (M * 12) / (fy / omegaB);

      const lim224 = 2.24 * Math.sqrt(E / fy);

      const assumedShape = pickAssumedForMoment(zxReq);
      const lightestShape =
        pickLightestForShear(zxReq, V, fy, E, kv, isLRFD) ?? assumedShape;
      const condShape = lightestShape ?? assumedShape;

      const lambdaPglob = 1.10 * Math.sqrt((kv * E) / fy);
      const lambdaRglob = 1.37 * Math.sqrt((kv * E) / fy);

      setText(
        'sfShearDesSectionName',
        assumedShape?.name?.replace(/X/gi, '×') ?? '—',
      );
      setText(
        'sfShearDesLightest',
        lightestShape?.name?.replace(/X/gi, '×') ?? '—',
      );

      let asmLambda = null;
      if (assumedShape) {
        const ar = shearStrengthForShape(assumedShape, fy, E, kv);
        asmLambda = ar.lambda;
      }

      let cv;
      let Vn;
      let phiVn;
      let Vallow;
      let condLambda = null;
      let shearCondShapeResult = null;

      if (condShape) {
        shearCondShapeResult = shearStrengthForShape(condShape, fy, E, kv);
        condLambda = shearCondShapeResult.lambda;
        cv = shearCondShapeResult.cv;
        Vn = shearCondShapeResult.Vn;
        phiVn = shearCondShapeResult.phiVn;
        Vallow = shearCondShapeResult.Vallow;
      } else {
        cv = Vn = phiVn = Vallow = null;
      }

      setText('sfShearDesWult', fmtNum(wTop, 2));
      setText('sfShearDesWu', fmtNum(wComb, 2));
      setText('sfShearDesW14', w14 == null ? '—' : fmtNum(w14, 2));
      setText('sfShearDesMu', fmtNum(M, 3));
      setText('sfShearDesVu', fmtNum(V, 3));
      setText('sfShearDesZx', fmtNum(zxReq, 4));

      setText('sfShearDesPlasticMod', assumedShape?.zx == null ? '—' : fmtNum(assumedShape.zx, 2));
      setText('sfShearDesTw', assumedShape?.tw == null ? '—' : fmtNum(assumedShape.tw, 3));
      setText('sfShearDesDepth', assumedShape?.d == null ? '—' : fmtNum(assumedShape.d, 2));
      setText('sfShearDesLambdaWeb', asmLambda == null ? '—' : fmtNum(asmLambda, 2));

      setText('sfShearDesLambdaVal', fmtShearLimit(lim224));
      setText('sfShearDesLambdaP', fmtShearLimit(lambdaPglob));
      setText('sfShearDesLambdaR', fmtShearLimit(lambdaRglob));
      setText('sfShearDesCv', fmtNum(cv, 3));
      setText('sfShearDesPhi', fmtNum(phiV, 2));
      setText('sfShearDesOmega', fmtNum(omegaV, 2));
      setText('sfShearDesVn', fmtNum(Vn, 2));

      let isSafe;
      if (isLRFD) {
        isSafe = Number.isFinite(V) && Number.isFinite(phiVn) ? V <= phiVn : null;
      } else {
        isSafe = Number.isFinite(V) && Number.isFinite(Vallow) ? V <= Vallow : null;
      }
      const demandShear = V;

      setText('sfShearDesUltimateVal', Number.isFinite(demandShear) ? fmtNum(demandShear, 3) : '—');
      if (isSafe == null) {
        setText('sfShearDesRemarks', '—');
      } else {
        setText('sfShearDesRemarks', isSafe ? 'SAFE' : 'UNSAFE');
      }

      if (shearDebugEnabled()) {
        console.debug('[SteelForge shear · design]', {
          wComb,
          M_kft: M,
          Vu_or_Va: demandShear,
          zxReq,
          assumed: assumedShape?.name,
          lightest: lightestShape?.name,
          governing: condShape?.name,
          ...(shearCondShapeResult ?? {}),
          phiVn,
          Vallow,
          lim224,
          lambdaP: lambdaPglob,
          lambdaR: lambdaRglob,
          isSafe,
          mode: isLRFD ? 'LRFD' : 'ASD',
        });
      }
    };

    const defaults = {
      sfShearDesFy: 50,
      sfShearDesDL: 0.2,
      sfShearDesLL: 0.8,
      sfShearDesL: 55,
    };
    Object.entries(defaults).forEach(([id, value]) => {
      const el = input(id);
      if (el && String(el.value ?? '').trim() === '') el.value = String(value);
    });

    const steelTypeEl = input('sfShearDesSteelType');
    const fyEl = input('sfShearDesFy');
    populateStructuralSteelGradeSelect(steelTypeEl, 'a992');

    const syncSteelPropsFromGrade = () => {
      const fuEl = input('sfShearDesFu');
      if (!steelTypeEl || !fyEl) return;
      if (steelTypeEl.value === 'custom') {
        if (fuEl) {
          fuEl.value = '';
          fuEl.readOnly = false;
        }
        return;
      }
      const g = steelPropsFromStructuralGradeSelect(steelTypeEl.value);
      if (g) {
        fyEl.value = String(g.fy);
        if (fuEl) {
          fuEl.value = String(g.fu);
          fuEl.readOnly = true;
        }
      }
    };

    pane.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    if (steelTypeEl) steelTypeEl.addEventListener('change', () => {
      syncSteelPropsFromGrade();
      update();
    });

    syncSteelPropsFromGrade();
    update();
  }

  window.SteelForge.initShear = (panelRoot) => {
    const root = panelRoot.querySelector('.sf-comp') ? panelRoot : document;
    attachModeToggle(root, { topic: 'SHEAR' });
    attachShearThumbs(root);
    attachShearAnalysis(root);
    attachShearDesign(root);
  };
})();
