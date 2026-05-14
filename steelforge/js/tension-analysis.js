(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = {
    type: 0,
    label: 2,
    Ag: 5,
    tPrimary: 8,
    tFallbackA: 9,
    tFallbackB: 14,
    xbar: 38,
  };

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

  /**
   * Workbook / client: BOLT → d<sub>h</sub> = d<sub>b</sub> + 1/8 in.
   * HOLE (punch / listed hole dia.) → add 1/16 in to final d<sub>h</sub> (not “as-is”).
   */
  const BOLT_TO_HOLE_ADD_IN = 1 / 8;
  const HOLE_PUNCH_ADD_IN = 1 / 16;
  const PHI_LRFD_BLOCK = 0.75;
  const OMEGA_ASD_BLOCK = 2.0;

  function fmt(v, d = 3) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(d).replace(/\.?0+$/, '');
  }

  function holeDiameterFromBoltDia(boltDiaIn) {
    if (!Number.isFinite(boltDiaIn) || boltDiaIn <= 0) return null;
    return boltDiaIn + BOLT_TO_HOLE_ADD_IN;
  }

  /** @param {'bolt'|'hole'|string} kind */
  function effectiveHoleDiameterInches(kind, givenInches) {
    if (!Number.isFinite(givenInches) || givenInches <= 0) return null;
    const k = String(kind || 'bolt').toLowerCase();
    if (k === 'hole') return givenInches + HOLE_PUNCH_ADD_IN;
    return holeDiameterFromBoltDia(givenInches);
  }

  function toNumInput(v, fallback = '') {
    return Number.isFinite(v) ? String(v) : fallback;
  }

  function minPositive(arr) {
    const vals = arr.filter((x) => Number.isFinite(x) && x > 0);
    return vals.length ? Math.min(...vals) : null;
  }

  function finiteMin(arr) {
    const vals = arr.filter((x) => Number.isFinite(x));
    return vals.length ? Math.min(...vals) : null;
  }

  function getActiveSteelGrade() {
    const g = window.SteelForge?.activeStructuralSteelGrade;
    if (!g) return null;
    if (!Number.isFinite(Number(g.fy)) || !Number.isFinite(Number(g.fu))) return null;
    return g;
  }

  function populateTenSteelGradeSelect(selectEl, preferredId) {
    const pop = window.SteelForge?.populateStructuralSteelGradeSelect;
    if (typeof pop !== 'function' || !selectEl) return;
    const pref =
      preferredId ??
      window.SteelForge?.getPreferredStructuralSteelGradeId?.() ??
      'a992';
    pop(selectEl, pref);
  }

  function applyStructuralGradeSelectToFyFu(steelSelect, fyEl, fuEl) {
    const propsFn = window.SteelForge?.steelPropsFromStructuralGradeSelect;
    if (!steelSelect || !fyEl || !fuEl || typeof propsFn !== 'function') return;
    if (steelSelect.value === 'custom') {
      fyEl.readOnly = false;
      fuEl.readOnly = false;
      return;
    }
    const g = propsFn(steelSelect.value);
    if (g && Number.isFinite(Number(g.fy)) && Number.isFinite(Number(g.fu))) {
      fyEl.value = String(g.fy);
      fuEl.value = String(g.fu);
      fyEl.readOnly = true;
      fuEl.readOnly = true;
    }
  }

  /**
   * Numeric U from shear lag case (analysis / design).
   * CASE 2: U = 1 − x̄/L when x̄ and L are finite and L > 0; otherwise workbook fallback (e.g. 0.75).
   */
  function shearLagUFromSelection(lagRaw, xbarIn, LconnIn) {
    const raw = String(lagRaw ?? '').trim();
    if (!raw) return null;
    const nDirect = parseNumLike(raw);
    if (Number.isFinite(nDirect)) return nDirect;
    const m = raw.match(/^case\s*(.+)$/i);
    if (!m) return null;
    let key = String(m[1]).trim().replace(/\s+/g, '').toLowerCase();
    key = key.replace(/^0+/, '') || '0';
    if (key === '8') key = '8a';
    const case2ish = key === '2' || key === '2a';
    if (case2ish && Number.isFinite(xbarIn) && Number.isFinite(LconnIn) && LconnIn > 0) {
      const u = 1 - xbarIn / LconnIn;
      if (Number.isFinite(u)) return Math.max(0, Math.min(1, u));
    }
    if (window.SteelForgeWorkbookShearLagU) {
      const bookKey = case2ish ? '2' : key;
      const uBook = window.SteelForgeWorkbookShearLagU(bookKey);
      if (Number.isFinite(uBook)) return uBook;
    }
    return null;
  }

  window.SteelForge = window.SteelForge || {};
  window.SteelForge.initTensionAnalysis = (panelRoot) => {
    const pane = panelRoot?.querySelector?.('.sf-comp--tension .sf-comp__mode[data-comp-mode-pane="analysis"]');
    if (!pane) return;

    const el = (id) => pane.querySelector(`#${id}`);
    const methodEl = el('sfTenAnaMethod');
    const shapeEl = el('sfTenAnaShape');
    const aiscEl = el('sfTenAnaAisc');
    const tEl = el('sfTenAnaT');
    const agEl = el('sfTenAnaAgProp');
    const xbarEl = el('sfTenAnaXbar');
    const lenEl = el('sfTenAnaLength');
    const steelEl = el('sfTenAnaSteel');
    const fyEl = el('sfTenAnaFy');
    const fuEl = el('sfTenAnaFu');
    const lagEl = el('sfTenAnaShearLag');
    const uGovEl = el('sfTenAnaUgovern');
    const nEl = el('sfTenAnaNBolts');
    const boltKindEl = el('sfTenAnaBoltKind');
    const dhEl = el('sfTenAnaDh');
    const ahEl = el('sfTenAnaAh');
    const anNsEl = el('sfTenAnaAnNs');
    const anStEl = el('sfTenAnaAnStag');
    const anGovEl = el('sfTenAnaAnGov');
    const sEls = [1, 2, 3, 4, 5].map((i) => el(`sfTenAnaS${i}`));
    const gEls = [1, 2, 3, 4, 5].map((i) => el(`sfTenAnaG${i}`));
    const sumEl = el('sfTenAnaStagSum');

    const outLrfdY = el('sfTenAnaLrfdYield');
    const outLrfdF = el('sfTenAnaLrfdFracture');
    const outLrfdGov = el('sfTenAnaLrfdGov');
    const outLrfdUlt = el('sfTenAnaLrfdUlt');
    const outAsdY = el('sfTenAnaAsdYield');
    const outAsdF = el('sfTenAnaAsdFracture');
    const outAsdGov = el('sfTenAnaAsdGov');
    const outAsdAllow = el('sfTenAnaAsdAllow');
    const solveBtn = el('sfTenAnaSolve');

    if (!methodEl || !shapeEl || !aiscEl) return;

    populateTenSteelGradeSelect(steelEl);

    const suggestEl = pane.querySelector('#sfTenAnaAiscSuggest');
    const toggleEl = pane.querySelector('#sfTenAnaAiscToggle');
    const searchWrap = aiscEl.closest('.sf-tenAna__searchWrap');

    /** Normalize free-text query: uppercase, strip whitespace and separators. */
    function normalizeQuery(s) {
      return String(s || '').toUpperCase().replace(/[\s\-_.·]/g, '');
    }

    function setSuggestOpen(isOpen) {
      if (!suggestEl) return;
      suggestEl.hidden = !isOpen;
      aiscEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    const CSV_TYPES = new Set(['L', '2L', 'W', 'WT', 'HP', 'C', 'MC', 'S', 'ST', 'MT']);

    function shapeTypeSet(shapeVal) {
      const v = String(shapeVal || 'l').toLowerCase();
      if (v === 'l') return new Set(['L']);
      if (v === '2l') return new Set(['2L']);
      if (v === 'w') return new Set(['W', 'WT', 'HP']);
      if (v === 'c') return new Set(['C', 'MC', 'S', 'ST', 'MT']);
      return new Set();
    }

    function shapeThicknessFamily(shapeVal) {
      const v = String(shapeVal || 'l').toLowerCase();
      if (v === 'l' || v === '2l') return 'angle';
      if (v === 'w' || v === 'c') return 'wide';
      return 'manual';
    }

    let allSteelRows = [];
    let angleRows = [];
    let stagSumTouched = false;

    /**
     * Parse the SHEAR LAG FACTOR selector into a numeric U:
     *   - Numeric input ("0.85") → use directly.
     *   - "CASE X" → look up workbook table (S(ASTM)) via SHEAR_LAG_CASES.
     *   - Bare "CASE 8" coerces to 8a for parity with design tension.
     */
    function getUFromLagSelect() {
      return shearLagUFromSelection(
        lagEl?.value,
        parseNumLike(xbarEl?.value),
        parseNumLike(lenEl?.value),
      );
    }

    const isManualMode = () => String(shapeEl.value || '').toLowerCase() === 'manual';

    function refreshShapeCatalog() {
      const want = shapeTypeSet(shapeEl.value);
      angleRows =
        want.size === 0
          ? []
          : allSteelRows.filter((r) => want.has(String(r[COL.type] || '').trim()));
    }

    /**
     * Build dropdown matches by normalized substring match and show them.
     * Empty query shows the first 30 of the current shape pool so scroll/pick works.
     */
    function renderSuggest(qRaw) {
      if (!suggestEl) return;
      if (isManualMode()) {
        setSuggestOpen(false);
        return;
      }
      const q = normalizeQuery(qRaw);
      const pool = angleRows;
      const matches = !q
        ? pool.slice(0, 30)
        : pool
            .filter((r) => normalizeQuery(r[COL.label]).includes(q))
            .slice(0, 50);

      suggestEl.innerHTML = '';
      if (matches.length === 0) {
        const li = document.createElement('li');
        li.className = 'sf-tenAna__suggestEmpty';
        li.textContent = pool.length ? 'No matching section' : 'Catalog unavailable';
        suggestEl.appendChild(li);
      } else {
        matches.forEach((row) => {
          const lab = String(row[COL.label] || '').trim();
          const li = document.createElement('li');
          li.className = 'sf-tenAna__suggestItem';
          li.textContent = lab;
          li.setAttribute('role', 'option');
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            applyAiscRowByLabel(lab);
            setSuggestOpen(false);
            recompute();
          });
          suggestEl.appendChild(li);
        });
      }
      setSuggestOpen(true);
    }

    function setGeometryReadOnly(isReadOnly) {
      [tEl, agEl, xbarEl].forEach((x) => {
        if (x) x.readOnly = isReadOnly;
      });
    }

    function applyAiscRowByLabel(label) {
      const hit = angleRows.find((r) => String(r[COL.label] || '').trim().toUpperCase() === String(label || '').trim().toUpperCase());
      if (!hit) return false;
      const fam = shapeThicknessFamily(shapeEl.value);
      let tVal = null;
      let xbarVal = null;
      if (fam === 'angle') {
        tVal =
          parseNumLike(hit[COL.tPrimary]) ??
          parseNumLike(hit[COL.tFallbackA]) ??
          parseNumLike(hit[COL.tFallbackB]) ??
          null;
        xbarVal = parseNumLike(hit[COL.xbar]);
      } else if (fam === 'wide') {
        tVal = parseNumLike(hit[14]) ?? parseNumLike(hit[8]) ?? null;
        xbarVal = parseNumLike(hit[38]) ?? parseNumLike(hit[32]) ?? null;
      } else {
        return false;
      }
      const agVal = parseNumLike(hit[COL.Ag]);
      if (tEl) tEl.value = toNumInput(tVal);
      if (agEl) agEl.value = toNumInput(agVal);
      if (xbarEl) xbarEl.value = toNumInput(xbarVal);
      aiscEl.value = String(hit[COL.label] || '').trim();
      stagSumTouched = false;
      return true;
    }

    function applySteelDefaults() {
      applyStructuralGradeSelectToFyFu(steelEl, fyEl, fuEl);
    }

    function syncAnalysisCapacityLabels(isLRFD) {
      pane.querySelectorAll('.capacity-inline .capacity-table--inline').forEach((tbl) => {
        const rows = tbl.querySelectorAll('tr');
        if (rows.length < 4) return;
        const ths = [0, 1, 2, 3].map((i) => rows[i]?.querySelector('th')).filter(Boolean);
        if (ths.length < 4) return;
        ths[0].innerHTML = isLRFD ? 'YIELDING (φT<sub>n</sub>, LRFD)' : 'YIELDING (P<sub>n</sub>/Ω, ASD)';
        ths[1].innerHTML = isLRFD ? 'FRACTURE (φT<sub>n</sub>, LRFD)' : 'FRACTURE (P<sub>n</sub>/Ω, ASD)';
        ths[2].innerHTML = isLRFD ? 'BLOCK SHEAR (LRFD)' : 'BLOCK SHEAR (ASD)';
        ths[3].innerHTML = isLRFD ? 'GOVERNING (LRFD)' : 'GOVERNING (ASD)';
      });
    }

    function normalizeInputs() {
      if (nEl) {
        const n = parseNumLike(nEl.value);
        if (Number.isFinite(n)) nEl.value = String(Math.max(0, Math.round(n)));
      }
      ['sfTenAnaBlkNShear', 'sfTenAnaBlkNTension'].forEach((bid) => {
        const bx = el(bid);
        if (!bx) return;
        const vn = parseNumLike(bx.value);
        if (Number.isFinite(vn)) bx.value = String(Math.max(0, Math.round(vn)));
      });
      const blkUbs = el('sfTenAnaBlkUbs');
      if (blkUbs) {
        const ubs = parseNumLike(blkUbs.value);
        if (Number.isFinite(ubs)) blkUbs.value = fmt(Math.max(0, ubs), 3);
      }
    }

    function recompute() {
      if (!lagEl || !uGovEl || !ahEl || !anNsEl || !anStEl || !anGovEl) return;
      normalizeInputs();
      const t = parseNumLike(tEl?.value);
      const Ag = parseNumLike(agEl?.value);
      const L = parseNumLike(lenEl?.value);
      const n = parseNumLike(nEl?.value);
      const Fy = parseNumLike(fyEl?.value);
      const Fu = parseNumLike(fuEl?.value);

      const U = getUFromLagSelect();
      uGovEl.textContent = fmt(U, 3);

      const givenDia = parseNumLike(dhEl?.value);
      const boltKind = String(boltKindEl?.value || 'bolt').toLowerCase();
      const dhHole = effectiveHoleDiameterInches(boltKind, givenDia);
      const Ah =
        Number.isFinite(n) &&
        n > 0 &&
        Number.isFinite(dhHole) &&
        dhHole > 0 &&
        Number.isFinite(t) &&
        t > 0
          ? n * dhHole * t
          : null;
      ahEl.textContent = fmt(Ah, 4);

      const dfDispEl = el('sfTenAnaDfDisp');
      if (dfDispEl) {
        dfDispEl.textContent = Number.isFinite(dhHole) ? fmt(dhHole, 4) : '—';
      }

      const blkBoltAlias = el('sfTenAnaBlkBoltAlias');
      if (blkBoltAlias) {
        blkBoltAlias.textContent = Number.isFinite(givenDia) ? fmt(givenDia, 4) : '—';
      }
      const blkDhDisp = el('sfTenAnaBlkDhDisp');
      if (blkDhDisp) {
        blkDhDisp.textContent = Number.isFinite(dhHole) ? fmt(dhHole, 4) : '—';
      }

      const AnNs = Number.isFinite(Ag) && Number.isFinite(Ah) ? Ag - Ah : null;
      anNsEl.textContent = fmt(AnNs, 3);

      let sum = 0;
      let hasPair = false;
      sEls.forEach((sEl, i) => {
        const s = parseNumLike(sEl?.value);
        const g = parseNumLike(gEls[i]?.value);
        if (Number.isFinite(s) && Number.isFinite(g) && g > 0) {
          hasPair = true;
          sum += (s * s) / (4 * g);
        }
      });
      if (sumEl && !stagSumTouched) sumEl.value = hasPair ? fmt(sum, 3) : '';
      const stagSum = parseNumLike(sumEl?.value);

      // Strict workbook parity (TENSION D30): An_staggered = (Ag − Ah) + Σ(s²/4g)
      // — workbook does NOT multiply the staggered correction by t.
      const AnSt = Number.isFinite(Ag) && Number.isFinite(Ah) && Number.isFinite(stagSum)
        ? Ag - Ah + stagSum
        : null;
      anStEl.textContent = fmt(AnSt, 3);

      const AnGov =
        Number.isFinite(AnNs) && Number.isFinite(AnSt) ? Math.min(AnNs, AnSt) :
        Number.isFinite(AnNs) ? AnNs :
        Number.isFinite(AnSt) ? AnSt : null;
      anGovEl.textContent = fmt(AnGov, 3);

      const Ae = Number.isFinite(U) && Number.isFinite(AnGov) ? U * AnGov : null;
      const aeDisplayEl = el('sfTenAnaAe');
      if (aeDisplayEl) aeDisplayEl.textContent = fmt(Ae, 4);

      const blkNS = parseNumLike(el('sfTenAnaBlkNShear')?.value);
      const blkLS = parseNumLike(el('sfTenAnaBlkLshear')?.value);
      const blkNT = parseNumLike(el('sfTenAnaBlkNTension')?.value);
      const blkLT = parseNumLike(el('sfTenAnaBlkLtension')?.value);
      const blkUbs = parseNumLike(el('sfTenAnaBlkUbs')?.value);

      const outBlkAgv = el('sfTenAnaBlkAgv');
      const outBlkAnv = el('sfTenAnaBlkAnv');
      const outBlkAgt = el('sfTenAnaBlkAgt');
      const outBlkAnt = el('sfTenAnaBlkAnt');
      const outBlkTermFuAnv = el('sfTenAnaBlkTermFuAnv');
      const outBlkTermFyAgv = el('sfTenAnaBlkTermFyAgv');
      const outBlkTermUbFuAnt = el('sfTenAnaBlkTermUbFuAnt');
      const outBlkGovShearLeg = el('sfTenAnaBlkGovShearLeg');
      const outBlkRnGov = el('sfTenAnaBlkRnGov');
      const capBlkEl = el('sfTenAnaCapBlock');

      let lrfdBlock = null;
      let asdBlock = null;

      const ntBlk = Number.isFinite(blkNT) ? blkNT : null;
      const clearBlkStrength = () => {
        [
          outBlkTermFuAnv,
          outBlkTermFyAgv,
          outBlkTermUbFuAnt,
          outBlkGovShearLeg,
          outBlkRnGov,
          capBlkEl,
        ].forEach((node) => {
          if (node) node.textContent = '—';
        });
      };
      const clearBlkAll = () => {
        [
          outBlkAgv,
          outBlkAnv,
          outBlkAgt,
          outBlkAnt,
          outBlkTermFuAnv,
          outBlkTermFyAgv,
          outBlkTermUbFuAnt,
          outBlkGovShearLeg,
          outBlkRnGov,
          capBlkEl,
        ].forEach((node) => {
          if (node) node.textContent = '—';
        });
      };

      if (
        Number.isFinite(t) &&
        t > 0 &&
        Number.isFinite(Fy) &&
        Fy > 0 &&
        Number.isFinite(Fu) &&
        Fu > 0 &&
        Number.isFinite(dhHole) &&
        dhHole > 0 &&
        Number.isFinite(blkNS) &&
        blkNS >= 0 &&
        Number.isFinite(blkLS) &&
        blkLS > 0 &&
        Number.isFinite(ntBlk) &&
        ntBlk >= 0 &&
        Number.isFinite(blkLT) &&
        blkLT > 0 &&
        Number.isFinite(blkUbs) &&
        blkUbs > 0
      ) {
        const AgvBlk = 2 * blkLS * t;
        const AnvBlk = AgvBlk - blkNS * dhHole * t;
        const AgtBlk = blkLT * t;
        const AntBlk = AgtBlk - ntBlk * dhHole * t;
        if (outBlkAgv) outBlkAgv.textContent = fmt(AgvBlk, 4);
        if (outBlkAnv) outBlkAnv.textContent = fmt(AnvBlk, 4);
        if (outBlkAgt) outBlkAgt.textContent = fmt(AgtBlk, 4);
        if (outBlkAnt) outBlkAnt.textContent = fmt(AntBlk, 4);

        const f1v = AnvBlk > 0 ? 0.6 * Fu * AnvBlk : null;
        const f2v = AgvBlk > 0 ? 0.6 * Fy * AgvBlk : null;
        const ft = AntBlk > 0 ? blkUbs * Fu * AntBlk : null;

        if (outBlkTermFuAnv) outBlkTermFuAnv.textContent = f1v != null ? fmt(f1v, 4) : '—';
        if (outBlkTermFyAgv) outBlkTermFyAgv.textContent = f2v != null ? fmt(f2v, 4) : '—';
        if (outBlkTermUbFuAnt) outBlkTermUbFuAnt.textContent = ft != null ? fmt(ft, 4) : '—';
        if (outBlkGovShearLeg) {
          if (f1v != null && f2v != null) outBlkGovShearLeg.textContent = fmt(Math.min(f1v, f2v), 4);
          else outBlkGovShearLeg.textContent = '—';
        }

        if (AnvBlk > 0 && AntBlk > 0) {
          const tensPart = ft;
          const rnShearRupt = f1v + tensPart;
          const rnShearYield = f2v + tensPart;
          const rnGovBlk = Math.min(rnShearRupt, rnShearYield);
          lrfdBlock = PHI_LRFD_BLOCK * rnGovBlk;
          asdBlock = rnGovBlk / OMEGA_ASD_BLOCK;
          if (outBlkRnGov) outBlkRnGov.textContent = fmt(rnGovBlk, 3);
        } else {
          if (outBlkRnGov) outBlkRnGov.textContent = '—';
          lrfdBlock = null;
          asdBlock = null;
          if (capBlkEl) capBlkEl.textContent = '—';
        }
      } else {
        clearBlkAll();
      }

      const lrfdYield = Number.isFinite(Fy) && Number.isFinite(Ag) ? 0.9 * Fy * Ag : null;
      const lrfdFrac = Number.isFinite(Fu) && Number.isFinite(Ae) ? 0.75 * Fu * Ae : null;
      const asdYield = Number.isFinite(Fy) && Number.isFinite(Ag) ? (Fy * Ag) / 1.67 : null;
      const asdFrac = Number.isFinite(Fu) && Number.isFinite(Ae) ? (Fu * Ae) / 2.0 : null;
      const finLrfdGov = finiteMin([lrfdYield, lrfdFrac, lrfdBlock]);
      const finAsdGov = finiteMin([asdYield, asdFrac, asdBlock]);

      const isLRFD = String(methodEl?.value || 'lrfd').toLowerCase() === 'lrfd';
      syncAnalysisCapacityLabels(isLRFD);

      const dispYield = isLRFD ? lrfdYield : asdYield;
      const dispFrac = isLRFD ? lrfdFrac : asdFrac;
      const dispBlk = isLRFD ? lrfdBlock : asdBlock;
      const dispGov = isLRFD ? finLrfdGov : finAsdGov;

      if (outLrfdY) outLrfdY.textContent = fmt(dispYield, 3);
      if (outLrfdF) outLrfdF.textContent = fmt(dispFrac, 3);
      if (capBlkEl) capBlkEl.textContent = fmt(dispBlk, 3);
      if (outLrfdGov) outLrfdGov.textContent = fmt(dispGov, 3);
      if (outLrfdUlt) outLrfdUlt.textContent = fmt(dispGov, 3);
      if (outAsdY) outAsdY.textContent = fmt(asdYield, 3);
      if (outAsdF) outAsdF.textContent = fmt(asdFrac, 3);
      if (outAsdGov) outAsdGov.textContent = fmt(finAsdGov, 3);
      if (outAsdAllow) outAsdAllow.textContent = fmt(finAsdGov, 3);
    }

    function setDefaults() {
      if (methodEl && !methodEl.value) methodEl.value = 'lrfd';
      if (shapeEl && !shapeEl.value) shapeEl.value = 'l';
      if (lenEl && !String(lenEl.value).trim()) lenEl.value = '120';
      if (nEl && !String(nEl.value).trim()) nEl.value = '1';
      if (dhEl && !String(dhEl.value).trim()) dhEl.value = '3/4';
      if (lagEl && !String(lagEl.value).trim()) lagEl.value = 'CASE 8a';
      applySteelDefaults();
      setGeometryReadOnly(!isManualMode());
      stagSumTouched = false;
      const blkNS = el('sfTenAnaBlkNShear');
      const blkNT = el('sfTenAnaBlkNTension');
      const blkLS = el('sfTenAnaBlkLshear');
      const blkLT = el('sfTenAnaBlkLtension');
      const blkUbsEl = el('sfTenAnaBlkUbs');
      if (blkNS && !String(blkNS.value).trim()) blkNS.value = '5';
      if (blkLS && !String(blkLS.value).trim()) blkLS.value = '7.5';
      if (blkLT && !String(blkLT.value).trim()) blkLT.value = '9';
      if (blkUbsEl && !String(blkUbsEl.value).trim()) blkUbsEl.value = '1';
      if (blkNT && !String(blkNT.value).trim()) {
        const nsStr = blkNS && String(blkNS.value).trim();
        const nStr = nEl && String(nEl.value).trim();
        if (nsStr) blkNT.value = nsStr;
        else if (nStr) blkNT.value = nStr;
      }
    }

    function defaultCatalogRow() {
      const v = String(shapeEl.value || 'l').toLowerCase();
      const prefs =
        v === 'w'
          ? ['W12X40', 'W12X35', 'W16X26']
          : v === 'c'
            ? ['C10X30', 'MC10X8', 'S12X35']
            : v === '2l'
              ? ['2L4X4X5/8', '2L4X4X3/4', '2L3X3X1/4']
              : ['L4X4X1/2', 'L3-1/2X3-1/2X3/8'];
      for (const p of prefs) {
        const hit = angleRows.find(
          (r) => String(r[COL.label] || '').trim().toUpperCase() === p.toUpperCase(),
        );
        if (hit) return hit;
      }
      return angleRows[0] ?? null;
    }

    function wire() {
      populateTenSteelGradeSelect(steelEl);
      const bump = () => {
        recompute();
      };

      sumEl?.addEventListener(
        'input',
        () => {
          stagSumTouched = String(sumEl.value || '').trim() !== '';
        },
        true,
      );

      pane.querySelectorAll('input, select').forEach((x) => {
        if (x === steelEl) return;
        x.addEventListener('input', bump);
        x.addEventListener('change', bump);
      });
      const bumpSteel = () => {
        applySteelDefaults();
        recompute();
      };
      steelEl?.addEventListener('input', bumpSteel);
      steelEl?.addEventListener('change', bumpSteel);

      let debounce;
      aiscEl.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => renderSuggest(aiscEl.value), 90);
      });
      aiscEl.addEventListener('focus', () => {
        if (!isManualMode()) renderSuggest(aiscEl.value);
      });
      aiscEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          setSuggestOpen(false);
          return;
        }
        if (e.key === 'Enter') {
          if (isManualMode()) return;
          e.preventDefault();
          const q = normalizeQuery(aiscEl.value);
          const exact = angleRows.find((r) => normalizeQuery(r[COL.label]) === q);
          const hit = exact || angleRows.find((r) => normalizeQuery(r[COL.label]).includes(q));
          if (hit) {
            applyAiscRowByLabel(String(hit[COL.label] || '').trim());
            setSuggestOpen(false);
            recompute();
          }
        }
      });
      toggleEl?.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (isManualMode()) return;
        if (suggestEl?.hidden) {
          aiscEl.focus();
          renderSuggest('');
        } else {
          setSuggestOpen(false);
        }
      });
      document.addEventListener(
        'click',
        (e) => {
          if (searchWrap && !searchWrap.contains(e.target)) setSuggestOpen(false);
        },
        true,
      );

      shapeEl?.addEventListener('change', () => {
        const manual = isManualMode();
        setGeometryReadOnly(!manual);
        stagSumTouched = false;
        refreshShapeCatalog();
        if (manual) {
          setSuggestOpen(false);
        } else if (angleRows.length) {
          applyAiscRowByLabel(aiscEl.value) || applyAiscRowByLabel(String(angleRows[0][COL.label] || '').trim());
        }
        recompute();
      });
      solveBtn?.addEventListener('click', bump);
    }

    const attachAnalysisGradeListener = () => {
      const fn = () => {
        const g = getActiveSteelGrade();
        if (g && steelEl) {
          populateTenSteelGradeSelect(steelEl, g.id);
          steelEl.value = g.id;
        }
        applySteelDefaults();
        recompute();
      };
      const prev = window.SteelForge._sfTenAnaGradeListener;
      if (prev) window.removeEventListener('sf:steel-grade-change', prev);
      window.SteelForge._sfTenAnaGradeListener = fn;
      window.addEventListener('sf:steel-grade-change', fn);
    };

    /** Listeners must exist before CSV returns; otherwise stagger / block-shear cells feel “dead” on load. */
    let wired = false;
    function ensureWire() {
      if (wired) return;
      wired = true;
      wire();
      attachAnalysisGradeListener();
    }

    ensureWire();
    setDefaults();
    recompute();

    fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((txt) => {
        const lines = txt.split(/\r?\n/);
        allSteelRows = lines
          .slice(4)
          .map(parseCsvLine)
          .filter((r) => {
            const typ = String(r[COL.type] || '').trim();
            const lbl = String(r[COL.label] || '').trim();
            return !!lbl && CSV_TYPES.has(typ);
          });

        refreshShapeCatalog();
        setDefaults();
        const dflt = defaultCatalogRow();
        if (dflt) applyAiscRowByLabel(dflt[COL.label]);
        recompute();
      })
      .catch(() => {
        setDefaults();
        recompute();
      });
  };

  window.SteelForge.initTensionDesign = (panelRoot) => {
    const pane = panelRoot?.querySelector?.('.sf-comp--tension .sf-comp__mode[data-comp-mode-pane="design"]');
    if (!pane) return;

    const el = (id) => pane.querySelector(`#${id}`);
    const methodEl = el('sfTenDesMethod');
    const dlEl = el('sfTenDesDl');
    const llEl = el('sfTenDesLl');
    const lEl = el('sfTenDesL');
    const steelEl = el('sfTenDesSteel');
    const fyEl = el('sfTenDesFy');
    const fuEl = el('sfTenDesFu');
    const lagEl = el('sfTenDesShearLag');
    const xbarDesEl = el('sfTenDesXbar');
    const uEl = el('sfTenDesU');
    const rEl = el('sfTenDesR');
    const nEl = el('sfTenDesN');
    const boltKindEl = el('sfTenDesBoltKind');
    const dhEl = el('sfTenDesDh');
    const dfEl = el('sfTenDesDf');

    const out1216 = el('sfTenDesComb1216');
    const out14 = el('sfTenDesComb14');
    const outDlLl = el('sfTenDesCombDlLl');
    const outTu = el('sfTenDesTu');
    const outTs = el('sfTenDesTs');
    const outTasd = el('sfTenDesTasd');
    const outYieldAg = el('sfTenDesYieldAg');
    const outFracAe = el('sfTenDesFracAe');
    const outFracAssAg = el('sfTenDesFracAssAg');
    const outGovAg = el('sfTenDesGovAg');
    const outLightest = el('sfTenDesLrfdSec');
    const outAsdSec = el('sfTenDesAsdSec');
    const tb = pane.querySelector('.sf-tensDes__table tbody');
    const solveBtn = el('sfTenDesSolve');

    if (!methodEl || !dlEl || !llEl || !lEl || !steelEl || !fyEl || !fuEl || !uEl || !tb) return;

    populateTenSteelGradeSelect(steelEl);

    let angleRows = [];

    const getUFromLagText = () =>
      shearLagUFromSelection(lagEl?.value, parseNumLike(xbarDesEl?.value), parseNumLike(lEl?.value));

    const rowArea = (r) => parseNumLike(r?.[COL.Ag]);
    const rowRmin = (r) => {
      const rx = parseNumLike(r?.[31]);
      const ry = parseNumLike(r?.[37]);
      const rz = parseNumLike(r?.[43]);
      const vals = [rx, ry, rz].filter((x) => Number.isFinite(x) && x > 0);
      return vals.length ? Math.min(...vals) : null;
    };

    const sortedByArea = (rows) =>
      [...rows].sort((a, b) => {
        const aa = rowArea(a);
        const bb = rowArea(b);
        if (!Number.isFinite(aa) && !Number.isFinite(bb)) return 0;
        if (!Number.isFinite(aa)) return 1;
        if (!Number.isFinite(bb)) return -1;
        return aa - bb;
      });

    function applySteelDefaults() {
      applyStructuralGradeSelectToFyFu(steelEl, fyEl, fuEl);
    }

    function normalizeInputs() {
      if (dlEl) {
        const v = parseNumLike(dlEl.value);
        if (Number.isFinite(v)) dlEl.value = fmt(Math.max(0, v), 3);
      }
      if (llEl) {
        const v = parseNumLike(llEl.value);
        if (Number.isFinite(v)) llEl.value = fmt(Math.max(0, v), 3);
      }
      if (lEl) {
        const v = parseNumLike(lEl.value);
        if (Number.isFinite(v)) lEl.value = fmt(Math.max(0, v), 3);
      }
      if (nEl) {
        const v = parseNumLike(nEl.value);
        if (Number.isFinite(v)) nEl.value = String(Math.max(0, Math.round(v)));
      }
      if (dhEl) {
        const v = parseNumLike(dhEl.value);
        if (Number.isFinite(v)) dhEl.value = fmt(Math.max(0, v), 3);
      }
    }

    function setDefaults() {
      if (!methodEl.value) methodEl.value = 'lrfd';
      if (!String(dlEl.value).trim()) dlEl.value = '70';
      if (!String(llEl.value).trim()) llEl.value = '30';
      if (!String(lEl.value).trim()) lEl.value = '120';
      if (!String(lagEl?.value || '').trim()) lagEl.value = 'CASE 2';
      if (xbarDesEl && !String(xbarDesEl.value).trim()) xbarDesEl.value = '1.2';
      if (!String(nEl?.value || '').trim()) nEl.value = '2';
      if (!String(dhEl?.value || '').trim()) dhEl.value = '7/8';
      if (uEl) uEl.readOnly = true;
      applySteelDefaults();
      normalizeInputs();
    }

    /**
     * Render selection-of-section table. A row is SAFE only when:
     *   1. Section area Ag ≥ required Ag (yield + fracture governing), AND
     *   2. Section r_min ≥ required r_min = L/300 (workbook slenderness ceiling).
     */
    function renderTable(govAg, rMinReq) {
      const rows = sortedByArea(angleRows);
      const isSafe = (r) => {
        const ag = rowArea(r);
        if (!Number.isFinite(ag) || !Number.isFinite(govAg) || ag < govAg) return false;
        if (Number.isFinite(rMinReq) && rMinReq > 0) {
          const rmin = rowRmin(r);
          if (!Number.isFinite(rmin) || rmin < rMinReq) return false;
        }
        return true;
      };
      const safeRows = rows.filter(isSafe);
      const lightest = safeRows[0] ?? null;

      let displayRows = rows.slice(0, 12);
      if (Number.isFinite(govAg) && rows.length > 0) {
        let pivot = rows.findIndex(isSafe);
        if (pivot < 0) pivot = rows.length - 1;
        const before = 5;
        const total = 12;
        let start = Math.max(0, pivot - before);
        let end = Math.min(rows.length, start + total);
        start = Math.max(0, end - total);
        displayRows = rows.slice(start, end);
      }

      tb.innerHTML = '';
      displayRows.forEach((r) => {
        const ag = rowArea(r);
        const ok = isSafe(r);
        const label = String(r[COL.label] || '').trim();
        const isThreshold = lightest && label === String(lightest[COL.label] || '').trim();
        const tr = document.createElement('tr');
        if (isThreshold) {
          tr.classList.add('sf-tensDes__row--threshold');
          tr.title = 'Threshold row: first section meeting Ag ≥ req. AND r ≥ L/300';
        }
        tr.innerHTML = `
          <td>${label}</td>
          <td>${fmt(ag, 3)}</td>
          <td>${fmt(govAg, 3)}</td>
          <td><span class="sf-tbRef__pillTag ${ok ? 'sf-tbRef__pillTag--safe' : 'sf-tbRef__pillTag--unsafe'}">${ok ? 'SAFE' : 'UNSAFE'}</span></td>
        `;
        tb.appendChild(tr);
      });

      const lightLabel = lightest ? String(lightest[COL.label] || '').trim() : '—';
      if (outLightest) outLightest.textContent = lightLabel;
      if (outAsdSec) outAsdSec.textContent = lightLabel;
      if (rEl && !String(rEl.value).trim()) {
        rEl.value = toNumInput(rowRmin(lightest ?? rows[0]));
      }
    }

    function recompute() {
      normalizeInputs();
      const DL = parseNumLike(dlEl.value);
      const LL = parseNumLike(llEl.value);
      const Fy = parseNumLike(fyEl.value);
      const Fu = parseNumLike(fuEl.value);
      const UfromCase = getUFromLagText();
      // U field is read-only in design page: derive directly from the selected lag case/text.
      const U = UfromCase;
      if (uEl) uEl.value = Number.isFinite(UfromCase) ? fmt(UfromCase, 3) : '';

      const c1216 = Number.isFinite(DL) && Number.isFinite(LL) ? 1.2 * DL + 1.6 * LL : null;
      const c14 = Number.isFinite(DL) ? 1.4 * DL : null;
      const cDlll = Number.isFinite(DL) && Number.isFinite(LL) ? DL + LL : null;
      const Tu = Number.isFinite(c1216) && Number.isFinite(c14) ? Math.max(c1216, c14) : null;
      const Ts = cDlll;
      const Tasd = Ts;

      if (out1216) out1216.textContent = fmt(c1216, 3);
      if (out14) out14.textContent = fmt(c14, 3);
      if (outDlLl) outDlLl.textContent = fmt(cDlll, 3);
      if (outTu) outTu.textContent = fmt(Tu, 3);
      if (outTs) outTs.textContent = fmt(Ts, 3);
      if (outTasd) outTasd.textContent = fmt(Tasd, 3);

      const isLRFD = String(methodEl.value || 'lrfd').toLowerCase() === 'lrfd';
      const Treq = isLRFD ? Tu : Tasd;
      const agYield = Number.isFinite(Treq) && Number.isFinite(Fy) && Fy > 0
        ? (isLRFD ? Treq / (0.9 * Fy) : (Treq * 1.67) / Fy)
        : null;
      /**
       * Workbook TENSION sheet (column Q, design) — STRICT parity:
       *   LRFD: Q25 = Tu / (0.75 · Fu · U)                            → Ae_req
       *   LRFD: Q26 = Q25 / 0.85                                       → Ag_req (assumed Ae/Ag ≈ 0.85)
       *   ASD : Q32 = (Ta · 2) / (Fu · r_min)  where r_min = L/300    → Ae_req  (matches workbook cell verbatim)
       *   ASD : Q33 = Q32 / 0.85
       *   Q27/Q34 = MAX(Ag_yield, Ag_frac)
       */
      const lengthInForAsd = parseNumLike(lEl?.value);
      const rMinForAsd = Number.isFinite(lengthInForAsd) && lengthInForAsd > 0 ? lengthInForAsd / 300 : null;
      const aeFrac = !Number.isFinite(Treq) || !Number.isFinite(Fu) || Fu <= 0
        ? null
        : (isLRFD
          ? (Number.isFinite(U) && U > 0 ? Treq / (0.75 * Fu * U) : null)
          : (Number.isFinite(rMinForAsd) && rMinForAsd > 0 ? (Treq * 2.0) / (Fu * rMinForAsd) : null));
      const agFromFrac = Number.isFinite(aeFrac) ? aeFrac / 0.85 : null;
      const govAg = Number.isFinite(agYield) && Number.isFinite(agFromFrac) ? Math.max(agYield, agFromFrac)
        : Number.isFinite(agYield) ? agYield
        : Number.isFinite(agFromFrac) ? agFromFrac : null;

      if (outYieldAg) outYieldAg.textContent = fmt(agYield, 3);
      if (outFracAe) outFracAe.textContent = fmt(aeFrac, 3);
      if (outFracAssAg) outFracAssAg.textContent = fmt(agFromFrac, 3);
      if (outGovAg) outGovAg.textContent = fmt(govAg, 3);

      const boltKind = String(boltKindEl?.value || 'bolt').toLowerCase();
      const nominalDia = parseNumLike(dhEl?.value);
      const df = effectiveHoleDiameterInches(boltKind, nominalDia);
      if (dfEl) dfEl.textContent = fmt(df, 4);

      // Slenderness ceiling: section r_min must exceed L/300 (workbook TENSION Q12).
      const lengthIn = parseNumLike(lEl?.value);
      const rMinReq = Number.isFinite(lengthIn) && lengthIn > 0 ? lengthIn / 300 : null;
      renderTable(govAg, rMinReq);
    }

    function wire() {
      populateTenSteelGradeSelect(steelEl);
      const bumpSteel = () => {
        applySteelDefaults();
        recompute();
      };
      pane.querySelectorAll('input, select').forEach((x) => {
        if (x === steelEl) return;
        x.addEventListener('input', recompute);
        x.addEventListener('change', recompute);
      });
      steelEl.addEventListener('input', bumpSteel);
      steelEl.addEventListener('change', bumpSteel);
      if (steelEl && !steelEl.dataset.sfTenDesSteelPickerBound) {
        steelEl.dataset.sfTenDesSteelPickerBound = '1';
        if (typeof steelEl.showPicker === 'function') {
          steelEl.addEventListener(
            'pointerdown',
            (e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              try {
                steelEl.showPicker();
                e.preventDefault();
              } catch (_) {
                /* Unsupported or not user-activated: keep native behavior */
              }
            },
            { capture: true },
          );
        }
      }
      solveBtn?.addEventListener('click', recompute);
    }

    const attachDesignGradeListener = () => {
      const fn = () => {
        const g = getActiveSteelGrade();
        if (g && steelEl) {
          populateTenSteelGradeSelect(steelEl, g.id);
          steelEl.value = g.id;
        }
        applySteelDefaults();
        normalizeInputs();
        recompute();
      };
      const prev = window.SteelForge._sfTenDesGradeListener;
      if (prev) window.removeEventListener('sf:steel-grade-change', prev);
      window.SteelForge._sfTenDesGradeListener = fn;
      window.addEventListener('sf:steel-grade-change', fn);
    };
    attachDesignGradeListener();

    fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((txt) => {
        const lines = txt.split(/\r?\n/);
        angleRows = lines
          .slice(4)
          .map(parseCsvLine)
          .filter((r) => {
            const typ = String(r[COL.type] || '').trim();
            const lbl = String(r[COL.label] || '').trim();
            return (typ === 'L' || typ === '2L') && !!lbl && Number.isFinite(rowArea(r));
          });
        wire();
        setDefaults();
        recompute();
      })
      .catch(() => {
        wire();
        setDefaults();
        recompute();
      });
  };
})();

