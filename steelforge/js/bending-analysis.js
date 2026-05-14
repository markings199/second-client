(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  /** Column indices from steel selection workbook (0-based). */
  const COL = { type: 0, label: 2, lamF: 23, lamW: 24, Ix: 29, Sx: 30, Zx: 33 };
  const PHI_B = 0.9;
  const OMEGA_B = 1.67;
  const E_DEFAULT = 29000;

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

  /** Δ_allow (in) from span L (ft) and workbook denominator n (Δ = L/n). */
  function allowableDeflectionInches(L_ft, denomRaw) {
    const n = parseNumLike(denomRaw);
    if (!Number.isFinite(L_ft) || L_ft <= 0 || !Number.isFinite(n) || n <= 0) return null;
    return (L_ft * 12) / n;
  }

  function deltaInches(W_klf, L_ft, E_ksi, I_in4, deflectionK) {
    if (![W_klf, L_ft, E_ksi, I_in4].every((x) => Number.isFinite(x) && x > 0)) return null;
    const k = deflectionK;
    if (!Number.isFinite(k) || k <= 0) return null;
    return (k * W_klf * Math.pow(12, 3) * Math.pow(L_ft, 4)) / (E_ksi * I_in4);
  }

  function workbookBeamCaseAna(rawId) {
    return window.SteelForgeWorkbookBeamCaseById
      ? window.SteelForgeWorkbookBeamCaseById(rawId)
      : {
          id: 'simple-u',
          deflectionK: 5 / 384,
        };
  }

  function populateAnalysisDeflectionSelect(selectEl, preferredDenom) {
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

  function preferredAnaDeflDenom() {
    const g = window.SteelForge?.activeStructuralSteelGrade;
    const d = g?.workbookDeflectionDenom;
    return Number.isFinite(d) && d > 0 ? d : 360;
  }

  function formatDeflectionDual(deltaIn) {
    if (!Number.isFinite(deltaIn)) return '—';
    return `${fmt(deltaIn / 12, 9)} ft (${fmt(deltaIn, 4)} in)`;
  }

  function formatDeflectionWorkbookFt(deltaIn) {
    if (!Number.isFinite(deltaIn)) return '—';
    return fmt(deltaIn / 12, 9);
  }

  function steelPropsFromGradeSelect(selectValue) {
    if (selectValue === 'custom') return null;
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    return grades.find((x) => x.id === selectValue) ?? null;
  }

  function getPreferredSteelGradeId() {
    const activeId = window.SteelForge?.activeStructuralSteelGrade?.id;
    return activeId || 'a992';
  }

  function populateSteelSelect(selectEl, preferredId = 'a992') {
    const pop = window.SteelForge?.populateStructuralSteelGradeSelect;
    if (typeof pop === 'function' && selectEl) {
      pop(selectEl, preferredId);
      return;
    }
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
      const label = String(g.label || '').trim() || g.id;
      opt.textContent = label;
      const cat = g.catalogId != null ? `ASTM catalog ${g.catalogId}. ` : '';
      opt.title = `${cat}Fy = ${g.fy} ksi, Fu = ${g.fu} ksi`;
      selectEl.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Fy / Fu (edit fields)';
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
    const listId = `${el.id || 'sfBendAnaSteel'}__list`;
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
    return (
      grades.find((g) => normalizeGradeLoose(g.label) === nk) ||
      grades.find((g) => nk.length >= 4 && normalizeGradeLoose(g.label).includes(nk)) ||
      grades.find((g) => nk.length >= 4 && nk.includes(normalizeGradeLoose(g.label))) ||
      null
    );
  }

  /**
   * Flange local buckling — strict parity with workbook BENDING!F22:
   *   λ_pf = 0.38√(E/Fy), λ_rf = 1.0√(E/Fy).
   *   COMPACT:        M_n = M_p = F_y Z_x / 12.
   *   NON-COMPACT:    M_n = M_p − (M_p − 0.7 F_y S_x / 12)·(λ_f − λ_pf)/(λ_rf − λ_pf).
   *   SLENDER FLANGE: M_n = 0.9 · E · S_x · (4/λ_w) / λ_f²   ·1/12
   *                   (workbook elastic flange-local-buckling form using h/tw directly).
   * The slender branch needs λ_w (web slenderness h/tw); when unavailable, returns null.
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
    // Slender flange (workbook strict form). Falls back to 0.7·My if λ_w not provided.
    if (Number.isFinite(lamW) && lamW > 0) {
      return (0.9 * E * Sx * (4 / lamW)) / (lamF * lamF * 12);
    }
    return 0.7 * My;
  }

  /**
   * Web flexural limits (AISC Table B4.1b — rolled I-shape web): λ_pw = 3.76√(E/Fy), λ_rw = 5.70√(E/Fy).
   * Same interpolation form between M_p and 0.7 M_y as flange; governing strength is min(flange, web).
   */
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

  /**
   * Governing nominal flexural strength — strict workbook parity.
   * Workbook classifies on flange only (BENDING!D21 uses λ_f). Web slenderness λ_w is
   * only used inside the slender-flange branch (4/λ_w term). We keep `nominalMomentWebKipFt`
   * available for diagnostic UI but it is NOT used to govern M_n.
   */
  function nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW) {
    return nominalMomentFlangeKipFt(Fy, E, Zx, Sx, lamF, lamW);
  }

  /** UI verdict for CHECK COMPACTNESS card — flange slenderness only (matches λ_pf / λ_rf labels). */
  function flangeCompactnessVerdict(lamF, Fy, E) {
    if (![lamF, Fy, E].every((x) => Number.isFinite(x) && x > 0)) return '—';
    const lpF = 0.38 * Math.sqrt(E / Fy);
    const lrF = 1.0 * Math.sqrt(E / Fy);
    if (lamF <= lpF) return 'COMPACT FLANGE';
    if (lamF <= lrF) return 'NON-COMPACT FLANGE';
    return 'SLENDER FLANGE';
  }

  window.SteelForge = window.SteelForge || {};

  window.SteelForge.initBendingAnalysis = (panelRoot) => {
    const root =
      panelRoot?.querySelector?.('.sf-comp.sf-comp--bending') ??
      document.querySelector('.sf-comp.sf-comp--bending');
    if (!root) return;

    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="analysis"]');
    if (!pane) return;

    const $ = (id) => pane.querySelector(`#${id}`);
    const methodEl = $('sfBendAnaMethod');
    const shapeEl = $('sfBendAnaAisc');
    const lfEl = $('sfBendAnaLf');
    const lwEl = $('sfBendAnaLw');
    const zxEl = $('sfBendAnaZx');
    const sxEl = $('sfBendAnaSx');
    const steelEl = $('sfBendAnaSteel');
    const fyEl = $('sfBendAnaFy');
    const eEl = $('sfBendAnaE');
    const mpEl = $('sfBendAnaMp');
    const outLpf = $('sfBendAnaLpfLim');
    const outLrf = $('sfBendAnaLrfLim');
    const outClass = $('sfBendAnaClass');
    const outMn = $('sfBendAnaMn');
    const outMa = $('sfBendAnaMa');
    const outPhiMn = $('sfBendAnaMu');
    const capLrfdLbl = $('sfBendAnaCapLrfdLbl');
    const solveBtn = $('sfBendAnaSolve');
    const anaDefNo = $('sfBendAnaDefNo');
    const anaDefYes = $('sfBendAnaDefYes');
    const spanFt = $('sfBendAnaSpanFt');
    const wsvc = $('sfBendAnaWsvc');
    const deflLimSel = $('sfBendAnaDeflLim');
    const ixDisp = $('sfBendAnaIxDisp');
    const deltaAllow = $('sfBendAnaDeltaAllow');
    const deltaMax = $('sfBendAnaDeltaMax');
    const deflRm = $('sfBendAnaDeflRm');

    if (!methodEl || !shapeEl || !steelEl || !fyEl || !eEl || !mpEl) return;

    let wRows = [];
    let curIx = null;

    function syncAnaDeflDataset() {
      if (!root || !anaDefYes || !anaDefNo) return;
      root.dataset.sfBendAnaDefl = anaDefYes.checked ? 'with' : 'without';
    }

    const isManual = () => String(shapeEl.value || '') === 'manual';

    function setGeomReadOnly(ro) {
      [lfEl, lwEl, zxEl, sxEl].forEach((el) => {
        if (!el) return;
        el.readOnly = ro;
        el.classList.toggle('sf-bend__readonly', ro);
      });
    }

    function applyWRowByLabel(lab) {
      const hit = wRows.find((r) => String(r[COL.label] || '').trim() === String(lab || '').trim());
      if (!hit) return false;
      if (lfEl) lfEl.value = fmt(parseNumLike(hit[COL.lamF]), 6);
      if (lwEl) lwEl.value = fmt(parseNumLike(hit[COL.lamW]), 6);
      if (zxEl) zxEl.value = fmt(parseNumLike(hit[COL.Zx]), 3);
      if (sxEl) sxEl.value = fmt(parseNumLike(hit[COL.Sx]), 3);
      const ix = parseNumLike(hit[COL.Ix]);
      curIx = Number.isFinite(ix) && ix > 0 ? ix : null;
      if (ixDisp) ixDisp.textContent = Number.isFinite(ix) ? fmt(ix, 1) : '—';
      return true;
    }

    function syncSteel() {
      if (!steelEl) return;
      const g = steelPropsFromControlValue(steelEl.value);
      if (!g || String(steelEl.value).trim().toLowerCase() === 'custom') {
        if (fyEl) {
          fyEl.readOnly = false;
          fyEl.classList.remove('sf-bend__readonly');
        }
        return;
      }
      if (g && fyEl) {
        if (steelEl.tagName === 'SELECT') steelEl.value = g.id;
        else steelEl.value = gradeLabel(g);
        fyEl.value = String(g.fy);
        fyEl.readOnly = true;
        fyEl.classList.add('sf-bend__readonly');
      }
    }

    function normalizeInputs() {
      const num = (el, d = 3, min = 0) => {
        if (!el) return;
        const v = parseNumLike(el.value);
        if (!Number.isFinite(v)) return;
        el.value = fmt(Math.max(min, v), d);
      };
      num(lfEl, 6, 0);
      num(lwEl, 6, 0);
      num(zxEl, 3, 0);
      num(sxEl, 3, 0);
      num(spanFt, 3, 0);
      num(wsvc, 4, 0);
      num(fyEl, 3, 0);
    }

    function updateDeflectionOutputs() {
      const clearPill = () => {
        if (!deflRm) return;
        deflRm.textContent = '—';
        deflRm.classList.remove('sf-bendAna__verdictPill--safe', 'sf-bendAna__verdictPill--unsafe');
      };

      if (!anaDefYes?.checked) {
        if (deltaAllow) deltaAllow.textContent = '—';
        if (deltaMax) deltaMax.textContent = '—';
        clearPill();
        return;
      }

      const L = parseNumLike(spanFt?.value);
      const W = parseNumLike(wsvc?.value);
      const denom = deflLimSel?.value;
      const dAllow = allowableDeflectionInches(L, denom);

      if (deltaAllow) deltaAllow.textContent = formatDeflectionWorkbookFt(dAllow);

      if (!Number.isFinite(curIx) || curIx <= 0 || !Number.isFinite(W) || W <= 0 || !Number.isFinite(L) || L <= 0) {
        if (deltaMax) deltaMax.textContent = '—';
        clearPill();
        return;
      }

      const bc = workbookBeamCaseAna('simple-u');
      const k = bc.deflectionK ?? 5 / 384;
      const dMax = deltaInches(W, L, E_DEFAULT, curIx, k);

      if (deltaMax) deltaMax.textContent = formatDeflectionWorkbookFt(dMax);

      if (deflRm) {
        const ok =
          Number.isFinite(dMax) &&
          Number.isFinite(dAllow) &&
          dAllow > 0 &&
          dMax <= dAllow + 1e-9;
        deflRm.textContent =
          !Number.isFinite(dMax) || !Number.isFinite(dAllow) || dAllow <= 0 ? '—' : ok ? 'SAFE' : 'UNSAFE';
        deflRm.classList.toggle('sf-bendAna__verdictPill--safe', ok);
        deflRm.classList.toggle(
          'sf-bendAna__verdictPill--unsafe',
          Number.isFinite(dMax) && Number.isFinite(dAllow) && dAllow > 0 && !ok,
        );
      }
    }

    function recompute() {
      syncAnaDeflDataset();
      normalizeInputs();
      syncSteel();
      if (eEl) eEl.value = String(E_DEFAULT);

      const method = String(methodEl.value || 'lrfd').toLowerCase();
      const isLRFD = method === 'lrfd';

      if (capLrfdLbl) {
        capLrfdLbl.innerHTML = isLRFD
          ? '<span class="sf-bendAna__capEm">φM<sub>n</sub></span> (LRFD) — governing'
          : '<span class="sf-bendAna__capEm">M<sub>n</sub>/Ω</span> (ASD) — governing';
      }

      const Fy = parseNumLike(fyEl?.value);
      const E = parseNumLike(eEl?.value);
      const Zx = parseNumLike(zxEl?.value);
      const Sx = parseNumLike(sxEl?.value);
      const lamF = parseNumLike(lfEl?.value);
      const lamW = parseNumLike(lwEl?.value);

      const lpF = Number.isFinite(E) && Number.isFinite(Fy) && Fy > 0 ? 0.38 * Math.sqrt(E / Fy) : null;
      const lrF = Number.isFinite(E) && Number.isFinite(Fy) && Fy > 0 ? 1.0 * Math.sqrt(E / Fy) : null;

      if (outLpf) outLpf.textContent = Number.isFinite(lpF) ? fmt(lpF, 8) : '—';
      if (outLrf) outLrf.textContent = Number.isFinite(lrF) ? fmt(lrF, 8) : '—';

      if (outClass) outClass.textContent = flangeCompactnessVerdict(lamF, Fy, E);

      const Mp =
        Number.isFinite(Fy) && Number.isFinite(Zx) ? (Fy * Zx) / 12 : null;
      if (mpEl) mpEl.value = Number.isFinite(Mp) ? fmt(Mp, 3) : '';

      const Mn = nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW);
      if (outMn) outMn.textContent = fmt(Mn, 3);

      const phiMn = Number.isFinite(Mn) ? PHI_B * Mn : null;
      const maAsd = Number.isFinite(Mn) ? Mn / OMEGA_B : null;
      const design = isLRFD ? phiMn : maAsd;

      if (outMa) outMa.textContent = fmt(maAsd, 3);
      if (outPhiMn) outPhiMn.textContent = fmt(phiMn, 3);
      const govEl = $('sfBendAnaGovCap');
      if (govEl) govEl.textContent = fmt(design, 3);

      updateDeflectionOutputs();
    }

    function buildShapeOptions() {
      while (shapeEl.options.length) shapeEl.remove(0);
      const m = document.createElement('option');
      m.value = 'manual';
      m.textContent = 'Manual entry';
      shapeEl.appendChild(m);
      wRows.forEach((r) => {
        const lab = String(r[COL.label] || '').trim();
        if (!lab) return;
        const o = document.createElement('option');
        o.value = lab;
        o.textContent = lab;
        shapeEl.appendChild(o);
      });
    }

    function wire() {
      pane.querySelectorAll('input, select').forEach((el) => {
        if (el === shapeEl) return;
        el.addEventListener('input', recompute);
        el.addEventListener('change', () => {
          if (el === steelEl) syncSteel();
          recompute();
        });
      });
      shapeEl.addEventListener('change', () => {
        if (isManual()) {
          setGeomReadOnly(false);
          curIx = null;
          if (ixDisp) ixDisp.textContent = '—';
        } else if (wRows.length) {
          applyWRowByLabel(shapeEl.value);
          setGeomReadOnly(true);
        }
        recompute();
      });
      solveBtn?.addEventListener('click', recompute);
    }

    if (eEl && String(eEl.value).trim() === '') eEl.value = String(E_DEFAULT);
    if (eEl) {
      eEl.readOnly = true;
      eEl.classList.add('sf-bend__readonly');
    }
    if (mpEl) {
      mpEl.readOnly = true;
      mpEl.classList.add('sf-bend__readonly');
    }
    populateSteelControl(steelEl, getPreferredSteelGradeId());
    populateAnalysisDeflectionSelect(deflLimSel, preferredAnaDeflDenom());
    syncSteel();
    syncAnaDeflDataset();
    buildShapeOptions();
    wire();

    window.addEventListener('sf:steel-grade-change', () => {
      const pid = window.SteelForge?.activeStructuralSteelGrade?.id ?? getPreferredSteelGradeId();
      populateSteelControl(steelEl, pid);
      populateAnalysisDeflectionSelect(deflLimSel, preferredAnaDeflDenom());
      syncSteel();
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
        buildShapeOptions();
        if (wRows.length) {
          const pref =
            wRows.find((r) => String(r[COL.label] || '').trim().toUpperCase() === 'W21X44') ??
            wRows[0];
          const lab = String(pref?.[COL.label] || '').trim();
          shapeEl.value = lab;
          applyWRowByLabel(lab);
          setGeomReadOnly(true);
        } else {
          shapeEl.value = 'manual';
          setGeomReadOnly(false);
        }
        recompute();
      })
      .catch(() => {
        recompute();
      });
  };
})();
