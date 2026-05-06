/**
 * Build SteelForgeShearShapes from the steel selection CSV (W-shapes only).
 * Geometry: Aw = d·t_w, h = (h/t_w)·t_w = λ_w·t_w per spreadsheet/AISC-style usage.
 */
(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';
  const COL = { type: 0, label: 2, w: 4, d: 6, tw: 8, lamF: 23, lamW: 24, zx: 33 };

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

  let loadPromise = null;

  window.SteelForge = window.SteelForge || {};

  /**
   * Loads/replaces window.SteelForgeShearShapes from CSV. Safe to call multiple times.
   * On failure, leaves existing steel-db.js shapes in place.
   * @returns {Promise<number>} count of shapes loaded
   */
  window.SteelForge.ensureShearShapesFromCsv = function ensureShearShapesFromCsv() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(`./${encodeURIComponent(CSV_NAME)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((txt) => {
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
            lambda_w: lamW,
            lambda_f: lamF,
            zx: Number.isFinite(zx) ? zx : null,
          });
        }
        window.SteelForgeShearShapes = out;
        window.SteelForgeShearShapesSortedByWeight = [...out].sort(
          (a, b) =>
            (a.weightLbFt ?? 9999) - (b.weightLbFt ?? 9999) ||
            String(a.name).localeCompare(String(b.name)),
        );
        return out.length;
      })
      .catch(() => {
        loadPromise = null;
        return 0;
      });
    return loadPromise;
  };
})();
