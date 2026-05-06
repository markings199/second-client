/**
 * Section Properties page: loads `exel program EWIWIWI(S(STEEL SELECTION)).csv`
 * (AISC-style catalog) and displays fields from fixed column indices — no derived formulas.
 * Search is the editable control; numeric fields are catalog values (read-only).
 */
(() => {
  const CSV_NAME = 'exel program EWIWIWI(S(STEEL SELECTION)).csv';

  /** Column indices from workbook row structure (0-based, 56 columns). */
  const COL = {
    type: 0,
    aiscLabel: 2,
    weightLbFt: 4,
    areaIn2: 5,
    depthIn: 6,
    tw: 8,
    bf: 12,
    tf: 14,
    Ix: 29,
    Iy: 35,
    Iz: 41,
  };

  const SHAPE_FILTER = {
    w: new Set(['W', 'WT', 'HP']),
    angle: new Set(['L', '2L']),
    c: new Set(['C', 'MC', 'S', 'ST', 'MT']),
    hss: new Set(['Rect. HSS', 'Round HSS', 'Square HSS', 'PIPE']),
  };

  /**
   * Page field layouts by selected family.
   * `cols` supports fallback columns in priority order.
   */
  const FIELD_LAYOUTS = {
    w: [
      { label: 'Weight (W)', unit: 'lb/ft', cols: [4] },
      { label: 'Area (Ag)', unit: 'in²', cols: [5] },
      { label: 'Depth (d)', unit: 'in', cols: [6] },
      { label: 'Web Thickness (tw)', unit: 'in', cols: [8] },
      { label: 'Flange Width (bf)', unit: 'in', cols: [12] },
      { label: 'Flange Thickness (tf)', unit: 'in', cols: [14] },
      { label: 'Moment of Inertia @X (Ix)', unit: 'in⁴', cols: [29] },
      { label: 'Moment of Inertia @Y (Iy)', unit: 'in⁴', cols: [35] },
      { label: 'Moment of Inertia @Z (Iz)', unit: 'in⁴', cols: [41] },
    ],
    angle: [
      { label: 'Weight (W)', unit: 'lb/ft', cols: [4] },
      { label: 'Area (Ag)', unit: 'in²', cols: [5] },
      { label: 'Leg Size (d)', unit: 'in', cols: [6] },
      { label: 'Thickness (t)', unit: 'in', cols: [10, 9, 14] },
      { label: 'Centroid (x̄)', unit: 'in', cols: [38, 32] },
      { label: 'Radius of Gyration (rₓ)', unit: 'in', cols: [31] },
      { label: 'Moment of Inertia @X (Ix)', unit: 'in⁴', cols: [29] },
      { label: 'Moment of Inertia @Y (Iy)', unit: 'in⁴', cols: [35] },
      { label: 'Moment of Inertia @Z (Iz)', unit: 'in⁴', cols: [41] },
    ],
    c: [
      { label: 'Weight (W)', unit: 'lb/ft', cols: [4] },
      { label: 'Area (Ag)', unit: 'in²', cols: [5] },
      { label: 'Depth (d)', unit: 'in', cols: [6] },
      { label: 'Web Thickness (tw)', unit: 'in', cols: [8] },
      { label: 'Flange Width (bf)', unit: 'in', cols: [12] },
      { label: 'Flange Thickness (tf)', unit: 'in', cols: [14] },
      { label: 'Moment of Inertia @X (Ix)', unit: 'in⁴', cols: [29] },
      { label: 'Moment of Inertia @Y (Iy)', unit: 'in⁴', cols: [35] },
      { label: 'Moment of Inertia @Z (Iz)', unit: 'in⁴', cols: [41] },
    ],
    hss: [
      { label: 'Weight (W)', unit: 'lb/ft', cols: [4] },
      { label: 'Area (Ag)', unit: 'in²', cols: [5] },
      { label: 'Wall Thickness (t)', unit: 'in', cols: [3] },
      { label: 'Section Slenderness (b/t or D/t)', unit: '—', cols: [23, 25] },
      { label: 'Flat Ratio (h/t)', unit: '—', cols: [24] },
      { label: 'Section Modulus (Sx)', unit: 'in³', cols: [30] },
      { label: 'Plastic Modulus (Zx)', unit: 'in³', cols: [33] },
      { label: 'Moment of Inertia @X (Ix)', unit: 'in⁴', cols: [29] },
      { label: 'Moment of Inertia @Y (Iy)', unit: 'in⁴', cols: [35] },
    ],
  };

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

  function displayCell(v) {
    if (v == null) return '';
    const s0 = String(v).replace(/\u00A0/g, ' ').trim();
    if (s0 === '' || s0 === '–' || s0 === '\u2013' || s0 === '-') return '—';
    // Normalize spreadsheet spacing (e.g. "1  3/4" -> "1 3/4", "44      " -> "44")
    return s0.replace(/\s+/g, ' ');
  }

  window.SteelForge = window.SteelForge || {};

  window.SteelForge.initSectionProps = (panelRoot) => {
    const root = panelRoot?.querySelector?.('.sf-secprops');
    if (!root) return;

    const searchEl = root.querySelector('.sf-secprops__search');
    const suggestEl = root.querySelector('.sf-secprops__suggest');
    const searchWrap = root.querySelector('.sf-secprops__searchWrap');
    const titleRow = root.querySelector('.sf-secprops__titleRow');
    const rows = Array.from(root.querySelectorAll('.sf-secprops__row'));
    const shapes = root.querySelectorAll('.sf-secprops__shape[data-sf-family]');

    if (!searchEl || !suggestEl) return;

    let catalog = [];
    let shapeFamily = 'w';
    let loadError = null;

    function setSuggestOpen(isOpen) {
      suggestEl.hidden = !isOpen;
      if (titleRow) titleRow.classList.toggle('sf-secprops__titleRow--dropdownOpen', isOpen);
    }

    function filteredCatalog() {
      if (!shapeFamily || !SHAPE_FILTER[shapeFamily]) return catalog;
      const allow = SHAPE_FILTER[shapeFamily];
      return catalog.filter((row) => allow.has(String(row[COL.type] || '').trim()));
    }

    function rowByLabel(label) {
      const t = String(label || '').trim().toUpperCase();
      const pool = filteredCatalog();
      return pool.find((r) => String(r[COL.aiscLabel] || '').trim().toUpperCase() === t) || null;
    }

    function getDisplayValueFromCols(row, cols) {
      const list = Array.isArray(cols) ? cols : [cols];
      for (const ci of list) {
        const v = displayCell(row[ci]);
        if (v && v !== '—') return v;
      }
      return '—';
    }

    function applyFieldLayoutForFamily(fam) {
      const layout = FIELD_LAYOUTS[fam] || FIELD_LAYOUTS.w;
      rows.forEach((r, i) => {
        const def = layout[i] || layout[layout.length - 1];
        const labelEl = r.querySelector('.sf-secprops__label');
        const inputEl = r.querySelector('.sf-secprops__val');
        const unitEl = r.querySelector('.sf-secprops__unit');
        if (labelEl) labelEl.textContent = def.label;
        if (unitEl) unitEl.textContent = def.unit;
        if (inputEl) inputEl.dataset.csvCols = def.cols.join('|');
      });
    }

    function applyRow(row) {
      if (!row) return;
      rows.forEach((r) => {
        const inp = r.querySelector('.sf-secprops__val');
        if (!inp) return;
        const rawCols = String(inp.dataset.csvCols || inp.getAttribute('data-csv-col') || '');
        const cols = rawCols
          .split('|')
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n));
        if (cols.length === 0) return;
        inp.value = getDisplayValueFromCols(row, cols);
      });
      const lab = String(row[COL.aiscLabel] || '').trim();
      if (lab) searchEl.value = lab;
    }

    function defaultRow() {
      const pool = filteredCatalog();
      if (shapeFamily === 'w') {
        // Match UI reference default when available.
        const preferred = pool.find(
          (r) => String(r[COL.aiscLabel] || '').trim().toUpperCase() === 'W44X335',
        );
        if (preferred) return preferred;
      }
      const wFirst = pool.find((r) => String(r[COL.type] || '').trim() === 'W');
      return wFirst || pool[0] || null;
    }

    function renderSuggest(q) {
      const query = String(q || '').trim().toUpperCase();
      const pool = filteredCatalog();
      const matches = !query
        ? pool.slice(0, 25)
        : pool
            .filter((r) => String(r[COL.aiscLabel] || '').toUpperCase().includes(query))
            .slice(0, 25);

      suggestEl.innerHTML = '';
      if (matches.length === 0) {
        const li = document.createElement('li');
        li.className = 'sf-secprops__suggestEmpty';
        li.textContent = loadError || 'No matching section';
        suggestEl.appendChild(li);
      } else {
        matches.forEach((row) => {
          const li = document.createElement('li');
          li.className = 'sf-secprops__suggestItem';
          li.textContent = String(row[COL.aiscLabel] || '').trim();
          li.setAttribute('role', 'option');
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            applyRow(row);
            setSuggestOpen(false);
          });
          suggestEl.appendChild(li);
        });
      }
      setSuggestOpen(true);
    }

    let debounce;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderSuggest(searchEl.value), 120);
    });

    searchEl.addEventListener('focus', () => {
      renderSuggest(searchEl.value);
    });

    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const exact = rowByLabel(searchEl.value);
        if (exact) {
          applyRow(exact);
          setSuggestOpen(false);
        } else {
          const pool = filteredCatalog();
          const q = String(searchEl.value || '').trim().toUpperCase();
          const first = pool.find((r) => String(r[COL.aiscLabel] || '').toUpperCase().includes(q));
          if (first) {
            applyRow(first);
            setSuggestOpen(false);
          }
        }
      }
      if (e.key === 'Escape') setSuggestOpen(false);
    });

    document.addEventListener(
      'click',
      (e) => {
        if (searchWrap && !searchWrap.contains(e.target)) setSuggestOpen(false);
      },
      true
    );

    function activateShapeFamily(el, fam) {
      shapeFamily = fam;
      shapes.forEach((s) => s.classList.toggle('sf-secprops__shape--active', s === el));
      applyFieldLayoutForFamily(shapeFamily);
      const row = defaultRow();
      if (row) applyRow(row);
      else {
        rows.forEach((r) => {
          const inp = r.querySelector('.sf-secprops__val');
          if (!inp) return;
          inp.value = '';
        });
        searchEl.value = '';
      }
      renderSuggest(searchEl.value);
    }

    shapes.forEach((el) => {
      const go = () => activateShapeFamily(el, el.getAttribute('data-sf-family'));
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });

    const url = `./${encodeURIComponent(CSV_NAME)}`;
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      })
      .then((text) => {
        const lines = text.split(/\r?\n/);
        catalog = [];
        for (let i = 4; i < lines.length; i++) {
          const line = lines[i];
          if (!line || !line.trim()) continue;
          const row = parseCsvLine(line);
          if (row.length < 42) continue;
          const typ = String(row[COL.type] || '').trim();
          const label = String(row[COL.aiscLabel] || '').trim();
          if (!typ || !label) continue;
          catalog.push(row);
        }
        if (catalog.length === 0) throw new Error('empty');

        applyFieldLayoutForFamily(shapeFamily);
        applyRow(defaultRow() || catalog[0]);
        setSuggestOpen(false);
      })
      .catch(() => {
        loadError = 'Could not load section catalog.';
        rows.forEach((r) => {
          const inp = r.querySelector('.sf-secprops__val');
          if (!inp) return;
          inp.value = '';
        });
        searchEl.value = '';
        searchEl.placeholder = loadError;
        setSuggestOpen(false);
      });
  };
})();
