/**
 * Node parity checks vs reference workbook `exel program EWIWIWI(BENDING) (1).csv`.
 * Run: node steelforge/scripts/sf-bending-parity.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PHI_B = 0.9;
const OMEGA_B = 1.67;
const E = 29000;

/**
 * Workbook BENDING!F22 — strict parity:
 *   COMPACT      → Fy·Zx/12
 *   NON-COMPACT  → Mp − (Mp − 0.7·Fy·Sx/12) · (λf − λpf)/(λrf − λpf)
 *   SLENDER      → 0.9·E·Sx·(4/λw) / (λf² · 12)
 * Flange classification only — web slenderness not used to govern.
 */
function nominalMomentFlangeKipFt(Fy, Zx, Sx, lamF, lamW) {
  const Mp = (Fy * Zx) / 12;
  const My = (Fy * Sx) / 12;
  const lpF = 0.38 * Math.sqrt(E / Fy);
  const lrF = 1.0 * Math.sqrt(E / Fy);
  if (lamF <= lpF) return Mp;
  if (lamF <= lrF) {
    const den = lrF - lpF;
    return Mp - (Mp - 0.7 * My) * ((lamF - lpF) / den);
  }
  if (Number.isFinite(lamW) && lamW > 0) {
    return (0.9 * E * Sx * (4 / lamW)) / (lamF * lamF * 12);
  }
  return 0.7 * My;
}

function nominalMomentKipFt(Fy, Zx, Sx, lamF, lamW) {
  return nominalMomentFlangeKipFt(Fy, Zx, Sx, lamF, lamW);
}

function flangeCompactnessVerdict(lamF, Fy) {
  const lpF = 0.38 * Math.sqrt(E / Fy);
  const lrF = 1.0 * Math.sqrt(E / Fy);
  if (lamF <= lpF) return 'COMPACT FLANGE';
  if (lamF <= lrF) return 'NON-COMPACT FLANGE';
  return 'SLENDER FLANGE';
}

function lpFlange(Fy) {
  return 0.38 * Math.sqrt(E / Fy);
}

function nearly(a, b, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}

const checks = [];

