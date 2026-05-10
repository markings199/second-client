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

  function nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW) {
    if (![Fy, E, Zx, Sx, lamF, lamW].every((x) => Number.isFinite(x) && x > 0)) return null;
    const My = (Fy * Sx) / 12;
    const Mp = (Fy * Zx) / 12;
    const lrF = 1.0 * Math.sqrt(E / Fy);
    const lrW = 5.7 * Math.sqrt(E / Fy);
    const branch = (lam, lr) => {
      if (lam <= lr) return Mp;
      return 0.7 * My;
    };
    const MnF = branch(lamF, lrF);
    const MnW = branch(lamW, lrW);
    return Math.min(MnF, MnW);
  }

  function compactnessVerdict(lamF, lamW, Fy, E) {
    if (![lamF, lamW, Fy, E].every((x) => Number.isFinite(x) && x > 0)) return '—';
    const lrF = 1.0 * Math.sqrt(E / Fy);
    const lrW = 5.7 * Math.sqrt(E / Fy);
    if (lamF <= lrF && lamW <= lrW) return 'COMPACT FLANGE';
    return 'SLENDER SECTION';
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

  function steelPropsFromControlValue(v) {
    const t = String(v || '').trim();
    if (!t) return null;
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    return (
      grades.find((g) => g.id === t) ||
      grades.find((g) => String(g.label || '').toLowerCase() === t.toLowerCase()) ||
      grades.find((g) => gradeLabel(g).toLowerCase() === t.toLowerCase()) ||
      null
    );
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
      outN: {
        c12: $('sfBendDesN_c12'),
        c14: $('sfBendDesN_c14'),
        Wu: $('sfBendDesN_Wu'),
        Mu: $('sfBendDesMuN'),
        dlll: $('sfBendDesN_dlll'),
        Wa: $('sfBendDesN_Wa'),
        Ma: $('sfBendDesMaN'),
        ZxReq: $('sfBendDesN_ZxReq'),
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
      },
      lw: { Wu: $('sfBendDesLwWu'), Mu: $('sfBendDesLwMu'), Wa: $('sfBendDesLwWa'), Ma: $('sfBendDesLwMa') },
      ass1: {
        sec: $('sfBendDesAss1Sec'),
        zx: $('sfBendDesZxY'),
        w: $('sfBendDesAss1W'),
        sx: $('sfBendDesAss1Sx'),
        lf: $('sfBendDesAss1Lf'),
        rm: $('sfBendDesAss1Rm'),
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
        finalSec: $('sfBendDesDeflFinalSec'),
        finalRm: $('sfBendDesDeflFinalRm'),
      },
    };

    if (!methodEl || !steelN || !steelY) return;

    let wRows = [];

    function isDeflOn() {
      return deflYes && deflYes.checked;
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

    function copySpan(toEl, fromEl) {
      if (toEl && fromEl) toEl.textContent = fromEl.textContent;
    }

    function copyHtml(toEl, fromEl) {
      if (toEl && fromEl) toEl.innerHTML = fromEl.innerHTML;
    }

    function clearDeflMirrorPanels() {
      const d = els.defl;
      if (!d) return;
      Object.values(d).forEach((el) => {
        if (el) el.textContent = '—';
      });
      if (d.capSym) d.capSym.innerHTML = 'M<sub>u</sub>';
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
      copySpan(d.ass1Rm, els.ass1.rm);
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
      copySpan(d.finalSec, els.finalSec);
      copySpan(d.finalRm, els.finalRm);
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

    let c12v,
      c14v,
      Wu_val,
      Mu_val,
      Ma_req_val,
      dlll_val,
      Wa_val,
      Zx_req;

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

    function syncBeamFormulaLabels(beamRaw) {
      const bc = workbookBeamCase(beamRaw);
      const mom = bc.momentFormula || '—';
      const def = bc.deflectionFormula || '—';
      [els.formulaMomN, els.formulaMomY].forEach((el) => {
        if (el) el.textContent = mom;
      });
      [els.formulaDeflN, els.formulaDeflY].forEach((el) => {
        if (el) el.textContent = def;
      });
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

    function recompute() {
      normalizeInputs();
      const ins = activeInputs();
      const method = String(methodEl.value || 'lrfd').toLowerCase();
      const isLRFD = method === 'lrfd';
      const E = E_DEFAULT;
      const Fy = fyFromSelect(ins.steel);
      setOutSpan(els.fyDispN, Number.isFinite(Fy) ? `${fmt(Fy, 3)} ksi` : '—');
      setOutSpan(els.fyDispY, Number.isFinite(Fy) ? `${fmt(Fy, 3)} ksi` : '—');
      const bc = workbookBeamCase(ins.beam);
      const KMOM = bc.momentCoeff;

      if (els.capSym) {
        els.capSym.innerHTML = isLRFD ? 'M<sub>u</sub> =' : 'M<sub>a</sub> =';
      }

      const dl = ins.dl;
      const ll = ins.ll;
      const L = ins.L;

      const deflOn = isDeflOn();
      if (els.deflLim && els.deflLimY && els.deflLim.value !== els.deflLimY.value) {
        if (deflOn) els.deflLim.value = els.deflLimY.value;
        else els.deflLimY.value = els.deflLim.value;
      }

      const denomSrc =
        deflOn && els.deflLimY ? els.deflLimY.value : els.deflLim ? els.deflLim.value : null;
      const deltaLimIn =
        deflOn && Number.isFinite(L) && L > 0 ? allowableDeflectionInches(L, denomSrc) : null;

      syncBeamFormulaLabels(ins.beam);

      const invalid = ![dl, ll, L].every((x) => Number.isFinite(x) && x >= 0) || !Number.isFinite(L) || L <= 0;

      if (invalid) {
        [
          ...Object.values(els.outN),
          ...Object.values(els.outY),
          ...Object.values(els.lw),
          ...Object.values(els.ass1),
          els.lpf,
          els.lrf,
          els.verdict,
          els.Mn,
          els.allowDefl,
          els.deflY,
          els.ixChip,
          els.ixSec,
          els.ixZx,
          els.ixSx,
          els.ixI,
          els.ixLf,
          els.ixW,
          els.capVal,
          els.finalSec,
          els.finalRm,
          els.fyDispN,
          els.fyDispY,
        ].forEach((el) => {
          if (el) el.textContent = '—';
        });
        if (els.capSym) els.capSym.innerHTML = 'M<sub>u</sub>';
        clearDeflMirrorPanels();
        return;
      }

      c12v = 1.2 * dl + 1.6 * ll;
      c14v = 1.4 * dl;
      Wu_val = Math.max(c12v, c14v);
      dlll_val = dl + ll;
      Wa_val = dlll_val;

      Mu_val = Wu_val * L * L * KMOM;
      Ma_req_val = Wa_val * L * L * KMOM;

      if (isLRFD) {
        Zx_req = (12 * Mu_val) / (PHI_B * Fy);
      } else {
        Zx_req = (12 * Ma_req_val * OMEGA_B) / Fy;
      }

      const oActive = deflOn ? els.outY : els.outN;
      const oIdle = deflOn ? els.outN : els.outY;

      setOutSpan(oActive.c12, fmt(c12v, 4));
      setOutSpan(oActive.c14, fmt(c14v, 4));
      setOutSpan(oActive.Wu, fmt(Wu_val, 4));
      setOutSpan(oActive.Mu, fmt(Mu_val, 3));
      setOutSpan(oActive.dlll, fmt(dlll_val, 4));
      setOutSpan(oActive.Wa, fmt(Wa_val, 4));
      setOutSpan(oActive.Ma, fmt(Ma_req_val, 3));
      setOutSpan(oActive.ZxReq, fmt(Zx_req, 3));

      setOutSpan(oIdle.c12, '—');
      setOutSpan(oIdle.c14, '—');
      setOutSpan(oIdle.Wu, '—');
      setOutSpan(oIdle.Mu, '—');
      setOutSpan(oIdle.dlll, '—');
      setOutSpan(oIdle.Wa, '—');
      setOutSpan(oIdle.Ma, '—');
      setOutSpan(oIdle.ZxReq, '—');

      const demandStrength = isLRFD ? Mu_val : Ma_req_val;
      if (els.capVal) els.capVal.textContent = fmt(demandStrength, 3);

      const lpF = 0.38 * Math.sqrt(E / Fy);
      const lrF = 1.0 * Math.sqrt(E / Fy);
      setOutSpan(els.lpf, fmt(lpF, 8));
      setOutSpan(els.lrf, fmt(lrF, 8));

      let I_min = 0;
      if (deflOn && Number.isFinite(deltaLimIn) && deltaLimIn > 0) {
        const Wsvc = dlll_val;
        const ixReq = requiredIx(Wsvc, L, E, deltaLimIn, bc.deflectionK);
        if (Number.isFinite(ixReq) && ixReq > 0) I_min = ixReq;
        setOutSpan(els.ixChip, fmt(ixReq, 1));
        setOutSpan(els.allowDefl, formatDeflectionDual(deltaLimIn));
      } else {
        setOutSpan(els.ixChip, '—');
        setOutSpan(els.allowDefl, '—');
        setOutSpan(els.deflY, '—');
      }

      if (wRows.length === 0) {
        setOutSpan(els.lw.Wu, '—');
        setOutSpan(els.lw.Mu, '—');
        setOutSpan(els.lw.Wa, '—');
        setOutSpan(els.lw.Ma, '—');
        setOutSpan(els.ass1.sec, '—');
        setOutSpan(els.ass1.zx, '—');
        setOutSpan(els.ass1.w, '—');
        setOutSpan(els.ass1.sx, '—');
        setOutSpan(els.ass1.lf, '—');
        setOutSpan(els.ass1.rm, '—');
        setOutSpan(els.verdict, '—');
        setOutSpan(els.Mn, '—');
        setOutSpan(els.finalSec, '—');
        setOutSpan(els.finalRm, '—');
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

      let w_self = 0;
      let picked = null;
      let Wu_tot = Wu_val;
      let Wa_tot = Wa_val;
      let Mu_tot = Mu_val;
      let Ma_tot = Ma_req_val;

      for (let iter = 0; iter < 15; iter++) {
        Wu_tot = Math.max(1.2 * (dl + w_self) + 1.6 * ll, 1.4 * (dl + w_self));
        Wa_tot = dl + ll + w_self;
        Mu_tot = Wu_tot * L * L * KMOM;
        Ma_tot = Wa_tot * L * L * KMOM;
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

      if (!picked) {
        setOutSpan(els.lw.Wu, fmt(Wu_tot, 4));
        setOutSpan(els.lw.Mu, fmt(Mu_tot, 3));
        setOutSpan(els.lw.Wa, fmt(Wa_tot, 4));
        setOutSpan(els.lw.Ma, fmt(Ma_tot, 3));
        setOutSpan(els.ass1.sec, '—');
        setOutSpan(els.ass1.zx, '—');
        setOutSpan(els.ass1.w, '—');
        setOutSpan(els.ass1.sx, '—');
        setOutSpan(els.ass1.lf, '—');
        setOutSpan(els.verdict, '—');
        setOutSpan(els.Mn, '—');
        setOutSpan(els.finalSec, '—');
        setOutSpan(els.finalRm, 'No W-shape satisfies strength / inertia checks.');
        setOutSpan(els.ass1.rm, '—');
        if (deflOn) {
          ['ixSec', 'ixZx', 'ixSx', 'ixI', 'ixLf', 'ixW'].forEach((k) => setOutSpan(els[k], '—'));
        }
        mirrorDeflPanels(ins.beam);
        return;
      }

      const row = picked.row;
      const lab = picked.lab;
      const Zx = parseNumLike(row[COL.Zx]);
      const Sx = parseNumLike(row[COL.Sx]);
      const lamF = parseNumLike(row[COL.lamF]);
      const lamW = parseNumLike(row[COL.lamW]);
      const Mn = nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW);
      const verdict = compactnessVerdict(lamF, lamW, Fy, E);

      setOutSpan(els.lw.Wu, fmt(Wu_tot, 4));
      setOutSpan(els.lw.Mu, fmt(Mu_tot, 3));
      setOutSpan(els.lw.Wa, fmt(Wa_tot, 4));
      setOutSpan(els.lw.Ma, fmt(Ma_tot, 3));

      setOutSpan(els.ass1.sec, lab);
      setOutSpan(els.ass1.zx, fmt(Zx, 3));
      setOutSpan(els.ass1.w, fmt(picked.wLb, 1));
      setOutSpan(els.ass1.sx, fmt(Sx, 3));
      setOutSpan(els.ass1.lf, fmt(lamF, 6));
      setOutSpan(els.verdict, verdict);
      setOutSpan(els.Mn, fmt(Mn, 3));

      const rm = `${isLRFD ? 'LRFD' : 'ASD'} demand ${fmt(isLRFD ? Mu_tot : Ma_tot, 3)} kips·ft; ${isLRFD ? 'φMₙ' : 'Mₙ/Ω'} ${fmt(designStrengthKipFt(Fy, E, row, isLRFD), 3)} kips·ft.`;
      setOutSpan(els.ass1.rm, rm);

      setOutSpan(els.finalSec, lab);
      setOutSpan(
        els.finalRm,
        verdict.includes('SLENDER SECTION')
          ? 'Check slender-element provisions; nominal strength reduced.'
          : 'Section satisfies bending strength for governing combination.'
      );

      if (deflOn) {
        const Wsvc = dl + ll + w_self;
        const dMax = deltaInches(Wsvc, L, E, picked.Ix, bc.deflectionK);
        setOutSpan(els.deflY, Number.isFinite(dMax) ? formatDeflectionDual(dMax) : '—');
        setOutSpan(els.ixSec, lab);
        setOutSpan(els.ixZx, fmt(Zx, 3));
        setOutSpan(els.ixSx, fmt(Sx, 3));
        setOutSpan(els.ixI, fmt(picked.Ix, 1));
        setOutSpan(els.ixLf, fmt(lamF, 6));
        setOutSpan(els.ixW, fmt(picked.wLb, 1));
      } else {
        ['ixSec', 'ixZx', 'ixSx', 'ixI', 'ixLf', 'ixW'].forEach((k) => {
          if (els[k]) els[k].textContent = '—';
        });
      }

      mirrorDeflPanels(ins.beam);
    }

    function wire() {
      pane.querySelectorAll('input, select').forEach((el) => {
        if (el === methodEl || el === methodDefl) return;
        el.addEventListener('input', recompute);
        el.addEventListener('change', recompute);
      });
      [methodEl, methodDefl].filter(Boolean).forEach((el) => {
        el.addEventListener('change', () => {
          syncMethodPeers(el);
          recompute();
        });
      });
      steelN.addEventListener('change', () => {
        steelY.value = steelN.value;
      });
      steelY.addEventListener('change', () => {
        steelN.value = steelY.value;
      });
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
      const dDL = 0.15;
      const dLL = 0.4;
      const dL = 24;
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
