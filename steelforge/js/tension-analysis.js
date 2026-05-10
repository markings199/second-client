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

  function fmt(v, d = 3) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(d).replace(/\.?0+$/, '');
  }

  function toNumInput(v, fallback = '') {
    return Number.isFinite(v) ? String(v) : fallback;
  }

  function minPositive(arr) {
    const vals = arr.filter((x) => Number.isFinite(x) && x > 0);
    return vals.length ? Math.min(...vals) : null;
  }

  function getSteelByText(s) {
    const t = String(s || '').trim().toUpperCase();
    if (!t) return null;
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    return (
      grades.find((g) => String(g.id).toUpperCase() === t) ||
      grades.find((g) => String(g.label).toUpperCase() === t) ||
      grades.find((g) => String(g.label).toUpperCase().includes(t)) ||
      null
    );
  }

  function getActiveSteelGrade() {
    const g = window.SteelForge?.activeStructuralSteelGrade;
    if (!g) return null;
    if (!Number.isFinite(Number(g.fy)) || !Number.isFinite(Number(g.fu))) return null;
    return g;
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
    const case1El = el('sfTenAnaCase1');
    const case2El = el('sfTenAnaCase2');
    const case8El = el('sfTenAnaCase8');
    const uGovEl = el('sfTenAnaUgovern');
    const nEl = el('sfTenAnaNBolts');
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

    const dataListId = 'sfTenAnaAiscList';
    let dl = pane.querySelector(`#${dataListId}`);
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = dataListId;
      pane.appendChild(dl);
    }
    aiscEl.setAttribute('list', dataListId);

    let angleRows = [];
    let case2Touched = false;
    let stagSumTouched = false;

    const isManualMode = () => String(shapeEl.value || '').toLowerCase() === 'manual';

    function setGeometryReadOnly(isReadOnly) {
      [tEl, agEl, xbarEl].forEach((x) => {
        if (x) x.readOnly = isReadOnly;
      });
    }

    function applyAiscRowByLabel(label) {
      const hit = angleRows.find((r) => String(r[COL.label] || '').trim().toUpperCase() === String(label || '').trim().toUpperCase());
      if (!hit) return false;
      const tVal =
        parseNumLike(hit[COL.tPrimary]) ??
        parseNumLike(hit[COL.tFallbackA]) ??
        parseNumLike(hit[COL.tFallbackB]) ??
        null;
      const agVal = parseNumLike(hit[COL.Ag]);
      const xbarVal = parseNumLike(hit[COL.xbar]);
      if (tEl) tEl.value = toNumInput(tVal);
      if (agEl) agEl.value = toNumInput(agVal);
      if (xbarEl) xbarEl.value = toNumInput(xbarVal);
      aiscEl.value = String(hit[COL.label] || '').trim();
      case2Touched = false;
      stagSumTouched = false;
      return true;
    }

    function applySteelDefaults() {
      if (!steelEl || !fyEl || !fuEl) return;
      const hit = getSteelByText(steelEl.value);
      if (!hit) {
        fyEl.readOnly = false;
        fuEl.readOnly = false;
        return;
      }
      steelEl.value = hit.label;
      fyEl.value = String(hit.fy);
      fuEl.value = String(hit.fu);
      fyEl.readOnly = true;
      fuEl.readOnly = true;
    }

    function normalizeInputs() {
      if (nEl) {
        const n = parseNumLike(nEl.value);
        if (Number.isFinite(n)) nEl.value = String(Math.max(0, Math.round(n)));
      }
      if (case1El) {
        const v = parseNumLike(case1El.value);
        if (Number.isFinite(v)) case1El.value = fmt(v, 3);
      }
      if (case8El) {
        const v = parseNumLike(case8El.value);
        if (Number.isFinite(v)) case8El.value = fmt(v, 3);
      }
    }

    function recompute() {
      if (!case2El || !uGovEl || !ahEl || !anNsEl || !anStEl || !anGovEl) return;
      normalizeInputs();
      const t = parseNumLike(tEl?.value);
      const Ag = parseNumLike(agEl?.value);
      const xbar = parseNumLike(xbarEl?.value);
      const L = parseNumLike(lenEl?.value);
      const n = parseNumLike(nEl?.value);
      const dh = parseNumLike(dhEl?.value);
      const Fy = parseNumLike(fyEl?.value);
      const Fu = parseNumLike(fuEl?.value);

      if (!case2Touched && Number.isFinite(xbar) && Number.isFinite(L) && L > 0) {
        case2El.value = fmt(Math.max(0.6, 1 - xbar / L), 3);
      }

      const c1 = parseNumLike(case1El?.value);
      const c2 = parseNumLike(case2El?.value);
      const c8 = parseNumLike(case8El?.value);
      const U = minPositive([c1, c2, c8]);
      uGovEl.textContent = fmt(U, 3);

      const Ah = Number.isFinite(n) && Number.isFinite(dh) && Number.isFinite(t) ? n * dh * t : null;
      ahEl.textContent = fmt(Ah, 3);

      const dfDispEl = el('sfTenAnaDfDisp');
      if (dfDispEl) {
        const dNom = parseNumLike(dhEl?.value);
        dfDispEl.textContent = Number.isFinite(dNom) ? fmt(dNom, 4) : '—';
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

      const AnSt = Number.isFinite(Ag) && Number.isFinite(Ah) && Number.isFinite(t) && Number.isFinite(stagSum)
        ? Ag - Ah + t * stagSum
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
      const lrfdYield = Number.isFinite(Fy) && Number.isFinite(Ag) ? 0.9 * Fy * Ag : null;
      const lrfdFrac = Number.isFinite(Fu) && Number.isFinite(Ae) ? 0.75 * Fu * Ae : null;
      const asdYield = Number.isFinite(Fy) && Number.isFinite(Ag) ? (Fy * Ag) / 1.67 : null;
      const asdFrac = Number.isFinite(Fu) && Number.isFinite(Ae) ? (Fu * Ae) / 2.0 : null;
      const lrfdGov = Number.isFinite(lrfdYield) && Number.isFinite(lrfdFrac) ? Math.min(lrfdYield, lrfdFrac) : null;
      const asdGov = Number.isFinite(asdYield) && Number.isFinite(asdFrac) ? Math.min(asdYield, asdFrac) : null;

      if (outLrfdY) outLrfdY.textContent = fmt(lrfdYield, 3);
      if (outLrfdF) outLrfdF.textContent = fmt(lrfdFrac, 3);
      if (outLrfdGov) outLrfdGov.textContent = fmt(lrfdGov, 3);
      if (outLrfdUlt) outLrfdUlt.textContent = fmt(lrfdGov, 3);
      if (outAsdY) outAsdY.textContent = fmt(asdYield, 3);
      if (outAsdF) outAsdF.textContent = fmt(asdFrac, 3);
      if (outAsdGov) outAsdGov.textContent = fmt(asdGov, 3);
      if (outAsdAllow) outAsdAllow.textContent = fmt(asdGov, 3);

      const syncCapMirror = (srcId, dstId) => {
        const src = el(srcId);
        const dst = el(dstId);
        if (src && dst) dst.textContent = src.textContent;
      };
      syncCapMirror('sfTenAnaLrfdYield', 'sfTenAnaLrfdYieldMir');
      syncCapMirror('sfTenAnaLrfdFracture', 'sfTenAnaLrfdFractureMir');
      syncCapMirror('sfTenAnaCapBlock', 'sfTenAnaCapBlockMir');
      syncCapMirror('sfTenAnaLrfdGov', 'sfTenAnaLrfdGovMir');
    }

    function setDefaults() {
      const activeGrade = getActiveSteelGrade();
      if (methodEl && !methodEl.value) methodEl.value = 'lrfd';
      if (shapeEl && !shapeEl.value) shapeEl.value = 'l';
      if (lenEl && !String(lenEl.value).trim()) lenEl.value = '120';
      if (nEl && !String(nEl.value).trim()) nEl.value = '2';
      if (dhEl && !String(dhEl.value).trim()) dhEl.value = '3/4';
      if (case1El && !String(case1El.value).trim()) case1El.value = '1.0';
      if (case8El && !String(case8El.value).trim()) case8El.value = '0.9';
      if (steelEl && !String(steelEl.value).trim()) steelEl.value = activeGrade?.label ?? 'A992';
      applySteelDefaults();
      setGeometryReadOnly(!isManualMode());
      case2Touched = false;
      stagSumTouched = false;
    }

    function defaultAngleRow() {
      const preferredLabels = ['L4X4X1/2', 'L3-1/2X3-1/2X3/8'];
      for (const p of preferredLabels) {
        const hit = angleRows.find(
          (r) => String(r[COL.label] || '').trim().toUpperCase() === p.toUpperCase(),
        );
        if (hit) return hit;
      }
      return angleRows[0] ?? null;
    }

    function wire() {
      pane.querySelectorAll('input, select').forEach((x) => {
        x.addEventListener('input', recompute);
        x.addEventListener('change', recompute);
      });
      aiscEl.addEventListener('change', () => {
        if (!isManualMode()) applyAiscRowByLabel(aiscEl.value);
        recompute();
      });
      aiscEl.addEventListener('blur', () => {
        if (!isManualMode()) applyAiscRowByLabel(aiscEl.value);
        recompute();
      });
      steelEl?.addEventListener('change', () => {
        applySteelDefaults();
        recompute();
      });
      shapeEl?.addEventListener('change', () => {
        const manual = isManualMode();
        setGeometryReadOnly(!manual);
        case2Touched = false;
        stagSumTouched = false;
        if (!manual && angleRows.length) {
          applyAiscRowByLabel(aiscEl.value) || applyAiscRowByLabel(angleRows[0][COL.label]);
        }
        recompute();
      });
      case2El?.addEventListener('input', () => {
        case2Touched = String(case2El.value || '').trim() !== '';
      });
      sumEl?.addEventListener('input', () => {
        stagSumTouched = String(sumEl.value || '').trim() !== '';
      });
      solveBtn?.addEventListener('click', recompute);
    }

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
            return (typ === 'L' || typ === '2L') && !!lbl;
          });

        dl.innerHTML = '';
        angleRows.forEach((r) => {
          const opt = document.createElement('option');
          opt.value = String(r[COL.label] || '').trim();
          dl.appendChild(opt);
        });

        setDefaults();
        const dflt = defaultAngleRow();
        if (dflt) applyAiscRowByLabel(dflt[COL.label]);
        wire();
        recompute();
      })
      .catch(() => {
        setDefaults();
        wire();
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
    const uEl = el('sfTenDesU');
    const rEl = el('sfTenDesR');
    const nEl = el('sfTenDesN');
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

    let angleRows = [];

    const getUFromLagText = () => {
      const raw = String(lagEl?.value || '').trim().toUpperCase();
      if (!raw) return null;
      const n = parseNumLike(raw);
      if (Number.isFinite(n)) return n;
      if (raw.includes('1')) return 1.0;
      if (raw.includes('2')) return 0.85;
      if (raw.includes('8')) return 0.9;
      return null;
    };

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
      const hit = getSteelByText(steelEl.value);
      if (!hit) {
        fyEl.readOnly = false;
        fuEl.readOnly = false;
        return;
      }
      steelEl.value = hit.label;
      fyEl.value = String(hit.fy);
      fuEl.value = String(hit.fu);
      fyEl.readOnly = true;
      fuEl.readOnly = true;
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
      const activeGrade = getActiveSteelGrade();
      if (!methodEl.value) methodEl.value = 'lrfd';
      if (!String(dlEl.value).trim()) dlEl.value = '70';
      if (!String(llEl.value).trim()) llEl.value = '30';
      if (!String(lEl.value).trim()) lEl.value = '120';
      if (!String(steelEl.value).trim()) steelEl.value = activeGrade?.label ?? 'A992';
      if (!String(lagEl?.value || '').trim()) lagEl.value = 'CASE 2';
      if (!String(nEl?.value || '').trim()) nEl.value = '2';
      if (!String(dhEl?.value || '').trim()) dhEl.value = '7/8';
      if (uEl) uEl.readOnly = true;
      applySteelDefaults();
      normalizeInputs();
    }

    function renderTable(govAg) {
      const rows = sortedByArea(angleRows);
      const safeRows = rows.filter((r) => Number.isFinite(rowArea(r)) && Number.isFinite(govAg) && rowArea(r) >= govAg);
      const lightest = safeRows[0] ?? null;

      let displayRows = rows.slice(0, 12);
      if (Number.isFinite(govAg) && rows.length > 0) {
        let pivot = rows.findIndex((r) => Number.isFinite(rowArea(r)) && rowArea(r) >= govAg);
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
        const ok = Number.isFinite(ag) && Number.isFinite(govAg) ? ag >= govAg : false;
        const label = String(r[COL.label] || '').trim();
        const isThreshold = lightest && label === String(lightest[COL.label] || '').trim();
        const tr = document.createElement('tr');
        if (isThreshold) {
          tr.classList.add('sf-tensDes__row--threshold');
          tr.title = 'Threshold row: first section meeting required Ag';
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
      const aeFrac = Number.isFinite(Treq) && Number.isFinite(Fu) && Fu > 0
        ? (isLRFD ? Treq / (0.75 * Fu) : (Treq * 2.0) / Fu)
        : null;
      const agFromFrac = Number.isFinite(aeFrac) && Number.isFinite(U) && U > 0 ? aeFrac / U : null;
      const govAg = Number.isFinite(agYield) && Number.isFinite(agFromFrac) ? Math.max(agYield, agFromFrac)
        : Number.isFinite(agYield) ? agYield
        : Number.isFinite(agFromFrac) ? agFromFrac : null;

      if (outYieldAg) outYieldAg.textContent = fmt(agYield, 3);
      if (outFracAe) outFracAe.textContent = fmt(aeFrac, 3);
      if (outFracAssAg) outFracAssAg.textContent = fmt(agFromFrac, 3);
      if (outGovAg) outGovAg.textContent = fmt(govAg, 3);

      const dh = parseNumLike(dhEl?.value);
      const df = Number.isFinite(dh) ? dh + 1 / 16 : null;
      if (dfEl) dfEl.textContent = fmt(df, 3);

      renderTable(govAg);
    }

    function wire() {
      pane.querySelectorAll('input, select').forEach((x) => {
        x.addEventListener('input', recompute);
        x.addEventListener('change', recompute);
      });
      steelEl.addEventListener('change', () => {
        applySteelDefaults();
        recompute();
      });
      solveBtn?.addEventListener('click', recompute);
    }

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
        setDefaults();
        wire();
        recompute();
      })
      .catch(() => {
        setDefaults();
        wire();
        recompute();
      });
  };
})();

