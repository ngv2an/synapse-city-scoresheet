const SynapseScoresheet = (() => {
  const POINTS = {
    containment: 45,
    neutralization: 160,
    analysis: 100,
    crl: 40,
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

  const ALL_LEANBOTS = [
    { id: 'leanbot1', name: 'Leanbot 1', rowClass: 'row-leanbot' },
    { id: 'leanbot2', name: 'Leanbot 2', rowClass: 'row-leanbot' },
  ];

  const LEANBOT_LEVELS = {
    explorer: ['leanbot1'],
    creator: ['leanbot1'],
    innovator: ['leanbot1', 'leanbot2'],
    master: ['leanbot1', 'leanbot2'],
  };

  const DISABLED_MISSIONS = {
    red: ['neutralization'],
    yellow1: ['neutralization'],
    yellow2: ['neutralization'],
    mystery: ['neutralization'],
    green: ['analysis'],
    blue: ['analysis'],
    purple: ['analysis'],
  };

  const JUDGE_KEY = 'scoresheet.judgeName';

  let activeLevel = 'creator';
  // scoreState maps blockId to selected option: 'containment' | 'neutralization' | 'analysis' | null
  let scoreState = {};
  // leanbotState maps botId to boolean (checked for CRL)
  let leanbotState = {};
  // Compressed data URL of the mission photo, sent along with the score
  let currentPhotoDataUrl = '';

  function isMissionDisabled(blockId, missionType) {
    const disabledList = DISABLED_MISSIONS[blockId] || [];
    return disabledList.includes(missionType);
  }

  function getMissionPoints(blockId, missionType) {
    if (blockId === 'mystery' && missionType === 'analysis') {
      return 150;
    }
    return POINTS[missionType] || 0;
  }

  function initScoreState() {
    scoreState = {};
    ALL_BLOCKS.forEach((block) => {
      scoreState[block.id] = null;
    });

    leanbotState = {};
    ALL_LEANBOTS.forEach((bot) => {
      leanbotState[bot.id] = false;
    });
  }

  function getRowScore(blockId) {
    const selected = scoreState[blockId];
    if (selected && !isMissionDisabled(blockId, selected)) {
      return getMissionPoints(blockId, selected);
    }
    return 0;
  }

  function getLeanbotRowScore(botId) {
    return leanbotState[botId] ? POINTS.crl : 0;
  }

  function renderMissionCell(blockId, selectedType, type) {
    const disabled = isMissionDisabled(blockId, type);
    if (disabled) {
      return `<td class="mission-cell cell-disabled"></td>`;
    }

    const isChecked = selectedType === type;
    const points = getMissionPoints(blockId, type);
    return `
      <td class="mission-cell cell-clickable" data-type="${type}">
        <button class="check-btn ${isChecked ? 'checked' : ''}" data-block="${blockId}" data-type="${type}">
          +${points}
        </button>
      </td>
    `;
  }

  function renderBlockTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const currentBlockIds = LEVELS[activeLevel] || [];
    const hasYellow2 = currentBlockIds.includes('yellow2');

    ALL_BLOCKS.forEach((block) => {
      if (!currentBlockIds.includes(block.id)) return;

      const blockDisplayName = (block.id === 'yellow1' && !hasYellow2) ? 'Yellow' : block.name;
      const selected = scoreState[block.id] || null;

      const tr = document.createElement('tr');
      tr.className = block.rowClass;
      tr.setAttribute('data-block', block.id);

      tr.innerHTML = `
        <td class="block-cell cell-clickable" data-action="unselect" title="Click to deselect">
          <span class="block-name">${blockDisplayName}</span>
        </td>
        ${renderMissionCell(block.id, selected, 'containment')}
        ${renderMissionCell(block.id, selected, 'neutralization')}
        ${renderMissionCell(block.id, selected, 'analysis')}
      `;

      tbody.appendChild(tr);
    });
  }

  function renderLeanbotTable() {
    const tbody = document.getElementById('leanbot-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const currentBotIds = LEANBOT_LEVELS[activeLevel] || [];
    const hasMultipleBots = currentBotIds.length > 1;

    ALL_LEANBOTS.forEach((bot) => {
      if (!currentBotIds.includes(bot.id)) return;

      const displayName = (bot.id === 'leanbot1' && !hasMultipleBots) ? 'Leanbot' : bot.name;
      const isChecked = !!leanbotState[bot.id];

      const tr = document.createElement('tr');
      tr.className = bot.rowClass;
      tr.setAttribute('data-leanbot', bot.id);

      tr.innerHTML = `
        <td class="block-cell cell-clickable" data-action="unselect-leanbot" title="Click to deselect">
          <span class="block-name">${displayName}</span>
        </td>
        <td class="mission-cell cell-disabled"></td>
        <td class="mission-cell cell-disabled"></td>
        <td class="mission-cell cell-clickable" data-type="crl">
          <button class="check-btn ${isChecked ? 'checked' : ''}" data-leanbot="${bot.id}" data-type="crl">
            +${POINTS.crl}
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  function renderTable() {
    renderBlockTable();
    renderLeanbotTable();
    updateTotalScore();
  }

  function getTotalScore() {
    const currentBlockIds = LEVELS[activeLevel] || [];
    const blockTotal = currentBlockIds.reduce((sum, bId) => sum + getRowScore(bId), 0);

    const currentBotIds = LEANBOT_LEVELS[activeLevel] || [];
    const leanbotTotal = currentBotIds.reduce((sum, botId) => sum + getLeanbotRowScore(botId), 0);

    return blockTotal + leanbotTotal;
  }

  function updateTotalScore() {
    const currentBlockIds = LEVELS[activeLevel] || [];
    let blockTotal = 0;

    currentBlockIds.forEach((bId) => {
      blockTotal += getRowScore(bId);
    });

    const currentBotIds = LEANBOT_LEVELS[activeLevel] || [];
    let leanbotTotal = 0;

    currentBotIds.forEach((botId) => {
      leanbotTotal += getLeanbotRowScore(botId);
    });

    const totalEl = document.getElementById('total-score');
    if (totalEl) {
      totalEl.textContent = blockTotal + leanbotTotal;
    }
  }

  function handleRowClick(blockId, action, missionType) {
    if (!blockId) return;

    if (action === 'unselect') {
      // Clicked on Block column -> unselect
      scoreState[blockId] = null;
    } else if (missionType) {
      if (isMissionDisabled(blockId, missionType)) return;
      // Clicked on Containment, Neutralization, or Analysis
      if (scoreState[blockId] === missionType) {
        // Clicked the currently selected option again -> unselect
        scoreState[blockId] = null;
      } else {
        // Select this option and deselect any other option in this row
        scoreState[blockId] = missionType;
      }
    }

    // Update row DOM buttons and total score
    updateRowVisuals(blockId);
    updateTotalScore();
  }

  function updateRowVisuals(blockId) {
    const tr = document.querySelector(`tr[data-block="${blockId}"]`);
    if (!tr) return;

    const selected = scoreState[blockId] || null;
    const buttons = tr.querySelectorAll('.check-btn:not(.disabled)');

    buttons.forEach((btn) => {
      const type = btn.getAttribute('data-type');
      if (type === selected) {
        btn.classList.add('checked');
      } else {
        btn.classList.remove('checked');
      }
      const points = getMissionPoints(blockId, type);
      btn.textContent = `+${points}`;
    });
  }

  function handleLeanbotRowClick(botId, action, missionType) {
    if (!botId) return;

    if (action === 'unselect-leanbot') {
      leanbotState[botId] = false;
    } else if (missionType === 'crl') {
      leanbotState[botId] = !leanbotState[botId];
    }

    updateLeanbotRowVisuals(botId);
    updateTotalScore();
  }

  function updateLeanbotRowVisuals(botId) {
    const tr = document.querySelector(`tr[data-leanbot="${botId}"]`);
    if (!tr) return;

    const isChecked = !!leanbotState[botId];
    const btn = tr.querySelector('.check-btn');
    if (btn) {
      if (isChecked) {
        btn.classList.add('checked');
      } else {
        btn.classList.remove('checked');
      }
      btn.textContent = `+${POINTS.crl}`;
    }
  }

  function clearPhoto() {
    const previewImg = document.getElementById('photo-preview');
    const container = document.getElementById('photo-container');
    const photoInput = document.getElementById('photo-input');
    if (previewImg) previewImg.src = '';
    if (container) container.style.display = 'none';
    if (photoInput) photoInput.value = '';
    currentPhotoDataUrl = '';
  }

  // Camera photos run 4-8MB and base64 adds another third on top, so shrink once
  // and reuse the result for both the preview and the submitted payload.
  function compressImage(file, maxSize = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not read the photo'));
      };

      img.src = objectUrl;
    });
  }

  // submit.js may fail to load (blocked, missing) -> don't take the whole app down with it
  function pendingCount() {
    return typeof SheetSubmit === 'undefined' ? 0 : SheetSubmit.pending();
  }

  function setSubmitStatus(message, tone) {
    const el = document.getElementById('submit-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'submit-status' + (tone ? ' is-' + tone : '');
  }

  function clearForNextTeam() {
    const teamInput = document.getElementById('team-name');
    if (teamInput) teamInput.value = '';
    initScoreState();
    clearPhoto();
    renderTable();
  }

  async function handleSubmit() {
    const btn = document.getElementById('btn-submit');
    const teamInput = document.getElementById('team-name');
    const judgeInput = document.getElementById('judge-name');
    if (!btn || !teamInput) return;

    const team = teamInput.value.trim();
    if (!team) {
      setSubmitStatus('Enter a team name before submitting.', 'error');
      teamInput.focus();
      return;
    }

    const totalScore = getTotalScore();
    if (totalScore === 0 && !window.confirm('Total score is 0. Submit anyway?')) return;

    btn.disabled = true;
    btn.textContent = 'Sending…';
    setSubmitStatus('', null);

    try {
      const result = await SheetSubmit.submit({
        judge: judgeInput ? judgeInput.value.trim() : '',
        team: team,
        level: activeLevel,
        totalScore: totalScore,
        scores: Object.assign({}, scoreState, leanbotState),
        photoBase64: currentPhotoDataUrl,
      });

      // A duplicate that came back from our own retry means the row landed on the first
      // try and we merely lost the reply, so report it as the success it is.
      if (result.duplicate && !result.viaRetry) {
        setSubmitStatus('This run was already recorded.', 'ok');
      } else {
        const where = result.row ? ' - row ' + result.row : '';
        setSubmitStatus('Submitted "' + team + '"' + where + '. Cleared for the next team.', 'ok');
      }
      clearForNextTeam();

    } catch (err) {
      const pending = pendingCount();
      if (pending > 0) {
        // The run is safely queued, so clear the sheet exactly as on success. Leaving it
        // filled invites the judge to score over it and submit a second, duplicate row.
        setSubmitStatus('Saved on this device (' + pending + ' waiting), ' + err.message, 'warn');
        clearForNextTeam();
      } else {
        setSubmitStatus('Submit failed: ' + err.message, 'error');
      }

    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  async function flushQueue(announceIdle) {
    if (pendingCount() === 0) return;

    const sent = await SheetSubmit.flush();
    const left = pendingCount();

    if (sent > 0) {
      setSubmitStatus('Sent ' + sent + ' run(s) saved offline.', 'ok');
    } else if (left > 0 && announceIdle) {
      setSubmitStatus(left + ' run(s) waiting for a connection.', 'warn');
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
        clearPhoto();
        renderTable();
      });
    }

    // Main block table click delegation
    const tbody = document.getElementById('table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;

        const blockId = tr.getAttribute('data-block');
        if (!blockId) return;

        // Check if clicked cell or element is an unselect trigger (Block column)
        const unselectTarget = e.target.closest('[data-action="unselect"]');
        if (unselectTarget) {
          handleRowClick(blockId, 'unselect', null);
          return;
        }

        // Check if clicked cell or button is a mission type (Containment, Neutralization, Analysis)
        const missionTarget = e.target.closest('.cell-clickable[data-type]');
        if (missionTarget) {
          const type = missionTarget.getAttribute('data-type');
          handleRowClick(blockId, null, type);
          return;
        }
      });
    }

    // Leanbot table click delegation
    const leanbotTbody = document.getElementById('leanbot-table-body');
    if (leanbotTbody) {
      leanbotTbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;

        const botId = tr.getAttribute('data-leanbot');
        if (!botId) return;

        // Check if clicked cell or element is an unselect trigger
        const unselectTarget = e.target.closest('[data-action="unselect-leanbot"]');
        if (unselectTarget) {
          handleLeanbotRowClick(botId, 'unselect-leanbot', null);
          return;
        }

        // Check if clicked cell or button is CRL
        const missionTarget = e.target.closest('.cell-clickable[data-type="crl"]');
        if (missionTarget) {
          handleLeanbotRowClick(botId, null, 'crl');
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
        clearPhoto();
        renderTable();
      });
    }

    // Photo button -> trigger camera capture
    const btnPhoto = document.getElementById('btn-photo');
    const photoInput = document.getElementById('photo-input');
    if (btnPhoto && photoInput) {
      btnPhoto.addEventListener('click', () => {
        photoInput.click();
      });

      photoInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        compressImage(file).then((dataUrl) => {
          currentPhotoDataUrl = dataUrl;

          const previewImg = document.getElementById('photo-preview');
          const container = document.getElementById('photo-container');
          if (previewImg && container) {
            previewImg.src = dataUrl;
            container.style.display = 'block';
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }).catch((err) => {
          setSubmitStatus(err.message, 'error');
        });
      });
    }

    // Remove Photo button
    const btnRemovePhoto = document.getElementById('btn-remove-photo');
    if (btnRemovePhoto) {
      btnRemovePhoto.addEventListener('click', () => {
        clearPhoto();
      });
    }

    // Judge name stays put across teams, so a judge types it once per session
    const judgeInput = document.getElementById('judge-name');
    if (judgeInput) {
      try {
        judgeInput.value = localStorage.getItem(JUDGE_KEY) || '';
      } catch (err) {
        // localStorage blocked -> only the convenience is lost
      }

      judgeInput.addEventListener('change', () => {
        try {
          localStorage.setItem(JUDGE_KEY, judgeInput.value.trim());
        } catch (err) {
          // as above
        }
      });
    }

    // Submit button
    const btnSubmit = document.getElementById('btn-submit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', handleSubmit);
    }

    window.addEventListener('online', () => flushQueue(false));
  }

  function init() {
    initScoreState();
    renderTable();
    setupEvents();
    flushQueue(true);
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
