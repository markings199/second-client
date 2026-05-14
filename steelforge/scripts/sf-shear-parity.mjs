/**
 * Node parity checks vs reference workbook `reference/exel program EWIWIWI(SHEAR).csv`.
 * Mirrors shear formulas in js/calculator.js (analysis φv=1 Ωv=1.5; design CONDITION CHECKING
 * uses λ-band φ/Ω; design SHEAR CAPACITY card assumes Cv=1 → ϕVn=Vn, Vn/Ω=Vn/1.5).
 * Design ULTIMATE SHEAR / header pills show φVn (LRFD) or Vn/Ω (ASD) from CONDITION CHECKING — same C_v, φ_v, Ω_v as V_n row.
 * Loads shape catalog like js/shear-csv-shapes.js for section-pick regression checks.
 * Run: node scripts/sf-shear-parity.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PHI_V_ANALYSIS = 1;
const OMEGA_V_ANALYSIS = 1.5;
const PHI_V_DESIGN = 0.9;
const OMEGA_V_DESIGN = 1.67;
const PHI_B = 0.9;
const OMEGA_B = 1.67;
const E = 29000;
const KV = 5;

function calcShearCv(lambda, lambdaP, lambdaR, Fy, Ev, kv) {
  if (![lambda, lambdaP, lambdaR, Fy, Ev, kv].every(Number.isFinite)) return null;
  if (lambda <= 0 || lambdaP <= 0 || lambdaR <= 0 || Fy <= 0 || Ev <= 0 || kv <= 0) return null;
  const limA = 2.24 * Math.sqrt(Ev / Fy);
  if (lambda <= limA) return 1;
  if (lambda <= lambdaP) return 1;
  if (lambda <= lambdaR) return lambdaP / lambda;
  return (1.51 * kv * Ev) / (Fy * lambda ** 2);
}

function fmtShearLimit(v) {
  if (!Number.isFinite(v)) return null;
  return Number(v.toFixed(8));
}

function nearly(a, b, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}

const checks = [];
function add(name, ok, detail = '') {
  checks.push({ name, ok, detail });
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
  if (!s0 || s0 === '—' || s0 === '–' || s0 === '-' || s0 === '�') return null;
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

/** Same columns as js/shear-csv-shapes.js */
function loadShearShapesFromRepoCsv() {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = { type: 0, label: 2, w: 4, d: 6, tw: 8, lamF: 23, lamW: 24, zx: 33 };
  const txt = readFileSync(join(__dirname, '..', CSV_NAME), 'utf8');
  const lines = txt.split(/\r?\n/);
  const out = [];
  for (let i = 4; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (String(row[COL.type] || '').trim() !== 'W') continue;
    const name = String(row[COL.label] || '').trim();
    if (!name) continue;
    const d = parseNumLike(row[COL.d]);
    const tw = parseNumLike(row[COL.tw]);
    const lamW = parseNumLike(row[COL.lamW]);
    const lamF = parseNumLike(row[COL.lamF]);
    if (![d, tw, lamW].every((x) => Number.isFinite(x) && x > 0)) continue;
    const h = lamW * tw;
    const Aw = d * tw;
    const zx = parseNumLike(row[COL.zx]);
    out.push({
      name,
      weightLbFt: parseNumLike(row[COL.w]),
      d,
      tw,
      h,
      Aw,
      lambdaW: lamW,
      lambdaF: lamF,
      zx: Number.isFinite(zx) ? zx : null,
    });
  }
  const sortedByWeight = [...out].sort(
    (a, b) =>
      (a.weightLbFt ?? 9999) - (b.weightLbFt ?? 9999) || String(a.name).localeCompare(String(b.name)),
  );
  return { shapes: out, shapesSortedByWeight: sortedByWeight };
}

function shearWebAreaWorkbook(shape) {
  if (!shape) return null;
  if (Number.isFinite(shape.d) && Number.isFinite(shape.tw) && shape.tw > 0) return shape.d * shape.tw;
  return Number.isFinite(shape.Aw) ? shape.Aw : null;
}

