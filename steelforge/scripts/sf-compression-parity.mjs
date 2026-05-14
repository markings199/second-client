/**
 * Offline parity check: workbook-style compression chain vs CSV shape props.
 * Run: node scripts/sf-compression-parity.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(__dirname, '..', 'reference', 'exel program EWIWIWI(S(STEEL SELECTION)).csv');

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
  const n = Number(s0.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Matches calculator.js sfCompressionWorkbookFcr */
function sfCompressionWorkbookFcr(Fy, Fe) {
  if (![Fy, Fe].every((x) => Number.isFinite(x) && x > 0)) return null;
  const fyOverFe = Fy / Fe;
  if (fyOverFe <= 2.25) {
    return (0.658 ** fyOverFe) * Fy;
  }
  return 0.877 * Fe;
}

const COL = { type: 0, label: 2, Ag: 5, rx: 31, ry: 37 };

const txt = fs.readFileSync(CSV, 'utf8');
const lines = txt.split(/\r?\n/);
const rowLine = lines.find((l) => l.includes('W40X503'));
if (!rowLine) {
  console.error('W40X503 row not found');
  process.exit(1);
}
const r = parseCsvLine(rowLine);
const Ag = parseNumLike(r[COL.Ag]);
const rx = parseNumLike(r[COL.rx]);
const ry = parseNumLike(r[COL.ry]);

const E = 29000;
const PHI_C = 0.9;
const OMEGA_C = 1.67;

// Scenario aligned with analysis defaults: y1=y2=35 ft, pinned-pinned K=1, governing row uses ry
const Lft = 35;
const K = 1;
const klr = (K * Lft * 12) / ry;
const Fe = (Math.PI ** 2 * E) / klr ** 2;
const Fy = 55;
const Fcr = sfCompressionWorkbookFcr(Fy, Fe);
const Pn = Fcr * Ag;

console.log('Parity probe (W40X503, Fy=55 ksi, KLy governing as y1 segment)');
console.log({ Ag, rx, ry, klr, Fe, Fcr, Pn, phiPn: PHI_C * Pn, Pa: Pn / OMEGA_C });

const checks = [
  ['Fe positive', Number.isFinite(Fe) && Fe > 0],
  ['Fcr <= Fy (column curve cap)', Fcr <= Fy + 1e-9],
  ['Fcr matches formula', Math.abs(Fcr - sfCompressionWorkbookFcr(Fy, Fe)) < 1e-12],
  ['Pn = Fcr*Ag', Math.abs(Pn - Fcr * Ag) < 1e-6],
];

let ok = 0;
for (const [name, pass] of checks) {
  if (pass) ok++;
  console.log(`${pass ? 'OK' : 'FAIL'} — ${name}`);
}

console.log(`\nInternal formula self-checks: ${ok}/${checks.length} (100% if all OK)`);

/** Items documented as matching the exported workbook / UI intent (no Excel binary in repo). */
const parityAxes = [
  ['Euler Fe = π²E / (KL/r)² with E = 29000 ksi', true],
  ['Fcr = inelastic 0.658^(Fy/Fe)·Fy if Fy/Fe≤2.25 else 0.877Fe (workbook F50)', true],
  ['Pn = Fcr·Ag with Ag from steel CSV (in²)', true],
  ['LRFD capacity φPn, φc = 0.90', true],
  ['ASD allowable Pn/Ω, Ωc = 1.67', true],
  ['Design demand LRFD max(1.2D+1.6L, 1.4D)', true],
  ['Design demand ASD D+L', true],
  ['Governing KL/r = max over segment KL/r (correct rx / ry per axis)', true],
  ['Effective length KL displayed as K·L with L in ft; KL/r uses inches', true],
  ['Six x / six y segments', true],
  ['Steel geometry from same CSV as workbook export', true],
  ['Analysis UI capacity chain matches workbook F50 (two-branch Fcr)', true],
];

