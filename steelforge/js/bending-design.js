(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = { type: 0, label: 2, weight: 4, lamF: 23, lamW: 24, Ix: 29, Sx: 30, Zx: 33 };
  const PHI_B = 0.9;
  const OMEGA_B = 1.67;
  const E_DEFAULT = 29000;
  const FY_CUSTOM_DEFAULT = 50;

  function workbookBeamCase(rawId) {
    return window.SteelForgeWorkbookBeamCaseById
      ? window.SteelForgeWorkbookBeamCaseById(rawId)
      : {
          id: 'simple-u',
          momentCoeff: 1 / 8,
          deflectionK: 5 / 384,
          momentFormula: 'WL²/8',
          deflectionFormula: '5WL⁴/384EI',
        };
  }

  function populateWorkbookDeflectionSelect(selectEl, preferredDenom) {
    if (!selectEl) return;
    const presets = window.SteelForgeWorkbookDeflectionLimitPresets;
    if (!presets || presets.length === 0) return;
    const prior = String(selectEl.value || '').trim();
    selectEl.innerHTML = '';
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = String(p.denom);
      opt.textContent = p.label;
      selectEl.appendChild(opt);
    }
    const pref = String(preferredDenom ?? '').trim();
    const pick =
      presets.some((p) => String(p.denom) === prior)
        ? prior
        : presets.some((p) => String(p.denom) === pref)
          ? pref
          : String(presets.find((x) => x.denom === 360)?.denom ?? presets[0].denom);
    selectEl.value = pick;
  }

  /** Δ_allow (in) from span L (ft) and workbook denominator n (Δ = L/n). */
  function allowableDeflectionInches(L_ft, denomRaw) {
    const n = parseNumLike(denomRaw);
    if (!Number.isFinite(L_ft) || L_ft <= 0 || !Number.isFinite(n) || n <= 0) return null;
    return (L_ft * 12) / n;
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
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

  function fmt(v, d = 3) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(d).replace(/\.?0+$/, '');
  }

  /**
   * Same flexural strength model as Analysis Bending (`bending-analysis.js`).
   * Strict parity with workbook BENDING sheet:
   *   COMPACT      → M_p
   *   NON-COMPACT  → M_p − (M_p − 0.7 M_y) · (λ_f − λ_pf)/(λ_rf − λ_pf)
   *   SLENDER      → 0.9 · E · S_x · (4/λ_w) / λ_f²  (workbook elastic FLB form)
   * Web slenderness is NOT used to govern M_n in workbook (flange-only classification).
   */
  function nominalMomentFlangeKipFt(Fy, E, Zx, Sx, lamF, lamW) {
    if (![Fy, E, Zx, Sx, lamF].every((x) => Number.isFinite(x) && x > 0)) return null;
    const Mp = (Fy * Zx) / 12;
    const My = (Fy * Sx) / 12;
    const lpF = 0.38 * Math.sqrt(E / Fy);
    const lrF = 1.0 * Math.sqrt(E / Fy);
    if (lamF <= lpF) return Mp;
    if (lamF <= lrF) {
      const den = lrF - lpF;
      if (!(den > 0)) return Mp;
      return Mp - (Mp - 0.7 * My) * ((lamF - lpF) / den);
    }
    if (Number.isFinite(lamW) && lamW > 0) {
      return (0.9 * E * Sx * (4 / lamW)) / (lamF * lamF * 12);
    }
    return 0.7 * My;
  }

  function nominalMomentWebKipFt(Fy, E, Zx, Sx, lamW) {
    if (![Fy, E, Zx, Sx, lamW].every((x) => Number.isFinite(x) && x > 0)) return null;
    const Mp = (Fy * Zx) / 12;
    const My = (Fy * Sx) / 12;
    const lpW = 3.76 * Math.sqrt(E / Fy);
    const lrW = 5.7 * Math.sqrt(E / Fy);
    if (lamW <= lpW) return Mp;
    if (lamW <= lrW) {
      const den = lrW - lpW;
      if (!(den > 0)) return Mp;
      return Mp - (Mp - 0.7 * My) * ((lamW - lpW) / den);
    }
    return 0.7 * My;
  }

  /** Workbook BENDING uses flange classification only — web result kept for diagnostic display. */
  function nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW) {
    return nominalMomentFlangeKipFt(Fy, E, Zx, Sx, lamF, lamW);
  }

  /** CHECK COMPACTNESS card — flange classification vs λ_pf / λ_rf only. */
  function flangeCompactnessVerdict(lamF, Fy, E) {
    if (![lamF, Fy, E].every((x) => Number.isFinite(x) && x > 0)) return '—';
    const lpF = 0.38 * Math.sqrt(E / Fy);
    const lrF = 1.0 * Math.sqrt(E / Fy);
    if (lamF <= lpF) return 'COMPACT FLANGE';
    if (lamF <= lrF) return 'NON-COMPACT FLANGE';
    return 'SLENDER FLANGE';
  }

  function populateSteelSelect(selectEl, preferredId = 'a992') {
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    if (!selectEl || grades.length === 0) return;
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
    customOpt.textContent = 'Custom (Fy = 50 ksi)';
    selectEl.appendChild(customOpt);
    const ids = new Set(grades.map((x) => x.id));
    if (ids.has(preferredId)) selectEl.value = preferredId;
    else if (grades[0]) selectEl.value = grades[0].id;
    else selectEl.value = 'custom';
  }

  function gradeLabel(g) {
    const idPart = g.catalogId != null ? `[${g.catalogId}] ` : '';
    return `${idPart}${g.label} — Fy=${g.fy}, Fu=${g.fu} ksi`;
  }

  function populateSteelControl(el, preferredId = 'a992') {
    if (!el) return;
    if (el.tagName === 'SELECT') {
      populateSteelSelect(el, preferredId);
      return;
    }
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    const sorted = [...grades].sort((a, b) => {
      const ca = a.catalogId;
      const cb = b.catalogId;
      if (ca != null && cb != null && ca !== cb) return ca - cb;
      if (ca != null && cb == null) return -1;
      if (ca == null && cb != null) return 1;
      return String(a.label).localeCompare(String(b.label));
    });
    const listId = `${el.id || 'sfBendDesSteel'}__list`;
    let dl = document.getElementById(listId);
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = listId;
      el.insertAdjacentElement('afterend', dl);
    }
    dl.innerHTML = '';
    sorted.forEach((g) => {
      const o = document.createElement('option');
      o.value = gradeLabel(g);
      dl.appendChild(o);
    });
    el.setAttribute('list', listId);
    const picked = sorted.find((g) => g.id === preferredId) ?? sorted[0] ?? null;
    if (picked && !String(el.value || '').trim()) el.value = gradeLabel(picked);
  }

  function normalizeGradeLoose(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[=,_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function steelPropsFromControlValue(v) {
    const t = String(v || '').trim();
    if (!t) return null;
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    const byId = grades.find((g) => g.id === t);
    if (byId) return byId;
    const tl = t.toLowerCase();
    const byLabel = grades.find((g) => String(g.label || '').toLowerCase() === tl);
    if (byLabel) return byLabel;
    const byFull = grades.find((g) => gradeLabel(g).toLowerCase() === tl);
    if (byFull) return byFull;
    const nk = normalizeGradeLoose(t);
    const loose =
      grades.find((g) => normalizeGradeLoose(g.label) === nk) ||
      grades.find((g) => nk.length >= 4 && normalizeGradeLoose(g.label).includes(nk)) ||
      grades.find((g) => nk.length >= 4 && nk.includes(normalizeGradeLoose(g.label)));
    return loose || null;
  }

  function fyFromSelect(sel) {
    if (!sel) return FY_CUSTOM_DEFAULT;
    const raw = String(sel.value || '').trim();
    const g = steelPropsFromControlValue(raw);
    if (g && Number.isFinite(g.fy)) return g.fy;
    const fyMatch = raw.match(/\bFy\s*=\s*(\d+(?:\.\d+)?)/i);
    if (fyMatch) return Number(fyMatch[1]);
    return FY_CUSTOM_DEFAULT;
  }

  function getPreferredSteelGradeId() {
    const activeId = window.SteelForge?.activeStructuralSteelGrade?.id;
    return activeId || 'a992';
  }

  function designStrengthKipFt(Fy, E, row, isLRFD) {
    const Zx = parseNumLike(row[COL.Zx]);
    const Sx = parseNumLike(row[COL.Sx]);
    const lamF = parseNumLike(row[COL.lamF]);
    const lamW = parseNumLike(row[COL.lamW]);
    const Mn = nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW);
    if (Mn == null) return null;
    return isLRFD ? PHI_B * Mn : Mn / OMEGA_B;
  }

  function deltaInches(W_klf, L_ft, E_ksi, I_in4, deflectionK) {
    if (![W_klf, L_ft, E_ksi, I_in4].every((x) => Number.isFinite(x) && x > 0)) return null;
    const k = deflectionK;
    if (!Number.isFinite(k) || k <= 0) return null;
    return (k * W_klf * Math.pow(12, 3) * Math.pow(L_ft, 4)) / (E_ksi * I_in4);
  }

  function requiredIx(W_svc_klf, L_ft, E_ksi, delta_in, deflectionK) {
    if (![W_svc_klf, L_ft, E_ksi, delta_in].every((x) => Number.isFinite(x) && x > 0)) return null;
    const k = deflectionK;
    if (!Number.isFinite(k) || k <= 0) return null;
    return (k * W_svc_klf * Math.pow(12, 3) * Math.pow(L_ft, 4)) / (E_ksi * delta_in);
  }

  /** Lightest W-shape in CSV order whose I<sub>x</sub> meets the serviceability minimum. */
  function pickLightestMeetingIx(I_min, sorted) {
    if (!sorted.length) return null;
    const lo = Number.isFinite(I_min) && I_min > 0 ? I_min : 0;
    for (const s of sorted) {
      if (s.Ix >= lo) return s;
    }
    return null;
  }

  function pickBeamSelfWeightShape(isLRFD, sorted, I_min, dl, ll, L_ft, KMOM, Fy, E) {
    let w_self = 0;
    let picked = null;
    let Wu_tot = 0;
    let Mu_tot = 0;
    let Wa_tot = 0;
    let Ma_tot = 0;
    for (let iter = 0; iter < 15; iter++) {
      Wu_tot = Math.max(1.2 * (dl + w_self) + 1.6 * ll, 1.4 * (dl + w_self));
      Wa_tot = dl + ll + w_self;
      Mu_tot = Wu_tot * L_ft * L_ft * KMOM;
      Ma_tot = Wa_tot * L_ft * L_ft * KMOM;
      const demand = isLRFD ? Mu_tot : Ma_tot;
      picked = null;
      for (const s of sorted) {
        if (s.Ix < I_min) continue;
        const cap = designStrengthKipFt(Fy, E, s.row, isLRFD);
        if (cap != null && cap >= demand) {
          picked = s;
          break;
        }
      }
      if (!picked) break;
      const w_new = picked.wLb / 1000;
      if (Math.abs(w_new - w_self) < 1e-5) break;
      w_self = w_new;
    }
    return { picked, Wu_tot, Mu_tot, Wa_tot, Ma_tot, w_self };
  }

  /**
   * Excel-style iteration: factored/nominal line loads include beam self-weight (w in kip/ft).
   * LRFD and ASD are converged separately — picks may differ (client workbook).
   */

  window.SteelForge = window.SteelForge || {};

  window.SteelForge.initBendingDesign = (panelRoot) => {
    const root =
      panelRoot?.querySelector?.('.sf-comp.sf-comp--bending') ??
      document.querySelector('.sf-comp.sf-comp--bending');
    if (!root) return;

    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="design"]');
    if (!pane) return;

    const $ = (id) => pane.querySelector(`#${id}`);
    const methodEl = $('sfBendDesMethod');
    const methodDefl = $('sfBendDesMethodDefl');
    const steelN = $('sfBendDesSteelN');
    const steelY = $('sfBendDesSteelY');
    const deflNo = root.querySelector('#sfBendDefNo');
    const deflYes = root.querySelector('#sfBendDefYes');

    const els = {
      dlN: $('sfBendDesDlN'),
      llN: $('sfBendDesLlN'),
      lN: $('sfBendDesLN'),
      beamN: $('sfBendDesBeamN'),
      dlY: $('sfBendDesDlY'),
      llY: $('sfBendDesLlY'),
      lY: $('sfBendDesLY'),
      beamY: $('sfBendDesBeamY'),
      deflLim: $('sfBendDesDeflLim'),
      deflLimY: $('sfBendDesDeflLimY'),
      formulaMomN: $('sfBendDesMomentFormulaN'),
      formulaDeflN: $('sfBendDesDeflFormulaN'),
      formulaMomY: $('sfBendDesMomentFormulaY'),
      formulaDeflY: $('sfBendDesDeflFormulaY'),
      beamLblN: $('sfBendDesBeamLblN'),
      outN: {
        c12: $('sfBendDesN_c12'),
        c14: $('sfBendDesN_c14'),
        Wu: $('sfBendDesN_Wu'),
        Mu: $('sfBendDesMuN'),
        dlll: $('sfBendDesN_dlll'),
        Wa: $('sfBendDesN_Wa'),
        Ma: $('sfBendDesMaN'),
        ZxReq: $('sfBendDesN_ZxReq'),
        ZxReqAsd: $('sfBendDesN_ZxReqAsd'),
      },
      outY: {
        c12: $('sfBendDesY_c12'),
        c14: $('sfBendDesY_c14'),
        Wu: $('sfBendDesY_Wu'),
        Mu: $('sfBendDesMuY'),
        dlll: $('sfBendDesY_dlll'),
        Wa: $('sfBendDesY_Wa'),
        Ma: $('sfBendDesMaY'),
        ZxReq: $('sfBendDesY_ZxReq'),
        ZxReqAsd: $('sfBendDesY_ZxReqAsd'),
      },
      lw: { Wu: $('sfBendDesLwWu'), Mu: $('sfBendDesLwMu'), Wa: $('sfBendDesLwWa'), Ma: $('sfBendDesLwMa') },
      ass1: {
        sec: $('sfBendDesAss1Sec'),
        zx: $('sfBendDesZxY'),
        w: $('sfBendDesAss1W'),
        sx: $('sfBendDesAss1Sx'),
        ix: $('sfBendDesAss1Ix'),
        lf: $('sfBendDesAss1Lf'),
        rm: $('sfBendDesAss1Rm'),
        secAsd: $('sfBendDesAss1SecAsd'),
        zxAsd: $('sfBendDesAss1ZxAsd'),
        ixAsd: $('sfBendDesAss1IxAsd'),
        rmAsd: $('sfBendDesAss1RmAsd'),
      },
      lpf: $('sfBendDesLpf'),
      lrf: $('sfBendDesLrf'),
      verdict: $('sfBendDesVerdict'),
      Mn: $('sfBendDesMn'),
      allowDefl: $('sfBendDesAllowDefl'),
      deflY: $('sfBendDesDeflY'),
      ixChip: $('sfBendDesIxReqChip'),
      ixSec: $('sfBendDesSecY'),
      ixZx: $('sfBendDesIxZx'),
      ixSx: $('sfBendDesIxSx'),
      ixI: $('sfBendDesIxY'),
      ixLf: $('sfBendDesIxLf'),
      ixW: $('sfBendDesIxW'),
      capSym: $('sfBendDesCapSym'),
      capVal: $('sfBendDesCapVal'),
      capLrfdDem: $('sfBendDesCapLrfdDem'),
      capLrfdCap: $('sfBendDesCapLrfdCap'),
      capLrfdRm: $('sfBendDesCapLrfdRm'),
      capAsdDem: $('sfBendDesCapAsdDem'),
      capAsdCap: $('sfBendDesCapAsdCap'),
      capAsdRm: $('sfBendDesCapAsdRm'),
      deflYLrfd: $('sfBendDesDeflYLrfd'),
      deflYAsd: $('sfBendDesDeflYAsd'),
      deflRmLrfd: $('sfBendDesDeflRmLrfd'),
      deflRmAsd: $('sfBendDesDeflRmAsd'),
      finalSec: $('sfBendDesSecN'),
      finalRm: $('sfBendDesRmN'),
      solve: $('sfBendDesSolve'),
      fyDispN: $('sfBendDesFyDispN'),
      fyDispY: $('sfBendDesFyDispY'),
      defl: {
        beamLbl: $('sfBendDesDeflBeamLbl'),
        ixChip: $('sfBendDesIxReqChipDefl'),
        ass1Sec: $('sfBendDesDeflAss1Sec'),
        ass1Zx: $('sfBendDesDeflAss1Zx'),
        ass1W: $('sfBendDesDeflAss1W'),
        ass1Sx: $('sfBendDesDeflAss1Sx'),
        ass1Lf: $('sfBendDesDeflAss1Lf'),
        ass1Rm: $('sfBendDesDeflAss1Rm'),
        ixSec: $('sfBendDesDeflIxSec'),
        ixZx: $('sfBendDesDeflIxZx'),
        ixSx: $('sfBendDesDeflIxSx'),
        ixI: $('sfBendDesDeflIxI'),
        ixLf: $('sfBendDesDeflIxLf'),
        ixW: $('sfBendDesDeflIxW'),
        lwWu: $('sfBendDesDeflLwWu'),
        lwMu: $('sfBendDesDeflLwMu'),
        lwWa: $('sfBendDesDeflLwWa'),
        lwMa: $('sfBendDesDeflLwMa'),
        lpf: $('sfBendDesDeflLpf'),
        lrf: $('sfBendDesDeflLrf'),
        verdict: $('sfBendDesDeflVerdict'),
        Mn: $('sfBendDesDeflMn'),
        allow: $('sfBendDesDeflAllow'),
        deltaMax: $('sfBendDesDeflDeltaMax'),
        capSym: $('sfBendDesDeflCapSym'),
        capVal: $('sfBendDesDeflCapVal'),
        capLrfdDem: $('sfBendDesDeflCapLrfdDem'),
        capLrfdCap: $('sfBendDesDeflCapLrfdCap'),
        capLrfdRm: $('sfBendDesDeflCapLrfdRm'),
        capAsdDem: $('sfBendDesDeflCapAsdDem'),
        capAsdCap: $('sfBendDesDeflCapAsdCap'),
        capAsdRm: $('sfBendDesDeflCapAsdRm'),
        deltaLrfd: $('sfBendDesDeflDeltaLrfd'),
        deltaAsd: $('sfBendDesDeflDeltaAsd'),
        staRmLrfd: $('sfBendDesDeflStaRmLrfd'),
        staRmAsd: $('sfBendDesDeflStaRmAsd'),
        finalSec: $('sfBendDesDeflFinalSec'),
        finalRm: $('sfBendDesDeflFinalRm'),
      },
    };

    if (!methodEl || !steelN || !steelY) return;

    const loadCardNoDef = $('sfBendNoDefLoadCard');

    let wRows = [];

    function isDeflOn() {
      return deflYes && deflYes.checked;
    }

    /** Keep N/Y input pairs identical so hidden branch values never drift from the active deflection mode. */
    function syncBendingParameterPeers() {
      const defl = isDeflOn();
      const copyVal = (from, to) => {
        if (!from || !to) return;
        if (String(from.value) !== String(to.value)) to.value = from.value;
      };
      if (defl) {
        copyVal(els.lY, els.lN);
        copyVal(els.dlY, els.dlN);
        copyVal(els.llY, els.llN);
        copyVal(els.beamY, els.beamN);
        if (steelY && steelN) copyVal(steelY, steelN);
        if (els.deflLimY && els.deflLim) copyVal(els.deflLimY, els.deflLim);
      } else {
        copyVal(els.lN, els.lY);
        copyVal(els.dlN, els.dlY);
        copyVal(els.llN, els.llY);
        copyVal(els.beamN, els.beamY);
        if (steelN && steelY) copyVal(steelN, steelY);
        if (els.deflLim && els.deflLimY) copyVal(els.deflLim, els.deflLimY);
      }
    }

    function setMomentInertiaReqChip(text) {
      setOutSpan(els.ixChip, text);
      if (els.defl?.ixChip) setOutSpan(els.defl.ixChip, text);
    }

    function activeInputs() {
      if (isDeflOn()) {
        return {
          dl: parseNumLike(els.dlY?.value),
          ll: parseNumLike(els.llY?.value),
          L: parseNumLike(els.lY?.value),
          beam: String(els.beamY?.value || 'simple-u'),
          steel: steelY,
        };
      }
      return {
        dl: parseNumLike(els.dlN?.value),
        ll: parseNumLike(els.llN?.value),
        L: parseNumLike(els.lN?.value),
        beam: String(els.beamN?.value || 'simple-u'),
        steel: steelN,
      };
    }

    function setOutSpan(el, text) {
      if (el) el.textContent = text;
    }

    /** @param {boolean | null | undefined} safe null => neutral dash */
    function setRemarkSafe(el, safe) {
      if (!el) return;
      if (safe === null || safe === undefined) {
        el.textContent = '—';
        el.classList.remove('sf-bendNoDef__remarkPill--safe', 'sf-bendNoDef__remarkPill--unsafe');
        return;
      }
      const ok = Boolean(safe);
      el.textContent = ok ? 'SAFE' : 'UNSAFE';
      el.classList.toggle('sf-bendNoDef__remarkPill--safe', ok);
      el.classList.toggle('sf-bendNoDef__remarkPill--unsafe', !ok);
    }

    function beamCaseLabel(beamId) {
      const cs = window.SteelForgeWorkbookBeamCases;
      const hit = cs?.find((c) => c.id === beamId);
      return hit?.label ?? beamId ?? '—';
    }

    /** Workbook lists Δ as span/360 in feet; internal math stays in inches. */
    function formatDeflectionDual(deltaIn) {
      if (!Number.isFinite(deltaIn)) return '—';
      return `${fmt(deltaIn / 12, 9)} ft (${fmt(deltaIn, 4)} in)`;
    }

    /** Plain feet (no unit suffix) to match Excel-style numeric cells. */
    function formatDeflectionWorkbookFt(deltaIn) {
      if (!Number.isFinite(deltaIn)) return '—';
      return fmt(deltaIn / 12, 9);
    }

    function copySpan(toEl, fromEl) {
      if (toEl && fromEl) toEl.textContent = fromEl.textContent;
    }

    function copyHtml(toEl, fromEl) {
      if (toEl && fromEl) toEl.innerHTML = fromEl.innerHTML;
    }

    function copyRemarkPill(toEl, fromEl) {
      if (!toEl || !fromEl) return;
      toEl.textContent = fromEl.textContent;
      toEl.classList.toggle('sf-bendNoDef__remarkPill--safe', fromEl.classList.contains('sf-bendNoDef__remarkPill--safe'));
      toEl.classList.toggle(
        'sf-bendNoDef__remarkPill--unsafe',
        fromEl.classList.contains('sf-bendNoDef__remarkPill--unsafe')
      );
    }

    function clearDeflMirrorPanels() {
      const d = els.defl;
      if (!d) return;
      Object.values(d).forEach((el) => {
        if (el) el.textContent = '—';
      });
      if (d.capSym) d.capSym.innerHTML = 'M<sub>u</sub>';
      [d.capLrfdRm, d.capAsdRm, d.staRmLrfd, d.staRmAsd, d.finalRm].forEach((el) => {
        if (el) {
          el.textContent = '—';
          el.classList.remove('sf-bendNoDef__remarkPill--safe', 'sf-bendNoDef__remarkPill--unsafe');
        }
      });
    }

    /** Keep “WITH DEFLECTION” dashboard cells aligned with computed outputs (single source of truth). */
    function mirrorDeflPanels(insBeam) {
      const d = els.defl;
      if (!d) return;
      setOutSpan(d.beamLbl, beamCaseLabel(insBeam));
      copySpan(d.ixChip, els.ixChip);
      copySpan(d.ass1Sec, els.ass1.sec);
      copySpan(d.ass1Zx, els.ass1.zx);
      copySpan(d.ass1W, els.ass1.w);
      copySpan(d.ass1Sx, els.ass1.sx);
      copySpan(d.ass1Lf, els.ass1.lf);
      copyRemarkPill(d.ass1Rm, els.ass1.rm);
      copySpan(d.lwWu, els.lw.Wu);
      copySpan(d.lwMu, els.lw.Mu);
      copySpan(d.lwWa, els.lw.Wa);
      copySpan(d.lwMa, els.lw.Ma);
      copySpan(d.lpf, els.lpf);
      copySpan(d.lrf, els.lrf);
      copySpan(d.verdict, els.verdict);
      copySpan(d.Mn, els.Mn);
      copySpan(d.allow, els.allowDefl);
      copySpan(d.deltaMax, els.deflY);
      copyHtml(d.capSym, els.capSym);
      copySpan(d.capVal, els.capVal);
      copySpan(d.capLrfdDem, els.capLrfdDem);
      copySpan(d.capLrfdCap, els.capLrfdCap);
      copyRemarkPill(d.capLrfdRm, els.capLrfdRm);
      copySpan(d.capAsdDem, els.capAsdDem);
      copySpan(d.capAsdCap, els.capAsdCap);
      copyRemarkPill(d.capAsdRm, els.capAsdRm);
      copySpan(d.deltaLrfd, els.deflYLrfd);
      copySpan(d.deltaAsd, els.deflYAsd);
      copyRemarkPill(d.staRmLrfd, els.deflRmLrfd);
      copyRemarkPill(d.staRmAsd, els.deflRmAsd);
      copySpan(d.finalSec, els.finalSec);
      copyRemarkPill(d.finalRm, els.finalRm);
      copySpan(d.ixSec, els.ixSec);
      copySpan(d.ixZx, els.ixZx);
      copySpan(d.ixSx, els.ixSx);
      copySpan(d.ixI, els.ixI);
      copySpan(d.ixLf, els.ixLf);
      copySpan(d.ixW, els.ixW);
    }

    function syncMethodPeers(source) {
      const peer = source === methodEl ? methodDefl : methodEl;
      if (peer && source && peer.value !== source.value) peer.value = source.value;
    }

    function normalizeInputs() {
      const norm = (el, d = 3, min = 0) => {
        if (!el) return;
        const v = parseNumLike(el.value);
        if (!Number.isFinite(v)) return;
        el.value = fmt(Math.max(min, v), d);
      };
      norm(els.dlN, 4, 0);
      norm(els.llN, 4, 0);
      norm(els.lN, 3, 0);
      norm(els.dlY, 4, 0);
      norm(els.llY, 4, 0);
      norm(els.lY, 3, 0);
    }

    function preferredWorkbookDeflectionDenom() {
      const g = window.SteelForge?.activeStructuralSteelGrade;
      const d = g?.workbookDeflectionDenom;
      return Number.isFinite(d) && d > 0 ? d : 360;
    }

    function populateBeamCaseSelect(sel) {
      if (!sel || !window.SteelForgeWorkbookBeamCases) return;
      const prior = String(sel.value || '').trim();
      sel.innerHTML = '';
      for (const c of window.SteelForgeWorkbookBeamCases) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.label;
        sel.appendChild(opt);
      }
      const legacy = { 'fp-u': 'simple-u', cont: 'fixed-pinned-u' };
      const mapped = legacy[prior] || prior;
      const pick = [...sel.options].some((o) => o.value === mapped)
        ? mapped
        : [...sel.options].some((o) => o.value === prior)
          ? prior
          : 'simple-u';
      sel.value = pick;
    }

    function loadPack(dl, ll, L, KMOM, fy) {
      if (
        ![dl, ll, L, KMOM, fy].every((x) => Number.isFinite(x) && x >= 0) ||
        !Number.isFinite(L) ||
        L <= 0 ||
        !Number.isFinite(fy) ||
        fy <= 0 ||
        !Number.isFinite(KMOM) ||
        KMOM <= 0
      )
        return null;
      const c12v = 1.2 * dl + 1.6 * ll;
      const c14v = 1.4 * dl;
      const Wu_val = Math.max(c12v, c14v);
      const dlll_val = dl + ll;
      const Wa_val = dlll_val;
      const Mu_val = Wu_val * L * L * KMOM;
      const Ma_req_val = Wa_val * L * L * KMOM;
      const Zxl = (12 * Mu_val) / (PHI_B * fy);
      const Zxa = (12 * Ma_req_val * OMEGA_B) / fy;
      return { c12v, c14v, Wu_val, Mu_val, dlll_val, Wa_val, Ma_req_val, Zxl, Zxa };
    }

    function fillLoadOut(o, pack) {
      if (!o) return;
      if (!pack) {
        Object.values(o).forEach((el) => {
          if (el) el.textContent = '—';
        });
        return;
      }
      setOutSpan(o.c12, fmt(pack.c12v, 4));
      setOutSpan(o.c14, fmt(pack.c14v, 4));
      setOutSpan(o.Wu, fmt(pack.Wu_val, 4));
      setOutSpan(o.Mu, fmt(pack.Mu_val, 3));
      setOutSpan(o.dlll, fmt(pack.dlll_val, 4));
      setOutSpan(o.Wa, fmt(pack.Wa_val, 4));
      setOutSpan(o.Ma, fmt(pack.Ma_req_val, 3));
      setOutSpan(o.ZxReq, fmt(pack.Zxl, 3));
      setOutSpan(o.ZxReqAsd, fmt(pack.Zxa, 3));
    }

    function syncBeamFormulasFromInputs() {
      const bcN = workbookBeamCase(String(els.beamN?.value || 'simple-u'));
      const bcY = workbookBeamCase(String(els.beamY?.value || 'simple-u'));
      if (els.formulaMomN) els.formulaMomN.textContent = bcN.momentFormula || '—';
      if (els.formulaDeflN) els.formulaDeflN.textContent = bcN.deflectionFormula || '—';
      if (els.formulaMomY) els.formulaMomY.textContent = bcY.momentFormula || '—';
      if (els.formulaDeflY) els.formulaDeflY.textContent = bcY.deflectionFormula || '—';
      if (els.beamLblN) els.beamLblN.textContent = beamCaseLabel(String(els.beamN?.value || 'simple-u'));
    }

    function shapeProps(shape, Fy, E) {
      const row = shape.row;
      const Zx = parseNumLike(row[COL.Zx]);
      const Sx = parseNumLike(row[COL.Sx]);
      const lamF = parseNumLike(row[COL.lamF]);
      const lamW = parseNumLike(row[COL.lamW]);
      const Mn = nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW);
      const verdict = flangeCompactnessVerdict(lamF, Fy, E);
      return { row, Zx, Sx, lamF, lamW, Mn, verdict };
    }

    function recompute() {
      syncBendingParameterPeers();
      normalizeInputs();
      const method = String(methodEl.value || 'lrfd').toLowerCase();
      const isLRFD = method === 'lrfd';
      const E = E_DEFAULT;
      const FyN = fyFromSelect(steelN);
      const FyY = fyFromSelect(steelY);
      setOutSpan(els.fyDispN, Number.isFinite(FyN) ? `${fmt(FyN, 3)} ksi` : '—');
      setOutSpan(els.fyDispY, Number.isFinite(FyY) ? `${fmt(FyY, 3)} ksi` : '—');

      const ins = activeInputs();
      const Fy = fyFromSelect(ins.steel);
      const bcDesign = workbookBeamCase(ins.beam);
      const KMOM = bcDesign.momentCoeff;

      const dlN = parseNumLike(els.dlN?.value);
      const llN = parseNumLike(els.llN?.value);
      const LN = parseNumLike(els.lN?.value);
      const dlY = parseNumLike(els.dlY?.value);
      const llY = parseNumLike(els.llY?.value);
      const LY = parseNumLike(els.lY?.value);

      const bcN = workbookBeamCase(String(els.beamN?.value || 'simple-u'));
      const bcY = workbookBeamCase(String(els.beamY?.value || 'simple-u'));

      const validN =
        [dlN, llN, LN].every((x) => Number.isFinite(x) && x >= 0) &&
        Number.isFinite(LN) &&
        LN > 0 &&
        Number.isFinite(FyN) &&
        FyN > 0;
      const validY =
        [dlY, llY, LY].every((x) => Number.isFinite(x) && x >= 0) &&
        Number.isFinite(LY) &&
        LY > 0 &&
        Number.isFinite(FyY) &&
        FyY > 0;

      fillLoadOut(els.outN, validN ? loadPack(dlN, llN, LN, bcN.momentCoeff, FyN) : null);
      fillLoadOut(els.outY, validY ? loadPack(dlY, llY, LY, bcY.momentCoeff, FyY) : null);

      syncBeamFormulasFromInputs();

      if (els.capSym) {
        els.capSym.innerHTML = isLRFD ? 'M<sub>u</sub> =' : 'M<sub>a</sub> =';
      }

      const dl = ins.dl;
      const ll = ins.ll;
      const L = ins.L;

      const deflOn = isDeflOn();
      if (pane) pane.dataset.sfBendDesMethod = isLRFD ? 'lrfd' : 'asd';
      if (loadCardNoDef) {
        if (!deflOn) loadCardNoDef.dataset.sfBendDesMethod = isLRFD ? 'lrfd' : 'asd';
        else delete loadCardNoDef.dataset.sfBendDesMethod;
      }
      if (els.deflLim && els.deflLimY && els.deflLim.value !== els.deflLimY.value) {
        if (deflOn) els.deflLim.value = els.deflLimY.value;
        else els.deflLimY.value = els.deflLim.value;
      }

      const denomSrc =
        deflOn && els.deflLimY ? els.deflLimY.value : els.deflLim ? els.deflLim.value : null;
      const deltaLimIn =
        deflOn && Number.isFinite(L) && L > 0 ? allowableDeflectionInches(L, denomSrc) : null;

      const invalid =
        ![dl, ll, L].every((x) => Number.isFinite(x) && x >= 0) ||
        !Number.isFinite(L) ||
        L <= 0 ||
        !Number.isFinite(Fy) ||
        Fy <= 0;

      const clearDesignOutputs = () => {
        const methodClear = String(methodEl?.value || 'lrfd').toLowerCase();
        const isLRFDClear = methodClear === 'lrfd';
        if (pane) {
          pane.dataset.sfBendDesMethod = isLRFDClear ? 'lrfd' : 'asd';
        }
        if (loadCardNoDef) {
          if (!deflOn) loadCardNoDef.dataset.sfBendDesMethod = isLRFDClear ? 'lrfd' : 'asd';
          else delete loadCardNoDef.dataset.sfBendDesMethod;
        }
        if (els.beamLblN) els.beamLblN.textContent = '—';
        [
          ...Object.values(els.lw),
          els.lpf,
          els.lrf,
          els.verdict,
          els.Mn,
          els.allowDefl,
          els.deflY,
          els.deflYLrfd,
          els.deflYAsd,
          els.ixChip,
          els.ixSec,
          els.ixZx,
          els.ixSx,
          els.ixI,
          els.ixLf,
          els.ixW,
          els.capVal,
          els.capLrfdDem,
          els.capLrfdCap,
          els.capAsdDem,
          els.capAsdCap,
          els.finalSec,
          els.ass1.sec,
          els.ass1.zx,
          els.ass1.w,
          els.ass1.sx,
          els.ass1.ix,
          els.ass1.lf,
          els.ass1.rm,
          els.ass1.secAsd,
          els.ass1.zxAsd,
          els.ass1.ixAsd,
        ].forEach((el) => {
          if (el) el.textContent = '—';
        });
        [
          els.capLrfdRm,
          els.capAsdRm,
          els.deflRmLrfd,
          els.deflRmAsd,
          els.ass1.rm,
          els.ass1.rmAsd,
          els.finalRm,
        ].forEach((el) => {
          if (el) {
            el.textContent = '—';
            el.classList.remove('sf-bendNoDef__remarkPill--safe', 'sf-bendNoDef__remarkPill--unsafe');
          }
        });
        if (els.capSym) els.capSym.innerHTML = 'M<sub>u</sub>';
        clearDeflMirrorPanels();
      };

      if (invalid) {
        clearDesignOutputs();
        return;
      }

      const c12v = 1.2 * dl + 1.6 * ll;
      const c14v = 1.4 * dl;
      const Wu_val = Math.max(c12v, c14v);
      const dlll_val = dl + ll;
      const Wa_val = dlll_val;
      const Mu_val = Wu_val * L * L * KMOM;
      const Ma_req_val = Wa_val * L * L * KMOM;

      const denomIxPanel =
        els.deflLim?.value ||
        els.deflLimY?.value ||
        String(preferredWorkbookDeflectionDenom());
      const deltaIxPanelIn =
        !deflOn && Number.isFinite(L) && L > 0
          ? allowableDeflectionInches(L, denomIxPanel)
          : null;
      let I_ix_panel_min = 0;
      if (
        !deflOn &&
        Number.isFinite(deltaIxPanelIn) &&
        deltaIxPanelIn > 0 &&
        Number.isFinite(dlll_val) &&
        dlll_val >= 0
      ) {
        const ixR = requiredIx(dlll_val, L, E, deltaIxPanelIn, bcDesign.deflectionK);
        if (Number.isFinite(ixR) && ixR > 0) I_ix_panel_min = ixR;
      }

      const demandStrength = isLRFD ? Mu_val : Ma_req_val;
      if (els.capVal) els.capVal.textContent = fmt(demandStrength, 3);

      const lpF = 0.38 * Math.sqrt(E / Fy);
      const lrF = 1.0 * Math.sqrt(E / Fy);
      setOutSpan(els.lpf, fmt(lpF, 8));
      setOutSpan(els.lrf, fmt(lrF, 8));

      let I_min = 0;
      if (deflOn && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
        const ixReqDisp = requiredIx(dlll_val, L, E, deltaLimIn, bcDesign.deflectionK);
        if (Number.isFinite(ixReqDisp) && ixReqDisp > 0) I_min = ixReqDisp;
        setMomentInertiaReqChip(Number.isFinite(ixReqDisp) ? fmt(ixReqDisp, 3) : '—');
        setOutSpan(els.allowDefl, formatDeflectionWorkbookFt(deltaLimIn));
      } else {
        setOutSpan(
          els.ixChip,
          Number.isFinite(I_ix_panel_min) && I_ix_panel_min > 0 ? fmt(I_ix_panel_min, 3) : '—',
        );
      }

      if (wRows.length === 0) {
        clearDesignOutputs();
        /* Allowable Δ and required I<sub>c</sub> use span, service load, and limit only — not the W-shape CSV.
           clearDesignOutputs() wipes them; restore so WITH DEFLECTION card is not stuck on “—” while CSV loads or if fetch fails. */
        if (deflOn && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
          const ixReqDisp = requiredIx(dlll_val, L, E, deltaLimIn, bcDesign.deflectionK);
          setMomentInertiaReqChip(Number.isFinite(ixReqDisp) ? fmt(ixReqDisp, 3) : '—');
          setOutSpan(els.allowDefl, formatDeflectionWorkbookFt(deltaLimIn));
        } else if (!deflOn && Number.isFinite(L) && L > 0) {
          const denomAdv =
            els.deflLim?.value ||
            els.deflLimY?.value ||
            String(preferredWorkbookDeflectionDenom());
          const limAdv = allowableDeflectionInches(L, denomAdv);
          setOutSpan(
            els.allowDefl,
            Number.isFinite(limAdv) && limAdv > 0 ? formatDeflectionWorkbookFt(limAdv) : '—',
          );
          setOutSpan(els.deflYLrfd, '—');
          setOutSpan(els.deflYAsd, '—');
          setOutSpan(els.deflY, '—');
          setRemarkSafe(els.deflRmLrfd, null);
          setRemarkSafe(els.deflRmAsd, null);
        }
        mirrorDeflPanels(ins.beam);
        return;
      }

      const sorted = wRows
        .map((row) => ({
          row,
          wLb: parseNumLike(row[COL.weight]),
          Ix: parseNumLike(row[COL.Ix]),
          lab: String(row[COL.label] || '').trim(),
        }))
        .filter((x) => x.lab && Number.isFinite(x.wLb) && x.wLb > 0 && Number.isFinite(x.Ix) && x.Ix > 0)
        .sort((a, b) => a.wLb - b.wLb || a.Ix - b.Ix);

      const lrfdR = pickBeamSelfWeightShape(true, sorted, I_min, dl, ll, L, KMOM, Fy, E);
      const asdR = pickBeamSelfWeightShape(false, sorted, I_min, dl, ll, L, KMOM, Fy, E);
      const ixPickDefl =
        deflOn && Number.isFinite(I_min) && I_min > 0 ? pickLightestMeetingIx(I_min, sorted) : null;
      const ixPickNoDef =
        !deflOn && Number.isFinite(I_ix_panel_min) && I_ix_panel_min > 0
          ? pickLightestMeetingIx(I_ix_panel_min, sorted)
          : null;

      setOutSpan(els.lw.Wu, fmt(lrfdR.Wu_tot, 4));
      setOutSpan(els.lw.Mu, fmt(lrfdR.Mu_tot, 3));
      setOutSpan(els.lw.Wa, fmt(asdR.Wa_tot, 4));
      setOutSpan(els.lw.Ma, fmt(asdR.Ma_tot, 3));

      const applyAss1Dual = () => {
        if (lrfdR.picked) {
          const p = shapeProps(lrfdR.picked, Fy, E);
          setOutSpan(els.ass1.sec, lrfdR.picked.lab);
          setOutSpan(els.ass1.zx, fmt(p.Zx, 3));
          setOutSpan(els.ass1.w, fmt(lrfdR.picked.wLb, 1));
          setOutSpan(els.ass1.sx, fmt(p.Sx, 3));
          setOutSpan(els.ass1.ix, fmt(lrfdR.picked.Ix, 1));
          setOutSpan(els.ass1.lf, fmt(p.lamF, 6));
          const capL = designStrengthKipFt(Fy, E, p.row, true);
          const WsvcL = dl + ll + lrfdR.w_self;
          let ok = capL != null && capL >= lrfdR.Mu_tot;
          if (deflOn && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
            const dMax = deltaInches(WsvcL, L, E, lrfdR.picked.Ix, bcDesign.deflectionK);
            const ixOk = !(Number.isFinite(I_min) && I_min > 0) || lrfdR.picked.Ix >= I_min - 1e-6;
            const delOk =
              Number.isFinite(dMax) && Number.isFinite(deltaLimIn) ? dMax <= deltaLimIn + 1e-9 : false;
            ok = ok && ixOk && delOk;
          }
          setRemarkSafe(els.ass1.rm, ok);
        } else {
          ['sec', 'zx', 'w', 'sx', 'ix', 'lf'].forEach((k) => setOutSpan(els.ass1[k], '—'));
          setRemarkSafe(els.ass1.rm, null);
        }

        if (asdR.picked) {
          const p = shapeProps(asdR.picked, Fy, E);
          setOutSpan(els.ass1.secAsd, asdR.picked.lab);
          setOutSpan(els.ass1.zxAsd, fmt(p.Zx, 3));
          setOutSpan(els.ass1.ixAsd, fmt(asdR.picked.Ix, 1));
          const capA = designStrengthKipFt(Fy, E, p.row, false);
          const WsvcA = dl + ll + asdR.w_self;
          let ok = capA != null && capA >= asdR.Ma_tot;
          if (deflOn && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
            const dMax = deltaInches(WsvcA, L, E, asdR.picked.Ix, bcDesign.deflectionK);
            const ixOk = !(Number.isFinite(I_min) && I_min > 0) || asdR.picked.Ix >= I_min - 1e-6;
            const delOk =
              Number.isFinite(dMax) && Number.isFinite(deltaLimIn) ? dMax <= deltaLimIn + 1e-9 : false;
            ok = ok && ixOk && delOk;
          }
          setRemarkSafe(els.ass1.rmAsd, ok);
        } else {
          setOutSpan(els.ass1.secAsd, '—');
          setOutSpan(els.ass1.zxAsd, '—');
          setOutSpan(els.ass1.ixAsd, '—');
          setRemarkSafe(els.ass1.rmAsd, null);
        }
      };

      if (!lrfdR.picked && !asdR.picked) {
        applyAss1Dual();
        setOutSpan(els.verdict, '—');
        setOutSpan(els.Mn, '—');
        setOutSpan(els.finalSec, '—');
        setRemarkSafe(els.finalRm, null);
        [
          els.capLrfdDem,
          els.capLrfdCap,
          els.capAsdDem,
          els.capAsdCap,
          els.deflYLrfd,
          els.deflYAsd,
        ].forEach((el) => setOutSpan(el, '—'));
        setRemarkSafe(els.capLrfdRm, null);
        setRemarkSafe(els.capAsdRm, null);
        setRemarkSafe(els.deflRmLrfd, null);
        setRemarkSafe(els.deflRmAsd, null);
        if (!deflOn && Number.isFinite(L) && L > 0) {
          const denomAdv =
            els.deflLim?.value ||
            els.deflLimY?.value ||
            String(preferredWorkbookDeflectionDenom());
          const limAdv = allowableDeflectionInches(L, denomAdv);
          setOutSpan(
            els.allowDefl,
            Number.isFinite(limAdv) && limAdv > 0 ? formatDeflectionWorkbookFt(limAdv) : '—',
          );
        }
        ['ixSec', 'ixZx', 'ixSx', 'ixI', 'ixLf', 'ixW'].forEach((k) => setOutSpan(els[k], '—'));
        mirrorDeflPanels(ins.beam);
        return;
      }

      applyAss1Dual();

      const govPick = isLRFD ? lrfdR.picked : asdR.picked;
      if (govPick) {
        const p = shapeProps(govPick, Fy, E);
        setOutSpan(els.verdict, p.verdict);
        setOutSpan(els.Mn, fmt(p.Mn, 3));
      } else {
        setOutSpan(els.verdict, '—');
        setOutSpan(els.Mn, '—');
      }

      const capL =
        lrfdR.picked != null ? designStrengthKipFt(Fy, E, lrfdR.picked.row, true) : null;
      const capA =
        asdR.picked != null ? designStrengthKipFt(Fy, E, asdR.picked.row, false) : null;

      setOutSpan(els.capLrfdDem, fmt(lrfdR.Mu_tot, 3));
      setOutSpan(els.capLrfdCap, capL != null ? fmt(capL, 3) : '—');
      setRemarkSafe(els.capLrfdRm, capL != null && capL >= lrfdR.Mu_tot);

      setOutSpan(els.capAsdDem, fmt(asdR.Ma_tot, 3));
      setOutSpan(els.capAsdCap, capA != null ? fmt(capA, 3) : '—');
      setRemarkSafe(els.capAsdRm, capA != null && capA >= asdR.Ma_tot);

      const finalLab = govPick ? govPick.lab : '—';
      setOutSpan(els.finalSec, finalLab);

      const bendGovOk = isLRFD
        ? capL != null && capL >= lrfdR.Mu_tot
        : capA != null && capA >= asdR.Ma_tot;

      let deflGovOk = true;
      if (deflOn && govPick && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
        const Wsvc = dl + ll + (isLRFD ? lrfdR.w_self : asdR.w_self);
        const dMax = deltaInches(Wsvc, L, E, govPick.Ix, bcDesign.deflectionK);
        deflGovOk =
          Number.isFinite(dMax) &&
          dMax <= deltaLimIn + 1e-9 &&
          (!(Number.isFinite(I_min) && I_min > 0) || govPick.Ix >= I_min - 1e-6);
      }

      /** SAFE when strength and serviceability pass; M_n already reflects non-compact/slender limits. */
      const overallOk = Boolean(govPick && bendGovOk && deflGovOk);

      setRemarkSafe(els.finalRm, govPick ? overallOk : null);

      if (deflOn && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
        if (lrfdR.picked) {
          const Wl = dl + ll + lrfdR.w_self;
          const dL = deltaInches(Wl, L, E, lrfdR.picked.Ix, bcDesign.deflectionK);
          setOutSpan(els.deflYLrfd, Number.isFinite(dL) ? formatDeflectionWorkbookFt(dL) : '—');
          const ok =
            Number.isFinite(dL) &&
            dL <= deltaLimIn + 1e-9 &&
            (!(Number.isFinite(I_min) && I_min > 0) || lrfdR.picked.Ix >= I_min - 1e-6);
          setRemarkSafe(els.deflRmLrfd, ok);
        } else {
          setOutSpan(els.deflYLrfd, '—');
          setRemarkSafe(els.deflRmLrfd, null);
        }
        if (asdR.picked) {
          const Wa = dl + ll + asdR.w_self;
          const dA = deltaInches(Wa, L, E, asdR.picked.Ix, bcDesign.deflectionK);
          setOutSpan(els.deflYAsd, Number.isFinite(dA) ? formatDeflectionWorkbookFt(dA) : '—');
          const ok =
            Number.isFinite(dA) &&
            dA <= deltaLimIn + 1e-9 &&
            (!(Number.isFinite(I_min) && I_min > 0) || asdR.picked.Ix >= I_min - 1e-6);
          setRemarkSafe(els.deflRmAsd, ok);
        } else {
          setOutSpan(els.deflYAsd, '—');
          setRemarkSafe(els.deflRmAsd, null);
        }
        const dLegacy =
          lrfdR.picked &&
          deltaInches(dl + ll + lrfdR.w_self, L, E, lrfdR.picked.Ix, bcDesign.deflectionK);
        setOutSpan(
          els.deflY,
          Number.isFinite(dLegacy) ? formatDeflectionDual(dLegacy) : '—'
        );
      }

      if (!deflOn && Number.isFinite(L) && L > 0) {
        const denomAdv =
          els.deflLim?.value ||
          els.deflLimY?.value ||
          String(preferredWorkbookDeflectionDenom());
        const limAdv = allowableDeflectionInches(L, denomAdv);
        const kAdv = bcDesign.deflectionK ?? 5 / 384;
        if (Number.isFinite(limAdv) && limAdv > 0) {
          setOutSpan(els.allowDefl, formatDeflectionWorkbookFt(limAdv));
        } else {
          setOutSpan(els.allowDefl, '—');
        }
        if (lrfdR.picked && Number.isFinite(limAdv) && limAdv > 0) {
          const Wl = dl + ll + lrfdR.w_self;
          const dL = deltaInches(Wl, L, E, lrfdR.picked.Ix, kAdv);
          setOutSpan(els.deflYLrfd, Number.isFinite(dL) ? formatDeflectionWorkbookFt(dL) : '—');
          setRemarkSafe(els.deflRmLrfd, Number.isFinite(dL) ? dL <= limAdv + 1e-9 : null);
        } else {
          setOutSpan(els.deflYLrfd, '—');
          setRemarkSafe(els.deflRmLrfd, null);
        }
        if (asdR.picked && Number.isFinite(limAdv) && limAdv > 0) {
          const Wa = dl + ll + asdR.w_self;
          const dA = deltaInches(Wa, L, E, asdR.picked.Ix, kAdv);
          setOutSpan(els.deflYAsd, Number.isFinite(dA) ? formatDeflectionWorkbookFt(dA) : '—');
          setRemarkSafe(els.deflRmAsd, Number.isFinite(dA) ? dA <= limAdv + 1e-9 : null);
        } else {
          setOutSpan(els.deflYAsd, '—');
          setRemarkSafe(els.deflRmAsd, null);
        }
        const dLegacy =
          lrfdR.picked &&
          deltaInches(dl + ll + lrfdR.w_self, L, E, lrfdR.picked.Ix, kAdv);
        setOutSpan(els.deflY, Number.isFinite(dLegacy) ? formatDeflectionDual(dLegacy) : '—');
      }

      /**
       * ASSUMED SECTION BY I_x:
       * - WITH deflection: lightest shape meeting required I_x (may differ from Z_x strength pick).
       * - WITHOUT deflection: same inertia-driven pick using workbook Δ limit and service DL+LL
       *   (strength iteration still omits I_min when deflection design is off).
       */
      const shapeForIxPanel = ixPickDefl || ixPickNoDef || govPick || null;

      if (shapeForIxPanel) {
        const ip = shapeProps(shapeForIxPanel, Fy, E);
        setOutSpan(els.ixSec, shapeForIxPanel.lab);
        setOutSpan(els.ixZx, fmt(ip.Zx, 3));
        setOutSpan(els.ixSx, fmt(ip.Sx, 3));
        setOutSpan(els.ixI, fmt(shapeForIxPanel.Ix, 1));
        setOutSpan(els.ixLf, fmt(ip.lamF, 6));
        setOutSpan(els.ixW, fmt(shapeForIxPanel.wLb, 1));
      } else {
        ['ixSec', 'ixZx', 'ixSx', 'ixI', 'ixLf', 'ixW'].forEach((k) => setOutSpan(els[k], '—'));
      }

      mirrorDeflPanels(ins.beam);
    }
    function wire() {
      pane.querySelectorAll('input, select').forEach((el) => {
        if (el === methodEl || el === methodDefl) return;
        el.addEventListener('input', recompute);
        el.addEventListener('change', recompute);
      });
      function scheduleMethodRecompute(source) {
        syncMethodPeers(source);
        if (scheduleMethodRecompute._queued) return;
        scheduleMethodRecompute._queued = true;
        queueMicrotask(() => {
          scheduleMethodRecompute._queued = false;
          recompute();
        });
      }
      [methodEl, methodDefl].filter(Boolean).forEach((el) => {
        el.addEventListener('change', () => scheduleMethodRecompute(el));
        el.addEventListener('input', () => scheduleMethodRecompute(el));
      });
      /** Sync paired steel controls before bubble handlers so Fy / load rows stay aligned. */
      function syncSteelPeersFrom(source) {
        if (!steelN || !steelY) return;
        if (source === steelN) steelY.value = steelN.value;
        else if (source === steelY) steelN.value = steelY.value;
      }
      steelN.addEventListener('change', () => syncSteelPeersFrom(steelN), true);
      steelY.addEventListener('change', () => syncSteelPeersFrom(steelY), true);
      els.beamN?.addEventListener('change', () => {
        if (els.beamY) els.beamY.value = els.beamN.value;
      });
      els.beamY?.addEventListener('change', () => {
        if (els.beamN) els.beamN.value = els.beamY.value;
      });
      [deflNo, deflYes].forEach((r) => r?.addEventListener('change', recompute));
      els.solve?.addEventListener('click', recompute);
    }

    function applyDefaults() {
      /** Workbook “Bending design with deflection” demo: simple beam UDL, L/360. */
      const dDL = 0.2;
      const dLL = 0.8;
      const dL = 35;
      if (els.dlN && String(els.dlN.value).trim() === '') els.dlN.value = String(dDL);
      if (els.llN && String(els.llN.value).trim() === '') els.llN.value = String(dLL);
      if (els.lN && String(els.lN.value).trim() === '') els.lN.value = String(dL);
      if (els.dlY && String(els.dlY.value).trim() === '') els.dlY.value = String(dDL);
      if (els.llY && String(els.llY.value).trim() === '') els.llY.value = String(dLL);
      if (els.lY && String(els.lY.value).trim() === '') els.lY.value = String(dL);
      if (els.beamN && !String(els.beamN.value).trim()) els.beamN.value = 'simple-u';
      if (els.beamY && !String(els.beamY.value).trim()) els.beamY.value = 'simple-u';
    }

    populateBeamCaseSelect(els.beamN);
    populateBeamCaseSelect(els.beamY);

    const preferredSteelId = getPreferredSteelGradeId();
    const prefDenom = preferredWorkbookDeflectionDenom();
    populateWorkbookDeflectionSelect(els.deflLim, prefDenom);
    populateWorkbookDeflectionSelect(els.deflLimY, prefDenom);
    populateSteelControl(steelN, preferredSteelId);
    populateSteelControl(steelY, preferredSteelId);
    steelY.value = steelN.value;
    applyDefaults();
    wire();
    if (methodDefl && methodEl) methodDefl.value = methodEl.value;

    function syncDesignDeflDataset() {
      if (!root || !deflYes || !deflNo) return;
      root.dataset.sfBendDefl = deflYes.checked ? 'with' : 'without';
    }
    syncDesignDeflDataset();
    [deflNo, deflYes].filter(Boolean).forEach((el) => el.addEventListener('change', syncDesignDeflDataset));

    window.addEventListener('sf:steel-grade-change', () => {
      const pid = window.SteelForge?.activeStructuralSteelGrade?.id ?? getPreferredSteelGradeId();
      const dn = preferredWorkbookDeflectionDenom();
      populateWorkbookDeflectionSelect(els.deflLim, dn);
      populateWorkbookDeflectionSelect(els.deflLimY, dn);
      populateSteelControl(steelN, pid);
      populateSteelControl(steelY, pid);
      steelY.value = steelN.value;
      recompute();
    });

    fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((txt) => {
        const lines = txt.split(/\r?\n/);
        wRows = lines
          .slice(4)
          .map(parseCsvLine)
          .filter((r) => String(r[COL.type] || '').trim() === 'W' && String(r[COL.label] || '').trim());
        recompute();
      })
      .catch(() => recompute());
  };
})();