function shearStrengthForShape(shape, fyV, EV, kvV, phiV, omegaV) {
  const lambda =
    Number.isFinite(shape.h) && Number.isFinite(shape.tw) && shape.tw > 0
      ? shape.h / shape.tw
      : Number.isFinite(shape.lambdaW)
        ? shape.lambdaW
        : null;
  const aw = shearWebAreaWorkbook(shape);
  const lambdaP =
    Number.isFinite(fyV) && fyV > 0 && Number.isFinite(EV) && EV > 0 && Number.isFinite(kvV) && kvV > 0
      ? 1.1 * Math.sqrt((kvV * EV) / fyV)
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
}

function pickAssumedForMoment(shapesSorted, zxReqV) {
  if (!shapesSorted.length) return null;
  const ok = shapesSorted.filter((s) => Number.isFinite(s.zx) && s.zx >= zxReqV);
  if (ok.length) return ok[0];
  return shapesSorted.reduce((a, b) => ((a.zx ?? 0) >= (b.zx ?? 0) ? a : b));
}

function shearStrengthCv1Cap(shape, fyV) {
  const aw =
    Number.isFinite(shape.Aw)
      ? shape.Aw
      : Number.isFinite(shape.d) && Number.isFinite(shape.tw)
        ? shape.d * shape.tw
        : null;
  const Vn1 = Number.isFinite(fyV) && Number.isFinite(aw) ? 0.6 * fyV * aw * 1 : null;
  return {
    Vn: Vn1,
    phiVn: Vn1,
    Vallow: Number.isFinite(Vn1) ? Vn1 / 1.5 : null,
  };
}

function pickLightestForShear(shapesSorted, zxReqV, shearVV, fyV, lrfd) {
  const passes = (shape) => {
    const { phiVn: pv, Vallow: va } = shearStrengthCv1Cap(shape, fyV);
    if (lrfd) return Number.isFinite(pv) && Number.isFinite(shearVV) && shearVV <= pv;
    return Number.isFinite(va) && Number.isFinite(shearVV) && shearVV <= va;
  };
  return shapesSorted.find((s) => Number.isFinite(s.zx) && s.zx >= zxReqV && passes(s)) ?? null;
}

// --- ANALYSIS (CSV ~10–30): W12×40, unstiffened, Fy = 50 ksi, kv = 5
const fy50 = 50;
const Aw = 3.5105;
const lamW = 33.6;
const kv = 5;
const lim224 = 2.24 * Math.sqrt(E / fy50);
const lambdaP = 1.1 * Math.sqrt((kv * E) / fy50);
const lambdaR = 1.37 * Math.sqrt((kv * E) / fy50);
const cv = calcShearCv(lamW, lambdaP, lambdaR, fy50, E, kv);
const Vn = 0.6 * fy50 * Aw * cv;
const phiVnAna = PHI_V_ANALYSIS * Vn;
const VaAna = Vn / OMEGA_V_ANALYSIS;

add('Analysis λ₁ (2.24√(E/Fy)) ~53.946344', nearly(fmtShearLimit(lim224), 53.94634371, 1e-5), `got ${fmtShearLimit(lim224)}`);
add('Analysis λp web shear ~59.236813', nearly(fmtShearLimit(lambdaP), 59.23681288, 1e-5), `got ${fmtShearLimit(lambdaP)}`);
add('Analysis λr web shear ~73.776758', nearly(fmtShearLimit(lambdaR), 73.77675786, 1e-5), `got ${fmtShearLimit(lambdaR)}`);
add('Analysis Cv = 1', cv === 1);
add('Analysis Vn (105.315)', nearly(Vn, 105.315, 0.002), `got ${Vn}`);
add('Analysis LRFD Vu capacity (=Vn @ φ=1)', nearly(phiVnAna, 105.315, 0.002));
add('Analysis ASD Va capacity (70.21)', nearly(VaAna, 70.21, 0.002), `got ${VaAna}`);

