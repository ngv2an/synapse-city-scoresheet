const SynapseScoresheet = (() => {
  const POINTS = {
    containment: 45,
    neutralization: 160,
    analysis: 100,
    crl: 40,
  };

  const ALL_BLOCKS = [
    { id: 'green', name: 'Green', rowClass: 'row-green' },
    { id: 'blue', name: 'Blue', rowClass: 'row-blue' },
    { id: 'purple', name: 'Purple', rowClass: 'row-purple' },
    { id: 'mystery', name: 'Mystery', rowClass: 'row-mystery' },
    { id: 'red', name: 'Red', rowClass: 'row-red' },
    { id: 'yellow1', name: 'Yellow 1', rowClass: 'row-yellow1' },
    { id: 'yellow2', name: 'Yellow 2', rowClass: 'row-yellow2' },
  ];

  const LEVELS = {
    explorer: ['green', 'blue', 'red', 'yellow1'],
    creator: ['green', 'blue', 'purple', 'red', 'yellow1'],
    innovator: ['green', 'blue', 'purple', 'red', 'yellow1', 'yellow2'],
    master: ['green', 'blue', 'purple', 'mystery', 'red', 'yellow1', 'yellow2'],
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

  const DEFAULT_SHEET_ID = '1jnnh5phoBJO1JsKtzumCIOHQUl3kyeY13fThvHza2Bc';
  const METADATA_KEY_PREFIX = 'scoresheet.metadata.';
  const DRAFT_KEY_PREFIX = 'scoresheet.draft.';
  const DEVICE_KEY = 'scoresheet.deviceId';
  const JUDGE_KEY = 'scoresheet.judgeName';

  // The Sheet decides the level, so this only ever changes from the Config tab.
  let activeLevel = 'creator';
  // Kept around because the round is re-derived from the clock on a timer, not rendered once.
  let competitionInfo = { competitionDate: '', rounds: [], endTime: '', level: '' };
  let roundTicker = null;
  // scoreState maps blockId to selected option: 'containment' | 'neutralization' | 'analysis' | null
  let scoreState = {};
  // leanbotState maps botId to boolean (checked for CRL)
  let leanbotState = {};
  // Compressed data URL of the mission photo, sent along with the score
  let currentPhotoDataUrl = '';
  // Try: one of the 0-3 buttons, or a free number once Other is picked.
  let tryValue = 0;
  let tryIsOther = false;
  // Team options arrive with metadata, so keep the restored value until that list exists.
  let restoredTeam = '';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getActiveSheetId() {
    const urlParams = new URLSearchParams(window.location.search);
    const link = urlParams.get('link') || urlParams.get('sheet') || urlParams.get('id');
    if (!link) return DEFAULT_SHEET_ID;
    const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    return link.trim();
  }

  function getOrCreateDeviceId() {
    let devId = '';
    try {
      devId = localStorage.getItem(DEVICE_KEY);
    } catch (e) {}

    if (!devId) {
      const part1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const part2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      devId = `DEV-${part1}-${part2}`;
      try {
        localStorage.setItem(DEVICE_KEY, devId);
      } catch (e) {}
    }
    return devId;
  }

  function getDraftKey() {
    return DRAFT_KEY_PREFIX + getActiveSheetId();
  }

  function saveDraft() {
    const timeInput = document.getElementById('mission-time');
    const otherInput = document.getElementById('try-other');
    const selectedTeam = getSelectedTeam();

    try {
      localStorage.setItem(getDraftKey(), JSON.stringify({
        version: 1,
        level: activeLevel,
        team: selectedTeam || restoredTeam,
        missionTime: timeInput ? timeInput.value : '',
        tryValue: tryValue,
        tryIsOther: tryIsOther,
        tryOther: otherInput ? otherInput.value : '',
        scores: Object.assign({}, scoreState),
        leanbots: Object.assign({}, leanbotState),
      }));
    } catch (e) {}
  }

  function restoreDraft() {
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem(getDraftKey()));
    } catch (e) {
      return;
    }
    if (!draft || typeof draft !== 'object') return;

    const savedLevel = String(draft.level || '').toLowerCase();
    if (LEVELS[savedLevel]) activeLevel = savedLevel;

    const savedScores = draft.scores && typeof draft.scores === 'object' ? draft.scores : {};
    ALL_BLOCKS.forEach((block) => {
      const selected = savedScores[block.id];
      const valid = ['containment', 'neutralization', 'analysis'].includes(selected);
      if (valid && !isMissionDisabled(block.id, selected)) scoreState[block.id] = selected;
    });

    const savedLeanbots = draft.leanbots && typeof draft.leanbots === 'object' ? draft.leanbots : {};
    ALL_LEANBOTS.forEach((bot) => {
      leanbotState[bot.id] = savedLeanbots[bot.id] === true;
    });

    restoredTeam = typeof draft.team === 'string' ? draft.team : '';

    const timeInput = document.getElementById('mission-time');
    if (timeInput) timeInput.value = formatMissionTime(draft.missionTime || '');

    const savedTryValue = Number(draft.tryValue);
    tryValue = Number.isInteger(savedTryValue) && savedTryValue >= 0 && savedTryValue <= 3
      ? savedTryValue
      : 0;
    tryIsOther = draft.tryIsOther === true;

    const otherInput = document.getElementById('try-other');
    if (otherInput) {
      otherInput.value = String(draft.tryOther || '').replace(/\D/g, '').slice(0, 2);
    }
  }

  function clearDraft() {
    restoredTeam = '';
    try {
      localStorage.removeItem(getDraftKey());
    } catch (e) {}
  }

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
          ${points}
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
        <td colspan="3" class="block-cell leanbot-label-cell">
          <span class="block-name">${displayName} back to CRL</span>
        </td>
        <td class="mission-cell cell-clickable leanbot-action-cell" data-type="crl">
          <button class="check-btn ${isChecked ? 'checked' : ''}" data-leanbot="${bot.id}" data-type="crl">
            ${POINTS.crl}
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
      scoreState[blockId] = null;
    } else if (missionType) {
      if (isMissionDisabled(blockId, missionType)) return;
      if (scoreState[blockId] === missionType) {
        scoreState[blockId] = null;
      } else {
        scoreState[blockId] = missionType;
      }
    }

    updateRowVisuals(blockId);
    updateTotalScore();
    saveDraft();
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
      btn.textContent = `${points}`;
    });
  }

  function handleLeanbotRowClick(botId, missionType) {
    if (!botId || missionType !== 'crl') return;

    leanbotState[botId] = !leanbotState[botId];

    updateLeanbotRowVisuals(botId);
    updateTotalScore();
    saveDraft();
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
      btn.textContent = `${POINTS.crl}`;
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

  /**
   * Digits fill in from the right the way a stopwatch reads out, so 12345 becomes 1:23.45
   * and nobody types a colon. Every half-typed state is a real time as well - 123 reads as
   * 1.23 seconds, not a mask with holes in it - so the field never shows nonsense mid-entry.
   */
  function formatMissionTime(raw) {
    // The zeros this mask pads with come straight back in on the next keystroke, so they
    // have to go first - without this, typing 1 2 3 walks 0.01 -> 00.12 -> 0:01.23.
    const digits = String(raw).replace(/[^0-9]/g, '').replace(/^0+/, '').slice(-6);
    if (!digits) return '';

    const padded = digits.padStart(3, '0');
    const centis = padded.slice(-2);
    const seconds = padded.slice(0, -2);

    if (seconds.length <= 2) return seconds + '.' + centis;
    return seconds.slice(0, -2) + ':' + seconds.slice(-2) + '.' + centis;
  }

  function renderTryButtons() {
    const group = document.getElementById('try-options');
    if (!group) return;

    group.querySelectorAll('.try-btn').forEach((btn) => {
      const value = btn.getAttribute('data-try');
      const active = tryIsOther ? value === 'other' : String(tryValue) === value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const other = document.getElementById('try-other');
    if (other) {
      other.hidden = !tryIsOther;
      if (!tryIsOther) other.removeAttribute('aria-invalid');
    }
  }

  /** Read at submit time rather than tracked on every keystroke, so there is one truth. */
  function getTryCount() {
    if (!tryIsOther) return tryValue;

    const other = document.getElementById('try-other');
    const raw = other ? other.value.trim() : '';
    if (!/^\d{1,2}$/.test(raw)) return null;

    const typed = Number(raw);
    return Number.isInteger(typed) && typed >= 0 && typed <= 99 ? typed : null;
  }

  function resetTry() {
    tryValue = 0;
    tryIsOther = false;

    const other = document.getElementById('try-other');
    if (other) {
      other.value = '';
      other.removeAttribute('aria-invalid');
    }
    renderTryButtons();
  }

  function pendingCount() {
    return typeof SheetSubmit === 'undefined' ? 0 : SheetSubmit.pending();
  }

  function setSubmitStatus(message, tone) {
    const el = document.getElementById('submit-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'submit-status' + (tone ? ' is-' + tone : '');
  }

  function getSelectedJudge() {
    const select = document.getElementById('judge-select');
    return select ? select.value.trim() : '';
  }

  function getSelectedTeam() {
    const select = document.getElementById('team-select');
    return select ? select.value.trim() : '';
  }

  function resetRunState() {
    // Reset Time and Try
    const timeInput = document.getElementById('mission-time');
    if (timeInput) timeInput.value = '';
    resetTry();

    initScoreState();
    clearPhoto();
    renderTable();
  }

  function clearForNextTeam() {
    const teamSelect = document.getElementById('team-select');
    if (teamSelect) teamSelect.value = '';

    resetRunState();
    clearDraft();
  }

  async function loadMetadata() {
    const sheetId = getActiveSheetId();
    const cacheKey = METADATA_KEY_PREFIX + sheetId;

    // Update View Submission link
    const viewLink = document.getElementById('view-submission-link');
    if (viewLink) {
      viewLink.href = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    }

    // 1. Load from cache immediately
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached) applyMetadata(cached);
    } catch (e) {}

    // 2. Fetch fresh metadata from Apps Script
    try {
      const data = await SheetSubmit.fetchMetadata(sheetId);
      if (data && data.ok) {
        applyMetadata(data);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch (e) {}
      }
    } catch (err) {
      console.warn('Could not fetch sheet metadata:', err);
    }
  }

  /** 'dd/MM/yy' or 'dd/MM/yyyy' -> [year, monthIndex, day]. null when it is not a date. */
  function parseConfigDate(text) {
    const m = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;

    const year = Number(m[3]);
    return [year < 100 ? 2000 + year : year, Number(m[2]) - 1, Number(m[1])];
  }

  /** '2:30 PM', '14:30' or '14:30:00' -> seconds since midnight. */
  function parseConfigTime(text) {
    const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
    if (!m) return null;

    let hours = Number(m[1]);
    const minutes = Number(m[2]);
    const seconds = Number(m[3] || 0);
    const suffix = (m[4] || '').toUpperCase();

    if (suffix) {
      if (hours < 1 || hours > 12) return null;
      if (suffix === 'AM') hours = hours === 12 ? 0 : hours;
      if (suffix === 'PM') hours = hours === 12 ? 12 : hours + 12;
    }
    if (hours > 23 || minutes > 59 || seconds > 59) return null;

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * The clock picks one of the two fixed rounds, and End Time closes the schedule. Start
   * times are placed on the competition date, so opening the page the day before still
   * reads "Start at ..." rather than jumping to the last round.
   */
  function resolveRound(now) {
    const rounds = (competitionInfo.rounds || [])
      .map((r) => ({ round: Number(r.round), time: r.time, seconds: parseConfigTime(r.time) }))
      .filter((r) => (r.round === 1 || r.round === 2) && r.seconds !== null)
      .sort((a, b) => a.round - b.round);

    if (!rounds.length) return null;

    const date = parseConfigDate(competitionInfo.competitionDate);
    const midnight = date
      ? new Date(date[0], date[1], date[2])
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const endSeconds = parseConfigTime(competitionInfo.endTime);
    const ended = endSeconds !== null
      && now.getTime() >= midnight.getTime() + endSeconds * 1000;
    if (ended) return { current: null, first: rounds[0], ended: true };

    let current = null;
    rounds.forEach((r) => {
      if (now.getTime() >= midnight.getTime() + r.seconds * 1000) current = r;
    });

    return { current: current, first: rounds[0], ended: false };
  }

  function renderRound() {
    const el = document.getElementById('meta-round');
    if (!el) return;

    const state = resolveRound(new Date());
    if (!state) {
      el.textContent = '';
      el.classList.remove('is-pending', 'is-ended');
      return;
    }

    el.textContent = state.ended
      ? 'Ended at ' + competitionInfo.endTime
      : state.current
        ? 'Round ' + state.current.round
        : 'Start at ' + state.first.time;
    el.classList.toggle('is-pending', !state.current && !state.ended);
    el.classList.toggle('is-ended', state.ended);
  }

  function formatDeviceDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getFullYear() % 100);
  }

  /**
   * The round is read off the device clock, so a tablet left on the wrong date reports a
   * wrong round and says nothing about it. This makes that impossible to miss. It warns
   * rather than blocks: a judge mid-run needs the sheet more than they need a correct clock.
   */
  function renderDateWarning() {
    const el = document.getElementById('date-warning');
    if (!el) return;

    const expected = parseConfigDate(competitionInfo.competitionDate);
    if (!expected) {
      el.textContent = '';
      return;
    }

    const now = new Date();
    const sameDay = now.getFullYear() === expected[0]
      && now.getMonth() === expected[1]
      && now.getDate() === expected[2];

    el.textContent = sameDay ? '' : 'Wrong device date: ' + formatDeviceDate(now)
      + ' - competition is ' + competitionInfo.competitionDate
      + '. Check the device clock, the round above is unreliable.';
  }

  /** Round number for the row, blank before Round 1 and after End Time. */
  function getCurrentRound() {
    const state = resolveRound(new Date());
    return state && state.current ? state.current.round : '';
  }

  function renderClock() {
    renderRound();
    renderDateWarning();
  }

  function renderLevel() {
    const el = document.getElementById('meta-level');
    if (el) el.textContent = activeLevel;
  }

  function applyCompetitionMeta(data) {
    competitionInfo = {
      competitionDate: data.competitionDate || '',
      rounds: Array.isArray(data.rounds) ? data.rounds : [],
      endTime: data.endTime || '',
      level: data.level || '',
    };

    const dateEl = document.getElementById('meta-date');
    if (dateEl) dateEl.textContent = competitionInfo.competitionDate;

    renderClock();
  }

  /** One Sheet ID means one level, so this is the only thing that can change it. */
  function applyConfiguredLevel(level) {
    const key = String(level || '').toLowerCase();
    if (!LEVELS[key] || key === activeLevel) return;
    // Switching level rebuilds the block list, which would throw away a run in progress.
    if (getTotalScore() > 0) return;

    activeLevel = key;
    initScoreState();
    renderTable();
    renderLevel();
  }

  /**
   * Assigning a value no option carries leaves the select blank with selectedIndex -1, which
   * hides the placeholder too. Checking first keeps "-- Select Judge --" on screen when a
   * name has been taken out of the Config tab.
   */
  function optionExists(select, value) {
    return !!value && Array.from(select.options).some((o) => o.value === value);
  }

  function applyMetadata(data) {
    if (data.competition) {
      const banner = document.getElementById('competition-banner');
      if (banner) banner.textContent = data.competition;
    }

    applyCompetitionMeta(data);
    applyConfiguredLevel(data.level);

    // Populate Judges. The Config tab is the whole list - there is no free-text fallback,
    // so a name missing from it cannot be scored under and has to be added to the Sheet.
    const judgeSelect = document.getElementById('judge-select');
    if (judgeSelect && Array.isArray(data.judges)) {
      let saved = '';
      try {
        saved = localStorage.getItem(JUDGE_KEY) || '';
      } catch (e) {}

      const currentVal = getSelectedJudge() || saved;
      let opts = '<option value="">-- Select Judge --</option>';
      data.judges.forEach((j) => {
        opts += `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`;
      });
      judgeSelect.innerHTML = opts;
      judgeSelect.value = optionExists(judgeSelect, currentVal) ? currentVal : '';
    }

    // Populate Teams
    const teamSelect = document.getElementById('team-select');
    if (teamSelect && Array.isArray(data.teams)) {
      const currentVal = getSelectedTeam() || restoredTeam;
      let opts = '<option value="">-- Select Team --</option>';
      data.teams.forEach((t) => {
        opts += `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
      });
      teamSelect.innerHTML = opts;
      teamSelect.value = optionExists(teamSelect, currentVal) ? currentVal : '';
      restoredTeam = teamSelect.value;
    }
  }

  async function handleSubmit() {
    const btn = document.getElementById('btn-submit');
    const team = getSelectedTeam();
    const judge = getSelectedJudge();
    if (!btn) return;

    // Judge is checked first: it is picked once at the start of a session, so an empty one
    // means the judge never set up this device and every run after it would be unattributed.
    if (!judge) {
      setSubmitStatus('Select a Judge before submitting.', 'error');
      const judgeSelect = document.getElementById('judge-select');
      if (judgeSelect) judgeSelect.focus();
      return;
    }

    if (!team) {
      setSubmitStatus('Select a Team ID before submitting.', 'error');
      const teamSelect = document.getElementById('team-select');
      if (teamSelect) teamSelect.focus();
      return;
    }

    const tryCount = getTryCount();
    if (tryCount === null) {
      setSubmitStatus('Enter a whole Try count from 0 to 99.', 'error');
      const other = document.getElementById('try-other');
      if (other) {
        other.setAttribute('aria-invalid', 'true');
        other.focus();
      }
      return;
    }

    const totalScore = getTotalScore();
    if (totalScore === 0 && !window.confirm('Total score is 0. Submit anyway?')) return;

    const missionTime = document.getElementById('mission-time') ? document.getElementById('mission-time').value.trim() : '';
    const deviceId = getOrCreateDeviceId();
    const sheetId = getActiveSheetId();

    btn.disabled = true;
    btn.textContent = 'Sending…';
    setSubmitStatus('', null);

    try {
      // Competition and level are not sent: one Sheet is one competition at one level, both
      // already in its Config tab, so a column would repeat them on every single row.
      const result = await SheetSubmit.submit({
        sheetId: sheetId,
        deviceId: deviceId,
        judge: judge,
        team: team,
        round: getCurrentRound(),
        totalScore: totalScore,
        missionTime: missionTime,
        tryCount: tryCount,
        scores: Object.assign({}, scoreState, leanbotState),
        photoBase64: currentPhotoDataUrl,
      });

      if (result.duplicate && !result.viaRetry) {
        setSubmitStatus('This run was already recorded.', 'ok');
      } else {
        const where = result.row ? ' - row ' + result.row : '';
        setSubmitStatus('Submitted "' + team + '"' + where + '. Cleared for next run.', 'ok');
      }
      clearForNextTeam();

    } catch (err) {
      const pending = pendingCount();
      if (pending > 0) {
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
    // Main block table click delegation
    const tbody = document.getElementById('table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;

        const blockId = tr.getAttribute('data-block');
        if (!blockId) return;

        const unselectTarget = e.target.closest('[data-action="unselect"]');
        if (unselectTarget) {
          handleRowClick(blockId, 'unselect', null);
          return;
        }

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

        const missionTarget = e.target.closest('.cell-clickable[data-type="crl"]');
        if (missionTarget) {
          handleLeanbotRowClick(botId, 'crl');
          return;
        }
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

    // One judge works the whole session, so their pick survives a reload of this device.
    const judgeSelect = document.getElementById('judge-select');
    if (judgeSelect) {
      judgeSelect.addEventListener('change', () => {
        try {
          localStorage.setItem(JUDGE_KEY, judgeSelect.value);
        } catch (e) {}
      });
    }

    const teamSelect = document.getElementById('team-select');
    if (teamSelect) {
      teamSelect.addEventListener('change', () => {
        const nextTeam = teamSelect.value;
        const selectedNewTeam = !!nextTeam && nextTeam !== restoredTeam;
        restoredTeam = nextTeam;

        if (selectedNewTeam) resetRunState();
        saveDraft();
      });
    }

    // Try buttons. Other reveals a number field and focuses it, which is what raises the
    // numeric keypad on a phone - the buttons alone never open one.
    const tryOptions = document.getElementById('try-options');
    if (tryOptions) {
      tryOptions.addEventListener('click', (e) => {
        const btn = e.target.closest('.try-btn');
        if (!btn) return;

        const other = document.getElementById('try-other');
        const hadTryError = other && other.getAttribute('aria-invalid') === 'true';
        const value = btn.getAttribute('data-try');
        tryIsOther = value === 'other';
        if (!tryIsOther) tryValue = Number(value);
        renderTryButtons();
        if (hadTryError && !tryIsOther) setSubmitStatus('', null);

        if (tryIsOther && other) {
          other.focus();
          other.select();
        }
        saveDraft();
      });
    }

    const tryOther = document.getElementById('try-other');
    if (tryOther) {
      tryOther.addEventListener('input', () => {
        const hadTryError = tryOther.getAttribute('aria-invalid') === 'true';
        tryOther.value = tryOther.value.replace(/\D/g, '').slice(0, 2);
        tryOther.removeAttribute('aria-invalid');
        if (hadTryError) setSubmitStatus('', null);
        saveDraft();
      });
    }

    // Mission Time: digits only, the mask puts the separators in.
    const timeInput = document.getElementById('mission-time');
    if (timeInput) {
      timeInput.addEventListener('input', () => {
        timeInput.value = formatMissionTime(timeInput.value);
        saveDraft();
      });
    }

    // Submit button
    const btnSubmit = document.getElementById('btn-submit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', handleSubmit);
    }

    window.addEventListener('online', () => flushQueue(false));

    // A phone that sat locked through the break comes back showing the round it left on.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderClock();
    });
  }

  function init() {
    const devId = getOrCreateDeviceId();
    const devDisplay = document.getElementById('device-id-display');
    if (devDisplay) devDisplay.textContent = devId;

    initScoreState();
    restoreDraft();
    renderTable();
    renderLevel();
    renderTryButtons();
    setupEvents();
    loadMetadata();
    flushQueue(true);

    if (!roundTicker) roundTicker = setInterval(renderClock, 20000);
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
