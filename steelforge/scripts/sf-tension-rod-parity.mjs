/**
 * Algebraic spot-checks aligned with `steelforge/js/tension-rod-analysis.js`
 * (yield + rupture envelope, LRFD/ASD factors, basic ASCE load combos).
 * Run: node scripts/sf-tension-rod-parity.mjs
 */
const PHI_Y = 0.9;
const PHI_F = 0.75;
const OMEGA_Y = 1.67;
const OMEGA_F = 2.0;

function capacityBreakdown(Ag, Ae, Fy, Fu, method) {
  const lrfdY = PHI_Y * Fy * Ag;
  const lrfdF = PHI_F * Fu * Ae;
  const asdY = (Fy * Ag) / OMEGA_Y;
  const asdF = (Fu * Ae) / OMEGA_F;
  const yieldCap = method === 'lrfd' ? lrfdY : asdY;
  const fracCap = method === 'lrfd' ? lrfdF : asdF;
  const capGov = Math.min(yieldCap, fracCap);
  return { yieldCap, fracCap, capGov };
}

function pickLightestDummy(rows, demand, k, Fy, Fu, method) {
  const sorted = [...rows].sort((a, b) => a.Ag - b.Ag || a.lab.localeCompare(b.lab));
  for (const s of sorted) {
    const Ae = k * s.Ag;
    const { capGov } = capacityBreakdown(s.Ag, Ae, Fy, Fu, method);
    if (capGov + 1e-9 >= demand) return s;
  }
  return null;
}

const Ag = 1;
const k = 0.75;
const Ae = k * Ag;
const Fy = 36;
const Fu = 58;
const lrfd = capacityBreakdown(Ag, Ae, Fy, Fu, 'lrfd');
const asd = capacityBreakdown(Ag, Ae, Fy, Fu, 'asd');

const dl = 10;
const ll = 20;
const u1216 = 1.2 * dl + 1.6 * ll;
const u14 = 1.4 * dl;
const Tu = Math.max(u1216, u14);
const Ta = dl + ll;

const rows = [
  { lab: 'SMALL', Ag: 0.5 },
  { lab: 'MED', Ag: 0.8 },
  { lab: 'BIG', Ag: 1.2 },
];
const demand = 33;
const picked = pickLightestDummy(rows, demand, 0.75, Fy, Fu, 'lrfd');

console.log({ lrfd, asd, u1216, u14, Tu, Ta, picked: picked?.lab });

const okCap =
  Math.abs(lrfd.yieldCap - 32.4) < 1e-9 &&
  Math.abs(lrfd.fracCap - 32.625) < 1e-9 &&
  Math.abs(lrfd.capGov - 32.4) < 1e-9 &&
  Math.abs(asd.yieldCap - (36 * Ag) / OMEGA_Y) < 1e-9 &&
  Math.abs(asd.fracCap - (58 * Ae) / OMEGA_F) < 1e-9 &&
  Math.abs(asd.capGov - Math.min(asd.yieldCap, asd.fracCap)) < 1e-9;

const okLoads =
  Math.abs(u1216 - 44) < 1e-9 && Math.abs(u14 - 14) < 1e-9 && Math.abs(Tu - 44) < 1e-9 && Math.abs(Ta - 30) < 1e-9;

const pickedGov = picked ? capacityBreakdown(picked.Ag, 0.75 * picked.Ag, Fy, Fu, 'lrfd').capGov : null;
const okPick = picked?.lab === 'BIG' && pickedGov != null && pickedGov + 1e-6 >= demand;

const ok = okCap && okLoads && okPick;
console.log(ok ? 'OK — tension rod formula spot-checks' : 'FAIL — revisit rod tensile chain');
process.exit(ok ? 0 : 1);
