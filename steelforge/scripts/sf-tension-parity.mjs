/**
 * Spot-check: block shear chain matches `reference/exel program EWIWIWI(TENSION).csv`
 * sample (Agv = 5.625 in², Anv = 3.984375 in², Ant ≈ 2.39 in², Fy = 36 ksi, Fu = 58 ksi).
 * Run: node scripts/sf-tension-parity.mjs (from repo root: `node steelforge/scripts/sf-tension-parity.mjs`).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoSf = path.join(__dirname, '..');
const HOLE = 1 / 8;
const bolt = 0.75;
const dh = bolt + HOLE;
const t = 0.375;
const ns = 5;
const Ls = 7.5;
const nt = 3;
const Lt = 9;
const Fy = 36;
const Fu = 58;
const Ubs = 1;

const Agv = 2 * Ls * t;
const Anv = Agv - ns * dh * t;
const Ant = Lt * t - nt * dh * t;
const tens = Ubs * Fu * Ant;
const rnVR = 0.6 * Fu * Anv + tens;
const rnY = 0.6 * Fy * Agv + tens;
const rnGov = Math.min(rnVR, rnY);

console.log({ dh, Agv, Anv, Ant, rnVR, rnY, rnGov, phiRn: 0.75 * rnGov, Ta: rnGov / 2 });

const ok =
  Math.abs(Agv - 5.625) < 1e-9 &&
  Math.abs(Anv - 3.984375) < 1e-9 &&
  Math.abs(Ant - 2.390625) < 1e-9 &&
  Math.abs(rnGov - 260.15625) < 0.02 &&
  Math.abs(0.75 * rnGov - 195.1171875) < 0.05 &&
  Math.abs(rnGov / 2 - 130.078125) < 0.05;

console.log(ok ? 'OK — workbook sample block shear matches' : 'FAIL — revisit formulas');

/** Net area + LRFD tensile (matches tension-analysis.js hole rule & formulas). */
const HOLE2 = 1 / 8;
const bolt2 = 1;
const dh2 = bolt2 + HOLE2;
const t2 = 1;
const nHoles = 4;
const Ag2 = 10;
const Ah2 = nHoles * dh2 * t2;
const AnNs2 = Ag2 - Ah2;
const s2 = 4;
const g2 = 4;
const stagSum2 = (s2 * s2) / (4 * g2);
// Strict workbook parity: no *t multiplier on staggered correction.
const AnSt2 = Ag2 - Ah2 + stagSum2;
const AnGov2 = Math.min(AnNs2, AnSt2);
const U2 = 1;
const Ae2 = U2 * AnGov2;
const Fy2 = 36;
const Fu2 = 58;
const lrfdYield2 = 0.9 * Fy2 * Ag2;
const lrfdFrac2 = 0.75 * Fu2 * Ae2;

const okNet =
  Math.abs(Ah2 - 4.5) < 1e-9 &&
  Math.abs(AnNs2 - 5.5) < 1e-9 &&
  Math.abs(stagSum2 - 1) < 1e-9 &&
  // (Ag − Ah) + Σ(s²/4g) = (10 − 4.5) + 1 = 6.5
  Math.abs(AnSt2 - 6.5) < 1e-9 &&
  Math.abs(AnGov2 - 5.5) < 1e-9 &&
  Math.abs(Ae2 - 5.5) < 1e-9 &&
  Math.abs(lrfdYield2 - 324) < 1e-6 &&
  Math.abs(lrfdFrac2 - 239.25) < 1e-6;

console.log(okNet ? 'OK — net area / LRFD yield & fracture spot-check' : 'FAIL — net / tensile chain');

/** Mirror tension-analysis.js: BOLT +1/8 in, HOLE (listed punch) +1/16 in. */
const BOLT_ADD = 1 / 8;
const HOLE_ADD = 1 / 16;
const dhBoltMode = 0.75 + BOLT_ADD;
const dhHoleMode = 0.75 + HOLE_ADD;
const okHoleRule =
  Math.abs(dhBoltMode - 0.875) < 1e-12 && Math.abs(dhHoleMode - 0.8125) < 1e-12;
