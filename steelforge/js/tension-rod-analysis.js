(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = { type: 0, label: 2, Ag: 5 };
  const PHI_Y = 0.9;
  const PHI_F = 0.75;
  const OMEGA_Y = 1.67;
  const OMEGA_F = 2.0;

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

    window.SteelForge.__tensionRodRecomputeDesign = recompute;

    ensureRodCatalog().then((rows) => {
      catalogRows = rows;
      recompute();
    });
  };

  window.SteelForge.initTensionRodModern = (panelRoot) => {
    const root = panelRoot?.querySelector?.('#trModernApp') ?? document.querySelector('#trModernApp');
    if (!root) return false;
    if (root.dataset.trInit === '1') return true;
    root.dataset.trInit = '1';

    let currentU = 0.75;
    let dl = 45.0;
    let ll = 60.0;
    const Fy = 35;
    const Fu = 60;
    const phiY = 0.9;
    const phiR = 0.75;

    const $ = (id) => root.querySelector(`#${id}`);

    const updateLoadsAndDemand = () => {
      const factored1 = 1.2 * dl + 1.6 * ll;
      const factored2 = 1.4 * dl;
      const Tu = Math.max(factored1, factored2);
      const Ta = dl + ll;
      $('tr_factored_load').textContent = `${factored1.toFixed(2)} kips`;
      $('tr_load14dl').textContent = `${factored2.toFixed(2)} kips`;
      $('tr_tu_result').textContent = `${Tu.toFixed(2)} kips`;
      $('tr_ta_result').textContent = `${Ta.toFixed(2)} kips`;
      $('tr_gov_demand').textContent = `${Tu.toFixed(2)} kips (LRFD)`;
      $('tr_demand_ref').textContent = Tu.toFixed(2);
      $('tr_dl_val').textContent = `${dl.toFixed(1)} kips`;
      $('tr_ll_val').textContent = `${ll.toFixed(1)} kips`;
      $('tr_u_factor').textContent = currentU.toFixed(2);
      return Tu;
    };

    const computeRodCapacity = (diameter) => {
      const Ag = (Math.PI * diameter * diameter) / 4;
      const Ae = currentU * Ag;
      const phiPnYield = phiY * Fy * Ag;
      const phiPnRupture = phiR * Fu * Ae;
      return { Ag, Ae, phiPnYield, phiPnRupture };
    };

    const renderRodTable = () => {
      const Tu = updateLoadsAndDemand();
      const std = [0.75, 1.0, 1.125, 1.25, 1.375, 1.5, 1.75, 2.0, 2.25, 2.5];
      const tbody = $('tr_table_body');
      if (!tbody) return;
      tbody.innerHTML = '';
      let lightestSafe = null;

      std.forEach((d) => {
        const { Ag, Ae, phiPnYield, phiPnRupture } = computeRodCapacity(d);
        const capacity = Math.min(phiPnYield, phiPnRupture);
        const safe = capacity >= Tu;
        if (safe && lightestSafe == null) lightestSafe = d;
        const status = safe
          ? `<span class="tr-modern__safeTag">SAFE (φPₙ=${capacity.toFixed(1)} k)</span>`
          : `<span class="tr-modern__unsafeTag">UNSAFE (${capacity.toFixed(1)} &lt; ${Tu.toFixed(1)})</span>`;
        tbody.insertAdjacentHTML(
          'beforeend',
          `<tr>
            <td><strong>${d}"</strong></td>
            <td>${Ag.toFixed(3)}</td>
            <td>${Ae.toFixed(3)}</td>
            <td>${phiPnYield.toFixed(1)}</td>
            <td>${phiPnRupture.toFixed(1)}</td>
            <td>${status}</td>
          </tr>`,
        );
      });

      const verdict = $('tr_verdict');
      if (!verdict) return;
      if (lightestSafe != null) {
        verdict.innerHTML = `Recommendation: lightest adequate rod = <strong>${lightestSafe}"</strong> for T<sub>u</sub> = ${Tu.toFixed(1)} kips.`;
      } else {
        verdict.innerHTML = `No adequate rod found for T<sub>u</sub> = ${Tu.toFixed(1)} kips. Increase diameter or adjust assumptions.`;
      }
    };

    const checkUserDiameter = () => {
      const dIn = Number.parseFloat($('tr_rod_diam').value);
      const d = Number.isFinite(dIn) && dIn > 0 ? dIn : 1.0;
      const Tu = updateLoadsAndDemand();
      const { Ag, Ae, phiPnYield, phiPnRupture } = computeRodCapacity(d);
      $('tr_ag_value').textContent = `${Ag.toFixed(4)} in²`;
      $('tr_ae_value').textContent = `${Ae.toFixed(4)} in²`;
      $('tr_phi_yield').textContent = `${phiPnYield.toFixed(1)} kips`;
      $('tr_phi_rupture').textContent = `${phiPnRupture.toFixed(1)} kips`;

      const cap = Math.min(phiPnYield, phiPnRupture);
      $('tr_verdict').innerHTML = cap >= Tu
        ? `Selected rod <strong>${d}"</strong> is SAFE. Capacity ${cap.toFixed(1)} kips ≥ ${Tu.toFixed(1)} kips.`
        : `Selected rod <strong>${d}"</strong> is UNSAFE. Capacity ${cap.toFixed(1)} kips &lt; ${Tu.toFixed(1)} kips.`;
      renderRodTable();
    };

    const setLoads = (newDl, newLl) => {
      dl = newDl;
      ll = newLl;
      renderRodTable();
      checkUserDiameter();
    };

    root.querySelectorAll('.tr-modern__tabBtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        root.querySelectorAll('.tr-modern__tabBtn').forEach((b) => b.classList.remove('is-active'));
        root.querySelectorAll('.tr-modern__panel').forEach((p) => p.classList.remove('is-active'));
        btn.classList.add('is-active');
        const panel = root.querySelector(`#${tabId}`);
        if (panel) panel.classList.add('is-active');
      });
    });

    $('tr_check_btn')?.addEventListener('click', checkUserDiameter);
    $('tr_edit_u_btn')?.addEventListener('click', () => {
      const next = Number.parseFloat(window.prompt('Enter U factor (0.10 to 1.00):', String(currentU)) ?? '');
      if (Number.isFinite(next) && next >= 0.1 && next <= 1) {
        currentU = next;
        renderRodTable();
        checkUserDiameter();
      }
    });
    $('tr_set_typical')?.addEventListener('click', () => setLoads(45, 60));
    $('tr_set_heavy')?.addEventListener('click', () => setLoads(80, 100));
    $('tr_reset')?.addEventListener('click', () => {
      currentU = 0.75;
      $('tr_rod_diam').value = '1.25';
      setLoads(45, 60);
    });

    renderRodTable();
    checkUserDiameter();
    return true;
  };
})();
