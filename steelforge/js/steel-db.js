(() => {
  const W_SHAPES = [
    // Minimal in-app database (metric). Values are approximate enough for a working demo.
    // area_mm2, rx_mm, ry_mm
    { name: 'W200x15', series: 'W', area_mm2: 1910, rx_mm: 86, ry_mm: 33 },
    { name: 'W250x22', series: 'W', area_mm2: 2800, rx_mm: 109, ry_mm: 42 },
    { name: 'W250x33', series: 'W', area_mm2: 4200, rx_mm: 118, ry_mm: 52 },
    { name: 'W310x39', series: 'W', area_mm2: 4970, rx_mm: 140, ry_mm: 58 },
    { name: 'W360x51', series: 'W', area_mm2: 6500, rx_mm: 162, ry_mm: 66 },
    { name: 'W410x60', series: 'W', area_mm2: 7650, rx_mm: 182, ry_mm: 72 },
    { name: 'W460x74', series: 'W', area_mm2: 9420, rx_mm: 205, ry_mm: 80 },
  ];

  const HSS_SQUARE = [
    // Simple square HSS examples (metric-ish). area_mm2, rx_mm == ry_mm
    { name: 'HSS 100x100x6', series: 'HSS', area_mm2: 2250, rx_mm: 39, ry_mm: 39 },
    { name: 'HSS 150x150x6', series: 'HSS', area_mm2: 3450, rx_mm: 59, ry_mm: 59 },
    { name: 'HSS 200x200x8', series: 'HSS', area_mm2: 6200, rx_mm: 78, ry_mm: 78 },
    { name: 'HSS 250x250x9', series: 'HSS', area_mm2: 8600, rx_mm: 98, ry_mm: 98 },
  ];

  const SHAPES = [...W_SHAPES, ...HSS_SQUARE];

  window.SteelForgeDB = {
    shapes: SHAPES,
    bySeries(series) {
      return SHAPES.filter((s) => s.series === series);
    },
  };

  /**
   * Workbook material table: ASTM designation with Fy / Fu (ksi).
   * The STEEL SELECTION CSV export in this project lists section geometry only (W, HSS, 2L, …), not these grades.
   * `catalogId` tags legacy workbook ordering; `workbookDeflectionDenom` matches the ASTM Specification hub (Δ=L/n).
   * Variants with different Fu (e.g. A1065 Gr. 50) are separate rows with distinct labels.
   */
  window.SteelForgeStructuralSteelGrades = [
    // workbookDeflectionDenom: span‑ratio n for Δ = L/n per ASTM Specification hub (reference/exel program EWIWIWI(ASTM Specification).csv).
    { catalogId: 1, id: 'a36', label: 'A36', fy: 36, fu: 58, workbookDeflectionDenom: 190 },
    { catalogId: 2, id: 'a53_b', label: 'A53 Gr. B', fy: 35, fu: 60, workbookDeflectionDenom: 160 },
    { catalogId: 3, id: 'a500_b', label: 'A500 Gr. B', fy: 42, fu: 58, workbookDeflectionDenom: 180 },
    { catalogId: 4, id: 'a500_c', label: 'A500 Gr. C', fy: 46, fu: 62, workbookDeflectionDenom: 200 },
    { catalogId: 5, id: 'a501_36', label: 'A501 (Fy = 36 ksi)', fy: 36, fu: 58, workbookDeflectionDenom: 220 },
    { catalogId: 6, id: 'a514', label: 'A514', fy: 100, fu: 110 },
    { catalogId: 7, id: 'a529_50_fu70', label: 'A529 Gr. 50', fy: 50, fu: 70, workbookDeflectionDenom: 260 },
    { catalogId: 8, id: 'a529_55', label: 'A529 Gr. 55', fy: 55, fu: 70, workbookDeflectionDenom: 280 },
    { catalogId: 9, id: 'a572_42', label: 'A572 Gr. 42', fy: 42, fu: 60, workbookDeflectionDenom: 480 },
    { catalogId: 10, id: 'a572_50', label: 'A572 Gr. 50', fy: 50, fu: 65, workbookDeflectionDenom: 240 },
    { catalogId: 11, id: 'a572_55', label: 'A572 Gr. 55', fy: 55, fu: 70, workbookDeflectionDenom: 100 },
    { catalogId: 12, id: 'a572_60', label: 'A572 Gr. 60', fy: 60, fu: 75, workbookDeflectionDenom: 120 },
    { catalogId: 13, id: 'a572_65', label: 'A572 Gr. 65', fy: 65, fu: 80, workbookDeflectionDenom: 140 },
    { catalogId: 14, id: 'a588', label: 'A588', fy: 50, fu: 70, workbookDeflectionDenom: 580 },
    { catalogId: 15, id: 'a606', label: 'A606', fy: 50, fu: 70 },
    { catalogId: 16, id: 'a607_45', label: 'A607 Gr. 45', fy: 45, fu: 60 },
    { catalogId: 17, id: 'a607_50', label: 'A607 Gr. 50', fy: 50, fu: 65 },
    { catalogId: 18, id: 'a607_55', label: 'A607 Gr. 55', fy: 55, fu: 70 },
    { catalogId: 19, id: 'a618', label: 'A618', fy: 50, fu: 70 },
    { catalogId: 20, id: 'a709_36', label: 'A709 Gr. 36', fy: 36, fu: 58, workbookDeflectionDenom: 300 },
    { catalogId: 21, id: 'a709_50', label: 'A709 Gr. 50', fy: 50, fu: 65, workbookDeflectionDenom: 420 },
    { catalogId: 22, id: 'a709_50w', label: 'A709 Gr. 50W', fy: 50, fu: 70, workbookDeflectionDenom: 460 },
    { catalogId: 23, id: 'a709_70w', label: 'A709 Gr. 70W', fy: 70, fu: 90 },
    { catalogId: 24, id: 'a709_100', label: 'A709 Gr. 100', fy: 100, fu: 110 },
    { catalogId: 25, id: 'a709_100w', label: 'A709 Gr. 100W', fy: 100, fu: 110 },
    { catalogId: 26, id: 'a847', label: 'A847', fy: 50, fu: 70, workbookDeflectionDenom: 600 },
    { catalogId: 27, id: 'a852', label: 'A852', fy: 70, fu: 90 },
    { catalogId: 28, id: 'a913_50', label: 'A913 Gr. 50', fy: 50, fu: 65, workbookDeflectionDenom: 480 },
    { catalogId: 29, id: 'a913_60', label: 'A913 Gr. 60', fy: 60, fu: 75, workbookDeflectionDenom: 500 },
    { catalogId: 30, id: 'a913_65', label: 'A913 Gr. 65', fy: 65, fu: 80, workbookDeflectionDenom: 520 },
    { catalogId: 31, id: 'a913_70', label: 'A913 Gr. 70', fy: 70, fu: 90, workbookDeflectionDenom: 540 },
    { catalogId: 32, id: 'a992', label: 'A992', fy: 50, fu: 65, workbookDeflectionDenom: 360 },
    // Additional rows from client table / supplemental sheet
    { id: 'a501_gr_a', label: 'A501 Gr. A', fy: 36, fu: 58, workbookDeflectionDenom: 220 },
    { id: 'a501_gr_b', label: 'A501 Gr. B', fy: 50, fu: 70, workbookDeflectionDenom: 240 },
    { id: 'a529_50_fu65', label: 'A529 Gr. 50 (Fu = 65 ksi)', fy: 50, fu: 65, workbookDeflectionDenom: 260 },
    { id: 'a618_gr12', label: 'A618 Gr. I & II', fy: 50, fu: 70, workbookDeflectionDenom: 380 },
    { id: 'a618_gr3', label: 'A618 Gr. III', fy: 50, fu: 65, workbookDeflectionDenom: 400 },
    { id: 'a709_50s', label: 'A709 Gr. 50S', fy: 50, fu: 65, workbookDeflectionDenom: 440 },
    { id: 'a1043_36', label: 'A1043 Gr. 36', fy: 36, fu: 58, workbookDeflectionDenom: 320 },
    { id: 'a1043_50', label: 'A1043 Gr. 50', fy: 50, fu: 65, workbookDeflectionDenom: 340 },
    { id: 'a1085_a', label: 'A1085 Gr. A', fy: 50, fu: 65, workbookDeflectionDenom: 360 },
    { id: 'a1065_50_fu60', label: 'A1065 Gr. 50 (Fu = 60 ksi)', fy: 50, fu: 60, workbookDeflectionDenom: 560 },
    { id: 'a1065_50_fu70', label: 'A1065 Gr. 50 (Fu = 70 ksi)', fy: 50, fu: 70, workbookDeflectionDenom: 560 },
  ];

  /**
   * Imperial W-shapes for shear analysis & design (student spreadsheet / AISC-style).
   * weightLbFt — nominal weight (lb/ft); zx — plastic modulus Zx (in³);
   * h — clear web depth between fillets (in); tw — web thickness (in);
   * Aw — web area used in Vn = 0.6 Fy Aw Cv (in²); λw — h/tw when applicable.
   */
  window.SteelForgeShearShapes = [
    {
      name: 'W12X58',
      weightLbFt: 58,
      zx: 78.3,
      d: 12.19,
      tw: 0.36,
      h: 9.86,
      Aw: 4.388,
      lambdaW: 27.39,
      lambdaF: 9.42,
    },
    {
      name: 'W12X65',
      weightLbFt: 65,
      zx: 87.9,
      d: 12.12,
      tw: 0.39,
      h: 9.81,
      Aw: 4.727,
      lambdaW: 25.15,
      lambdaF: 8.68,
    },
    {
      name: 'W12X72',
      weightLbFt: 72,
      zx: 97.4,
      d: 12.25,
      tw: 0.43,
      h: 9.72,
      Aw: 5.268,
      lambdaW: 22.6,
      lambdaF: 8.85,
    },
    {
      name: 'W12X79',
      weightLbFt: 79,
      zx: 107,
      d: 12.38,
      tw: 0.47,
      h: 9.729,
      Aw: 5.828,
      lambdaW: 20.7,
      lambdaF: 8.22,
    },
    {
      name: 'W12X87',
      weightLbFt: 87,
      zx: 118,
      d: 12.53,
      tw: 0.515,
      h: 9.73,
      Aw: 6.453,
      lambdaW: 18.89,
      lambdaF: 7.92,
    },
    {
      name: 'W12X96',
      weightLbFt: 96,
      zx: 131,
      d: 12.71,
      tw: 0.55,
      h: 9.727,
      Aw: 6.991,
      lambdaW: 17.69,
      lambdaF: 7.65,
    },
    {
      name: 'W14X30',
      weightLbFt: 30,
      zx: 43.6,
      d: 13.84,
      tw: 0.27,
      h: 12.258,
      Aw: 3.726,
      lambdaW: 45.4,
      lambdaF: 8.74,
    },
    {
      name: 'W18X50',
      weightLbFt: 50,
      zx: 101,
      d: 18,
      tw: 0.355,
      h: 15.94,
      Aw: 6.39,
      lambdaW: 44.9,
      lambdaF: 9.1,
    },
    {
      name: 'W21X68',
      weightLbFt: 68,
      zx: 160,
      d: 21.13,
      tw: 0.43,
      h: 18.68,
      // Student spreadsheets often use Aw ≈ d·t_w for rolled W-shapes (matches ~272 kips @ Fy=50, Cv=1).
      Aw: 9.073,
      lambdaW: 43.44,
      lambdaF: 7.5,
    },
    {
      name: 'W24X62',
      weightLbFt: 62,
      zx: 131,
      d: 23.74,
      tw: 0.43,
      h: 21.97,
      Aw: 9.4471,
      lambdaW: 51.09,
      lambdaF: 8.0,
    },
    {
      name: 'W24X68',
      weightLbFt: 68,
      zx: 177,
      d: 24.73,
      tw: 0.415,
      h: 23.97,
      Aw: 9.94755,
      lambdaW: 57.76,
      lambdaF: 8.2,
    },
    {
      name: 'W27X84',
      weightLbFt: 84,
      zx: 213,
      d: 26.71,
      tw: 0.46,
      h: 25.91,
      Aw: 11.286,
      lambdaW: 56.33,
      lambdaF: 7.9,
    },
    {
      name: 'W40X503',
      weightLbFt: 503,
      zx: 2490,
      d: 42,
      tw: 1.07,
      h: 37.9,
      Aw: 40.553,
      lambdaW: 35.42,
      lambdaF: 6.8,
    },
    // Heavy W-shape from client workbook example (geometry rounded — verify in AISC Manual for production).
    {
      name: 'W44X368',
      weightLbFt: 368,
      zx: 2110,
      d: 44.0,
      tw: 2.68,
      h: 35.66,
      Aw: 95.569,
      lambdaW: 13.31,
      lambdaF: 1.91,
    },
  ];

  window.SteelForgeShearShapesSortedByWeight = [...window.SteelForgeShearShapes].sort(
    (a, b) =>
      (a.weightLbFt ?? 9999) - (b.weightLbFt ?? 9999) ||
      String(a.name).localeCompare(String(b.name)),
  );
})();