console.log(okHoleRule ? 'OK — bolt vs hole final diameter rules' : 'FAIL — bolt/hole d_h');

/** Shear lag auto U (analysis): Case 2 = clamp(0,1, 1 − x̄/L); Case 8a/8b from discrete workbook table. */
const uCase2 = Math.min(1, Math.max(0, 1 - 1 / 10));
const okU2 = Math.abs(uCase2 - 0.9) < 1e-12;
const u8a = 4 >= 4 ? 0.8 : 0.6;
const u8b = 2 >= 4 ? 0.8 : 0.6;
const okU8 = u8a === 0.8 && u8b === 0.6;
console.log(okU2 && okU8 ? 'OK — shear lag Case 2 / Case 8 auto rules' : 'FAIL — shear lag U');

/** Discrete CASE → U for tension Design must match S(ASTM).csv and `workbook-materials.js`. */
const sAstPath = path.join(repoSf, 'reference', 'exel program EWIWIWI(S(ASTM)).csv');
const sAst = fs.readFileSync(sAstPath, 'utf8');
const wmPath = path.join(repoSf, 'js', 'workbook-materials.js');
const wm = fs.readFileSync(wmPath, 'utf8');
const okSastmCsv =
  sAst.includes(',2,Some are transmitted to fasteners,0.75') &&
  sAst.includes(',4,Load is transmitted by longhitudinal welds,0.5625');
const okWmDiscrete =
  /caseKey:\s*'2'[\s\S]*?u:\s*0\.75\b/.test(wm) && /caseKey:\s*'4'[\s\S]*?u:\s*0\.5625\b/.test(wm);
console.log(okSastmCsv && okWmDiscrete ? 'OK — S(ASTM) discrete U vs workbook-materials' : 'FAIL — S(ASTM) / workbook shear-lag U drift');

/**
 * Workbook TENSION sheet — example case (analysis side).
 * Section L10X10X1-3/8, t=1.375, Ag=25.6, x̄=3, L=12 → U = 1 − x̄/L = 0.75, A36 (Fy=36, Fu=58),
 * Block shear with n_shear=5, L_shear=7.5, n_tens=3, L_tens=9, db=0.75 → dh=0.875, Ubs=1.
 * Cached workbook outputs: Agv=20.625, Anv=14.609, Ant=8.766, Vrupt=508.406, Vyield=445.5,
 * Vgov=445.5, Ublk=508.406, BlockLRFD=715.43, Yield_LRFD=829.44, Frac_LRFD ≈ 717.4, Gov=715.43.
 */
const wb = (() => {
  const t = 1.375, Ag = 25.6, U = 0.75, Fy = 36, Fu = 58, Ubs = 1;
  const dh = 0.75 + 1 / 8; // 0.875
  const nShear = 5, Lshear = 7.5, nTens = 3, Ltens = 9;
  const Agv = 2 * t * Lshear; // 20.625
  const Anv = Agv - nShear * dh * t; // 14.609375
  const Ant = Ltens * t - nTens * dh * t; // 8.765625
  const Vrupt = 0.6 * Fu * Anv;
  const Vyield = 0.6 * Fy * Agv;
  const Vgov = Math.min(Vrupt, Vyield);
  const TblkTen = Ubs * Fu * Ant;
  const BlockLRFD = 0.75 * (Vgov + TblkTen);
  const Yield_LRFD = 0.9 * Fy * Ag;
  // Workbook Ah = 3.609375 → An_ns = 25.6 − 3.609375 = 21.990625
  // Ae = An_ns * U = 16.4929… (workbook D35).
  const Ah = 3 * dh * t; // n=3 holes one row
  const An_ns = Ag - Ah;
  const Ae = An_ns * U;
  const Frac_LRFD = 0.75 * Fu * Ae;
  const Gov_LRFD = Math.min(Yield_LRFD, Frac_LRFD, BlockLRFD);
  return { Agv, Anv, Ant, Vrupt, Vyield, Vgov, TblkTen, BlockLRFD, Yield_LRFD, Frac_LRFD, Gov_LRFD };
})();
console.log('workbook-sample analysis:', wb);
const okWbAna =
  Math.abs(wb.Agv - 20.625) < 1e-6 &&
  Math.abs(wb.Anv - 14.609375) < 1e-6 &&
  Math.abs(wb.Ant - 8.765625) < 1e-6 &&
  Math.abs(wb.Vrupt - 508.40625) < 0.01 &&
  Math.abs(wb.Vyield - 445.5) < 0.01 &&
  Math.abs(wb.Vgov - 445.5) < 0.01 &&
  Math.abs(wb.TblkTen - 508.40625) < 0.01 &&
  Math.abs(wb.BlockLRFD - 715.4296875) < 0.05 &&
  Math.abs(wb.Yield_LRFD - 829.44) < 0.05 &&
  Math.abs(wb.Frac_LRFD - 717.44) < 0.5 &&
  Math.abs(wb.Gov_LRFD - 715.4296875) < 0.05;
