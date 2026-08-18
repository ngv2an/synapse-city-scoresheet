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
  // scoreState maps blockId to selected option: 'containment' | 'neutralization' | 'analysis' | null
  let scoreState = {};

  function initScoreState() {
    scoreState = {};
    ALL_BLOCKS.forEach((block) => {
      scoreState[block.id] = null;
    });
  }

  function getRowScore(blockId) {
    const selected = scoreState[blockId];
    if (selected && POINTS[selected]) {
      return POINTS[selected];
    }
    return 0;
  }

  function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const currentBlockIds = LEVELS[activeLevel] || [];
    const hasYellow2 = currentBlockIds.includes('yellow2');

    ALL_BLOCKS.forEach((block) => {
      if (!currentBlockIds.includes(block.id)) return;

      const blockDisplayName = (block.id === 'yellow1' && !hasYellow2) ? 'Yellow' : block.name;
      const selected = scoreState[block.id] || null;
      const rowScore = getRowScore(block.id);

      const tr = document.createElement('tr');
      tr.className = block.rowClass;
      tr.setAttribute('data-block', block.id);

      tr.innerHTML = `
        <td class="block-cell cell-clickable" data-action="unselect" title="Click to deselect">
          <span class="block-name">${blockDisplayName}</span>
        </td>
        <td class="mission-cell cell-clickable" data-type="containment">
          <button class="check-btn ${selected === 'containment' ? 'checked' : ''}" data-block="${block.id}" data-type="containment">
            ${selected === 'containment' ? '✓' : ''}
          </button>
        </td>
        <td class="mission-cell cell-clickable" data-type="neutralization">
          <button class="check-btn ${selected === 'neutralization' ? 'checked' : ''}" data-block="${block.id}" data-type="neutralization">
            ${selected === 'neutralization' ? '✓' : ''}
          </button>
        </td>
        <td class="mission-cell cell-clickable" data-type="analysis">
          <button class="check-btn ${selected === 'analysis' ? 'checked' : ''}" data-block="${block.id}" data-type="analysis">
            ${selected === 'analysis' ? '✓' : ''}
          </button>
        </td>
        <td class="row-score cell-clickable" data-action="unselect" id="score-${block.id}" title="Click to deselect">
          ${rowScore}
        </td>
      `;

      tbody.appendChild(tr);
    });

    updateTotalScore();
  }

  function getTotalScore() {
    const currentBlockIds = LEVELS[activeLevel] || [];
    return currentBlockIds.reduce((sum, bId) => sum + getRowScore(bId), 0);
  }

  function updateTotalScore() {
    const currentBlockIds = LEVELS[activeLevel] || [];
    let total = 0;

    currentBlockIds.forEach((bId) => {
      const rowScore = getRowScore(bId);
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

  function handleRowClick(blockId, action, missionType) {
    if (!blockId) return;

    if (action === 'unselect') {
      // Clicked on Block or Score column -> unselect
      scoreState[blockId] = null;
    } else if (missionType) {
      // Clicked on Containment, Neutralization, or Analysis
      if (scoreState[blockId] === missionType) {
        // Clicked the currently selected option again -> unselect
        scoreState[blockId] = null;
      } else {
        // Select this option and deselect any other option in this row
        scoreState[blockId] = missionType;
      }
    }

    // Update row DOM buttons and score
    updateRowVisuals(blockId);
    updateTotalScore();
  }

  function updateRowVisuals(blockId) {
    const tr = document.querySelector(`tr[data-block="${blockId}"]`);
    if (!tr) return;

    const selected = scoreState[blockId] || null;
    const buttons = tr.querySelectorAll('.check-btn');

    buttons.forEach((btn) => {
      const type = btn.getAttribute('data-type');
      if (type === selected) {
        btn.classList.add('checked');
        btn.textContent = '✓';
      } else {
        btn.classList.remove('checked');
        btn.textContent = '';
      }
    });

    const rowScoreEl = document.getElementById(`score-${blockId}`);
    if (rowScoreEl) {
      rowScoreEl.textContent = getRowScore(blockId);
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

        if (getTotalScore() > 0) {
          const ok = window.confirm('Current score will be lost when switching level. Do you want to continue?');
          if (!ok) return;
        }

        activeLevel = level;
        levelTabs.querySelectorAll('.level-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        initScoreState();
        renderTable();
      });
    }

    // Table click delegation for cells, buttons, block name, and score
    const tbody = document.getElementById('table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;

        const blockId = tr.getAttribute('data-block');
        if (!blockId) return;

        // Check if clicked cell or element is an unselect trigger (Block or Score)
        const unselectTarget = e.target.closest('[data-action="unselect"]');
        if (unselectTarget) {
          handleRowClick(blockId, 'unselect', null);
          return;
        }

        // Check if clicked cell or button is a mission type (Containment, Neutralization, Analysis)
        const missionTarget = e.target.closest('[data-type]');
        if (missionTarget) {
          const type = missionTarget.getAttribute('data-type');
          handleRowClick(blockId, null, type);
          return;
        }
      });
    }

    // Reset button
    const btnReset = document.getElementById('btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (getTotalScore() > 0) {
          const ok = window.confirm('Are you sure you want to reset all scores?');
          if (!ok) return;
        }
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