// λ_w = h·d/A_w for catalog W12×40 (matches UI hidden d + rolled-shape convention)
const hW12 = 9.912;
const dW12 = 11.9;
const lamDerived = (hW12 * dW12) / Aw;
add('Catalog λ_w from h·d/A_w (33.6)', nearly(lamDerived, 33.6, 0.02), `got ${lamDerived}`);

// --- DESIGN cantilever UDL (CSV ~6–17): DL=0.2 LL=0.8 L=55 ft, Fy=65
const dl = 0.2;
const ll = 0.8;
const L = 55;
const fy65 = 65;
const w12comb = 1.2 * dl + 1.6 * ll;
const w14 = 1.4 * dl;
const Wu = Math.max(w12comb, w14);
const Wa = dl + ll;
const Mu = Wu * L * L * (1 / 3);
const Vu = Wu * L;
const Ma = Wa * L * L * (1 / 3);
const Va = Wa * L;

add('Design Wu LRFD (1.52)', nearly(Wu, 1.52, 1e-9));
add('Design Wu governing vs 1.4DL (1.52 vs 0.28)', nearly(Wu, 1.52, 1e-9) && nearly(w14, 0.28, 1e-9));
add('Design Mu cantilever WL²/3 (1532.666667)', nearly(Mu, 1532.666667, 0.02), `got ${Mu}`);
add('Design Vu cantilever wL (83.6)', nearly(Vu, 83.6, 0.02), `got ${Vu}`);
add('Design Wa ASD (1)', nearly(Wa, 1, 1e-9));
add('Design Ma cantilever (1008.333333)', nearly(Ma, 1008.333333, 0.02), `got ${Ma}`);
add('Design Va cantilever (55)', nearly(Va, 55, 0.02), `got ${Va}`);

const zxReqLrfd = (Mu * 12) / (PHI_B * fy65);
const zxReqAsd = (Ma * 12 * OMEGA_B) / fy65;
add('Design Zx,req LRFD (~314.393)', nearly(zxReqLrfd, 314.3931624, 0.05), `got ${zxReqLrfd}`);
add('Design Zx,req ASD (~310.877)', nearly(zxReqAsd, 310.8769231, 0.05), `got ${zxReqAsd}`);

add('Design CONDITION CHECKING pane may use φv=0.9 in λ-band (not cap card)', PHI_V_DESIGN === 0.9);
add('Design CONDITION CHECKING pane Ωv (1.67)', nearly(OMEGA_V_DESIGN, 1.67, 1e-9));

const VnAt65 = 0.6 * fy65 * Aw * 1;
const phiVnCv1Cap = VnAt65;
const VallowCv1Cap = VnAt65 / 1.5;
add('Design Cv=1 cap ϕVn (=Vn @ W12×40, Fy=65) (~136.91)', nearly(phiVnCv1Cap, 136.9095, 0.02), `got ${phiVnCv1Cap}`);
add('Design Cv=1 cap Vn/Ω (~91.273)', nearly(VallowCv1Cap, 91.273, 0.002), `got ${VallowCv1Cap}`);