console.log(okWbAna ? 'OK — workbook TENSION analysis sample parity' : 'FAIL — workbook TENSION analysis parity drift');

/**
 * Workbook TENSION sheet — example case (design side).
 * Inputs: L=15, DL=15, LL=40, A36 (Fy=36, Fu=58), shear-lag CASE 8b → U=0.6.
 * Cached workbook outputs (Q-column):
 *   Tu=82, Ag_yield=2.531, Ae_req=3.142, Ag_frac (=Ae_req/0.85)=3.696, Ag_gov=3.696.
 *   ASD Ta=55, Ag_yield_ASD=2.551, Ae_req_ASD=2*Ta/(Fu*U)=3.161, Ag_frac_ASD=3.719.
 *   r_min_req = L/300 = 0.05 in.
 */
const wbDes = (() => {
  const DL = 15, LL = 40, L = 15, Fy = 36, Fu = 58, U = 0.6;
  const c1216 = 1.2 * DL + 1.6 * LL;
  const c14 = 1.4 * DL;
  const Tu = Math.max(c1216, c14);
  const Ta = DL + LL;
  const Ag_yield_L = Tu / (0.9 * Fy);
  const Ae_req_L = Tu / (0.75 * Fu * U);
  const Ag_frac_L = Ae_req_L / 0.85;
  const Ag_gov_L = Math.max(Ag_yield_L, Ag_frac_L);
  const Ag_yield_A = (Ta * 1.67) / Fy;
  // Strict workbook parity: ASD Ae_req uses r_min in the denominator (Q32 cell as written).
  const rMinAsd = L / 300;
  const Ae_req_A = (2 * Ta) / (Fu * rMinAsd);
  const Ag_frac_A = Ae_req_A / 0.85;
  const Ag_gov_A = Math.max(Ag_yield_A, Ag_frac_A);
  const rMin = L / 300;
  return { Tu, Ta, Ag_yield_L, Ae_req_L, Ag_frac_L, Ag_gov_L, Ag_yield_A, Ae_req_A, Ag_frac_A, Ag_gov_A, rMin };
})();
console.log('workbook-sample design:', wbDes);
const okWbDes =
  Math.abs(wbDes.Tu - 82) < 1e-9 &&
  Math.abs(wbDes.Ag_yield_L - 2.5308641975) < 1e-6 &&
  Math.abs(wbDes.Ae_req_L - 3.14176245) < 1e-6 &&
  Math.abs(wbDes.Ag_frac_L - 3.69619112) < 1e-6 &&
  Math.abs(wbDes.Ag_gov_L - 3.69619112) < 1e-6 &&
  // Workbook Q32 cached = 37.93103448 (uses r_min in denom). Q33 = Q32 / 0.85.
  Math.abs(wbDes.Ae_req_A - 37.93103448) < 1e-5 &&
  Math.abs(wbDes.Ag_frac_A - 44.62474645) < 1e-5 &&
  Math.abs(wbDes.rMin - 0.05) < 1e-9;
console.log(okWbDes ? 'OK — workbook TENSION design sample parity' : 'FAIL — workbook TENSION design parity drift');

process.exit(
  ok && okNet && okHoleRule && okU2 && okU8 && okSastmCsv && okWmDiscrete && okWbAna && okWbDes ? 0 : 1,
);
