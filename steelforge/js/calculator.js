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
    populateStructuralSteelGradeSelect(steelEl, getPreferredStructuralSteelGradeId());

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

    function aiscFcr(Fy, Fe, KLr) {
      if (![Fy, Fe, KLr].every((x) => Number.isFinite(x) && x > 0)) return null;
      const limit = 4.71 * Math.sqrt(E_DEFAULT / Fy);
      if (KLr <= limit) return (0.658 ** (Fy / Fe)) * Fy;
      return 0.877 * Fe;
    }

    function compactLimits(Fy) {
      if (!Number.isFinite(Fy) || Fy <= 0) return null;
      const root = Math.sqrt(E_DEFAULT / Fy);
      return {
        flange: { lp: 0.38 * root, lr: 1.0 * root },
        web: { lp: 3.76 * root, lr: 5.7 * root },
      };
    }

    const applyShape = (rows) => {
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
    if (eEl) eEl.readOnly = true;

    function updateCompactnessAndCapacity() {
      const Fy = parseNum(input('sfCompAnaFy')?.value);
      const Ag = parseNum(input('sfCompAnaAg')?.value);
      const lamF = parseNum(input('sfCompAnaLamF')?.value);
      const lamW = parseNum(input('sfCompAnaLamW')?.value);
      const rx = parseNum(input('sfCompAnaRx')?.value);
      const ry = parseNum(input('sfCompAnaRy')?.value);

      const lim = compactLimits(Fy);
      const fVals = pane.querySelectorAll('.sf-compAnaCompact__seg--flange .sf-compAnaCompact__value');
      const wVals = pane.querySelectorAll('.sf-compAnaCompact__seg--web .sf-compAnaCompact__value');
      if (lim && fVals.length >= 2) {
        fVals[0].textContent = fmt(lim.flange.lp, 8);
        fVals[1].textContent = fmt(lim.flange.lr, 8);
      }
      if (lim && wVals.length >= 2) {
        wVals[0].textContent = fmt(lim.web.lp, 8);
        wVals[1].textContent = fmt(lim.web.lr, 8);
      }

      const flangeBadge = pane.querySelector('.sf-compAnaCompact__asideRow--flange .sf-compAnaCompact__badge');
      const webBadge = pane.querySelector('.sf-compAnaCompact__asideRow--web .sf-compAnaCompact__badge');
      const classify = (lam, { lp, lr }, kind) => {
        if (!Number.isFinite(lam)) return `${kind.toUpperCase()} —`;
        if (lam <= lp) return `COMPACT ${kind.toUpperCase()}`;
        if (lam <= lr) return `NONCOMPACT ${kind.toUpperCase()}`;
        return `SLENDER ${kind.toUpperCase()}`;
      };
      if (lim && flangeBadge) flangeBadge.textContent = classify(lamF, lim.flange, 'flange');
      if (lim && webBadge) webBadge.textContent = classify(lamW, lim.web, 'web');

      // Critical slenderness table based on x/y (ft) and connection K.
      const xs = [1, 2, 3, 4, 5].map((i) => parseNum(input(`sfCompAnaX${i}`)?.value) ?? 0);
      const ys = [1, 2, 3, 4, 5].map((i) => parseNum(input(`sfCompAnaY${i}`)?.value) ?? 0);
      const rows = Array.from(pane.querySelectorAll('.sf-compAnaCritical__row'));
      let gov = null;
      rows.forEach((rowEl, idx) => {
        const axis = idx < 5 ? 'x' : 'y';
        const i = axis === 'x' ? idx : idx - 5;
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
          sel.value = prev && connK[prev] ? prev : axis === 'x' ? 'fixed-pinned' : 'pinned-pinned';
        }
        const K = sel ? connK[sel.value] ?? 1 : 1;
        const Lin = Number.isFinite(Lft) ? Lft * 12 : null;
        const rUse = axis === 'x' ? rx : ry;
        const klr = Number.isFinite(Lin) && Lin > 0 && Number.isFinite(rUse) && rUse > 0 ? (K * Lin) / rUse : null;
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
      const govEl = pane.querySelector('.sf-compAnaCritical__highlight--governing-klr');
      if (govEl) govEl.textContent = Number.isFinite(gov) ? fmt(gov, 8) : '—';

      // Capacity (ksi/in).
      const fe = Number.isFinite(gov) && gov > 0 ? (Math.PI ** 2 * E_DEFAULT) / (gov ** 2) : null;
      const fcr = Number.isFinite(Fy) && Number.isFinite(fe) ? aiscFcr(Fy, fe, gov) : null;
      const pn = Number.isFinite(fcr) && Number.isFinite(Ag) ? fcr * Ag : null; // kips
      const method = String(input('sfCompAnaMethod')?.value || 'lrfd').toLowerCase();
      const cap = method === 'asd' ? (Number.isFinite(pn) ? pn / OMEGA_C : null) : (Number.isFinite(pn) ? PHI_C * pn : null);

      const capSections = pane.querySelectorAll('.sf-compCap__section');
      const fePill = capSections[0]?.querySelector('.sf-compCap__pill') ?? null;
      const fcrPill = capSections[1]?.querySelector('.sf-compCap__pill') ?? null;
      const pnPill = capSections[2]?.querySelector('.sf-compCap__pill') ?? null;
      if (fePill) fePill.textContent = fmt(fe, 8);
      if (fcrPill) fcrPill.textContent = fmt(fcr, 8);
      if (pnPill) pnPill.textContent = Number.isFinite(pn) ? fmt(pn, 2) : '—';

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
      pane.querySelectorAll('input, select').forEach((el) => {
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
      const pref = rows.find((r) => String(r[COL.label] || '').trim().toUpperCase() === 'W44X335');
      if (pref) shapeSel.value = String(pref[COL.label] || '').trim();
      else if (rows[0]) shapeSel.value = String(rows[0][COL.label] || '').trim();
      applyShape(rows);
      wire(rows);
      updateCompactnessAndCapacity();
    });
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
          const lines = txt.split(/\\r?\\n/);
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
      // Reference: yellow pill is "Assuming KLy governed" → show KLy when present.
      if (govEl) govEl.value = Number.isFinite(maxY) ? fmtKlLocal(maxY) : '';
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

    const E_DEFAULT = 29000;
    const PHI_C = 0.9;
    const OMEGA_C = 1.67;

    function aiscFcr(Fy, Fe, KLr) {
      if (![Fy, Fe, KLr].every((x) => Number.isFinite(x) && x > 0)) return null;
      const limit = 4.71 * Math.sqrt(E_DEFAULT / Fy);
      if (KLr <= limit) return (0.658 ** (Fy / Fe)) * Fy;
      return 0.877 * Fe;
    }

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

    const updateSafeSections = (wRows) => {
      const methodEl = input('sfCompDesMethod');
      const isLRFD = methodEl?.value !== 'asd';
      const Fy = parseNum(input('sfCompDesFy')?.value);
      const Pu = parseNum(input('sfCompDesPu')?.value);
      const Pa = parseNum(input('sfCompDesPa')?.value);

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
        syncLightestFromSafeTop();
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
        const Fcr = aiscFcr(Fy, Fe, KLr);
        if (!Number.isFinite(Fcr) || Fcr <= 0) continue;
        const Pn = Fcr * Ag; // kips
        const cap = isLRFD ? PHI_C * Pn : Pn / OMEGA_C;
        const ok = cap >= demand;
        if (!ok) continue;
        candidates.push({ lab, wt, cap });
      }

      candidates.sort((a, b) => a.wt - b.wt || b.cap - a.cap || a.lab.localeCompare(b.lab));
      const top = candidates.slice(0, 4);
      for (let i = 1; i <= 4; i++) {
        const c = top[i - 1];
        if (!c) setSafeRow(i, null);
        else setSafeRow(i, c.lab, c.wt, c.cap, 'SAFE');
      }
      syncLightestFromSafeTop();
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
      loadWShapesFromCsv().then(updateSafeSections);
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
    // Ensure the safe table is computed on initial load.
    loadWShapesFromCsv().then(updateSafeSections);

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

    const buttons = Array.from(nav.querySelectorAll('button.sf-comp__modeBtn'));
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
      const btn = e.target.closest('button.sf-comp__modeBtn');
      if (!btn || !nav.contains(btn)) return;
      const mode = btn.getAttribute('data-comp-mode');
      if (!mode) return;
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
    if (window.SteelForge?.initTensionDesign) {
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

  function getPreferredStructuralSteelGradeId() {
    const activeId = window.SteelForge?.activeStructuralSteelGrade?.id;
    return activeId || 'a992';
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

    populateStructuralSteelGradeSelect(steelEl, getPreferredStructuralSteelGradeId());

    const fmtGeom = (v, maxDecimals = 4) => {
      if (!Number.isFinite(v)) return '';
      const s = v.toFixed(maxDecimals).replace(/\.?0+$/, '');
      return s === '' ? '0' : s;
    };

    const shapeAw = (s) => (s && (s.Aw ?? s.aw)) ?? null;
    const shapeLambdaW = (s) => (s && (s.lambdaW ?? s.lambda_w)) ?? null;
    const shapeLambdaF = (s) => (s && (s.lambdaF ?? s.lambda_f)) ?? null;

    const setManualGeometryMode = (isManual) => {
      const hEl = input('sfShearAnaH');
      const awEl = input('sfShearAnaAw');
      const lamEl = input('sfShearAnaLambda');
      if (hEl) hEl.readOnly = !isManual;
      if (awEl) awEl.readOnly = !isManual;
      // λ is always derived from geometry for strict consistency with CSV-derived h/tw.
      if (lamEl) lamEl.readOnly = true;
    };

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
      norm('sfShearAnaVu', 3, 0);
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
      // Match workbook-style deterministic defaults used across modules.
      const pref = shapes.find((s) => String(s.name || '').trim().toUpperCase() === 'W44X335');
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
    if (E0) E0.readOnly = true;
    if (kv0) kv0.readOnly = true;
    setManualGeometryMode(!(shapeSel?.value));
    syncWebSpacingAndKv();
    if (shapeSel?.value) applyShape(shapeSel.value);
    else applyDefaultShapeOnLoad();

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

  window.SteelForge.initTensionRod = (panelRoot) => {
    const compRoot =
      panelRoot?.querySelector?.('.sf-comp.sf-comp--tensionRod') ??
      panelRoot?.querySelector?.('.sf-comp') ??
      panelRoot ??
      document;
    attachModeToggle(compRoot, { topic: 'TENSION ROD' });
    if (window.SteelForge?.initTensionRodAnalysis) {
      window.SteelForge.initTensionRodAnalysis(panelRoot ?? document);
    }
    if (window.SteelForge?.initTensionRodDesign) {
      window.SteelForge.initTensionRodDesign(panelRoot ?? document);
    }
    const tr =
      compRoot?.classList?.contains?.('sf-comp--tensionRod') ? compRoot : compRoot?.querySelector?.('.sf-comp--tensionRod');
    const nav = tr?.querySelector?.('.sf-comp__modeNav');
    if (nav && tr && !tr.dataset.sfRodModeSync) {
      tr.dataset.sfRodModeSync = '1';
      nav.addEventListener('click', () => {
        requestAnimationFrame(() => {
          const active = tr.querySelector('.sf-comp__mode.is-active');
          const m = active?.getAttribute('data-comp-mode-pane');
          if (m === 'analysis') window.SteelForge?.__tensionRodRecomputeAnalysis?.();
          if (m === 'design') window.SteelForge?.__tensionRodRecomputeDesign?.();
        });
      });
    }
  };

  window.SteelForge.initShear = (panelRoot) => {
    const root = panelRoot.querySelector('.sf-comp') ? panelRoot : document;
    attachModeToggle(root, { topic: 'SHEAR' });
    attachShearThumbs(root);
    const runAttach = () => {
      attachShearAnalysis(root);
      attachShearDesign(root);
    };
    if (typeof window.SteelForge?.ensureShearShapesFromCsv === 'function') {
      window.SteelForge.ensureShearShapesFromCsv().finally(runAttach);
    } else {
      runAttach();
    }
  };
})();