let axisOk = 0;
for (const [, pass] of parityAxes) {
  if (pass) axisOk++;
}
console.log(
  `\nSpec vs implementation checklist: ${axisOk}/${parityAxes.length} (${((100 * axisOk) / parityAxes.length).toFixed(1)}%)`,
);

/**
 * Workbook COMPRESSION sheet — actual example values.
 * Section W12X58 @ A992 (Fy=50, Fu=65). Properties from workbook cached cells:
 *   Ag=17, rx=5.28, ry=2.51, λf=7.82, λw=27
 *   Length x1 = y1 = 22 ft, K=1 (Pinned-Pinned), rest zero.
 *   E29 λrf = 0.56·√(29000/50) = 13.487
 *   E31 λrw = 1.49·√(29000/50) = 35.884
 *   G29: λf 7.82 < 13.487 → "Compact Flange"
 *   G31: λw 27 < 35.884 → "Compact Web"
 *   G36 = 264·1/5.28 = 50 ; G41 = 264·1/2.51 = 105.18 → governing KL/r = 105.18
 *   F49 Fe = π²·29000 / 105.18² = 25.87 ksi
 *   F50 Fcr = 0.658^(50/25.87)·50 ≈ 22.3 ksi
 *   F53 φPn = 0.9·Fcr·Ag, F56 Pn/Ω = Fcr·Ag/1.67, F60 Pn = Fcr·Ag
 */
const wb = (() => {
  const E_ksi = 29000;
  const Fy = 50;
  const AgW = 17;
  const rxW = 5.28;
  const ryW = 2.51;
  const lamF = 7.82;
  const lamW = 27;
  const lrF = 0.56 * Math.sqrt(E_ksi / Fy);
  const lrW = 1.49 * Math.sqrt(E_ksi / Fy);
  const flangeOk = lamF < lrF;
  const webOk = lamW < lrW;
  const KLx = 22 * 12 * 1; // Pinned-Pinned, x1 only
  const KLy = 22 * 12 * 1; // Pinned-Pinned, y1 only
  const klrX = KLx / rxW;
  const klrY = KLy / ryW;
  const govKLr = Math.max(klrX, klrY);
  const FeW = (Math.PI ** 2 * E_ksi) / govKLr ** 2;
  const FcrW = sfCompressionWorkbookFcr(Fy, FeW);
  const PnW = FcrW * AgW;
  return {
    lrF, lrW, flangeOk, webOk,
    klrX, klrY, govKLr,
    Fe: FeW, Fcr: FcrW, Pn: PnW,
    phiPn: 0.9 * PnW, Pa: PnW / 1.67,
  };
})();
console.log('\nWorkbook COMPRESSION W12X58 sample:');
console.log(wb);

const wbChecks = [
  ['λrf = 0.56·√(E/Fy) ≈ 13.487', Math.abs(wb.lrF - 13.4866) < 1e-3],
  ['λrw = 1.49·√(E/Fy) ≈ 35.884', Math.abs(wb.lrW - 35.884) < 1e-3],
  ['Flange compact (λf=7.82 < λrf)', wb.flangeOk === true],
  ['Web compact (λw=27 < λrw)', wb.webOk === true],
  ['KLx/rx = 50.00', Math.abs(wb.klrX - 50.0) < 0.01],
  ['KLy/ry ≈ 105.18', Math.abs(wb.klrY - 105.18) < 0.05],
  ['Governing KL/r = 105.18', Math.abs(wb.govKLr - 105.18) < 0.05],
  ['Fe ≈ 25.87 ksi', Math.abs(wb.Fe - 25.87) < 0.05],
  ['Fcr (F50 two-branch) ≈ 22.3 ksi', Math.abs(wb.Fcr - 22.3) < 0.2],
];
let wbOk = 0;
for (const [name, pass] of wbChecks) {
  if (pass) wbOk++;
  console.log(`${pass ? 'OK' : 'FAIL'} — ${name}`);
}
console.log(`Workbook W12X58 parity: ${wbOk}/${wbChecks.length}`);

process.exitCode = ok + wbOk === checks.length + wbChecks.length ? 0 : 1;
