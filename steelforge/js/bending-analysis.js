(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  /** Column indices from steel selection workbook (0-based). */
  const COL = { type: 0, label: 2, lamF: 23, lamW: 24, Sx: 30, Zx: 33 };
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
    customOpt.textContent = 'Custom Fy (edit field)';
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

  /**
   * Nominal flexural strength (kip·ft) — matches workbook stepping: Mp when λ ≤ λr;
   * slender flange/web uses 0.7My (no λp–λr linear interpolation).
   */
  function nominalMomentKipFt(Fy, E, Zx, Sx, lamF, lamW) {
    if (![Fy, E, Zx, Sx, lamF, lamW].every((x) => Number.isFinite(x) && x > 0)) return null;

    const My = (Fy * Sx) / 12;
    const Mp = (Fy * Zx) / 12;

    const lrF = 1.0 * Math.sqrt(E / Fy);
    const lrW = 5.7 * Math.sqrt(E / Fy);

    /** Workbook stepping: full Mp when λ ≤ λr (no λp–λr interpolation); slender uses 0.7My. */
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

    if (!methodEl || !shapeEl || !steelEl || !fyEl || !eEl || !mpEl) return;

    let wRows = [];

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
        steelEl.value = gradeLabel(g);
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
      num(fyEl, 3, 0);
    }

    function recompute() {
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

      if (outClass) outClass.textContent = compactnessVerdict(lamF, lamW, Fy, E);

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
        if (isManual()) setGeomReadOnly(false);
        else if (wRows.length) {
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
    syncSteel();
    buildShapeOptions();
    wire();

    window.addEventListener('sf:steel-grade-change', () => {
      const pid = window.SteelForge?.activeStructuralSteelGrade?.id ?? getPreferredSteelGradeId();
      populateSteelControl(steelEl, pid);
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
