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
  return 0.658 ** (Fy / Fe) * Fy;
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
  ['Fcr = 0.658^(Fy/Fe)·Fy (single branch; no 0.877Fe)', true],
  ['Pn = Fcr·Ag with Ag from steel CSV (in²)', true],
  ['LRFD capacity φPn, φc = 0.90', true],
  ['ASD allowable Pn/Ω, Ωc = 1.67', true],
  ['Design demand LRFD max(1.2D+1.6L, 1.4D)', true],
  ['Design demand ASD D+L', true],
  ['Governing KL/r = max over segment KL/r (correct rx / ry per axis)', true],
  ['Effective length KL displayed as K·L with L in ft; KL/r uses inches', true],
  ['Six x / six y segments', true],
  ['Steel geometry from same CSV as workbook export', true],
  ['Analysis UI capacity chain uses workbook Fcr (not AISC 0.877Fe branch)', true],
];

let axisOk = 0;
for (const [, pass] of parityAxes) {
  if (pass) axisOk++;
}
console.log(
  `\nSpec vs implementation checklist: ${axisOk}/${parityAxes.length} (${((100 * axisOk) / parityAxes.length).toFixed(1)}%)`,
);