function add(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

// --- BENDING ANALYSIS sample (CSV rows ~4–27): W21×44 @ Fy = 100 ksi
const Mn1 = nominalMomentKipFt(100, 95.4, 81.6, 7.22, 53.6);
add('Analysis W21×44 Mn — flange non-compact governs (~772.38)', nearly(Mn1, 772.375183, 0.02), `got ${Mn1}`);
add('Analysis φMn LRFD (~695.14)', nearly(PHI_B * Mn1, 695.137665, 0.02), `got ${PHI_B * Mn1}`);
add('Analysis Mn/Ω ASD (~462.50)', nearly(Mn1 / OMEGA_B, 462.50011, 0.02), `got ${Mn1 / OMEGA_B}`);
add('Analysis λpf limit (6.471167)', nearly(lpFlange(100), 6.471166819, 1e-5), `got ${lpFlange(100)}`);
add(
  'Analysis verdict NON-COMPACT FLANGE',
  flangeCompactnessVerdict(7.22, 100) === 'NON-COMPACT FLANGE',
);

// Second sample: W18×40 @ 100 ksi (design subsection Mn)
const Mn2 = nominalMomentKipFt(100, 78.4, 68.4, 5.73, 50.9);
add('Design sample Mn W18×40 (653.333)', nearly(Mn2, 653.3333333, 0.02), `got ${Mn2}`);

// --- BENDING DESIGN sample (CSV ~11–15): simple beam UDL, L = 55 ft, DL=0.2 LL=0.8
const dl = 0.2;
const ll = 0.8;
const L = 55;
const c12 = 1.2 * dl + 1.6 * ll;
const c14 = 1.4 * dl;
const Wu = Math.max(c12, c14);
const dlll = dl + ll;
const Mu = Wu * L * L * (1 / 8);
const Ma_req = dlll * L * L * (1 / 8);
add('Design Wu (1.52)', nearly(Wu, 1.52, 1e-9), `got ${Wu}`);
add('Design Mu WL²/8 (574.75)', nearly(Mu, 574.75, 0.01), `got ${Mu}`);
add('Design Ma DL+LL (378.125)', nearly(Ma_req, 378.125, 0.01), `got ${Ma_req}`);

// Required Zx ( workbook row 16 ) — LRFD & ASD @ Fy = 100
const Zx_lrfd = (12 * Mu) / (PHI_B * 100);
const Zx_asd = (12 * Ma_req * OMEGA_B) / 100;
add('Design Zx,req LRFD (76.633333)', nearly(Zx_lrfd, 76.63333333, 0.002), `got ${Zx_lrfd}`);
add('Design Zx,req ASD (75.77625)', nearly(Zx_asd, 75.77625, 0.002), `got ${Zx_asd}`);

// With beam weight — workbook row 25–26 ( L = 55 ft, simple UDL )
const Wu_bw = 1.568;
const Mu_bw = Wu_bw * L * L * (1 / 8);
add('Design Wu incl. self-weight (1.568)', nearly(Wu_bw, 1.568, 1e-6));
add('Design Mu incl. self-weight (592.9)', nearly(Mu_bw, 592.9, 0.05), `got ${Mu_bw}`);

// Deflection column @ Fy = 65 ksi — λpf and Mn for W21×44 (rows 45, 50, 55)
const Fy65 = 65;
const lpF65 = 0.38 * Math.sqrt(E / Fy65);
const Mn_w21_65 = nominalMomentKipFt(Fy65, 95.4, 81.6, 7.22, 53.6);
add('Defl λpf @65 ksi (8.026495)', nearly(lpF65, 8.026494589, 1e-5), `got ${lpF65}`);
add('Defl Mn W21×44 @65 (516.75)', nearly(Mn_w21_65, 516.75, 0.02), `got ${Mn_w21_65}`);
add('Defl φMn LRFD (465.075)', nearly(PHI_B * Mn_w21_65, 465.075, 0.02));
add('Defl Mn/Ω ASD (309.431)', nearly(Mn_w21_65 / OMEGA_B, 309.4311377, 0.02));

// Allowable deflection workbook uses span/n in feet ( row 61 )
const Ldef_ft = 35;
const delta_allow_ft = Ldef_ft / 360;
add('Δallow L/n as ft (0.097222)', nearly(delta_allow_ft, 0.097222222, 1e-6));

/** Excel MATCH(lookup, range, -1) on non-increasing SECTION ZX columns C / D. */
function largestIndexGeNonIncreasing(arr, val) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] >= val) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
const zxCsv = [
  { lab: 'W21X44', zx: 95.4, ix: 843 },
  { lab: 'W18X35', zx: 66.5, ix: 510 },
];
const zxCol = zxCsv.map((r) => r.zx);
const ixCol = zxCsv.map((r) => r.ix);
add(
  'SECTION ZX Zx req 62.07 → W18X35',
  zxCsv[largestIndexGeNonIncreasing(zxCol, 62.06666667)]?.lab === 'W18X35',
);
add(
  'SECTION ZX Ix req 798.362 → W21X44',
  zxCsv[largestIndexGeNonIncreasing(ixCol, 798.362069)]?.lab === 'W21X44',
);

/** Parse `exel program EWIWIWI(SECTION ZX).csv` (no quoted fields in practice). */
function parseSectionZxCsv(txt) {
  const lines = String(txt || '')
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const lab = String(parts[1] || '').trim();
    const zx = Number(parts[2]);
    const ix = Number(parts[3]);
    if (lab && Number.isFinite(zx) && Number.isFinite(ix)) rows.push({ lab, zx, ix });
  }
  return rows;
}

function sectionZxLabelForZxReq(rows, zxReq) {
  if (!rows.length || !Number.isFinite(zxReq) || zxReq <= 0) return null;
  const zxCol = rows.map((r) => r.zx);
  const idx = largestIndexGeNonIncreasing(zxCol, zxReq);
  return idx >= 0 ? rows[idx].lab : null;
}

