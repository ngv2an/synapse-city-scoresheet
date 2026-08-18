const SynapseScoresheet = (() => {
  const POINTS = {
    containment: 45,
    neutralization: 160,
    analysis: 100,
  };

  const ALL_BLOCKS = [
    { id: 'red', name: 'Red', rowClass: 'row-red' },
    { id: 'yellow1', name: 'Yellow 1', rowClass: 'row-yellow1' },
    { id: 'yellow2', name: 'Yellow 2', rowClass: 'row-yellow2' },
    { id: 'green', name: 'Green', rowClass: 'row-green' },
    { id: 'blue', name: 'Blue', rowClass: 'row-blue' },
    { id: 'purple', name: 'Purple', rowClass: 'row-purple' },
    { id: 'mystery', name: 'Mystery', rowClass: 'row-mystery' },
  ];

  const LEVELS = {
    explorer: ['red', 'yellow1', 'green', 'blue'],
    creator: ['red', 'yellow1', 'green', 'blue', 'purple'],
    innovator: ['red', 'yellow1', 'yellow2', 'green', 'blue', 'purple'],
    master: ['red', 'yellow1', 'yellow2', 'green', 'blue', 'purple', 'mystery'],
  };

  let activeLevel = 'explorer';
  let scoreState = {};

  function initScoreState() {
    scoreState = {};
    ALL_BLOCKS.forEach((block) => {
      scoreState[block.id] = {
        containment: false,
        neutralization: false,
        analysis: false,
      };
    });
  }

  function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const currentBlockIds = LEVELS[activeLevel] || [];

    ALL_BLOCKS.forEach((block) => {
      if (!currentBlockIds.includes(block.id)) return;

      const state = scoreState[block.id] || { containment: false, neutralization: false, analysis: false };
      const tr = document.createElement('tr');
      tr.className = block.rowClass;

      let rowScore = 0;
      if (state.containment) rowScore += POINTS.containment;
      if (state.neutralization) rowScore += POINTS.neutralization;
      if (state.analysis) rowScore += POINTS.analysis;

      tr.innerHTML = `
        <td class="block-cell">
          <span class="color-swatch"></span>
          <span class="block-name">${block.name}</span>
        </td>
        <td>
          <button class="check-btn ${state.containment ? 'checked' : ''}" data-block="${block.id}" data-type="containment">
            ${state.containment ? '✓' : ''}
          </button>
        </td>
        <td>
          <button class="check-btn ${state.neutralization ? 'checked' : ''}" data-block="${block.id}" data-type="neutralization">
            ${state.neutralization ? '✓' : ''}
          </button>
        </td>
        <td>
          <button class="check-btn ${state.analysis ? 'checked' : ''}" data-block="${block.id}" data-type="analysis">
            ${state.analysis ? '✓' : ''}
          </button>
        </td>
        <td class="row-score" id="score-${block.id}">
          ${rowScore}
        </td>
      `;

      tbody.appendChild(tr);
    });

    updateTotalScore();
  }

  function updateTotalScore() {
    const currentBlockIds = LEVELS[activeLevel] || [];
    let total = 0;

    currentBlockIds.forEach((bId) => {
      const state = scoreState[bId];
      if (!state) return;

      let rowScore = 0;
      if (state.containment) rowScore += POINTS.containment;
      if (state.neutralization) rowScore += POINTS.neutralization;
      if (state.analysis) rowScore += POINTS.analysis;

      const rowScoreEl = document.getElementById(`score-${bId}`);
      if (rowScoreEl) {
        rowScoreEl.textContent = rowScore;
      }

      total += rowScore;
    });

    const totalEl = document.getElementById('total-score');
    if (totalEl) {
      totalEl.textContent = total;
    }
  }

  function setupEvents() {
    // Level Switcher
    const levelTabs = document.getElementById('level-tabs');
    if (levelTabs) {
      levelTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.level-tab');
        if (!btn) return;

        const level = btn.getAttribute('data-level');
        if (!level || level === activeLevel) return;

        activeLevel = level;
        levelTabs.querySelectorAll('.level-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        renderTable();
      });
    }

    // Table click delegation for check buttons
    const tbody = document.getElementById('table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('.check-btn');
        if (!btn) return;

        const blockId = btn.getAttribute('data-block');
        const type = btn.getAttribute('data-type');

        if (!scoreState[blockId]) {
          scoreState[blockId] = { containment: false, neutralization: false, analysis: false };
        }

        const isChecked = !scoreState[blockId][type];
        scoreState[blockId][type] = isChecked;

        if (isChecked) {
          btn.classList.add('checked');
          btn.textContent = '✓';
        } else {
          btn.classList.remove('checked');
          btn.textContent = '';
        }

        updateTotalScore();
      });
    }

    // Reset button
    const btnReset = document.getElementById('btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        initScoreState();
        renderTable();
      });
    }
  }

  function init() {
    initScoreState();
    renderTable();
    setupEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init,
  };
})();
