/**
 * Spot-check: block shear chain matches `reference/exel program EWIWIWI(TENSION).csv`
 * sample (Agv = 5.625 in², Anv = 3.984375 in², Ant ≈ 2.39 in², Fy = 36 ksi, Fu = 58 ksi).
 * Run: node scripts/sf-tension-parity.mjs
 */
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
const AnSt2 = Ag2 - Ah2 + t2 * stagSum2;
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
  Math.abs(AnSt2 - 6.5) < 1e-9 &&
  Math.abs(AnGov2 - 5.5) < 1e-9 &&
  Math.abs(Ae2 - 5.5) < 1e-9 &&
  Math.abs(lrfdYield2 - 324) < 1e-6 &&
  Math.abs(lrfdFrac2 - 239.25) < 1e-6;

console.log(okNet ? 'OK — net area / LRFD yield & fracture spot-check' : 'FAIL — net / tensile chain');

process.exit(ok && okNet ? 0 : 1);