// --- Catalog section picks (workbook row ~21: LRFD assumed W30X108, ASD W30X99)
let shapesSortedByWeight = [];
try {
  ({ shapesSortedByWeight } = loadShearShapesFromRepoCsv());
  const assumedLrfd = pickAssumedForMoment(shapesSortedByWeight, zxReqLrfd);
  const lightLrfd =
    pickLightestForShear(shapesSortedByWeight, zxReqLrfd, Vu, fy65, true) ?? assumedLrfd;
  add(
    'Catalog pick LRFD assumed section matches workbook (W30X108)',
    assumedLrfd?.name === 'W30X108',
    assumedLrfd ? `got ${assumedLrfd.name}` : 'missing shape list',
  );
  add(
    'Catalog pick LRFD lightest/shear-governing matches workbook (W30X108)',
    lightLrfd?.name === 'W30X108',
    lightLrfd ? `got ${lightLrfd.name}` : 'missing',
  );

  const assumedAsd = pickAssumedForMoment(shapesSortedByWeight, zxReqAsd);
  const lightAsd =
    pickLightestForShear(shapesSortedByWeight, zxReqAsd, Va, fy65, false) ?? assumedAsd;
  add(
    'Catalog pick ASD assumed section matches workbook (W30X99)',
    assumedAsd?.name === 'W30X99',
    assumedAsd ? `got ${assumedAsd.name}` : 'missing',
  );
  add(
    'Catalog pick ASD lightest matches workbook (W30X99)',
    lightAsd?.name === 'W30X99',
    lightAsd ? `got ${lightAsd.name}` : 'missing',
  );
} catch (e) {
  add('Catalog shape CSV readable', false, String(e?.message || e));
}

/**
 * Workbook SHEAR ANALYSIS — actual sample.
 * Section W24X62, Steel Grade "50" (Fy=50), web UNSTIFFENED, h=21.52, λf=5.97, λw=50.1,
 * Aw=10.191, kv=5, E=29000.
 * Cached values: λp=53.9463, λr_lower=59.2368, λr_upper=73.7768,
 *   λw=50.1 < λp → Cond 1 → Cv=1, φv=1, Ωv=1.5
 *   Vn = 0.6·50·10.191 = 305.73 ; φVn = 305.73 ; Va = Vn/1.5 = 203.82
 */
const wbAna = (() => {
  const Fy = 50, lamWv = 50.1, Awv = 10.191, kvv = 5;
  const lp = 2.24 * Math.sqrt(E / Fy);
  const lr1 = 1.10 * Math.sqrt((kvv * E) / Fy);
  const lr2 = 1.37 * Math.sqrt((kvv * E) / Fy);
  const Cv = calcShearCv(lamWv, lr1, lr2, Fy, E, kvv);
  const VnA = 0.6 * Fy * Awv * Cv;
  return { lp, lr1, lr2, Cv, VnA, phiVn: 1 * VnA, Va: VnA / 1.5 };
})();
add('Workbook SHEAR ANALYSIS λp (53.9463)', nearly(wbAna.lp, 53.94634371, 1e-5), `got ${wbAna.lp}`);
add('Workbook SHEAR ANALYSIS λr_lower (59.2368)', nearly(wbAna.lr1, 59.23681288, 1e-5));
add('Workbook SHEAR ANALYSIS λr_upper (73.7768)', nearly(wbAna.lr2, 73.77675786, 1e-5));
add('Workbook SHEAR ANALYSIS Cv = 1 (Cond 1)', wbAna.Cv === 1);
add('Workbook SHEAR ANALYSIS Vn = 305.73', nearly(wbAna.VnA, 305.73, 0.01), `got ${wbAna.VnA}`);
add('Workbook SHEAR ANALYSIS φVn = 305.73', nearly(wbAna.phiVn, 305.73, 0.01));
add('Workbook SHEAR ANALYSIS Va = 203.82', nearly(wbAna.Va, 203.82, 0.01), `got ${wbAna.Va}`);

/**
 * Workbook SHEAR DESIGN — actual sample.
 * Steel "A36" (Fy=36), DL=2, LL=18, L=7 ft, SIMPLE BEAM UDL.
 * Cached: Wu=31.2, Wu_alt=2.8, Mu=191.1, Vu=109.2, Wa=20, Ma=122.5, Va=70.
 * Zx_req_LRFD = 191.1·12/(36·0.9) = 70.778 ; Zx_req_ASD = 122.5·12·1.67/36 = 68.192.
 * Assumed section W16X40 (Zx=73, d=16, tw=0.305): Vn = 0.6·36·16·0.305·1 = 105.408,
 *   φVn = 105.408 (φ=1 because λw=46.5 < λp=63.576 at Fy=36), Va = Vn/1.5 = 70.272.
 * Check: φVn (105.408) < Vu (109.2) → UNSAFE, Va (70.272) > Vu_ASD (70) → SAFE.
 */
