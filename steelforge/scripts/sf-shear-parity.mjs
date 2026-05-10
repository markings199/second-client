/**
 * Node parity checks vs reference workbook `reference/exel program EWIWIWI(SHEAR).csv`.
 * Mirrors shear formulas in js/calculator.js (analysis φv=1 Ωv=1.5; design φv=0.9 Ωv=1.67).
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

function shearStrengthForShape(shape, fyV, EV, kvV, phiV, omegaV) {
  const lambda =
    Number.isFinite(shape.h) && Number.isFinite(shape.tw) && shape.tw > 0
      ? shape.h / shape.tw
      : Number.isFinite(shape.lambdaW)
        ? shape.lambdaW
        : null;
  const aw =
    Number.isFinite(shape.Aw)
      ? shape.Aw
      : Number.isFinite(shape.d) && Number.isFinite(shape.tw)
        ? shape.d * shape.tw
        : null;
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

function pickLightestForShear(shapesSorted, zxReqV, shearVV, fyV, EV, kvV, lrfd, phiV, omegaV) {
  const passes = (shape) => {
    const { phiVn: pv, Vallow: va } = shearStrengthForShape(shape, fyV, EV, kvV, phiV, omegaV);
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

add('Design pane φv (0.9)', PHI_V_DESIGN === 0.9);
add('Design pane Ωv (1.67)', nearly(OMEGA_V_DESIGN, 1.67, 1e-9));

const VnAt65 = 0.6 * fy65 * Aw * 1;
const phiVnAt65 = PHI_V_DESIGN * VnAt65;
const VallowAt65 = VnAt65 / OMEGA_V_DESIGN;
add('Design φVn @ W12×40 Aw with Fy=65 (~123.219)', nearly(phiVnAt65, 123.21855, 0.02), `got ${phiVnAt65}`);
add('Design Vn/Ω @ same (~81.982)', nearly(VallowAt65, 81.98173652694611, 0.002), `got ${VallowAt65}`);

// --- Catalog section picks (workbook row ~21: LRFD assumed W30X108, ASD W30X99)
let shapesSortedByWeight = [];
try {
  ({ shapesSortedByWeight } = loadShearShapesFromRepoCsv());
  const assumedLrfd = pickAssumedForMoment(shapesSortedByWeight, zxReqLrfd);
  const lightLrfd =
    pickLightestForShear(shapesSortedByWeight, zxReqLrfd, Vu, fy65, E, KV, true, PHI_V_DESIGN, OMEGA_V_DESIGN) ??
    assumedLrfd;
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
    pickLightestForShear(shapesSortedByWeight, zxReqAsd, Va, fy65, E, KV, false, PHI_V_DESIGN, OMEGA_V_DESIGN) ??
    assumedAsd;
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

const passed = checks.filter((c) => c.ok).length;
const total = checks.length;
console.log(`Shear workbook parity: ${passed}/${total} (${((100 * passed) / total).toFixed(1)}%)`);
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exitCode = passed === total ? 0 : 1;
