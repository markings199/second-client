(() => {
  const E_MPA = 200000; // steel elastic modulus in MPa
  const PHI_C = 0.9; // AISC compression resistance factor
  const OMEGA_C = 1.67; // AISC ASD safety factor (compression)

  /**
   * Reference workbook (Excel export) column curve: Fcr = 0.658^(Fy/Fe)·Fy for all slender regimes
   * (no transition to 0.877·Fe). Matches exported Fe / Fcr / φPn rows when KL/r > 4.71√(E/Fy).
   */
  function sfCompressionWorkbookFcr(Fy, Fe) {
    if (![Fy, Fe].every((x) => Number.isFinite(x) && x > 0)) return null;
    return (0.658 ** (Fy / Fe)) * Fy;
  }

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
    const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
    const COL = { type: 0, label: 2, Ag: 5, lamF: 23, lamW: 24, rx: 31, ry: 37 };

    function parseCsvLine(line) {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '\"' && line[i + 1] === '\"') {
            cur += '\"';
            i++;
          } else if (c === '\"') q = false;
          else cur += c;
        } else if (c === '\"') q = true;
        else if (c === ',') {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out;
    }

    function parseNumLike(v) {
      if (v == null) return null;
      const s0 = String(v).replace(/\u00A0/g, ' ').trim();
      if (!s0 || s0 === '—' || s0 === '–' || s0 === '-') return null;
      const s = s0.replace(/\s+/g, ' ');
      if (/^-?\d+\/\d+$/.test(s)) {
        const [a, b] = s.split('/').map(Number);
        return b ? a / b : null;
      }
      if (/^-?\d+\s+\d+\/\d+$/.test(s)) {
        const [whole, frac] = s.split(' ');
        const [a, b] = frac.split('/').map(Number);
        if (!b) return null;
        return Number(whole) + a / b;
      }
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }

    const fmt = (v, d = 8) => {
      if (!Number.isFinite(v)) return '—';
      return v.toFixed(d).replace(/\.?0+$/, '');
    };

    let wRowsPromise = null;
    function loadWShapesFromCsv() {
      if (wRowsPromise) return wRowsPromise;
      wRowsPromise = fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((txt) => {
          const lines = txt.split(/\r?\n/);
          const rows = [];
          for (let i = 4; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const r = parseCsvLine(line);
            if (String(r[COL.type] || '').trim() !== 'W') continue;
            const lab = String(r[COL.label] || '').trim();
            if (!lab) continue;
            rows.push(r);
          }
          return rows;
        })
        .catch(() => {
          wRowsPromise = null;
          return [];
        });
      return wRowsPromise;
    }

    const getSelectedWRow = (rows) => {
      const v = String(shapeSel.value || '').trim().toUpperCase();
      return rows.find((r) => String(r[COL.label] || '').trim().toUpperCase() === v) ?? null;
    };

    const steelEl = input('sfCompAnaSteel');
    populateStructuralSteelGradeSelect(
      steelEl,
      window.SteelForge?.activeStructuralSteelGrade?.id || 'a992',
    );

    const E_DEFAULT = 29000;
    const PHI_C = 0.9;
    const OMEGA_C = 1.67;
    const connK = {
      'fixed-pinned': 0.8,
      'pinned-pinned': 1,
      'fixed-fixed': 0.65,
      'free-pinned': 2,
      'fixed-free': 1.2,
    };

    /**
     * Compression-element slenderness limits — strict workbook parity (COMPRESSION!E29, E31):
     *   Flange (unstiffened, rolled W): λr = 0.56 · √(E/Fy)
     *   Web   (stiffened)             : λr = 1.49 · √(E/Fy)
     * Workbook uses a binary λr-only check ("Compact Flange" / "Non-Compact Flange").
     * We expose lp = lr so the dashboard's λp/λr widgets render the same single threshold
     * (AISC E-chapter has no separate λp for compression elements).
     */
    function compactLimits(Fy, Eksi = E_DEFAULT) {
      if (!Number.isFinite(Fy) || Fy <= 0) return null;
      const Euse = Number.isFinite(Eksi) && Eksi > 0 ? Eksi : E_DEFAULT;
      const root = Math.sqrt(Euse / Fy);
      const lrF = 0.56 * root;
      const lrW = 1.49 * root;
      return {
        flange: { lp: lrF, lr: lrF },
        web: { lp: lrW, lr: lrW },
      };
    }

    function syncShapeKindUI() {
      const kind = pane.querySelector('input[name="cadShapeKind"]:checked')?.value || 'w';
      const isW = kind === 'w';
      if (shapeSel) shapeSel.disabled = !isW;

      ['sfCompAnaAg', 'sfCompAnaRx', 'sfCompAnaRy', 'sfCompAnaLamF', 'sfCompAnaLamW'].forEach((id) => {
        const el = input(id);
        if (!el) return;
        el.readOnly = isW;
      });
    }

    function buildStiffnessRows() {
      const tb = pane.querySelector('#sfCompAnaStiffTbody');
      if (!tb || tb.dataset.sfBuilt === '1') return;
      tb.dataset.sfBuilt = '1';
      const subs = ['\u2081', '\u2082', '\u2083', '\u2084', '\u2085', '\u2086'];
      const opts = [
        ['fixed-pinned', 'Fixed-Pinned'],
        ['pinned-pinned', 'Pinned-Pinned'],
        ['fixed-fixed', 'Fixed-Fixed'],
        ['free-pinned', 'Free-Pinned'],
        ['fixed-free', 'Fixed-Free'],
      ];
      for (let idx = 0; idx < 12; idx++) {
        const axis = idx < 6 ? 'x' : 'y';
        const i = axis === 'x' ? idx : idx - 6;
        const label = `${axis === 'x' ? 'x' : 'y'}${subs[i]}`;
        const tr = document.createElement('tr');
        tr.className = 'sf-compAnaCritical__row';
        const sel = document.createElement('select');
        sel.className = 'sf-compAnaCritical__select cad-select';
        sel.setAttribute('aria-label', `Connection ${label}`);
        opts.forEach(([v, t]) => {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          sel.appendChild(o);
        });
        // Match client workbook: x-axis segments default fixed–pinned; y₁ fixed–pinned, y₂+ pinned–pinned.
        sel.value =
          axis === 'x' ? 'fixed-pinned' : i === 0 ? 'fixed-pinned' : 'pinned-pinned';
        const kSpan = document.createElement('span');
        kSpan.className = 'sf-compAnaCritical__input';
        const lSpan = document.createElement('span');
        lSpan.className = 'sf-compAnaCritical__input';
        const rSpan = document.createElement('span');
        rSpan.className = 'sf-compAnaCritical__input';
        const out = document.createElement('span');
        out.className = 'sf-compAnaCritical__output';
        const bar = document.createElement('div');
        bar.className = 'cad-bar';
        bar.setAttribute('role', 'presentation');
        const barTrack = document.createElement('div');
        barTrack.className = 'cad-barTrack';
        barTrack.appendChild(bar);
        const td0 = document.createElement('td');
        td0.className = 'cad-stiffEl';
        td0.textContent = label;
        const td1 = document.createElement('td');
        td1.appendChild(sel);
        const tdK = document.createElement('td');
        tdK.appendChild(kSpan);
        const tdL = document.createElement('td');
        tdL.appendChild(lSpan);
        const tdR = document.createElement('td');
        tdR.appendChild(rSpan);
        const tdOut = document.createElement('td');
        tdOut.className = 'cad-krCell';
        const outWrap = document.createElement('div');
        outWrap.className = 'cad-krOut';
        outWrap.appendChild(out);
        outWrap.appendChild(barTrack);
        tdOut.appendChild(outWrap);
        tr.appendChild(td0);
        tr.appendChild(td1);
        tr.appendChild(tdK);
        tr.appendChild(tdL);
        tr.appendChild(tdR);
        tr.appendChild(tdOut);
        tb.appendChild(tr);
      }
    }

    const applyShape = (rows) => {
      const kind = pane.querySelector('input[name="cadShapeKind"]:checked')?.value;
      if (kind && kind !== 'w') return;
      const row = getSelectedWRow(rows);
      if (!row) return;
      const agEl = input('sfCompAnaAg');
      const lamFEl = input('sfCompAnaLamF');
      const lamWEl = input('sfCompAnaLamW');
      const rxEl = input('sfCompAnaRx');
      const ryEl = input('sfCompAnaRy');
      if (agEl) {
        agEl.value = fmt(parseNumLike(row[COL.Ag]), 2);
        agEl.readOnly = true;
      }
      if (lamFEl) {
        lamFEl.value = fmt(parseNumLike(row[COL.lamF]), 2);
        lamFEl.readOnly = true;
      }
      if (lamWEl) {
        lamWEl.value = fmt(parseNumLike(row[COL.lamW]), 2);
        lamWEl.readOnly = true;
      }
      if (rxEl) {
        rxEl.value = fmt(parseNumLike(row[COL.rx]), 2);
        rxEl.readOnly = true;
      }
      if (ryEl) {
        ryEl.value = fmt(parseNumLike(row[COL.ry]), 2);
        ryEl.readOnly = true;
      }
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

    function updateCompactnessAndCapacity() {
      const Eksi = parseNum(input('sfCompAnaE')?.value);
      const Euse = Number.isFinite(Eksi) && Eksi > 0 ? Eksi : E_DEFAULT;
      const Fy = parseNum(input('sfCompAnaFy')?.value);
      const Ag = parseNum(input('sfCompAnaAg')?.value);
      const lamF = parseNum(input('sfCompAnaLamF')?.value);
      const lamW = parseNum(input('sfCompAnaLamW')?.value);
      const rx = parseNum(input('sfCompAnaRx')?.value);
      const ry = parseNum(input('sfCompAnaRy')?.value);

      const lim = compactLimits(Fy, Euse);
      // Strict workbook parity (COMPRESSION!G29, G31): binary "Compact" vs "Non-Compact" using λr only.
      const classify = (lam, { lr }, kind) => {
        if (!Number.isFinite(lam)) return `${kind.toUpperCase()} —`;
        if (lam < lr) return `COMPACT ${kind.toUpperCase()}`;
        return `NON-COMPACT ${kind.toUpperCase()}`;
      };

      const lamFDash = pane.querySelector('#sfCompDashLamF');
      const lamWDash = pane.querySelector('#sfCompDashLamW');
      if (lamFDash) lamFDash.textContent = Number.isFinite(lamF) ? fmt(lamF, 4) : '—';
      if (lamWDash) lamWDash.textContent = Number.isFinite(lamW) ? fmt(lamW, 4) : '—';

      const pillF = pane.querySelector('#sfCompDashPillFlange');
      const pillW = pane.querySelector('#sfCompDashPillWeb');
      if (lim && pillF) pillF.textContent = classify(lamF, lim.flange, 'flange');
      if (lim && pillW) pillW.textContent = classify(lamW, lim.web, 'web');

      const dashLim = (id, v) => {
        const el = pane.querySelector(`#${id}`);
        if (!el) return;
        el.textContent = lim && Number.isFinite(v) ? fmt(v, 8) : '—';
      };
      dashLim('sfCompDashLpF', lim?.flange?.lp);
      dashLim('sfCompDashLrF', lim?.flange?.lr);
      dashLim('sfCompDashLpW', lim?.web?.lp);
      dashLim('sfCompDashLrW', lim?.web?.lr);

      const xs = [1, 2, 3, 4, 5, 6].map((i) => parseNum(input(`sfCompAnaX${i}`)?.value) ?? 0);
      const ys = [1, 2, 3, 4, 5, 6].map((i) => parseNum(input(`sfCompAnaY${i}`)?.value) ?? 0);
      let gov = null;

      const rowEls = Array.from(pane.querySelectorAll('.sf-compAnaCritical__row'));
      if (rowEls.length > 0) {
        rowEls.forEach((rowEl, idx) => {
          const axis = idx < 6 ? 'x' : 'y';
          const i = axis === 'x' ? idx : idx - 6;
          const Lft = axis === 'x' ? xs[i] : ys[i];
          const sel = rowEl.querySelector('select.sf-compAnaCritical__select');
          if (sel && sel.options.length <= 1) {
            const prev = sel.value;
            sel.innerHTML = '';
            [
              ['fixed-pinned', 'Fixed-Pinned'],
              ['pinned-pinned', 'Pinned-Pinned'],
              ['fixed-fixed', 'Fixed-Fixed'],
              ['free-pinned', 'Free-Pinned'],
              ['fixed-free', 'Fixed-Free'],
            ].forEach(([v, t]) => {
              const o = document.createElement('option');
              o.value = v;
              o.textContent = t;
              sel.appendChild(o);
            });
            sel.value =
              prev && connK[prev]
                ? prev
                : axis === 'x'
                  ? 'fixed-pinned'
                  : i === 0
                    ? 'fixed-pinned'
                    : 'pinned-pinned';
          }
          const K = sel ? connK[sel.value] ?? 1 : 1;
          const Lin = Number.isFinite(Lft) ? Lft * 12 : null;
          const rUse = axis === 'x' ? rx : ry;
          const klr =
            Number.isFinite(Lin) && Lin > 0 && Number.isFinite(rUse) && rUse > 0 ? (K * Lin) / rUse : null;
          const inputs = rowEl.querySelectorAll('.sf-compAnaCritical__input');
          const out = rowEl.querySelector('.sf-compAnaCritical__output');
          if (inputs.length >= 3) {
            inputs[0].textContent = fmt(K, 2);
            inputs[1].textContent = Number.isFinite(Lin) ? fmt(Lin, 0) : '0';
            inputs[2].textContent = Number.isFinite(rUse) ? fmt(rUse, 2) : '—';
          }
          if (out) {
            out.classList.toggle('sf-compAnaCritical__output--empty', !(Number.isFinite(klr) && klr > 0));
            out.textContent = Number.isFinite(klr) && klr > 0 ? fmt(klr, 8) : '';
          }
          if (Number.isFinite(klr) && klr > 0) gov = gov == null ? klr : Math.max(gov, klr);
        });

        let maxKlr = 0;
        rowEls.forEach((rowEl) => {
          const out = rowEl.querySelector('.sf-compAnaCritical__output');
          const v = parseNum(out?.textContent);
          if (Number.isFinite(v) && v > 0) maxKlr = Math.max(maxKlr, v);
        });
        rowEls.forEach((rowEl) => {
          const out = rowEl.querySelector('.sf-compAnaCritical__output');
          const bar = rowEl.querySelector('.cad-bar');
          const v = parseNum(out?.textContent);
          if (bar && maxKlr > 0 && Number.isFinite(v) && v > 0)
            bar.style.width = `${Math.min(100, (v / maxKlr) * 100)}%`;
          else if (bar) bar.style.width = '0%';
        });
      } else {
        for (let idx = 0; idx < 12; idx++) {
          const axis = idx < 6 ? 'x' : 'y';
          const i = axis === 'x' ? idx : idx - 6;
          const Lft = axis === 'x' ? xs[i] : ys[i];
          const K = axis === 'x' ? connK['fixed-pinned'] : connK['pinned-pinned'];
          const Lin = Number.isFinite(Lft) ? Lft * 12 : null;
          const rUse = axis === 'x' ? rx : ry;
          const klr =
            Number.isFinite(Lin) && Lin > 0 && Number.isFinite(rUse) && rUse > 0 ? (K * Lin) / rUse : null;
          if (Number.isFinite(klr) && klr > 0) gov = gov == null ? klr : Math.max(gov, klr);
        }
      }

      const govTxt = Number.isFinite(gov) ? fmt(gov, 8) : '—';
      const govKlrEl = pane.querySelector('#sfCompDashGovKlr');
      if (govKlrEl) govKlrEl.textContent = govTxt;
      const govCompact = pane.querySelector('#sfCompDashGovKlrCompact');
      if (govCompact) govCompact.textContent = govTxt;

      const fe = Number.isFinite(gov) && gov > 0 ? (Math.PI ** 2 * Euse) / (gov ** 2) : null;
      const fcr = Number.isFinite(Fy) && Number.isFinite(fe) ? sfCompressionWorkbookFcr(Fy, fe) : null;
      const pn = Number.isFinite(fcr) && Number.isFinite(Ag) ? fcr * Ag : null;
      const method = String(input('sfCompAnaMethod')?.value || 'lrfd').toLowerCase();
      const cap = method === 'asd' ? (Number.isFinite(pn) ? pn / OMEGA_C : null) : (Number.isFinite(pn) ? PHI_C * pn : null);

      const feEl = pane.querySelector('#sfCompDashFe');
      const fcrEl = pane.querySelector('#sfCompDashFcr');
      const pnEl = pane.querySelector('#sfCompDashPn');
      if (feEl) feEl.textContent = fmt(fe, 8);
      if (fcrEl) fcrEl.textContent = fmt(fcr, 8);
      if (pnEl) pnEl.textContent = Number.isFinite(pn) ? fmt(pn, 2) : '—';

      const govHdr = pane.querySelector('#sfCompDashGovHdr');
      const puLab = pane.querySelector('#sfCompDashPuLab');
      if (govHdr)
        govHdr.textContent =
          method === 'asd'
            ? 'ALLOWABLE STRENGTH DESIGN (ASD)'
            : 'LOAD AND RESISTANCE FACTORED DESIGN (LRFD)';
      if (puLab)
        puLab.innerHTML =
          method === 'asd'
            ? 'P<sub>n</sub> / Ω<sub>c</sub> ='
            : 'φ<sub>c</sub>P<sub>n</sub> =';

      const puPill = pane.querySelector('#sfCompGovPu');
      if (puPill) puPill.textContent = Number.isFinite(cap) ? fmt(cap, 2) : '—';
    }

    const wire = (rows) => {
      shapeSel.addEventListener('change', () => {
        applyShape(rows);
        updateCompactnessAndCapacity();
      });
      steelEl?.addEventListener('change', () => {
        applySteelGrade();
        updateCompactnessAndCapacity();
      });
      pane.querySelectorAll('input[name="cadShapeKind"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          syncShapeKindUI();
          applyShape(rows);
          updateCompactnessAndCapacity();
        });
      });
      pane.querySelectorAll('input:not([name="cadShapeKind"]), select').forEach((el) => {
        el.addEventListener('input', updateCompactnessAndCapacity);
        el.addEventListener('change', updateCompactnessAndCapacity);
      });
    };

    applySteelGrade();
    loadWShapesFromCsv().then((rows) => {
      shapeSel.innerHTML = '';
      rows.forEach((r) => {
        const lab = String(r[COL.label] || '').trim();
        if (!lab) return;
        const opt = document.createElement('option');
        opt.value = lab;
        opt.textContent = lab.replace(/X/gi, '×');
        shapeSel.appendChild(opt);
      });
      const pref = rows.find((r) => String(r[COL.label] || '').trim().toUpperCase() === 'W40X503');
      if (pref) shapeSel.value = String(pref[COL.label] || '').trim();
      else if (rows[0]) shapeSel.value = String(rows[0][COL.label] || '').trim();
      buildStiffnessRows();
      syncShapeKindUI();
      applyShape(rows);
      wire(rows);
      updateCompactnessAndCapacity();
    });
  }

  /** DESIGN compression: visible inputs in `.compression-design-layout` share ids with hidden bridge fallbacks. */
  function normalizeSubscriptLabel(s) {
    const map = {
      '\u2080': '0',
      '\u2081': '1',
      '\u2082': '2',
      '\u2083': '3',
      '\u2084': '4',
      '\u2085': '5',
      '\u2086': '6',
      '\u2087': '7',
      '\u2088': '8',
      '\u2089': '9',
    };
    return String(s).replace(/[\u2080-\u2089]/g, (ch) => map[ch] ?? ch);
  }

  function parseLeadingNumber(txt) {
    const m = String(txt ?? '')
      .replace(/\u00A0/g, ' ')
      .trim()
      .match(/^([\d.,]+)/);
    if (!m) return NaN;
    return Number(m[1].replace(/,/g, ''));
  }

  function ensureCompressionDesignStaticBridge(pane) {
    const layout = pane.querySelector('.compression-design-layout');
    if (!layout) return null;
    let bridge = pane.querySelector('#sfCompDesStaticBridge');
    if (bridge) return bridge;

    bridge = document.createElement('div');
    bridge.id = 'sfCompDesStaticBridge';
    bridge.hidden = true;
    bridge.setAttribute('aria-hidden', 'true');
    pane.appendChild(bridge);

    const ensureInput = (id, attrs = {}) => {
      let el = pane.querySelector(`#${id}`) ?? bridge.querySelector(`#${id}`);
      if (el) return el;
      el = document.createElement('input');
      el.id = id;
      el.type = attrs.type || 'text';
      if (attrs.readOnly) el.readOnly = true;
      bridge.appendChild(el);
      return el;
    };
    const ensureSel = (id) => {
      let el = pane.querySelector(`#${id}`) ?? bridge.querySelector(`#${id}`);
      if (el) return el;
      el = document.createElement('select');
      el.id = id;
      bridge.appendChild(el);
      return el;
    };

    // Visible LRFD/ASD lives in compression.html (.method-pill__select); only bridge if absent (avoid duplicate id).
    if (!layout.querySelector('#sfCompDesMethod')) {
      const sel = ensureSel('sfCompDesMethod');
      sel.innerHTML = '<option value="lrfd">LRFD</option><option value="asd">ASD</option>';
    }

    ensureInput('sfCompDesDl', { type: 'number' });
    ensureInput('sfCompDesLl', { type: 'number' });
    ensureInput('sfCompDesFy', { type: 'number' });
    ensureInput('sfCompDesFu', { type: 'number' });

    ensureSel('sfCompDesSteel');

    ensureInput('sfCompDesComb12', { readOnly: true });
    ensureInput('sfCompDesComb14', { readOnly: true });
    ensureInput('sfCompDesCombSvc', { readOnly: true });
    ensureInput('sfCompDesPu', { readOnly: true });
    ensureInput('sfCompDesPa', { readOnly: true });

    ensureInput('sfCompDesGovKLx', { readOnly: true });
    ensureInput('sfCompDesGovKLy', { readOnly: true });
    ensureInput('sfCompDesGovKLyAsm', { readOnly: true });

    for (let i = 1; i <= 6; i++) {
      ensureInput(`sfCompDesX${i}`, { type: 'number' });
      ensureInput(`sfCompDesY${i}`, { type: 'number' });
      ensureInput(`sfCompDesSlKX${i}`, { type: 'number' });
      ensureInput(`sfCompDesSlLX${i}`, { type: 'number' });
      ensureInput(`sfCompDesSlKLX${i}`, { readOnly: true });
      ensureInput(`sfCompDesSlKY${i}`, { type: 'number' });
      ensureInput(`sfCompDesSlLY${i}`, { type: 'number' });
      ensureInput(`sfCompDesSlKLY${i}`, { readOnly: true });
    }

    for (let i = 1; i <= 4; i++) {
      ensureInput(`sfCompDesSafeSec${i}`, { readOnly: true });
      ensureInput(`sfCompDesSafeWt${i}`, { readOnly: true });
      ensureInput(`sfCompDesSafePu${i}`, { readOnly: true });
      ensureInput(`sfCompDesSafeRm${i}`, { readOnly: true });
    }
    ensureInput('sfCompDesLightest', { readOnly: true });

    const CONN_MAP = {
      'fixed-pinned': 0.8,
      'pinned-pinned': 1,
      'fixed-fixed': 0.65,
      'free-pinned': 2,
      'fixed-free': 1.2,
    };

    const normConn = (s) =>
      String(s ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/–|—/g, '-');

    const hasVisibleLoads = !!layout.querySelector('#sfCompDesDl');
    const hasVisibleSlenderK = !!layout.querySelector('#sfCompDesSlKX1');

    if (!hasVisibleLoads) {
      const leftPanels = layout.querySelectorAll('.left-panel .parameter-card');
      const rowEls = leftPanels[0]?.querySelectorAll('tbody tr') ?? [];

      rowEls.forEach((tr) => {
        const th = normalizeSubscriptLabel(tr.querySelector('th')?.textContent ?? '');
        const td = tr.querySelector('td');
        const raw = td?.textContent ?? '';
        const n = parseLeadingNumber(raw);
        if (/dead\s*load/i.test(th)) {
          if (Number.isFinite(n)) bridge.querySelector('#sfCompDesDl').value = String(n);
        } else if (/live\s*load/i.test(th)) {
          if (Number.isFinite(n)) bridge.querySelector('#sfCompDesLl').value = String(n);
        } else if (/length\s+x/i.test(th)) {
          const d = th.match(/x\s*(\d+)/i);
          const idx = d ? Number(d[1]) : NaN;
          if (idx >= 1 && idx <= 6 && Number.isFinite(n)) {
            const xEl = bridge.querySelector(`#sfCompDesX${idx}`);
            if (xEl) xEl.value = String(n);
          }
        } else if (/length\s+y/i.test(th)) {
          const d = th.match(/y\s*(\d+)/i);
          const idx = d ? Number(d[1]) : NaN;
          if (idx >= 1 && idx <= 6 && Number.isFinite(n)) {
            const yEl = bridge.querySelector(`#sfCompDesY${idx}`);
            if (yEl) yEl.value = String(n);
          }
        }
      });

      const steelRows = leftPanels[1]?.querySelectorAll('tbody tr') ?? [];
      steelRows.forEach((tr) => {
        const th = (tr.querySelector('th')?.textContent ?? '').trim();
        const td = tr.querySelector('td')?.textContent ?? '';
        const n = parseLeadingNumber(td);
        if (/^\s*f\s*y/i.test(th) || /F\s*y/i.test(th)) {
          if (Number.isFinite(n)) bridge.querySelector('#sfCompDesFy').value = String(n);
        }
        if (/^\s*f\s*u/i.test(th) || /F\s*u/i.test(th)) {
          if (Number.isFinite(n)) bridge.querySelector('#sfCompDesFu').value = String(n);
        }
      });
    }

    if (!hasVisibleSlenderK) {
      const ratioRows = layout.querySelectorAll('.ratio-table tbody tr');
      ratioRows.forEach((tr) => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 5) return;
        const elLab = normalizeSubscriptLabel(cells[0].textContent ?? '').trim();
        const conn = normConn(cells[1].textContent);
        const kVal = parseLeadingNumber(cells[2].textContent);
        const LVal = parseLeadingNumber(cells[3].textContent);

        const xm = elLab.match(/^x\s*(\d+)/i);
        const ym = elLab.match(/^y\s*(\d+)/i);
        let axis = '';
        let idx = NaN;
        if (xm) {
          axis = 'X';
          idx = Number(xm[1]);
        } else if (ym) {
          axis = 'Y';
          idx = Number(ym[1]);
        }
        if (!(axis && idx >= 1 && idx <= 6)) return;

        const kNorm = CONN_MAP[conn];
        const kUse = Number.isFinite(kVal) ? kVal : kNorm;
        const kEl = bridge.querySelector(`#sfCompDesSlK${axis}${idx}`);
        if (kEl && Number.isFinite(kUse)) kEl.value = String(kUse);
        const parLen =
          axis === 'X'
            ? bridge.querySelector(`#sfCompDesX${idx}`)
            : bridge.querySelector(`#sfCompDesY${idx}`);
        if (Number.isFinite(LVal) && parLen && !String(parLen.value || '').trim()) {
          parLen.value = String(LVal);
        }
      });
    }

    const methCtl = layout.querySelector('#sfCompDesMethod') || bridge.querySelector('#sfCompDesMethod');
    if (methCtl) methCtl.value = 'lrfd';

    return bridge;
  }

  function mirrorCompressionDesignStaticLayout(pane, input) {
    const layout = pane.querySelector('.compression-design-layout');
    if (!layout || !pane.querySelector('#sfCompDesStaticBridge')) return;

    const g = (id) => input(id)?.value ?? '';

    const setLastTd = (tableSel, rowIdx, text) => {
      const tr = layout.querySelector(`${tableSel} tbody tr:nth-child(${rowIdx})`);
      const td = tr?.querySelector('td:last-child');
      if (td) td.textContent = text;
    };

    const fmtCell = (val) => (!val || val === '—' ? '—' : `${val} kips`);
    setLastTd('.load-table', 1, fmtCell(g('sfCompDesComb12')));
    setLastTd('.load-table', 2, fmtCell(g('sfCompDesComb14')));
    setLastTd('.load-table', 3, fmtCell(g('sfCompDesCombSvc')));

    const sum = layout.querySelector('.summary-card .summary-value');
    if (sum) {
      const method = String(input('sfCompDesMethod')?.value || 'lrfd').toLowerCase();
      const v = method === 'asd' ? g('sfCompDesPa') : g('sfCompDesPu');
      sum.textContent = !v || v === '—' ? '—' : `${v} kips`;
    }

    const ratioBody = layout.querySelector('.ratio-table tbody');
    if (ratioBody) {
      const rows = ratioBody.querySelectorAll('tr');
      rows.forEach((tr) => {
        const labCell = tr.querySelector('th') ?? tr.querySelector('td');
        const lab = normalizeSubscriptLabel(labCell?.textContent ?? '').trim();
        const xm = lab.match(/^x\s*(\d+)/i);
        const ym = lab.match(/^y\s*(\d+)/i);
        let hid = '';
        if (xm) hid = `sfCompDesSlKLX${xm[1]}`;
        else if (ym) hid = `sfCompDesSlKLY${ym[1]}`;
        if (!hid) return;
        const kl = g(hid);
        const tds = tr.querySelectorAll('td');
        const klTd = tds[tds.length - 1];
        if (klTd && kl !== '') klTd.textContent = kl;
      });
    }

    const secBody = layout.querySelector('.section-table tbody');
    if (secBody) {
      const rows = secBody.querySelectorAll('tr');
      for (let i = 0; i < 4; i++) {
        const tr = rows[i];
        if (!tr) break;
        const tds = tr.querySelectorAll('td');
        const sec = g(`sfCompDesSafeSec${i + 1}`);
        const wt = g(`sfCompDesSafeWt${i + 1}`);
        const pu = g(`sfCompDesSafePu${i + 1}`);
        const rm = g(`sfCompDesSafeRm${i + 1}`);
        if (tds.length >= 4) {
          tds[0].textContent = sec || '—';
          tds[1].textContent = wt || '—';
          tds[2].textContent = pu && pu !== 'NO SECTION' ? `${pu} kips` : pu || '—';
          tds[3].textContent = rm || '—';
        }
      }
    }

    const light = layout.querySelector('.result-strip .result-code');
    if (light) light.textContent = g('sfCompDesLightest') || '—';
  }

  function attachCompressionDesignPanel(root) {
    const pane = root.querySelector('.sf-comp--compression .sf-comp__mode[data-comp-mode-pane="design"]');
    if (!pane) return;

    ensureCompressionDesignStaticBridge(pane);

    const input = (id) => pane.querySelector(`#${id}`);
    const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
    const COL = { type: 0, label: 2, weightLbFt: 4, Ag: 5, rx: 31, ry: 37 };

    function parseCsvLine(line) {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '\"' && line[i + 1] === '\"') {
            cur += '\"';
            i++;
          } else if (c === '\"') q = false;
          else cur += c;
        } else if (c === '\"') q = true;
        else if (c === ',') {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out;
    }

    function parseNumLike(v) {
      if (v == null) return null;
      const s0 = String(v).replace(/\u00A0/g, ' ').trim();
      if (!s0 || s0 === '—' || s0 === '–' || s0 === '-') return null;
      const s = s0.replace(/\s+/g, ' ');
      if (/^-?\d+\/\d+$/.test(s)) {
        const [a, b] = s.split('/').map(Number);
        return b ? a / b : null;
      }
      if (/^-?\d+\s+\d+\/\d+$/.test(s)) {
        const [whole, frac] = s.split(' ');
        const [a, b] = frac.split('/').map(Number);
        if (!b) return null;
        return Number(whole) + a / b;
      }
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }

    const fmt = (v, d = 2) => {
      if (!Number.isFinite(v)) return '';
      return v.toFixed(d).replace(/\.?0+$/, '');
    };

    function loadWShapesFromCsv() {
      // Share cache between compression design/analysis without cross-function refactors.
      if (!window.SteelForge) window.SteelForge = {};
      if (window.SteelForge.__sfWShapesCsvPromise) return window.SteelForge.__sfWShapesCsvPromise;
      window.SteelForge.__sfWShapesCsvPromise = fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((txt) => {
          const lines = txt.split(/\r?\n/);
          const rows = [];
          for (let i = 4; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const r = parseCsvLine(line);
            if (String(r[COL.type] || '').trim() !== 'W') continue;
            const lab = String(r[COL.label] || '').trim();
            if (!lab) continue;
            rows.push(r);
          }
          return rows;
        })
        .catch(() => {
          window.SteelForge.__sfWShapesCsvPromise = null;
          return [];
        });
      return window.SteelForge.__sfWShapesCsvPromise;
    }

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
      const kid = sel.dataset?.sfKFor;
      if (!kid) return;
      const kv = SF_COMP_DES_CONN_K[sel.value];
      if (kv === undefined) return;
      const kEl = input(kid);
      if (kEl) kEl.value = String(kv);
    };

    /** Populate connection dropdowns (analysis-aligned); `data-sf-k-for` points at the K numeric input id. */
    const wireCompressionDesignConnSelects = () => {
      const pairs = [
        ['fixed-pinned', 'Fixed-Pinned'],
        ['pinned-pinned', 'Pinned-Pinned'],
        ['fixed-fixed', 'Fixed-Fixed'],
        ['free-pinned', 'Free-Pinned'],
        ['fixed-free', 'Fixed-Free'],
      ];
      pane.querySelectorAll('select.sf-compDes__connSelect[data-sf-k-for]').forEach((sel) => {
        if (sel.options.length > 1) return;
        sel.innerHTML = '';
        pairs.forEach(([v, t]) => {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          sel.appendChild(o);
        });
      });
    };

    const initCompressionDesignConnDefaults = () => {
      pane.querySelectorAll('select.sf-compDes__connSelect[data-sf-k-for]').forEach((sel) => {
        if (!sel.value || !SF_COMP_DES_CONN_K[sel.value]) {
          const ym = sel.id.match(/^sfCompDesConnY(\d)$/i);
          if (ym) {
            const j = Number(ym[1]);
            sel.value = j === 1 ? 'fixed-pinned' : 'pinned-pinned';
          } else {
            sel.value = 'fixed-pinned';
          }
        }
        applyConnKFromSelect(sel);
      });
    };

    const syncSlenderLFromParams = () => {
      for (let i = 1; i <= 6; i++) {
        const xi = input(`sfCompDesX${i}`);
        const lx = input(`sfCompDesSlLX${i}`);
        if (xi && lx) lx.value = xi.value;
        const yi = input(`sfCompDesY${i}`);
        const ly = input(`sfCompDesSlLY${i}`);
        if (yi && ly) ly.value = yi.value;
      }
    };

    const updateGoverningKLFromSlender = () => {
      let maxX = NaN;
      let maxY = NaN;
      for (let i = 1; i <= 6; i++) {
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
      // Reference: yellow pill is "Assuming KLy governed" → show KLy when present.
      if (govEl) govEl.value = Number.isFinite(maxY) ? fmtKlLocal(maxY) : '';
    };

    const updateSlenderKL = () => {
      syncSlenderLFromParams();
      for (const ax of ['X', 'Y']) {
        for (let i = 1; i <= 6; i++) {
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

    const E_DEFAULT = 29000;
    const PHI_C = 0.9;
    const OMEGA_C = 1.67;

    const setSafeRow = (i, sec, wt, cap, remark) => {
      const secEl = input(`sfCompDesSafeSec${i}`);
      const wtEl = input(`sfCompDesSafeWt${i}`);
      const puEl = input(`sfCompDesSafePu${i}`);
      const rmEl = input(`sfCompDesSafeRm${i}`);
      if (!secEl || !wtEl || !puEl || !rmEl) return;
      if (!sec) {
        secEl.value = 'NO SECTION';
        wtEl.value = 'NO SECTION';
        puEl.value = 'NO SECTION';
        rmEl.value = 'NO SECTION';
        return;
      }
      secEl.value = sec;
      wtEl.value = fmt(wt, 0);
      puEl.value = fmt(cap, 2);
      rmEl.value = remark || 'SAFE';
    };

    /** Client layout: four rows fixed as W14 → W12 → W10 → W8 (lightest safe in each family). */
    const SAFE_SECTION_SERIES_ORDER = ['W14', 'W12', 'W10', 'W8'];

    function depthSeriesFromWLabel(lab) {
      const u = String(lab ?? '')
        .trim()
        .toUpperCase()
        .replace(/\u00D7/g, 'X')
        .replace(/\s+/g, '');
      const m = u.match(/^W(14|12|10|8)X/i);
      return m ? `W${m[1]}` : null;
    }

    const updateSafeSections = (wRows) => {
      const methodEl = input('sfCompDesMethod');
      const isLRFD = methodEl?.value !== 'asd';
      const Fy = parseNum(input('sfCompDesFy')?.value);
      const Pu = parseNum(input('sfCompDesPu')?.value);
      const Pa = parseNum(input('sfCompDesPa')?.value);

      const ltEl = input('sfCompDesLightest');
      const clearLightest = () => {
        if (ltEl) ltEl.value = '';
      };

      // Governing KL in ft from the table.
      const KLx = parseNum(input('sfCompDesGovKLx')?.value);
      const KLy = parseNum(input('sfCompDesGovKLy')?.value);
      const KLxIn = Number.isFinite(KLx) ? KLx * 12 : NaN;
      const KLyIn = Number.isFinite(KLy) ? KLy * 12 : NaN;

      const demand = isLRFD ? Pu : Pa;
      const demandOk = Number.isFinite(demand) && demand > 0;

      const candidates = [];
      if (!Number.isFinite(Fy) || Fy <= 0 || !demandOk || wRows.length === 0) {
        for (let i = 1; i <= 4; i++) setSafeRow(i, null);
        clearLightest();
        return;
      }

      for (const r of wRows) {
        const lab = String(r[COL.label] || '').trim().toUpperCase();
        const wt = parseNumLike(r[COL.weightLbFt]);
        const Ag = parseNumLike(r[COL.Ag]);
        const rx = parseNumLike(r[COL.rx]);
        const ry = parseNumLike(r[COL.ry]);
        if (!lab || ![wt, Ag, rx, ry].every((v) => Number.isFinite(v) && v > 0)) continue;

        const klrx = Number.isFinite(KLxIn) && KLxIn > 0 ? KLxIn / rx : NaN;
        const klry = Number.isFinite(KLyIn) && KLyIn > 0 ? KLyIn / ry : NaN;
        const KLr = Number.isFinite(klrx) && Number.isFinite(klry) ? Math.max(klrx, klry) : Number.isFinite(klry) ? klry : klrx;
        if (!Number.isFinite(KLr) || KLr <= 0) continue;

        const Fe = (Math.PI ** 2 * E_DEFAULT) / (KLr ** 2);
        const Fcr = sfCompressionWorkbookFcr(Fy, Fe);
        if (!Number.isFinite(Fcr) || Fcr <= 0) continue;
        const Pn = Fcr * Ag; // kips
        const cap = isLRFD ? PHI_C * Pn : Pn / OMEGA_C;
        const ok = cap >= demand;
        if (!ok) continue;
        candidates.push({ lab, wt, cap });
      }

      let lightestLab = null;
      let lightestWt = Infinity;
      for (const c of candidates) {
        if (c.wt < lightestWt) {
          lightestWt = c.wt;
          lightestLab = c.lab;
        }
      }
      if (ltEl) ltEl.value = lightestLab ? String(lightestLab).toUpperCase() : '';

      const bySeries = new Map();
      SAFE_SECTION_SERIES_ORDER.forEach((s) => bySeries.set(s, []));
      for (const c of candidates) {
        const series = depthSeriesFromWLabel(c.lab);
        if (series && bySeries.has(series)) bySeries.get(series).push(c);
      }

      SAFE_SECTION_SERIES_ORDER.forEach((series, si) => {
        const arr = bySeries.get(series) || [];
        arr.sort((a, b) => a.wt - b.wt || b.cap - a.cap || a.lab.localeCompare(b.lab));
        const pick = arr[0];
        const i = si + 1;
        if (!pick) setSafeRow(i, null);
        else setSafeRow(i, pick.lab, pick.wt, pick.cap, 'SAFE');
      });
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
      // Safe sections depend on demand + governing lengths; computed when CSV is ready.
      loadWShapesFromCsv().then((rows) => {
        updateSafeSections(rows);
        mirrorCompressionDesignStaticLayout(pane, input);
      });
    };

    const steelEl = input('sfCompDesSteel');
    const fyEl = input('sfCompDesFy');
    const fuEl = input('sfCompDesFu');
    populateStructuralSteelGradeSelect(steelEl, getPreferredStructuralSteelGradeId() || 'a992');

    const syncSteel = () => {
      if (!steelEl || steelEl.value === 'custom') {
        if (fyEl) fyEl.readOnly = false;
        if (fuEl) fuEl.readOnly = false;
        return;
      }
      const g = steelPropsFromStructuralGradeSelect(steelEl.value);
      if (g && fyEl) {
        fyEl.value = String(g.fy);
        fyEl.readOnly = true;
      }
      if (g && fuEl) {
        fuEl.value = String(g.fu);
        fuEl.readOnly = true;
      }
    };

    wireCompressionDesignConnSelects();
    initCompressionDesignConnDefaults();

    pane.querySelectorAll('input:not([readonly]), select').forEach((el) => {
      el.addEventListener('input', updateDemand);
      el.addEventListener('change', () => {
        if (el.matches?.('select.sf-compDes__connSelect')) applyConnKFromSelect(el);
        syncSteel();
        updateDemand();
      });
    });

    syncSteel();
    updateDemand();
    loadWShapesFromCsv().then((rows) => {
      updateSafeSections(rows);
      mirrorCompressionDesignStaticLayout(pane, input);
    });
  }

  function attachModeToggle(root, { topic = 'COMPRESSION' } = {}) {
    const nav = root.querySelector('.sf-comp__modeNav');
    if (!nav) return;

    const buttons = Array.from(nav.querySelectorAll('button.sf-comp__modeBtn'));
    const panes = Array.from(root.querySelectorAll('.sf-comp__mode'));
    const indicator = root.querySelector('.sf-comp__indicator span');

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
    };

    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('button.sf-comp__modeBtn');
      if (!btn || !nav.contains(btn)) return;
      const mode = btn.getAttribute('data-comp-mode');
      if (!mode) return;
      setMode(mode);
    });

    // default to analysis (as requested)
    setMode('analysis');
  }

  /** After SPA navigation: switch analysis/design tab when hash uses `#page/design`. */
  window.SteelForge.activateModuleMode = (panelRoot, mode) => {
    const want = mode === 'design' ? 'design' : 'analysis';
    const comp = panelRoot?.querySelector?.('.sf-comp');
    if (!comp) return;
    const nav = comp.querySelector('.sf-comp__modeNav');
    if (!nav) return;
    const btn = nav.querySelector(`button.sf-comp__modeBtn[data-comp-mode="${want}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
  };

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
    if (window.SteelForge?.initBendingAnalysis) {
      window.SteelForge.initBendingAnalysis(panelRoot ?? document);
    }
    if (window.SteelForge?.initBendingDesign) {
      window.SteelForge.initBendingDesign(panelRoot ?? document);
    }
  };

  window.SteelForge.initTension = (panelRoot) => {
    const compRoot =
      panelRoot?.querySelector?.('.sf-comp.sf-comp--tension') ??
      panelRoot?.querySelector?.('.sf-comp') ??
      panelRoot ??
      document;
    attachModeToggle(compRoot, { topic: 'TENSION' });
    if (window.SteelForge?.initTensionAnalysis) {
      window.SteelForge.initTensionAnalysis(panelRoot ?? document);
    }
    if (
      window.SteelForge?.initTensionDesign &&
      compRoot.querySelector('.sf-comp__mode[data-comp-mode-pane="design"]')
    ) {
      window.SteelForge.initTensionDesign(panelRoot ?? document);
    }
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

  /** Limiting slenderness (λ, 2.24√(E/Fy), etc.) — compact display for UI tables */
  function fmtShearLimit(v) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(3).replace(/\.?0+$/, '');
  }

  /**
   * Client workbook / spec: λ_w = h/t_w. Sequential limits:
   * A = 2.24√(E/Fy), B = 1.10√(k_v E/Fy), C = 1.37√(k_v E/Fy).
   * If A > λ → cond 1; else if B > λ → cond 2; else if C > λ → cond 3; else cond 4.
   * Nominal V_n = 0.6 F_y A_w C_v with C_v and resistance factors per condition.
   */
  function shearClientShearState(lambda, fy, E, kv) {
    if (![lambda, fy, E, kv].every((x) => Number.isFinite(x) && x > 0)) return null;
    const limA = 2.24 * Math.sqrt(E / fy);
    const limB = 1.1 * Math.sqrt((kv * E) / fy);
    const limC = 1.37 * Math.sqrt((kv * E) / fy);

    if (limA > lambda) {
      return { condition: 1, cv: 1, phiV: 1, omegaV: 1.5, limA, limB, limC };
    }
    if (limB > lambda) {
      return { condition: 2, cv: 1, phiV: 0.9, omegaV: 1.67, limA, limB, limC };
    }
    if (limC > lambda) {
      return { condition: 3, cv: limB / lambda, phiV: 0.9, omegaV: 1.67, limA, limB, limC };
    }
    const cv = (1.51 * kv * E) / (fy * lambda * lambda);
    return { condition: 4, cv, phiV: 0.9, omegaV: 1.67, limA, limB, limC };
  }

  function calcShearCv(lambda, lambdaP, lambdaR, Fy, E, kv) {
    const st = shearClientShearState(lambda, Fy, E, kv);
    return st ? st.cv : null;
  }

  function webShearConditionLabel(condition) {
    if (condition === 1) return 'CONDITION 1 (Cv = 1, φv = 1)';
    if (condition === 2) return 'CONDITION 2 (Cv = 1, φv = 0.9)';
    if (condition === 3) return 'CONDITION 3 (inelastic shear buckling)';
    if (condition === 4) return 'CONDITION 4 (elastic shear buckling)';
    return '';
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

  function getPreferredStructuralSteelGradeId() {
    const activeId = window.SteelForge?.activeStructuralSteelGrade?.id;
    return activeId || 'a992';
  }

  function attachShearAnalysis(root) {
    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="analysis"]');
    if (!pane) return;

    const shapes = window.SteelForgeShearShapes ?? [];

    const input = (id) => pane.querySelector(`#${id}`);
    const out = (id) => pane.querySelector(`#${id}`);
    const num = (id) => parseNum(input(id)?.value);

    const methodEl = input('sfShearAnaMethod');
    const webCondEl = input('sfShearAnaWebCond');
    const shapeSel = input('sfShearAnaShape');
    const steelEl = input('sfShearAnaSteel');

    populateStructuralSteelGradeSelect(steelEl, getPreferredStructuralSteelGradeId());

    const fmtGeom = (v, maxDecimals = 4) => {
      if (!Number.isFinite(v)) return '';
      const s = v.toFixed(maxDecimals).replace(/\.?0+$/, '');
      return s === '' ? '0' : s;
    };

    const shapeAw = (s) => (s && (s.Aw ?? s.aw)) ?? null;
    const shapeAg = (s) => (s && (s.Ag ?? s.ag ?? s.area)) ?? null;
    const shapeLambdaW = (s) => (s && (s.lambdaW ?? s.lambda_w)) ?? null;
    const shapeLambdaF = (s) => (s && (s.lambdaF ?? s.lambda_f)) ?? null;

    const setManualGeometryMode = (isManual) => {
      const hEl = input('sfShearAnaH');
      const awEl = input('sfShearAnaAw');
      const lamEl = input('sfShearAnaLambda');
      const asEl = input('sfShearAnaAs');
      if (hEl) hEl.readOnly = !isManual;
      if (awEl) awEl.readOnly = !isManual;
      if (lamEl) {
        lamEl.readOnly = !isManual;
        lamEl.title = isManual
          ? 'Web slenderness λ_w = h/t_w — enter directly, or leave blank when h, d, and A_w match rolled-shape conventions'
          : 'Web slenderness h/t_w from steel catalog';
      }
      if (asEl) {
        asEl.readOnly = !isManual;
        asEl.title = isManual
          ? 'Optional gross area A (in²) — not used in V_n = 0.6 F_y A_w C_v'
          : 'Gross area A from Steel Sections catalog (in²)';
      }
    };

    const applySteelGradeProps = () => {
      const fyEl = input('sfShearAnaFy');
      const fuEl = input('sfShearAnaFu');
      const chipEl = out('sfShearAnaFyChip');
      if (!steelEl || !fyEl) return;
      if (steelEl.value === 'custom') {
        if (fuEl) {
          fuEl.value = '';
          fuEl.readOnly = false;
        }
        fyEl.readOnly = false;
        if (chipEl) chipEl.textContent = '—';
        return;
      }
      const g = steelPropsFromStructuralGradeSelect(steelEl.value);
      if (g) {
        fyEl.value = String(g.fy);
        fyEl.readOnly = true;
        if (fuEl) {
          fuEl.value = String(g.fu);
          fuEl.readOnly = true;
        }
        if (chipEl) chipEl.textContent = String(g.fy);
      }
    };

    const applyCatalogDefaults = () => {
      const Eel = input('sfShearAnaE');
      if (Eel) Eel.value = '29000';
    };

    const normalizeInputs = () => {
      const norm = (id, d = 4, min = 0) => {
        const el = input(id);
        if (!el) return;
        const v = parseNum(el.value);
        if (!Number.isFinite(v)) return;
        el.value = fmtNum(Math.max(min, v), d);
      };
      norm('sfShearAnaA', 4, 0);
      norm('sfShearAnaH', 4, 0);
      norm('sfShearAnaFy', 3, 0);
      norm('sfShearAnaFu', 3, 0);
      norm('sfShearAnaAw', 4, 0);
      norm('sfShearAnaAs', 4, 0);
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
      const tw = Number.isFinite(s.tw) ? s.tw : null;
      const d = Number.isFinite(s.d) ? s.d : null;
      const lamVal = shapeLambdaW(s);
      const awCatalog = shapeAw(s);

      /** Client spec: h = λ_w·t_w , A_w = t_w·d (Steel Sections V16 / selection CSV). */
      let hGeom = null;
      let awGeom = null;
      if (tw != null && lamVal != null) hGeom = lamVal * tw;
      else if (Number.isFinite(s.h)) hGeom = s.h;
      if (tw != null && d != null) awGeom = tw * d;
      else if (awCatalog != null) awGeom = awCatalog;

      const hEl = input('sfShearAnaH');
      const lamEl = input('sfShearAnaLambda');
      const lamFEl = input('sfShearAnaLambdaF');
      const awEl = input('sfShearAnaAw');
      const dEl = input('sfShearAnaD');
      const asEl = input('sfShearAnaAs');
      const lamFVal = shapeLambdaF(s);
      const agVal = shapeAg(s);

      if (hEl) hEl.value = hGeom != null ? fmtGeom(hGeom, 4) : '';
      if (lamEl && lamVal != null) lamEl.value = fmtGeom(lamVal, 4);
      if (lamFEl) lamFEl.value = lamFVal != null ? fmtGeom(lamFVal, 4) : '';
      if (awEl) awEl.value = awGeom != null ? fmtGeom(awGeom, 4) : '';
      if (dEl) dEl.value = d != null ? fmtGeom(d, 4) : '';
      if (asEl) asEl.value = agVal != null && Number.isFinite(agVal) ? fmtGeom(agVal, 4) : '';

      setManualGeometryMode(false);
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

    const applyDefaultShapeOnLoad = () => {
      if (!shapeSel || !shapes.length) return;
      // Prefer workbook shear reference section when present (see reference CSV W12×40).
      const pref =
        shapes.find((s) => String(s.name || '').trim().toUpperCase() === 'W12X40') ??
        shapes.find((s) => String(s.name || '').trim().toUpperCase() === 'W44X335');
      const fallback = shapeNamesSorted[0] ?? null;
      const chosen = pref ?? fallback;
      if (!chosen) return;
      shapeSel.value = chosen.name;
      applyShape(chosen.name);
    };

    const updateImageState = () => {
      const stiffened = (webCondEl?.value || 'stiffened') === 'stiffened';
      const plainImg = pane.querySelector('.sf-shearAna__imgEl--plain');
      const stiffImg = pane.querySelector('.sf-shearAna__imgEl--stiffened');
      if (plainImg) plainImg.style.opacity = stiffened ? '0.35' : '1';
      if (stiffImg) stiffImg.style.opacity = stiffened ? '1' : '0.35';
    };

    const update = () => {
      normalizeInputs();
      syncWebSpacingAndKv();
      const fy = num('sfShearAnaFy');
      const aw = num('sfShearAnaAw');
      const hGeom = num('sfShearAnaH');
      const lamEl = input('sfShearAnaLambda');
      const typedLambda = parseNum(lamEl?.value);
      const dGeom = num('sfShearAnaD');
      let lambdaWeb = null;
      if (Number.isFinite(typedLambda) && typedLambda > 0) {
        lambdaWeb = typedLambda;
      } else if (
        Number.isFinite(hGeom) &&
        hGeom > 0 &&
        Number.isFinite(aw) &&
        aw > 0 &&
        Number.isFinite(dGeom) &&
        dGeom > 0
      ) {
        // Rolled W-shape convention in catalog: A_w ≈ d·t_w and λ_w = h/t_w ⇒ λ_w = h·d/A_w.
        lambdaWeb = (hGeom * dGeom) / aw;
        if (lamEl && lamEl.readOnly) lamEl.value = fmtGeom(lambdaWeb, 6);
      }
      const kv = num('sfShearAnaKv');
      const E = num('sfShearAnaE');

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

      const shearSt =
        lambdaWeb != null && Number.isFinite(fy) && Number.isFinite(E) && Number.isFinite(kv)
          ? shearClientShearState(lambdaWeb, fy, E, kv)
          : null;
      const cv = shearSt ? shearSt.cv : null;
      const Vn =
        Number.isFinite(cv) && Number.isFinite(fy) && Number.isFinite(aw) ? 0.6 * fy * aw * cv : null;
      const phiVn =
        Number.isFinite(Vn) && shearSt ? shearSt.phiV * Vn : null;
      const asdCap = Number.isFinite(Vn) && shearSt ? Vn / shearSt.omegaV : null;

      const isASD = (methodEl?.value || 'lrfd') === 'asd';
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
      if (phiEl) phiEl.textContent = shearSt ? fmtNum(shearSt.phiV, 3) : '—';
      if (omgEl) omgEl.textContent = shearSt ? fmtNum(shearSt.omegaV, 2) : '—';
      if (vnEl) vnEl.textContent = fmtNum(Vn, 2);
      if (b1) b1.textContent = fmtShearLimit(lim224);
      if (b2) b2.textContent = fmtShearLimit(lambdaP);
      if (b3) b3.textContent = fmtShearLimit(lambdaR);

      const verdictEl = out('sfShearAnaVerdictPill');
      if (verdictEl) {
        if (!shearSt || !Number.isFinite(lambdaWeb)) verdictEl.textContent = '—';
        else verdictEl.textContent = webShearConditionLabel(shearSt.condition);
      }

      const fyChip = out('sfShearAnaFyChip');
      if (fyChip) {
        if (Number.isFinite(fy) && fy > 0) fyChip.textContent = String(Math.round(fy));
        else fyChip.textContent = '—';
      }

      const heroLead = out('sfShearAnaCapHeroLead');
      const heroNum = out('sfShearAnaCapHeroNum');
      if (heroLead && heroNum) {
        heroLead.innerHTML = isASD ? 'V<sub>n</sub>/Ω =' : 'ϕV<sub>n</sub> =';
        heroNum.textContent = fmtNum(isASD ? asdCap : phiVn, 2);
      }

      const remarksEl = out('sfShearAnaRemarks');
      const webCls = shearSt ? webShearConditionLabel(shearSt.condition) : '';
      if (remarksEl) {
        const cap = isASD ? capacityASD : capacityLRFD;
        if (!Number.isFinite(cap)) {
          remarksEl.textContent = webCls
            ? `${webCls}. Enter Aw, h (or λ), E, Fy.`
            : 'Enter section geometry and material.';
        } else {
          remarksEl.textContent = webCls ? `${webCls}.` : 'Shear capacity computed.';
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
          shearCondition: shearSt?.condition,
          Cv: cv,
          Vn,
          phiVn,
          VnOverOmega: asdCap,
          mode: isASD ? 'ASD' : 'LRFD',
        });
      }
    };

    pane.querySelectorAll('input, select').forEach((el) => {
      if (el === steelEl) return;
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
          const dEl = input('sfShearAnaD');
          const asEl = input('sfShearAnaAs');
          if (lamFEl) lamFEl.value = '';
          if (dEl) dEl.value = '';
          if (asEl) asEl.value = '';
          setManualGeometryMode(true);
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
    if (E0) E0.readOnly = true;
    if (kv0) {
      kv0.readOnly = true;
      kv0.setAttribute('aria-label', 'Web shear coefficient k_v');
    }
    setManualGeometryMode(!(shapeSel?.value));
    syncWebSpacingAndKv();
    if (shapeSel?.value) applyShape(shapeSel.value);
    else applyDefaultShapeOnLoad();

    window.addEventListener('sf:steel-grade-change', () => {
      const pid = window.SteelForge?.activeStructuralSteelGrade?.id ?? getPreferredStructuralSteelGradeId();
      populateStructuralSteelGradeSelect(steelEl, pid);
      applySteelGradeProps();
      update();
    });

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
      const st =
        Number.isFinite(lambda) && Number.isFinite(fyV) && Number.isFinite(EV) && Number.isFinite(kvV)
          ? shearClientShearState(lambda, fyV, EV, kvV)
          : null;
      const cv = st ? st.cv : null;
      const Vn = Number.isFinite(cv) && Number.isFinite(fyV) && Number.isFinite(aw) ? 0.6 * fyV * aw * cv : null;
      const phiVs = st?.phiV;
      const omegaVs = st?.omegaV;
      const phiVn =
        Number.isFinite(Vn) && Number.isFinite(phiVs) ? phiVs * Vn : null;
      const Vallow =
        Number.isFinite(Vn) && Number.isFinite(omegaVs) ? Vn / omegaVs : null;
      return {
        lambda,
        aw,
        lambdaP,
        lambdaR,
        cv,
        Vn,
        phiVn,
        Vallow,
        phiV: phiVs,
        omegaV: omegaVs,
        condition: st?.condition ?? null,
      };
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
      normalizeInputs();
      syncSteelPropsFromGrade();
      const method = (input('sfShearDesMethod')?.value || 'lrfd').toLowerCase();
      const isLRFD = method === 'lrfd';
      const layout = METHOD_LAYOUT[isLRFD ? 'lrfd' : 'asd'];
      if (designShapeImgs.length >= 2) {
        // Match analysis-tab behavior: emphasize top image in LRFD, bottom image in ASD.
        designShapeImgs[0].style.opacity = isLRFD ? '1' : '0.35';
        designShapeImgs[1].style.opacity = isLRFD ? '0.35' : '1';
      }

      const beamKind = String(input('sfShearDesBeamType')?.value || 'simple').toLowerCase();
      const isCantilever = beamKind === 'cantilever';
      const momentFac = isCantilever ? 1 / 3 : 1 / 8;
      const shearFac = isCantilever ? 1 : 0.5;
      const beamMomentFormulaHtml = isCantilever ? 'WL²/3' : 'WL²/8';
      /** Workbook-style cantilever UDL tip deflection (see shear design reference). */
      const beamDeflFormulaHtml = isCantilever ? 'WL<sup>4</sup>/5EI' : '5WL<sup>4</sup>/384EI';

      const setText = (id, value) => {
        const el = out(id);
        if (el) el.textContent = value;
      };
      const setHtml = (id, value) => {
        const el = out(id);
        if (el) el.innerHTML = value;
      };

      const syncShearDesRemarksUi = () => {
        const el = out('sfShearDesRemarks');
        if (!el?.classList) return;
        const t = (el.textContent || '').trim();
        el.classList.toggle('sf-shearDes-remark--safe', t === 'SAFE');
        el.classList.toggle('sf-shearDes-remark--unsafe', t === 'UNSAFE');
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

      // Mirror the dynamic labels on the new LOAD WITH BEAM WEIGHT card.
      setHtml('sfShearDesBwLoadTopLabel', layout.loadTopLabel);
      setText('sfShearDesBwLoadTopUnit', layout.loadTopUnit);
      setHtml('sfShearDesBwWuLabel', layout.wCombLabel);
      setText('sfShearDesBwWuUnit', layout.wCombUnit);
      setHtml('sfShearDesBwLoadBottomLabel', layout.loadBottomLabel);
      setText('sfShearDesBwLoadBottomUnit', layout.loadBottomUnit);
      setHtml('sfShearDesBwMomentLabel', layout.momentLabel);
      setText('sfShearDesBwMomentUnit', layout.momentUnit);
      setHtml('sfShearDesBwShearLabel', layout.shearLabel);
      setText('sfShearDesBwShearUnit', layout.shearUnit);

      // Mirror the dynamic CONDITION CHECKING ultimate-row labels with the design method.
      setHtml('sfShearDesUltLabel', isLRFD ? 'ULTIMATE SHEAR STRENGTH' : 'ALLOWABLE SHEAR STRENGTH');
      setHtml('sfShearDesUltExpr', layout.ultimateExpr);
      // Top-right SHEAR CAPACITY card label/expr swap (ϕVn vs Vn/Ω).
      setHtml(
        'sfShearDesCapCapLabel',
        isLRFD ? 'SHEAR CAPACITY' : 'ALLOWABLE SHEAR',
      );
      setHtml(
        'sfShearDesCapCapExpr',
        isLRFD ? 'ϕV<sub>n</sub> =' : 'V<sub>n</sub>/Ω =',
      );

      const beamMomentLbl = pane.querySelector('#sfShearDesBeamMomentLabel');
      const beamDeflLbl = pane.querySelector('#sfShearDesBeamDeflLabel');
      const beamMomentFormula = pane.querySelector('#sfShearDesBeamMomentFormula');
      const beamDeflFormula = pane.querySelector('#sfShearDesBeamDeflFormula');
      if (beamMomentLbl) beamMomentLbl.innerHTML = layout.beamMomentRow;
      if (beamDeflLbl) beamDeflLbl.innerHTML = layout.beamDeflRow;
      if (beamMomentFormula) beamMomentFormula.innerHTML = beamMomentFormulaHtml;
      if (beamDeflFormula) beamDeflFormula.innerHTML = beamDeflFormulaHtml;

      const bottomRow = out('sfShearDesLoadBottomRow');
      if (bottomRow) bottomRow.style.display = layout.showBottomRow ? '' : 'none';
      const bwBottomRow = out('sfShearDesBwLoadBottomRow');
      if (bwBottomRow) bwBottomRow.style.display = layout.showBottomRow ? '' : 'none';

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
          // New SHEAR CAPACITY card (top-right):
          'sfShearDesCapCv',
          'sfShearDesCapVn',
          'sfShearDesCapPhiVn',
          // New LOAD WITH BEAM WEIGHT:
          'sfShearDesBwWult',
          'sfShearDesBwWu',
          'sfShearDesBwW14',
          'sfShearDesBwMu',
          'sfShearDesBwVu',
        ].forEach((id) => setText(id, '—'));
        setText('sfShearDesSectionName', '—');
        setText('sfShearDesLightest', '—');
        setText('sfShearDesRemarks', '—');
        syncShearDesRemarksUi();
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
        M = wComb * L ** 2 * momentFac;
        V = wComb * L * shearFac;
      } else {
        wTop = dl + ll;
        w14 = null;
        wComb = dl + ll;
        M = wComb * L ** 2 * momentFac;
        V = wComb * L * shearFac;
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

      let cv;
      let Vn;
      let phiVn;
      let Vallow;
      let shearCondShapeResult = null;

      if (condShape) {
        shearCondShapeResult = shearStrengthForShape(condShape, fy, E, kv);
        cv = shearCondShapeResult.cv;
        Vn = shearCondShapeResult.Vn;
        phiVn = shearCondShapeResult.phiVn;
        Vallow = shearCondShapeResult.Vallow;
      } else {
        cv = Vn = phiVn = Vallow = null;
      }

      /** Web slenderness for the Z<sub>x</sub>-assumed shape (must match plastic modulus / depth / t<sub>w</sub> in the same card). */
      const lambdaWebAssumed =
        assumedShape &&
        (Number.isFinite(assumedShape.h) && Number.isFinite(assumedShape.tw) && assumedShape.tw > 0
          ? assumedShape.h / assumedShape.tw
          : Number.isFinite(assumedShape.lambdaW)
            ? assumedShape.lambdaW
            : null);

      setText('sfShearDesWult', fmtNum(wTop, 2));
      setText('sfShearDesWu', fmtNum(wComb, 2));
      setText('sfShearDesW14', w14 == null ? '—' : fmtNum(w14, 2));
      setText('sfShearDesMu', fmtNum(M, 3));
      setText('sfShearDesVu', fmtNum(V, 3));
      setText('sfShearDesZx', fmtNum(zxReq, 4));

      // ---- LOAD WITH BEAM WEIGHT (uses assumedShape.weight in lbs/ft → klf) ----
      // If the AISC catalog provides the section's self-weight (lbs/ft), add it
      // to DL and recompute the combined load + moment + shear. If unknown, fall
      // back to the same numbers as LOAD W/O to keep the card visually consistent.
      const beamWeightKlf =
        assumedShape && Number.isFinite(assumedShape.weight)
          ? assumedShape.weight / 1000
          : 0;
      const dlWithBw = dl + beamWeightKlf;
      let wTopBw;
      let w14Bw;
      let wCombBw;
      if (isLRFD) {
        wTopBw = 1.2 * dlWithBw + 1.6 * ll;
        w14Bw = 1.4 * dlWithBw;
        wCombBw = Math.max(wTopBw, w14Bw);
      } else {
        wTopBw = dlWithBw + ll;
        w14Bw = null;
        wCombBw = dlWithBw + ll;
      }
      const Mbw = wCombBw * L ** 2 * momentFac;
      const Vbw = wCombBw * L * shearFac;
      setText('sfShearDesBwWult', fmtNum(wTopBw, 2));
      setText('sfShearDesBwWu', fmtNum(wCombBw, 2));
      setText('sfShearDesBwW14', w14Bw == null ? '—' : fmtNum(w14Bw, 2));
      setText('sfShearDesBwMu', fmtNum(Mbw, 3));
      setText('sfShearDesBwVu', fmtNum(Vbw, 3));

      setText('sfShearDesPlasticMod', assumedShape?.zx == null ? '—' : fmtNum(assumedShape.zx, 2));
      setText('sfShearDesTw', assumedShape?.tw == null ? '—' : fmtNum(assumedShape.tw, 3));
      setText('sfShearDesDepth', assumedShape?.d == null ? '—' : fmtNum(assumedShape.d, 2));
      setText('sfShearDesLambdaWeb', lambdaWebAssumed == null ? '—' : fmtNum(lambdaWebAssumed, 2));

      setText('sfShearDesLambdaVal', fmtShearLimit(lim224));
      setText('sfShearDesLambdaP', fmtShearLimit(lambdaPglob));
      setText('sfShearDesLambdaR', fmtShearLimit(lambdaRglob));
      setText('sfShearDesCv', fmtNum(cv, 3));
      setText(
        'sfShearDesPhi',
        shearCondShapeResult?.phiV != null ? fmtNum(shearCondShapeResult.phiV, 2) : '—',
      );
      setText(
        'sfShearDesOmega',
        shearCondShapeResult?.omegaV != null ? fmtNum(shearCondShapeResult.omegaV, 2) : '—',
      );
      setText('sfShearDesVn', fmtNum(Vn, 2));

      // ---- SHEAR CAPACITY card (top-right) ----
      // Title shows Cv (rounded), then Vn and the design capacity (ϕVn for LRFD
      // / Vn/Ω for ASD). Remarks pill shares the same id as before so the SAFE
      // / UNSAFE logic below still drives it.
      setText('sfShearDesCapCv', Number.isFinite(cv) ? fmtNum(cv, 3) : '—');
      setText('sfShearDesCapVn', Number.isFinite(Vn) ? fmtNum(Vn, 3) : '—');
      const designShearCap = isLRFD ? phiVn : Vallow;
      setText(
        'sfShearDesCapPhiVn',
        Number.isFinite(designShearCap) ? fmtNum(designShearCap, 3) : '—',
      );

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
      syncShearDesRemarksUi();

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
    populateStructuralSteelGradeSelect(steelTypeEl, getPreferredStructuralSteelGradeId());

    const syncSteelPropsFromGrade = () => {
      const fuEl = input('sfShearDesFu');
      if (!steelTypeEl || !fyEl) return;
      if (steelTypeEl.value === 'custom') {
        fyEl.readOnly = false;
        if (fuEl) {
          fuEl.value = '';
          fuEl.readOnly = false;
        }
        return;
      }
      const g = steelPropsFromStructuralGradeSelect(steelTypeEl.value);
      if (g) {
        fyEl.value = String(g.fy);
        fyEl.readOnly = true;
        if (fuEl) {
          fuEl.value = String(g.fu);
          fuEl.readOnly = true;
        }
      }
    };

    const normalizeInputs = () => {
      const norm = (id, d = 3, min = 0) => {
        const el = input(id);
        if (!el) return;
        const v = parseNum(el.value);
        if (!Number.isFinite(v)) return;
        el.value = fmtNum(Math.max(min, v), d);
      };
      norm('sfShearDesFy', 3, 0);
      norm('sfShearDesFu', 3, 0);
      norm('sfShearDesDL', 4, 0);
      norm('sfShearDesLL', 4, 0);
      norm('sfShearDesL', 3, 0);
    };

    pane.querySelectorAll('input, select').forEach((el) => {
      if (el === steelTypeEl) return;
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    if (steelTypeEl) {
      steelTypeEl.addEventListener('change', () => {
        syncSteelPropsFromGrade();
        update();
      });
    }

    window.addEventListener('sf:steel-grade-change', () => {
      const pid = window.SteelForge?.activeStructuralSteelGrade?.id ?? getPreferredStructuralSteelGradeId();
      populateStructuralSteelGradeSelect(steelTypeEl, pid);
      syncSteelPropsFromGrade();
      update();
    });

    syncSteelPropsFromGrade();
    update();
  }

  window.SteelForge.initTensionRod = (panelRoot) => {
    const compRoot =
      panelRoot?.querySelector?.('.sf-comp.sf-comp--tensionRod') ??
      panelRoot?.querySelector?.('.sf-comp') ??
      panelRoot ??
      document;
    // Tension rod is design-only (no `.sf-comp__modeNav`; skip attachModeToggle).
    if (window.SteelForge?.initTensionRodDesign) {
      window.SteelForge.initTensionRodDesign(panelRoot ?? document);
    }
  };

  window.SteelForge.initShear = (panelRoot, opts = {}) => {
    const root = panelRoot.querySelector('.sf-comp') ? panelRoot : document;
    attachModeToggle(root, { topic: 'SHEAR' });
    attachShearThumbs(root);
    const initialMode = opts.initialMode === 'design' ? 'design' : 'analysis';
    const runAttach = () => {
      attachShearAnalysis(root);
      attachShearDesign(root);
      if (initialMode === 'design') {
        window.SteelForge.activateModuleMode(panelRoot, 'design');
      }
    };
    if (typeof window.SteelForge?.ensureShearShapesFromCsv === 'function') {
      window.SteelForge.ensureShearShapesFromCsv().finally(runAttach);
    } else {
      runAttach();
    }
  };
})();
