(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = { type: 0, label: 2, Ag: 5 };
  const PHI_Y = 0.9;
  const PHI_F = 0.75;
  const OMEGA_Y = 1.67;
  const OMEGA_F = 2.0;

  /**
   * Standard threaded rod diameters per workbook (in inches).
   * Order matters: must be ascending so we can snap UP to the next available size.
   * Display label uses the workbook glyphs (3/4, 7/8, 1¼, etc.).
   */
  const STANDARD_ROD_SIZES = [
    { label: '3/4', value: 0.75 },
    { label: '7/8', value: 0.875 },
    { label: '1', value: 1.0 },
    { label: '1¼', value: 1.25 },
    { label: '1½', value: 1.5 },
    { label: '1¾', value: 1.75 },
    { label: '2', value: 2.0 },
    { label: '2½', value: 2.5 },
  ];

  /** Snap a required diameter (in.) UP to the next standard rod size. */
  function snapUpToStandardRod(dReq) {
    if (!Number.isFinite(dReq) || dReq <= 0) return null;
    for (const s of STANDARD_ROD_SIZES) {
      if (s.value + 1e-9 >= dReq) return s;
    }
    return STANDARD_ROD_SIZES[STANDARD_ROD_SIZES.length - 1];
  }

  /**
   * Workbook formula for rod design (threaded rod, tensile fracture governs the bar diameter):
   *   LRFD: φ Tn = 0.75 × Fu × (0.75 × Ab)  →  required Ab = Tu / (0.75² × Fu)
   *   ASD : Tn/Ω = (0.75 × Fu × Ab) / 2     →  required Ab = (2 × Ta) / (0.75 × Fu)
   * Then d = √(4 Ab / π).
   */
  function requiredRodDiameter(demandKips, FuKsi, method) {
    if (!Number.isFinite(demandKips) || demandKips <= 0) return null;
    if (!Number.isFinite(FuKsi) || FuKsi <= 0) return null;
    const isLRFD = String(method || 'lrfd').toLowerCase() === 'lrfd';
    const Ab = isLRFD
      ? demandKips / (0.75 * 0.75 * FuKsi)
      : (2 * demandKips) / (0.75 * FuKsi);
    if (!Number.isFinite(Ab) || Ab <= 0) return null;
    return Math.sqrt((4 * Ab) / Math.PI);
  }

  let rodCatalogPromise = null;

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

  function filterRodCatalogRows(lines) {
    return lines
      .slice(4)
      .map(parseCsvLine)
      .filter((r) => {
        const typ = String(r[COL.type] || '').trim();
        const lbl = String(r[COL.label] || '').trim();
        return (typ === 'Round HSS' || typ === 'PIPE') && !!lbl;
      });
  }

  function ensureRodCatalog() {
    if (rodCatalogPromise) return rodCatalogPromise;
    rodCatalogPromise = fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((txt) => filterRodCatalogRows(txt.split(/\r?\n/)))
      .catch(() => []);
    return rodCatalogPromise;
  }

  function steelFromSelectValue(val) {
    if (val === 'custom') return null;
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    return grades.find((g) => g.id === val) ?? null;
  }

  function getPreferredStructuralSteelGradeId() {
    const preferred = window.SteelForge?.activeStructuralSteelGrade?.id;
    if (preferred) return preferred;
    return 'a992';
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
    customOpt.textContent = 'Custom Fy / Fu (edit fields)';
    selectEl.appendChild(customOpt);
    const ids = new Set(grades.map((x) => x.id));
    if (ids.has(preferredId)) selectEl.value = preferredId;
    else selectEl.value = grades[0]?.id ?? 'custom';
  }

  function grossAreaFromD(dIn) {
    if (!Number.isFinite(dIn) || dIn <= 0) return null;
    return (Math.PI * dIn * dIn) / 4;
  }

  function capacityBreakdown(Ag, Ae, Fy, Fu, method) {
    const lrfdY = Number.isFinite(Fy) && Number.isFinite(Ag) ? PHI_Y * Fy * Ag : null;
    const lrfdF = Number.isFinite(Fu) && Number.isFinite(Ae) ? PHI_F * Fu * Ae : null;
    const asdY = Number.isFinite(Fy) && Number.isFinite(Ag) ? (Fy * Ag) / OMEGA_Y : null;
    const asdF = Number.isFinite(Fu) && Number.isFinite(Ae) ? (Fu * Ae) / OMEGA_F : null;
    const yieldCap = method === 'lrfd' ? lrfdY : asdY;
    const fracCap = method === 'lrfd' ? lrfdF : asdF;
    const capGov =
      Number.isFinite(yieldCap) && Number.isFinite(fracCap) ? Math.min(yieldCap, fracCap) :
      Number.isFinite(yieldCap) ? yieldCap :
      Number.isFinite(fracCap) ? fracCap : null;
    return { yieldCap, fracCap, capGov };
  }

  function pickLightestRod(rows, demand, k, Fy, Fu, method) {
    if (!Number.isFinite(demand) || demand < 0) return null;
    if (!Number.isFinite(k) || k < 0 || k > 1) return null;
    if (!Number.isFinite(Fy) || !Number.isFinite(Fu)) return null;
    const sorted = [...rows]
      .map((r) => {
        const Ag = parseNumLike(r[COL.Ag]);
        const lab = String(r[COL.label] || '').trim();
        return { r, Ag, lab };
      })
      .filter((x) => Number.isFinite(x.Ag) && x.Ag > 0 && x.lab);
    sorted.sort((a, b) => a.Ag - b.Ag || a.lab.localeCompare(b.lab));
    for (const s of sorted) {
      const Ae = k * s.Ag;
      const { capGov } = capacityBreakdown(s.Ag, Ae, Fy, Fu, method);
      if (Number.isFinite(capGov) && capGov + 1e-6 >= demand) return s;
    }
    return null;
  }

  /** Keep rod steel dropdown aligned with hub grade changes (custom grade left untouched). */
  function attachStructuralGradeSync(key, steelEl, syncSteel, recompute) {
    const fn = () => {
      const preferred = getPreferredStructuralSteelGradeId();
      if (!steelEl) return;
      if (steelEl.value !== 'custom') {
        const ids = new Set(Array.from(steelEl.options).map((o) => o.value));
        if (ids.has(preferred)) steelEl.value = preferred;
      }
      syncSteel();
      recompute();
    };
    const prev = window.SteelForge?.[key];
    if (prev) window.removeEventListener('sf:steel-grade-change', prev);
    window.SteelForge[key] = fn;
    window.addEventListener('sf:steel-grade-change', fn);
  }

  window.SteelForge = window.SteelForge || {};
  window.SteelForge.initTensionRodAnalysis = (panelRoot) => {
    const root = panelRoot?.querySelector?.('.sf-comp--tensionRod') ?? document.querySelector('.sf-comp--tensionRod');
    if (!root) return;
    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="analysis"]');
    if (!pane) return;

    const $ = (id) => pane.querySelector(`#${id}`);
    const methodEl = $('sfRodAnaMethod');
    const catalogEl = $('sfRodAnaCatalog');
    const dEl = $('sfRodAnaD');
    const lEl = $('sfRodAnaL');
    const kEl = $('sfRodAnaK');
    const steelEl = $('sfRodAnaSteel');
    const fyEl = $('sfRodAnaFy');
    const fuEl = $('sfRodAnaFu');
    const dlEl = $('sfRodAnaDl');
    const llEl = $('sfRodAnaLl');
    const out1216 = $('sfRodOutComb1216');
    const out14 = $('sfRodOutComb14');
    const outDlLl = $('sfRodOutDlLl');
    const outGovLbl = $('sfRodOutGovLbl');
    const outTGov = $('sfRodOutTGov');
    const outAg = $('sfRodOutAg');
    const outAe = $('sfRodOutAe');
    const outYield = $('sfRodOutYield');
    const outFrac = $('sfRodOutFrac');
    const outCapLbl = $('sfRodOutCapLbl');
    const outCapGov = $('sfRodOutCapGov');
    const verdictEl = $('sfRodVerdict');
    const solveBtn = $('sfRodAnaSolve');

    if (!methodEl || !catalogEl || !dEl || !kEl || !steelEl || !fyEl || !fuEl) return;

    let catalogRows = [];

    function normalizeInputs() {
      const d = parseNumLike(dEl?.value);
      if (dEl && Number.isFinite(d)) dEl.value = d < 0 ? '0' : fmt(d, 4);

      const L = parseNumLike(lEl?.value);
      if (lEl && Number.isFinite(L)) lEl.value = L < 0 ? '0' : fmt(L, 3);

      const k = parseNumLike(kEl?.value);
      if (kEl && Number.isFinite(k)) {
        const kc = Math.max(0, Math.min(1, k));
        kEl.value = fmt(kc, 4);
      }

      const dl = parseNumLike(dlEl?.value);
      if (dlEl && Number.isFinite(dl)) dlEl.value = dl < 0 ? '0' : fmt(dl, 3);

      const ll = parseNumLike(llEl?.value);
      if (llEl && Number.isFinite(ll)) llEl.value = ll < 0 ? '0' : fmt(ll, 3);

      const fy = parseNumLike(fyEl?.value);
      if (fyEl && Number.isFinite(fy)) fyEl.value = fy < 0 ? '0' : fmt(fy, 3);

      const fu = parseNumLike(fuEl?.value);
      if (fuEl && Number.isFinite(fu)) fuEl.value = fu < 0 ? '0' : fmt(fu, 3);
    }

    function applyCatalogSelection() {
      const v = String(catalogEl.value || '').trim();
      if (v === 'manual' || !v) {
        dEl.readOnly = false;
        dEl.classList.remove('sf-rod__inp--readonly');
        return;
      }
      const hit = catalogRows.find((r) => String(r[COL.label] || '').trim() === v);
      if (!hit) return;
      const Agc = parseNumLike(hit[COL.Ag]);
      if (!Number.isFinite(Agc) || Agc <= 0) return;
      const dEq = Math.sqrt((4 * Agc) / Math.PI);
      dEl.value = fmt(dEq, 4);
      dEl.readOnly = true;
      dEl.classList.add('sf-rod__inp--readonly');
    }

    function syncSteel() {
      if (!steelEl || steelEl.value === 'custom') {
        if (fyEl) fyEl.readOnly = false;
        if (fuEl) fuEl.readOnly = false;
        return;
      }
      const g = steelFromSelectValue(steelEl.value);
      if (g && fyEl) {
        fyEl.value = String(g.fy);
        fyEl.readOnly = true;
      }
      if (g && fuEl) {
        fuEl.value = String(g.fu);
        fuEl.readOnly = true;
      }
    }

    function recompute() {
      normalizeInputs();
      syncSteel();
      applyCatalogSelection();

      const method = String(methodEl.value || 'lrfd').toLowerCase();
      root.classList.toggle('sf-rod--lrfd', method === 'lrfd');
      root.classList.toggle('sf-rod--asd', method === 'asd');

      const dl = parseNumLike(dlEl?.value);
      const ll = parseNumLike(llEl?.value);
      const u1216 = Number.isFinite(dl) && Number.isFinite(ll) ? 1.2 * dl + 1.6 * ll : null;
      const u14 = Number.isFinite(dl) ? 1.4 * dl : null;
      const svc = Number.isFinite(dl) && Number.isFinite(ll) ? dl + ll : null;

      if (out1216) out1216.textContent = fmt(u1216, 3);
      if (out14) out14.textContent = fmt(u14, 3);
      if (outDlLl) outDlLl.textContent = fmt(svc, 3);

      let demand = null;
      if (method === 'lrfd') {
        if (outGovLbl) {
          outGovLbl.innerHTML = 'GOVERNING <span class="sf-tbRef__mono">T<sub>u</sub></span> =';
        }
        if (outCapLbl) {
          outCapLbl.innerHTML = 'GOVERNING CAPACITY <span class="sf-tbRef__mono">φT<sub>n</sub></span> =';
        }
        demand =
          Number.isFinite(u1216) && Number.isFinite(u14) ? Math.max(u1216, u14) :
          Number.isFinite(u1216) ? u1216 :
          Number.isFinite(u14) ? u14 : null;
      } else {
        if (outGovLbl) {
          outGovLbl.innerHTML = 'GOVERNING <span class="sf-tbRef__mono">T<sub>a</sub></span> =';
        }
        if (outCapLbl) {
          outCapLbl.innerHTML = 'GOVERNING CAPACITY <span class="sf-tbRef__mono">T<sub>n</sub>/Ω</span> =';
        }
        demand = svc;
      }
      if (outTGov) outTGov.textContent = fmt(demand, 3);

      const d = parseNumLike(dEl?.value);
      const k = parseNumLike(kEl?.value);
      const Fy = parseNumLike(fyEl?.value);
      const Fu = parseNumLike(fuEl?.value);

      let Ag = grossAreaFromD(d);
      if (catalogEl.value !== 'manual') {
        const hit = catalogRows.find((r) => String(r[COL.label] || '').trim() === String(catalogEl.value || '').trim());
        if (hit) {
          const Agc = parseNumLike(hit[COL.Ag]);
          if (Number.isFinite(Agc) && Agc > 0) Ag = Agc;
        }
      }

      const kOk = Number.isFinite(k) && k >= 0 && k <= 1;
      const Ae = kOk && Number.isFinite(Ag) ? k * Ag : null;

      if (outAg) outAg.textContent = fmt(Ag, 4);
      if (outAe) outAe.textContent = fmt(Ae, 4);

      const { yieldCap, fracCap, capGov } = capacityBreakdown(Ag, Ae, Fy, Fu, method);

      if (outYield) outYield.textContent = fmt(yieldCap, 3);
      if (outFrac) outFrac.textContent = fmt(fracCap, 3);

      if (outCapGov) outCapGov.textContent = fmt(capGov, 3);

      if (verdictEl) {
        verdictEl.classList.remove('sf-rod__verdict--safe', 'sf-rod__verdict--unsafe');
        if (Number.isFinite(capGov) && Number.isFinite(demand) && Number.isFinite(Ag) && Ag > 0 && kOk) {
          const ok = capGov + 1e-6 >= demand;
          verdictEl.textContent = ok ? 'SAFE' : 'UNSAFE';
          verdictEl.classList.add(ok ? 'sf-rod__verdict--safe' : 'sf-rod__verdict--unsafe');
        } else {
          verdictEl.textContent = '—';
        }
      }
    }

    function setDefaults() {
      if (dEl && !String(dEl.value).trim()) dEl.value = '1';
      if (lEl && !String(lEl.value).trim()) lEl.value = '12';
      if (kEl && !String(kEl.value).trim()) kEl.value = '0.75';
      if (dlEl && !String(dlEl.value).trim()) dlEl.value = '10';
      if (llEl && !String(llEl.value).trim()) llEl.value = '20';
      if (methodEl && !methodEl.value) methodEl.value = 'lrfd';
    }

    function fillCatalogOptions() {
      const prev = catalogEl.value;
      while (catalogEl.options.length > 1) catalogEl.remove(1);
      const sorted = [...catalogRows].sort((a, b) =>
        String(a[COL.label] || '').localeCompare(String(b[COL.label] || '')),
      );
      sorted.forEach((r) => {
        const lab = String(r[COL.label] || '').trim();
        if (!lab) return;
        const opt = document.createElement('option');
        opt.value = lab;
        const typ = String(r[COL.type] || '').trim();
        opt.textContent = `${typ}: ${lab}`;
        catalogEl.appendChild(opt);
      });
      if (prev && [...catalogEl.options].some((o) => o.value === prev)) catalogEl.value = prev;
      else catalogEl.value = 'manual';
      applyCatalogSelection();
    }

    populateSteelSelect(steelEl, getPreferredStructuralSteelGradeId());
    syncSteel();
    setDefaults();
    normalizeInputs();

    pane.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', recompute);
      el.addEventListener('change', recompute);
    });

    solveBtn?.addEventListener('click', recompute);

    attachStructuralGradeSync('_sfRodTrAnaGradeSync', steelEl, syncSteel, recompute);

    window.SteelForge.__tensionRodRecomputeAnalysis = recompute;

    ensureRodCatalog().then((rows) => {
      catalogRows = rows;
      fillCatalogOptions();
      recompute();
    });
  };

  window.SteelForge.initTensionRodDesign = (panelRoot) => {
    const root = panelRoot?.querySelector?.('.sf-comp--tensionRod') ?? document.querySelector('.sf-comp--tensionRod');
    if (!root) return;
    const pane = root.querySelector('.sf-comp__mode[data-comp-mode-pane="design"]');
    if (!pane) return;

    const $ = (id) => pane.querySelector(`#${id}`);
    const methodEl = $('sfRodDesMethod');
    const kEl = $('sfRodDesK');
    const steelEl = $('sfRodDesSteel');
    const fyEl = $('sfRodDesFy');
    const fuEl = $('sfRodDesFu');
    const dlEl = $('sfRodDesDl');
    const llEl = $('sfRodDesLl');
    const out1216 = $('sfRodDesOut1216');
    const out14 = $('sfRodDesOut14');
    const outDlLl = $('sfRodDesOutDlLl');
    const outGovLbl = $('sfRodDesGovLbl');
    const outTGov = $('sfRodDesTGov');
    const outSection = $('sfRodDesSection');
    const outD = $('sfRodDesD');
    const outAg = $('sfRodDesAg');
    const outAe = $('sfRodDesAe');
    const outYield = $('sfRodDesYield');
    const outFrac = $('sfRodDesFrac');
    const outCapLbl = $('sfRodDesCapLbl');
    const outCapGov = $('sfRodDesCapGov');
    const outDreq = $('sfRodDesDreq');
    const outDuse = $('sfRodDesDuse');
    const verdictEl = $('sfRodDesVerdict');
    const solveBtn = $('sfRodDesSolve');

    if (!methodEl || !kEl || !steelEl || !fyEl || !fuEl) return;

    let catalogRows = [];

    function normalizeInputs() {
      const k = parseNumLike(kEl?.value);
      if (kEl && Number.isFinite(k)) {
        const kc = Math.max(0, Math.min(1, k));
        kEl.value = fmt(kc, 4);
      }

      const dl = parseNumLike(dlEl?.value);
      if (dlEl && Number.isFinite(dl)) dlEl.value = dl < 0 ? '0' : fmt(dl, 3);

      const ll = parseNumLike(llEl?.value);
      if (llEl && Number.isFinite(ll)) llEl.value = ll < 0 ? '0' : fmt(ll, 3);

      const fy = parseNumLike(fyEl?.value);
      if (fyEl && Number.isFinite(fy)) fyEl.value = fy < 0 ? '0' : fmt(fy, 3);

      const fu = parseNumLike(fuEl?.value);
      if (fuEl && Number.isFinite(fu)) fuEl.value = fu < 0 ? '0' : fmt(fu, 3);
    }

    function syncSteel() {
      if (!steelEl || steelEl.value === 'custom') {
        if (fyEl) fyEl.readOnly = false;
        if (fuEl) fuEl.readOnly = false;
        return;
      }
      const g = steelFromSelectValue(steelEl.value);
      if (g && fyEl) {
        fyEl.value = String(g.fy);
        fyEl.readOnly = true;
      }
      if (g && fuEl) {
        fuEl.value = String(g.fu);
        fuEl.readOnly = true;
      }
    }

    function recompute() {
      normalizeInputs();
      syncSteel();

      const method = String(methodEl.value || 'lrfd').toLowerCase();
      root.classList.toggle('sf-rod--lrfd', method === 'lrfd');
      root.classList.toggle('sf-rod--asd', method === 'asd');

      const dl = parseNumLike(dlEl?.value);
      const ll = parseNumLike(llEl?.value);
      const u1216 = Number.isFinite(dl) && Number.isFinite(ll) ? 1.2 * dl + 1.6 * ll : null;
      const u14 = Number.isFinite(dl) ? 1.4 * dl : null;
      const svc = Number.isFinite(dl) && Number.isFinite(ll) ? dl + ll : null;

      if (out1216) out1216.textContent = fmt(u1216, 3);
      if (out14) out14.textContent = fmt(u14, 3);
      if (outDlLl) outDlLl.textContent = fmt(svc, 3);

      let demand = null;
      if (method === 'lrfd') {
        if (outGovLbl) {
          outGovLbl.innerHTML = 'GOVERNING <span class="sf-tbRef__mono">T<sub>u</sub></span> =';
        }
        if (outCapLbl) {
          outCapLbl.innerHTML = 'GOVERNING CAPACITY <span class="sf-tbRef__mono">φT<sub>n</sub></span> =';
        }
        demand =
          Number.isFinite(u1216) && Number.isFinite(u14) ? Math.max(u1216, u14) :
          Number.isFinite(u1216) ? u1216 :
          Number.isFinite(u14) ? u14 : null;
      } else {
        if (outGovLbl) {
          outGovLbl.innerHTML = 'GOVERNING <span class="sf-tbRef__mono">T<sub>a</sub></span> =';
        }
        if (outCapLbl) {
          outCapLbl.innerHTML = 'GOVERNING CAPACITY <span class="sf-tbRef__mono">T<sub>n</sub>/Ω</span> =';
        }
        demand = svc;
      }
      if (outTGov) outTGov.textContent = fmt(demand, 3);

      const k = parseNumLike(kEl?.value);
      const Fy = parseNumLike(fyEl?.value);
      const Fu = parseNumLike(fuEl?.value);
      const kOk = Number.isFinite(k) && k >= 0 && k <= 1;

      const dReqFromFormula = requiredRodDiameter(demand, Fu, method);
      const standardRod = snapUpToStandardRod(dReqFromFormula);
      if (outDreq) outDreq.textContent = fmt(dReqFromFormula, 4);
      if (outDuse) outDuse.textContent = standardRod ? standardRod.label : '—';

      const picked = kOk && catalogRows.length
        ? pickLightestRod(catalogRows, demand, k, Fy, Fu, method)
        : null;

      if (picked) {
        const Ag = picked.Ag;
        const Ae = kOk ? k * Ag : null;
        const dEq = Math.sqrt((4 * Ag) / Math.PI);
        if (outSection) outSection.textContent = picked.lab;
        if (outD) outD.textContent = fmt(dEq, 4);
        if (outAg) outAg.textContent = fmt(Ag, 4);
        if (outAe) outAe.textContent = fmt(Ae, 4);

        const { yieldCap, fracCap, capGov } = capacityBreakdown(Ag, Ae, Fy, Fu, method);
        if (outYield) outYield.textContent = fmt(yieldCap, 3);
        if (outFrac) outFrac.textContent = fmt(fracCap, 3);
        if (outCapGov) outCapGov.textContent = fmt(capGov, 3);

        if (verdictEl) {
          verdictEl.classList.remove('sf-rod__verdict--safe', 'sf-rod__verdict--unsafe');
          if (Number.isFinite(capGov) && Number.isFinite(demand)) {
            const ok = capGov + 1e-6 >= demand;
            verdictEl.textContent = ok ? 'SAFE' : 'UNSAFE';
            verdictEl.classList.add(ok ? 'sf-rod__verdict--safe' : 'sf-rod__verdict--unsafe');
          } else {
            verdictEl.textContent = '—';
          }
        }
      } else {
        if (outSection) outSection.textContent = '—';
        if (outD) outD.textContent = '—';
        if (outAg) outAg.textContent = '—';
        if (outAe) outAe.textContent = '—';
        if (outYield) outYield.textContent = '—';
        if (outFrac) outFrac.textContent = '—';
        if (outCapGov) outCapGov.textContent = '—';
        if (verdictEl) {
          verdictEl.classList.remove('sf-rod__verdict--safe', 'sf-rod__verdict--unsafe');
          if (!kOk || !Number.isFinite(demand) || !Number.isFinite(Fy) || !Number.isFinite(Fu)) {
            verdictEl.textContent = '—';
          } else {
            verdictEl.textContent = 'UNSAFE';
            verdictEl.classList.add('sf-rod__verdict--unsafe');
          }
        }
      }
    }

    function setDefaults() {
      if (kEl && !String(kEl.value).trim()) kEl.value = '0.75';
      if (dlEl && !String(dlEl.value).trim()) dlEl.value = '10';
      if (llEl && !String(llEl.value).trim()) llEl.value = '20';
      if (methodEl && !methodEl.value) methodEl.value = 'lrfd';
    }

    populateSteelSelect(steelEl, getPreferredStructuralSteelGradeId());
    syncSteel();
    setDefaults();
    normalizeInputs();

    pane.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', recompute);
      el.addEventListener('change', recompute);
    });

    solveBtn?.addEventListener('click', recompute);

    attachStructuralGradeSync('_sfRodTrDesGradeSync', steelEl, syncSteel, recompute);

    window.SteelForge.__tensionRodRecomputeDesign = recompute;

    ensureRodCatalog().then((rows) => {
      catalogRows = rows;
      recompute();
    });
  };
})();
