/**
 * Steel Grade module: STEEL GRADE page bound to `SteelForgeStructuralSteelGrades`
 * in steel-db.js (ASTM designation, Fy, Fu in ksi).
 *
 * The workbook export `exel program EWIWIWI(S(STEEL SELECTION)).csv` contains section
 * geometry (W, 2L, HSS, …) only; it does not include ASTM grade strength rows. Grade
 * strengths stay in sync with the material table embedded in steel-db.js.
 */
(() => {
  /** Default matches common W-shape design practice (ASTM REF 2). */
  const DEFAULT_GRADE_ID = 'a992';

  function sortedGrades() {
    const grades = window.SteelForgeStructuralSteelGrades ?? [];
    return [...grades].sort((a, b) => {
      const ca = a.catalogId;
      const cb = b.catalogId;
      if (ca != null && cb != null && ca !== cb) return ca - cb;
      if (ca != null && cb == null) return -1;
      if (ca == null && cb != null) return 1;
      return String(a.label).localeCompare(String(b.label));
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stressDisplay(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    if (Number.isInteger(x)) return String(x);
    return String(x);
  }

  window.SteelForge = window.SteelForge || {};

  window.SteelForge.initSteelGrade = (panelRoot) => {
    const root = panelRoot?.querySelector?.('.sf-grade') ? panelRoot : document;
    const grades = sortedGrades();
    const tbody = root.querySelector('#sfGradeTableBody');
    const designationEl = root.querySelector('#sfGradeDesignation');
    const fyEl = root.querySelector('#sfGradeFy');
    const fuPill = root.querySelector('#sfGradeFuPill');
    const outDesignation = root.querySelector('#sfGradeSelDesignation');
    const outFy = root.querySelector('#sfGradeSelFy');
    const outFu = root.querySelector('#sfGradeSelFu');
    if (!tbody || !designationEl || !fyEl || !fuPill || !outDesignation || !outFy || !outFu) return;
    if (grades.length === 0) return;

    tbody.replaceChildren();
    for (const row of grades) {
      const tr = document.createElement('tr');
      tr.dataset.gradeId = row.id;
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td>${stressDisplay(row.fy)}</td><td>${stressDisplay(row.fu)}</td>`;
      tbody.appendChild(tr);
    }

    designationEl.replaceChildren();
    for (const row of grades) {
      const opt = document.createElement('option');
      opt.value = row.id;
      opt.textContent = row.label;
      designationEl.appendChild(opt);
    }

    const byId = (id) => grades.find((g) => g.id === id) ?? null;

    function highlightRow(id) {
      tbody.querySelectorAll('tr').forEach((tr) => {
        tr.classList.toggle('sf-grade__row--active', tr.dataset.gradeId === id);
      });
    }

    /** All catalog rows that share the same display label (workbook variants). */
    function gradesForLabel(label) {
      return grades.filter((g) => g.label === label);
    }

    function syncFyControl(grade) {
      fyEl.replaceChildren();
      const variants = gradesForLabel(grade.label);
      const fyChoices =
        variants.length > 1
          ? [...new Set(variants.map((g) => g.fy))].sort((a, b) => a - b)
          : [grade.fy];
      for (const fy of fyChoices) {
        const opt = document.createElement('option');
        opt.value = String(fy);
        opt.textContent = stressDisplay(fy);
        fyEl.appendChild(opt);
      }
      fyEl.value = String(grade.fy);
    }

    function resolveGradeFromControls() {
      const id = designationEl.value;
      const base = byId(id);
      if (!base) return null;
      const variants = gradesForLabel(base.label);
      if (variants.length <= 1) return base;
      const fySel = Number(fyEl.value);
      const match = variants.find((g) => g.fy === fySel);
      return match ?? base;
    }

    function applyGrade(grade) {
      if (!grade) return;
      syncFyControl(grade);
      const resolved = resolveGradeFromControls() ?? grade;
      fuPill.textContent = stressDisplay(resolved.fu);
      outDesignation.textContent = resolved.label;
      outFy.textContent = `${stressDisplay(resolved.fy)} ksi`;
      outFu.textContent = `${stressDisplay(resolved.fu)} ksi`;
      highlightRow(resolved.id);
      designationEl.value = resolved.id;
      window.SteelForge.activeStructuralSteelGrade = {
        id: resolved.id,
        label: resolved.label,
        fy: resolved.fy,
        fu: resolved.fu,
        catalogId: resolved.catalogId ?? null,
        workbookDeflectionDenom: resolved.workbookDeflectionDenom ?? null,
      };
      window.dispatchEvent(
        new CustomEvent('sf:steel-grade-change', {
          detail: window.SteelForge.activeStructuralSteelGrade,
        }),
      );
    }

    designationEl.addEventListener('change', () => {
      const g = byId(designationEl.value);
      if (g) applyGrade(g);
    });

    fyEl.addEventListener('change', () => {
      const base = byId(designationEl.value);
      if (!base) return;
      const variants = gradesForLabel(base.label);
      if (variants.length <= 1) {
        applyGrade(base);
        return;
      }
      const fySel = Number(fyEl.value);
      const picked = variants.find((g) => g.fy === fySel) ?? base;
      designationEl.value = picked.id;
      applyGrade(picked);
    });

    function activateRowById(id) {
      if (!id || !byId(id)) return;
      designationEl.value = id;
      applyGrade(byId(id));
    }

    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-grade-id]');
      if (!tr || !tbody.contains(tr)) return;
      activateRowById(tr.dataset.gradeId);
    });

    tbody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr[data-grade-id]');
      if (!tr || !tbody.contains(tr)) return;
      e.preventDefault();
      activateRowById(tr.dataset.gradeId);
    });

    const initialId = grades.some((g) => g.id === DEFAULT_GRADE_ID) ? DEFAULT_GRADE_ID : grades[0].id;
    designationEl.value = initialId;
    applyGrade(byId(initialId));
  };
})();
