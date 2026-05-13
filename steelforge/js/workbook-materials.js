/**
 * Shared workbook parity layer: ASTM Specification beam cases, deflection L/n presets,
 * and S(ASTM) shear-lag U catalog. Source CSV exports live under ./reference/.
 */
(() => {
  /**
   * Uniform-load beam models aligned with `reference/exel program EWIWIWI(ASTM Specification).csv`.
   * momentCoeff: M = momentCoeff * W(klf) * L(ft)² → kip·ft
   * deflectionK: δ(in) = deflectionK * W(klf) * 12³ * L(ft)⁴ / (E(ksi) * I(in⁴))
   */
  const BEAM_CASES = [
    {
      id: 'simple-u',
      label: 'SIMPLE BEAM - Uniformly distributed load',
      momentCoeff: 1 / 8,
      deflectionK: 5 / 384,
      momentFormula: 'WL²/8',
      deflectionFormula: '5WL⁴/384EI',
    },
    {
      id: 'simple-tri-to-end',
      label: 'SIMPLE BEAM - Load increasing uniformly to one end',
      /** Peak intensity w (klf); M_max = w L²/(9√3) kip·ft */
      momentCoeff: 1 / (9 * Math.sqrt(3)),
      deflectionK: 1 / 60,
      momentFormula: 'wL²/(9√3)',
      deflectionFormula: 'wL⁴/(60EI)',
    },
    {
      id: 'simple-tri-to-center',
      label: 'SIMPLE BEAM - Load increasing uniformly to the center',
      momentCoeff: 1 / 12,
      deflectionK: 1 / 60,
      momentFormula: 'wL²/12',
      deflectionFormula: 'wL⁴/(60EI)',
    },
    {
      id: 'simple-tri-from-center',
      label: 'SIMPLE BEAM - Load increasing uniformly from center',
      momentCoeff: 1 / 12,
      deflectionK: 1 / 60,
      momentFormula: 'wL²/12',
      deflectionFormula: 'wL⁴/(60EI)',
    },
    {
      id: 'fixed-pinned-u',
      label: 'FIXED AND PIN - Uniformly distributed load',
      momentCoeff: 1 / 8,
      deflectionK: 1 / 185,
      momentFormula: 'WL²/8',
      deflectionFormula: 'WL⁴/185EI',
    },
    {
      id: 'fixed-fixed-u',
      label: 'FIXED AND FIXED - Uniformly distributed load',
      momentCoeff: 1 / 12,
      deflectionK: 1 / 384,
      momentFormula: 'WL²/12',
      deflectionFormula: 'WL⁴/384EI',
    },
    {
      id: 'fixed-free-u',
      label: 'FIXED AND FREE - Uniformly distributed load',
      /** Cantilever UDL: M = wL²/2 at fixed end */
      momentCoeff: 1 / 2,
      deflectionK: 1 / 8,
      momentFormula: 'WL²/2',
      deflectionFormula: 'WL⁴/(8EI)',
    },
    {
      id: 'cantilever-u',
      label: 'CANTILEVER - Uniformly distributed load',
      momentCoeff: 1 / 3,
      deflectionK: 1 / 24,
      momentFormula: 'WL²/3',
      deflectionFormula: 'WL⁴/24EI',
    },
    {
      id: 'cantilever-tri-to-fixed',
      label: 'CANTILEVER - Load increasing uniformly to fixed end',
      momentCoeff: 1 / 6,
      deflectionK: 1 / 30,
      momentFormula: 'wL²/6',
      deflectionFormula: 'wL⁴/(30EI)',
    },
    {
      id: 'overhang-u',
      label: 'BEAM OVERHANGING ONE SUPPORT - Uniformly distributed load between supports',
      momentCoeff: 1 / 8,
      deflectionK: 5 / 384,
      momentFormula: 'WL²/8',
      deflectionFormula: '5WL⁴/384EI',
    },
    {
      id: 'cont-2span-one-u',
      label: 'CONTINUOUS BEAM [2 EQUAL SPANS] - Uniform load on one span',
      momentCoeff: 49 / 512,
      deflectionK: 0.0092,
      momentFormula: '49WL²/512',
      deflectionFormula: '0.0092WL⁴/EI',
    },
  ];

  const LEGACY_BEAM_IDS = {
    'fp-u': 'simple-u',
    cont: 'fixed-pinned-u',
  };

  /**
   * ASTM Specification “deflection limitation” table: Δ = L/n with span L in ft (same as app bending).
   * Includes L/100 … L/600 in steps of 20, plus named rows from the workbook (flat roofs L/180, floors L/360, etc.).
   */
  const DEFLECTION_DENOMS = (() => {
    const out = [];
    for (let n = 100; n <= 600; n += 20) out.push(n);
    return out;
  })();

  function workbookDeflectionLabel(denom) {
    const d = Number(denom);
    if (d === 180) return 'L/180 — flat roofs';
    if (d === 240) return 'L/240';
    if (d === 360) return 'L/360 — floors';
    if (d === 480) return 'L/480';
    return `L/${d}`;
  }

  /** Shear lag factor U cases from `reference/exel program EWIWIWI(S(ASTM)).csv` (discrete table; tension Design mode). */
  const SHEAR_LAG_CASES = [
    { caseKey: '1', description: 'Directly transmitted to fasteners', u: 1 },
    { caseKey: '2', description: 'Some are transmitted to fasteners', u: 0.75 },
    { caseKey: '3', description: 'Transverse welds', u: 1 },
    { caseKey: '4', description: 'Load is transmitted by longitudinal welds', u: 0.5625 },
    { caseKey: '5', description: 'Round HSS', u: null },
    { caseKey: '6a', description: 'Rectangular HSS (single)', u: null },
    { caseKey: '6b', description: 'Rectangular HSS (two side)', u: null },
    { caseKey: '7a', description: 'W, H, S, HP (flange — 3 or more)', u: null },
    { caseKey: '7b', description: 'W, H, S, HP (web — 4 or more)', u: 0.7 },
    { caseKey: '8a', description: 'L and 2L (4 or more)', u: 0.8 },
    { caseKey: '8b', description: 'L and 2L (less than 3)', u: 0.6 },
  ];

  window.SteelForgeWorkbookBeamCases = BEAM_CASES;

  window.SteelForgeWorkbookBeamCaseById = (rawId) => {
    const mapped = LEGACY_BEAM_IDS[String(rawId || '').trim()];
    const id = mapped || String(rawId || '').trim();
    const hit = BEAM_CASES.find((c) => c.id === id);
    return hit || BEAM_CASES[0];
  };

  window.SteelForgeWorkbookDeflectionLimitPresets = DEFLECTION_DENOMS.map((denom) => ({
    denom,
    label: workbookDeflectionLabel(denom),
    /** Allowable deflection (in) when span L is entered in ft: Δ = L(ft)·12/n */
    allowableDeltaInches(L_ft) {
      return Number.isFinite(L_ft) && L_ft > 0 ? (L_ft * 12) / denom : null;
    },
  }));

  window.SteelForgeWorkbookShearLagCases = SHEAR_LAG_CASES;

  window.SteelForgeWorkbookShearLagU = (caseKey) => {
    const k = String(caseKey ?? '').trim();
    const row = SHEAR_LAG_CASES.find((c) => c.caseKey === k);
    return row ? row.u : null;
  };
})();