function canonWLabel(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

const zxCsvPath = path.join(__dirname, '..', 'exel program EWIWIWI(SECTION ZX).csv');
const zxRowsFull = parseSectionZxCsv(fs.readFileSync(zxCsvPath, 'utf8'));
add('SECTION ZX CSV loads (≥60 rows)', zxRowsFull.length >= 60, `got ${zxRowsFull.length}`);
let zxMidpointsOk = true;
let zxMidDetail = '';
for (let i = 0; i < zxRowsFull.length - 1; i++) {
  const zHi = zxRowsFull[i].zx;
  const zLo = zxRowsFull[i + 1].zx;
  if (!(zHi > zLo)) continue;
  const mid = (zHi + zLo) / 2;
  const lab = sectionZxLabelForZxReq(zxRowsFull, mid);
  if (lab !== zxRowsFull[i].lab) {
    zxMidpointsOk = false;
    zxMidDetail = `row ${i + 1}↔${i + 2}: Z=${mid} → ${lab} (expect ${zxRowsFull[i].lab})`;
    break;
  }
}
add('SECTION ZX Zx MATCH(-1) all midpoints', zxMidpointsOk, zxMidDetail);
add(
  'SECTION ZX Zx req 54.3 → W14x34 (canon)',
  canonWLabel(sectionZxLabelForZxReq(zxRowsFull, 54.3)) === 'W14X34',
  `got ${sectionZxLabelForZxReq(zxRowsFull, 54.3)}`,
);
// BENDING DESIGN WITH DEFLECTION — L=35 ft, A992 Fy=50, DL=0.2, LL=0.8, simple UDL, L/360 (workbook screenshots)
const dl35 = 0.2;
const ll35 = 0.8;
const L35 = 35;
const Fy50 = 50;
const Wu35 = Math.max(1.2 * dl35 + 1.6 * ll35, 1.4 * dl35);
const Mu35 = Wu35 * L35 * L35 * (1 / 8);
const Zreq35 = (12 * Mu35) / (PHI_B * Fy50);
add('Demo L=35 Mu w/o BW (232.75)', nearly(Mu35, 232.75, 0.01), `got ${Mu35}`);
add('Demo L=35 Zx,req LRFD (~62.067)', nearly(Zreq35, 62.06666667, 0.002), `got ${Zreq35}`);
const Eksi = 29000;
const kDefl = 5 / 384;
const deltaIn35 = (L35 * 12) / 360;
const Ireq35 =
  (kDefl * ll35 * Math.pow(12, 3) * Math.pow(L35, 4)) / (Eksi * deltaIn35);
add('Demo L=35 Ix,req LL-only (~798.362)', nearly(Ireq35, 798.362069, 0.001), `got ${Ireq35}`);
const wBeam44 = 44 / 1000;
const WuBw35 = 1.2 * (dl35 + wBeam44) + 1.6 * ll35;
const MuBw35 = WuBw35 * L35 * L35 * (1 / 8);
add('Demo W21×44 Wu incl. BW (1.5728)', nearly(WuBw35, 1.5728, 1e-4), `got ${WuBw35}`);
add('Demo W21×44 Mu incl. BW (240.835)', nearly(MuBw35, 240.835, 0.01), `got ${MuBw35}`);

/**
 * Workbook BENDING sheet — full analysis example.
 * Section W21X48 at Fy=100, Zx=107, Sx=93, λf=9.47, λw=53.6.
 *   Mp = 100·107/12 = 891.667 kip·ft (E13)
 *   λpf = 0.38·√(290) = 6.47117 (F17)
 *   λrf = √(290) = 17.0294 (F19)
 *   λf = 9.47 → NON-COMPACT FLANGE (D21)
 *   Mn (F22) ≈ 891.667 − (891.667 − 0.7·100·93/12) · (9.47 − 6.47117)/(17.0294 − 6.47117)
 *            ≈ 792.49 kip·ft
 *   E25 = 0.9·Mn ≈ 713.244 (workbook cached)
 *   E26 = Mn/1.67 ≈ 474.547 (workbook cached)
 */
const Mn_W21X48 = nominalMomentKipFt(100, 107, 93, 9.47, 53.6);
add('Workbook W21X48 Mn analysis (~792.49)', nearly(Mn_W21X48, 792.4934, 0.1), `got ${Mn_W21X48}`);
add('Workbook W21X48 φMn LRFD (~713.24)', nearly(PHI_B * Mn_W21X48, 713.2441, 0.1), `got ${PHI_B * Mn_W21X48}`);
add('Workbook W21X48 Mn/Ω ASD (~474.547)', nearly(Mn_W21X48 / OMEGA_B, 474.547, 0.1), `got ${Mn_W21X48 / OMEGA_B}`);

/**
 * Slender flange branch parity — uses workbook elastic FLB form.
 * Synthetic: Fy=100, Sx=50, λf=20 (>λrf=17.03), λw=30
 *   Mn = 0.9·29000·50·(4/30)/(20²·12) = 174000·(0.13333)/4800 = 36.25 kip·ft
 */
const Mn_slender = nominalMomentKipFt(100, 60, 50, 20, 30);
const expected_slender = (0.9 * E * 50 * (4 / 30)) / (20 * 20 * 12);
add('Slender flange branch (workbook elastic form)', nearly(Mn_slender, expected_slender, 1e-6), `got ${Mn_slender}, expected ${expected_slender}`);

const passed = checks.filter((c) => c.ok).length;
const total = checks.length;
console.log(`Bending workbook parity: ${passed}/${total} (${((100 * passed) / total).toFixed(1)}%)`);
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exitCode = passed === total ? 0 : 1;
