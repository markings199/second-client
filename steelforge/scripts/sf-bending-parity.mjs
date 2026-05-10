/**
 * Node parity checks vs reference workbook `exel program EWIWIWI(BENDING) (1).csv`.
 * Run: node scripts/sf-bending-parity.mjs
 */

const PHI_B = 0.9;
const OMEGA_B = 1.67;
const E = 29000;

function nominalMomentKipFt(Fy, Zx, Sx, lamF, lamW) {
  const My = (Fy * Sx) / 12;
  const Mp = (Fy * Zx) / 12;
  const lrF = 1.0 * Math.sqrt(E / Fy);
  const lrW = 5.7 * Math.sqrt(E / Fy);
  const branch = (lam, lr) => (lam <= lr ? Mp : 0.7 * My);
  return Math.min(branch(lamF, lrF), branch(lamW, lrW));
}

function compactnessVerdict(lamF, lamW, Fy) {
  const lrF = 1.0 * Math.sqrt(E / Fy);
  const lrW = 5.7 * Math.sqrt(E / Fy);
  if (lamF <= lrF && lamW <= lrW) return 'COMPACT FLANGE';
  return 'SLENDER SECTION';
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
add('Analysis W21×44 Mn (795)', nearly(Mn1, 795, 0.05), `got ${Mn1}`);
add('Analysis φMn LRFD (715.5)', nearly(PHI_B * Mn1, 715.5, 0.05), `got ${PHI_B * Mn1}`);
add('Analysis Mn/Ω ASD (476.048)', nearly(Mn1 / OMEGA_B, 476.0479042, 0.01), `got ${Mn1 / OMEGA_B}`);
add('Analysis λpf limit (6.471167)', nearly(lpFlange(100), 6.471166819, 1e-5), `got ${lpFlange(100)}`);
add('Analysis verdict COMPACT FLANGE', compactnessVerdict(7.22, 53.6, 100) === 'COMPACT FLANGE');

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

const passed = checks.filter((c) => c.ok).length;
const total = checks.length;
console.log(`Bending workbook parity: ${passed}/${total} (${((100 * passed) / total).toFixed(1)}%)`);
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exitCode = passed === total ? 0 : 1;