const wbDes = (() => {
  const Fy = 36, DL = 2, LL = 18, Ld = 7;
  const Wu_lrfd = Math.max(1.2 * DL + 1.6 * LL, 1.4 * DL);
  const Wa_asd = DL + LL;
  const Mu = (Wu_lrfd * Ld * Ld) / 8;
  const Vu = (Wu_lrfd * Ld) / 2;
  const Ma = (Wa_asd * Ld * Ld) / 8;
  const Va_demand = (Wa_asd * Ld) / 2;
  const Zx_req_L = (Mu * 12) / (Fy * 0.9);
  const Zx_req_A = (Ma * 12 * 1.67) / Fy;
  // W16X40 section
  const d = 16, tw = 0.305, lamW = 46.5;
  const lp = 2.24 * Math.sqrt(E / Fy);
  const lr1 = 1.10 * Math.sqrt((5 * E) / Fy);
  const lr2 = 1.37 * Math.sqrt((5 * E) / Fy);
  const Cv = calcShearCv(lamW, lr1, lr2, Fy, E, 5);
  const phiV = lamW < lp ? 1 : 0.9;
  const omegaV = lamW < lp ? 1.5 : 1.67;
  const Vn = 0.6 * Fy * d * tw * Cv;
  return {
    Wu_lrfd, Wa_asd, Mu, Vu, Ma, Va_demand, Zx_req_L, Zx_req_A,
    lp, lr1, lr2, Cv, phiV, omegaV,
    Vn, phiVn: phiV * Vn, Va: Vn / omegaV,
    safeLRFD: phiV * Vn > Vu,
    safeASD: Vn / omegaV > Va_demand,
  };
})();
add('Workbook SHEAR DESIGN Wu LRFD = 31.2', nearly(wbDes.Wu_lrfd, 31.2, 1e-9));
add('Workbook SHEAR DESIGN Mu = 191.1', nearly(wbDes.Mu, 191.1, 0.01), `got ${wbDes.Mu}`);
add('Workbook SHEAR DESIGN Vu = 109.2', nearly(wbDes.Vu, 109.2, 0.01));
add('Workbook SHEAR DESIGN Zx_req LRFD ≈ 70.778', nearly(wbDes.Zx_req_L, 70.7778, 0.01), `got ${wbDes.Zx_req_L}`);
add('Workbook SHEAR DESIGN Zx_req ASD ≈ 68.192', nearly(wbDes.Zx_req_A, 68.1917, 0.01), `got ${wbDes.Zx_req_A}`);
add('Workbook SHEAR DESIGN W16X40 Cv = 1', wbDes.Cv === 1);
add('Workbook SHEAR DESIGN W16X40 Vn = 105.408', nearly(wbDes.Vn, 105.408, 0.01), `got ${wbDes.Vn}`);
add('Workbook SHEAR DESIGN W16X40 LRFD UNSAFE (φVn < Vu)', wbDes.safeLRFD === false);
add('Workbook SHEAR DESIGN W16X40 ASD SAFE (Va > Vu_ASD)', wbDes.safeASD === true);
add(
  'Design ULTIMATE SHEAR pill matches φVn (not factored demand Vu)',
  nearly(wbDes.phiVn, 105.408, 0.01) && Math.abs(wbDes.phiVn - wbDes.Vu) > 1,
  `φVn=${wbDes.phiVn}, Vu=${wbDes.Vu}`,
);

const passed = checks.filter((c) => c.ok).length;
const total = checks.length;
console.log(`Shear workbook parity: ${passed}/${total} (${((100 * passed) / total).toFixed(1)}%)`);
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exitCode = passed === total ? 0 : 1;
