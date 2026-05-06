(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = { type: 0, label: 2, weight: 4, lamF: 23, lamW: 24, Ix: 29, Sx: 30, Zx: 33 };
  const PHI_B = 0.9;
  const OMEGA_B = 1.67;
  const E_DEFAULT = 29000;
  const KMOM = 1 / 8;
  const FY_CUSTOM_DEFAULT = 50;

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
    const lpF = 0.38 * Math.sqrt(E / Fy);
    const lrF = 1.0 * Math.sqrt(E / Fy);
    const lpW = 3.76 * Math.sqrt(E / Fy);
    const lrW = 5.7 * Math.sqrt(E / Fy);
    const branch = (lam, lp, lr) => {
      if (lam <= lp) return Mp;
      if (lam <= lr) return Mp - (Mp - 0.7 * My) * ((lam - lp) / (lr - lp));
      return 0.7 * My;
    };
    const MnF = branch(lamF, lpF, lrF);
    const MnW = branch(lamW, lpW, lrW);
    return Math.min(MnF, MnW);
  }

  function compactnessVerdict(lamF, lamW, Fy, E) {
    if (![lamF, lamW, Fy, E].every((x) => Number.isFinite(x) && x > 0)) return '—';
    const lpF = 0.38 * Math.sqrt(E / Fy);
    const lrF = 1.0 * Math.sqrt(E / Fy);
    const lpW = 3.76 * Math.sqrt(E / Fy);
    const lrW = 5.7 * Math.sqrt(E / Fy);
    const flangeOk = lamF <= lpF && lamW <= lpW;
    const noncompactOk = lamF <= lrF && lamW <= lrW;
    if (flangeOk) return 'COMPACT SECTION';
    if (noncompactOk) return 'NONCOMPACT SECTION';
    return 'SLENDER SECTION';
  }

  function deflK(beam) {
    return beam === 'cont' ? 1 / 185 : 5 / 384;
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
    const g = steelPropsFromControlValue(sel.value);
    return g && Number.isFinite(g.fy) ? g.fy : FY_CUSTOM_DEFAULT;
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

  function deltaInches(W_klf, L_ft, E_ksi, I_in4, beam) {
    if (![W_klf, L_ft, E_ksi, I_in4].every((x) => Number.isFinite(x) && x > 0)) return null;
    const k = deflK(beam);
    return (k * W_klf * Math.pow(12, 3) * Math.pow(L_ft, 4)) / (E_ksi * I_in4);
  }

  function requiredIx(W_svc_klf, L_ft, E_ksi, delta_in, beam) {
    if (![W_svc_klf, L_ft, E_ksi, delta_in].every((x) => Number.isFinite(x) && x > 0)) return null;
    const k = deflK(beam);
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
          beam: String(els.beamY?.value || 'fp-u'),
          steel: steelY,
        };
      }
      return {
        dl: parseNumLike(els.dlN?.value),
        ll: parseNumLike(els.llN?.value),
        L: parseNumLike(els.lN?.value),
        beam: String(els.beamN?.value || 'fp-u'),
        steel: steelN,
      };
    }

    function setOutSpan(el, text) {
      if (el) el.textContent = text;
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
      norm(els.deflLim, 4, 0);
    }

    function recompute() {
      normalizeInputs();
      const ins = activeInputs();
      const method = String(methodEl.value || 'lrfd').toLowerCase();
      const isLRFD = method === 'lrfd';
      const E = E_DEFAULT;
      const Fy = fyFromSelect(ins.steel);

      if (els.capSym) {
        els.capSym.innerHTML = isLRFD ? 'M<sub>u</sub> =' : 'M<sub>a</sub> =';
      }

      const deflOn = isDeflOn();
      const deltaLimIn = deflOn ? parseNumLike(els.deflLim?.value) : null;

      const dl = ins.dl;
      const ll = ins.ll;
      const L = ins.L;
      const beam = ins.beam;

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
        ].forEach((el) => {
          if (el) el.textContent = '—';
        });
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
        const ixReq = requiredIx(Wsvc, L, E, deltaLimIn, beam);
        if (Number.isFinite(ixReq) && ixReq > 0) I_min = ixReq;
        setOutSpan(els.ixChip, fmt(ixReq, 1));
        setOutSpan(els.allowDefl, `${fmt(deltaLimIn, 4)} in`);
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
        verdict.includes('SLENDER')
          ? 'Check slender-element provisions; nominal strength reduced.'
          : 'Section satisfies bending strength for governing combination.'
      );

      if (deflOn) {
        const Wsvc = dl + ll + w_self;
        const dMax = deltaInches(Wsvc, L, E, picked.Ix, beam);
        setOutSpan(els.deflY, Number.isFinite(dMax) ? `${fmt(dMax, 4)} in` : '—');
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
    }

    function wire() {
      pane.querySelectorAll('input, select').forEach((el) => {
        el.addEventListener('input', recompute);
        el.addEventListener('change', recompute);
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
      const dDefl = (dL * 12) / 360;
      if (els.dlN && String(els.dlN.value).trim() === '') els.dlN.value = String(dDL);
      if (els.llN && String(els.llN.value).trim() === '') els.llN.value = String(dLL);
      if (els.lN && String(els.lN.value).trim() === '') els.lN.value = String(dL);
      if (els.dlY && String(els.dlY.value).trim() === '') els.dlY.value = String(dDL);
      if (els.llY && String(els.llY.value).trim() === '') els.llY.value = String(dLL);
      if (els.lY && String(els.lY.value).trim() === '') els.lY.value = String(dL);
      if (els.deflLim && String(els.deflLim.value).trim() === '') els.deflLim.value = fmt(dDefl, 4);
      if (els.beamN && !String(els.beamN.value).trim()) els.beamN.value = 'fp-u';
      if (els.beamY && !String(els.beamY.value).trim()) els.beamY.value = 'cont';
    }

    const preferredSteelId = getPreferredSteelGradeId();
    populateSteelControl(steelN, preferredSteelId);
    populateSteelControl(steelY, preferredSteelId);
    steelY.value = steelN.value;
    applyDefaults();
    wire();

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
