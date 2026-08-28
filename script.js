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
    { id: 'mystery', name: 'Mystery', rowClass: 'row-mystery' },
    { id: 'green', name: 'Green', rowClass: 'row-green' },
    { id: 'blue', name: 'Blue', rowClass: 'row-blue' },
    { id: 'purple', name: 'Purple', rowClass: 'row-purple' },
  ];

  const LEVELS = {
    explorer: ['red', 'yellow1', 'green', 'blue'],
    creator: ['red', 'yellow1', 'green', 'blue', 'purple'],
    innovator: ['red', 'yellow1', 'yellow2', 'green', 'blue', 'purple'],
    master: ['red', 'yellow1', 'yellow2', 'mystery', 'green', 'blue', 'purple'],
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

  const DRAFT_KEY_PREFIX = 'scoresheet.draft.';
  const CONFIG_KEY_PREFIX = 'scoresheet.config.';
  const HISTORY_KEY_PREFIX = 'scoresheet.history.';
  const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
  // Both copies are the same size, so the history copy only saves what the lower quality
  // saves - a fraction of what halving the edge used to. What keeps a long day of runs
  // from failing to save at all is writeSubmissionHistory_, which drops the oldest photo
  // and tries again whenever the store is full.
  const HISTORY_PHOTO_MAX_SIZE = 1280;
  const HISTORY_PHOTO_QUALITY = 0.6;
  const HISTORY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  const DEVICE_KEY = 'scoresheet.deviceId';
  const JUDGE_KEY = 'scoresheet.judgeName';
  const DEFAULT_MISSION_TIME = '2:00.00';
  // A run is two minutes. The box opens on the limit itself, which is why the two read
  // alike. The minute cap is separate and larger on purpose: it guards the shape of the
  // value rather than the rule, and outlives any change to how long a run lasts.
  const MISSION_TIME_LIMIT_MS = 120000;
  const MISSION_TIME_MAX_MINUTES = 59;
  // Always the last team on the list, whatever Config holds. A run under this name is a
  // pipeline check, so it is the one team allowed to submit before Round 1 opens.
  const TEST_TEAM = 'Test Submission';

  /**
   * Opened with no ?link=, the page has no Sheet behind it: Config is generated here from
   * the device clock, and Submit only writes this device's history. Nothing is ever sent.
   */
  const DEMO_SCOPE = 'demo';
  const DEMO_COMPETITION = 'Synapse City';
  const DEMO_LEVEL = 'master';
  const DEMO_JUDGES = ['Judge A', 'Judge B'];
  const DEMO_TEAMS = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5'];
  // Round 1 opens on the hour just gone, Round 2 an hour later, End an hour after that.
  // Held back from the end of the day so all three still land before midnight.
  const DEMO_LAST_START_HOUR = 21;

  const HISTORY_MISSION_NAMES = {
    containment: 'Containment',
    neutralization: 'Neutralization',
    analysis: 'Analysis'
  };

  // A status not listed here was sent and acknowledged, which needs no label of its own.
  const HISTORY_STATUS_LABELS = {
    sending: 'Sending',
    config: 'Config loaded',
    queued: 'Saved offline',
    failed: 'Not sent - still on this device',
    demo: 'Demo run - nothing was sent'
  };

  const HISTORY_STATUS_CLASSES = {
    sending: ' is-sending',
    config: ' is-config',
    queued: ' is-queued',
    failed: ' is-failed',
    demo: ' is-demo'
  };

  // One glyph per outcome, with the label a screen reader and a tooltip both read. Sending
  // is drawn by CSS as a turning ring, so it is the one state with no character of its own.
  const HISTORY_STATUS_ICONS = {
    sending: ['', 'Sending'],
    config: ['⚙', 'Config load'],
    queued: ['⧗', 'Saved offline'],
    failed: ['✕', 'Not sent'],
    demo: ['•', 'Demo run']
  };
  // Anything else reached the Sheet and was acknowledged.
  const HISTORY_STATUS_ICON_SENT = ['✓', 'Submitted'];

  // The Sheet decides the level, so this only ever changes from the Config tab.
  let activeLevel = 'creator';
  // Kept around because the round is re-derived from the clock on a timer, not rendered once.
  let competitionInfo = { competitionDate: '', rounds: [], endTime: '', level: '' };
  // Which Config the runs on this device belong to. Derived from whatever Config is applied
  // - cached copy or fresh fetch alike - so it is never stored and never goes stale.
  let configStamp = '';
  let roundTicker = null;
  // scoreState maps blockId to selected option: 'containment' | 'neutralization' | 'analysis' | null
  let scoreState = {};
  // leanbotState maps botId to boolean (checked for CRL)
  let leanbotState = {};
  // Compressed data URL of the mission photo, kept as the fallback the run can still carry
  let currentPhotoDataUrl = '';
  // Set once the photo has gone up on its own, ahead of the run that references it
  let currentPhotoId = '';
  let currentPhotoUrl = '';
  let currentPhotoUploadKb = 0;
  // The upload in flight, so Submit waits out what is left of it rather than starting over
  let currentPhotoUpload = null;
  // How long each step of this photo took. Kept on the run in History because the Logs tab
  // only ever sees the server's share, and the gap between the two is where the wait lives.
  let currentPhotoTiming = null;
  // Smaller copy of the same photo, the one that goes into this device's history
  let currentPhotoThumbUrl = '';
  // { width, height, bytes } for each of the two, measured once when the photo is taken
  let currentPhotoInfo = null;
  let currentPhotoThumbInfo = null;
  // A run always took at least one attempt, so the buttons start at 1 and so does the
  // count a fresh sheet carries.
  const DEFAULT_TRY = 1;
  const MAX_TRY_BUTTON = 4;
  // Try: the count the row means, kept in step with the box - typing 1-4 is the same
  // answer as tapping that button, so it lights up either way.
  let tryValue = DEFAULT_TRY;
  // Team options arrive with metadata, so keep the restored value until that list exists.
  let restoredTeam = '';
  // Every team in Config, and - where Config groups them - which judge each one belongs to.
  let allTeams = [];
  let teamRoster = null;
  // How many judges Config offers, which is what decides whether there is a choice to make.
  let judgeCount = 0;
  // A run that has been sent, or is on its way. Its numbers are frozen until another team
  // is picked, so what was submitted cannot quietly become something else.
  let runLocked = false;
  let historyCleanupTicker = null;
  let historyLastFocus = null;
  let timetableTicker = null;
  let timetableLastFocus = null;
  let errorLastFocus = null;
  let lastErrorReport = '';
  // One report per distinct fault. A ticker that throws would otherwise reopen the dialog
  // every second, and the judge only has to tell the organiser about it once.
  const reportedErrors = {};

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** What the base64 decodes to, which is what travels - not the length of the string. */
  function dataUrlBytes_(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    if (!base64) return 0;

    const padding = (base64.match(/=+$/) || [''])[0].length;
    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  }

  function formatBytes_(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';

    const kb = bytes / 1024;
    return kb < 1024 ? Math.round(kb) + ' KB' : (kb / 1024).toFixed(1) + ' MB';
  }

  /** '840 ms' below a second, '4.6 s' above it - nobody reads '4612 ms' as four seconds. */
  function formatDuration_(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value)) return '';

    return value < 1000 ? Math.round(value) + ' ms' : (value / 1000).toFixed(1) + ' s';
  }

  /** "1280 × 960 · 248 KB", or '' for a photo that was never measured. */
  function formatPhotoInfo_(info) {
    if (!info || !info.width || !info.height) return '';

    const size = formatBytes_(info.bytes);
    return info.width + ' × ' + info.height + (size ? ' · ' + size : '');
  }

  function errorMessageOf_(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.name ? err.name + ': ' + err.message : err.message);

    try {
      return JSON.stringify(err);
    } catch (e) {
      return String(err);
    }
  }

  /** Reads a value for the report without ever becoming the thing that fails. */
  function safely_(fn) {
    try {
      const value = fn();
      return value === undefined || value === null || value === '' ? '-' : String(value);
    } catch (e) {
      return '-';
    }
  }

  /**
   * V8 opens a stack with "Name: message"; Safari and Firefox start straight at the
   * frames, so put the message back when it is missing.
   */
  function stackTextOf_(err) {
    const stack = err && err.stack ? String(err.stack).trim() : '';
    if (!stack) return '';

    const message = errorMessageOf_(err);
    return stack.indexOf(message) === 0 ? stack : message + '\n' + stack;
  }

  /**
   * The trace as thrown, followed by every `cause` chained behind it. A thrown
   * non-Error carries no stack at all, so fall back to where it surfaced instead.
   */
  function buildStackSections_(err) {
    const sections = [];
    const seen = [];
    let current = err;

    while (current && typeof current === 'object' && seen.indexOf(current) === -1 && seen.length < 5) {
      seen.push(current);

      const text = stackTextOf_(current);
      if (text) sections.push((seen.length === 1 ? 'Stack:' : 'Caused by:') + '\n' + text);
      current = current.cause;
    }

    if (!sections.length) {
      const here = safely_(() => String(new Error('trace').stack || '').trim());
      if (here !== '-') sections.push('Stack (thrown value had none - this is where it surfaced):\n' + here);
    }

    return sections;
  }

  /** A cross-origin or parse error arrives with no Error object; keep the location. */
  function errorFromEvent_(e) {
    if (!e || !e.message) return e || 'Unknown error';

    const at = e.filename
      ? ' (' + e.filename + ':' + (e.lineno || '?') + ':' + (e.colno || '?') + ')'
      : '';
    return String(e.message) + at;
  }

  /**
   * Everything the organiser would otherwise have to ask for, in one block a judge can
   * screenshot: what broke, where, and which device and run it happened on.
   */
  function buildErrorReport_(context, err) {
    const now = new Date();

    const lines = [
      'When   : ' + now.toLocaleString(),
      'Where  : ' + context,
      'What   : ' + errorMessageOf_(err),
      '',
      'Device : ' + safely_(getOrCreateDeviceId),
      'Sheet  : ' + safely_(getStorageScope_),
      'Level  : ' + safely_(() => activeLevel),
      'Judge  : ' + safely_(getSelectedJudge),
      'Team ID: ' + safely_(getSelectedTeam),
      'Queued : ' + safely_(pendingCount),
      'Page   : ' + safely_(() => window.location.href),
      'Browser: ' + safely_(() => navigator.userAgent)
    ];

    // The whole trace, not just the top frames: the dialog scrolls, and a stack cut
    // short is the one thing an organiser cannot reconstruct after the fact.
    buildStackSections_(err).forEach((section) => lines.push('', section));
    return lines.join('\n');
  }

  function showError_(context, err) {
    try {
      const report = buildErrorReport_(context, err);
      // Same fault, same place - already reported.
      const key = context + '|' + errorMessageOf_(err);
      if (reportedErrors[key]) return;
      reportedErrors[key] = true;

      console.error('[' + context + ']', err);

      const modal = document.getElementById('error-modal');
      const detail = document.getElementById('error-detail');
      if (!modal || !detail) return;

      lastErrorReport = report;
      detail.textContent = report;

      // A dialog already up is answering an earlier fault; do not shove it aside.
      if (!modal.hidden) return;

      errorLastFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('error-modal-open');

      const close = document.getElementById('error-close');
      if (close) close.focus();
    } catch (e) {
      console.error('Could not report error:', e, err);
    }
  }

  function closeError_() {
    const modal = document.getElementById('error-modal');
    if (!modal || modal.hidden) return;

    modal.hidden = true;
    document.body.classList.remove('error-modal-open');
    if (errorLastFocus && typeof errorLastFocus.focus === 'function') errorLastFocus.focus();
    errorLastFocus = null;
  }

  /**
   * The venue often serves this over plain http on a LAN address, where the async clipboard
   * API does not exist, so the old selection copy is the one that has to work.
   */
  function copyErrorReport_() {
    const button = document.getElementById('error-copy');
    const done = (ok) => {
      if (!button) return;
      button.textContent = ok ? 'Copied' : 'Press and hold to copy';
      setTimeout(() => {
        if (button.textContent !== 'Copy') button.textContent = 'Copy';
      }, 2500);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(lastErrorReport).then(() => done(true), () => done(false));
      return;
    }

    try {
      const area = document.createElement('textarea');
      area.value = lastErrorReport;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, lastErrorReport.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  /** '' when the page was opened with no link at all - see isDemoMode_. */
  function getActiveSheetId() {
    const urlParams = new URLSearchParams(window.location.search);
    const link = urlParams.get('sheetId') || urlParams.get('sheet') || urlParams.get('link') || urlParams.get('id');
    if (!link) return '';
    const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    return link.trim();
  }

  /** No Sheet to open, so Config is generated locally and no run is ever sent. */
  function isDemoMode_() {
    return !getActiveSheetId();
  }

  /** Storage keys still need a name when there is no Sheet ID to use as one. */
  function getStorageScope_() {
    return getActiveSheetId() || DEMO_SCOPE;
  }

  function demoClock_(hour) {
    return String(hour).padStart(2, '0') + ':00:00';
  }

  /**
   * The same shape the Web App answers with, built here instead. The schedule is anchored
   * to the hour just gone so Round 1 is already open the moment the page loads: 11:16
   * gives 11:00, 12:00, 13:00.
   */
  function buildDemoConfig_() {
    const now = new Date();
    const two = (value) => String(value).padStart(2, '0');
    const start = Math.min(now.getHours(), DEMO_LAST_START_HOUR);

    return {
      ok: true,
      sheetId: '',
      competition: DEMO_COMPETITION,
      competitionDate: two(now.getDate()) + '/' + two(now.getMonth() + 1) + '/' + now.getFullYear(),
      rounds: [
        { round: 1, time: demoClock_(start) },
        { round: 2, time: demoClock_(start + 1) }
      ],
      endTime: demoClock_(start + 2),
      level: DEMO_LEVEL,
      judges: DEMO_JUDGES.slice(),
      teams: DEMO_TEAMS.slice()
    };
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
    return DRAFT_KEY_PREFIX + getStorageScope_();
  }

  function getConfigKey() {
    return CONFIG_KEY_PREFIX + getStorageScope_();
  }

  /** The last good Config answer for this Sheet, or null when there has never been one. */
  function readCachedConfig_() {
    try {
      const raw = localStorage.getItem(getConfigKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.ok ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeCachedConfig_(data) {
    try {
      localStorage.setItem(getConfigKey(), JSON.stringify(data));
    } catch (err) {
      console.warn('Could not cache Config:', err);
    }
  }

  function getHistoryKey() {
    return HISTORY_KEY_PREFIX + getStorageScope_();
  }

  function saveDraft() {
    const timeInput = document.getElementById('mission-time');
    const tryInput = document.getElementById('try-input');
    const selectedTeam = getSelectedTeam();

    try {
      localStorage.setItem(getDraftKey(), JSON.stringify({
        version: 1,
        level: activeLevel,
        team: selectedTeam || restoredTeam,
        missionTime: timeInput ? timeInput.value : '',
        tryValue: tryValue,
        tryTyped: tryInput ? tryInput.value : '',
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
    if (timeInput) timeInput.value = formatMissionTime(draft.missionTime || DEFAULT_MISSION_TIME);

    // A draft written before the buttons started at 1 can hold a 0, which no longer has a
    // button to restore it to.
    const savedTryValue = Number(draft.tryValue);
    tryValue = Number.isInteger(savedTryValue)
      && savedTryValue >= DEFAULT_TRY && savedTryValue <= MAX_TRY_BUTTON
      ? savedTryValue
      : DEFAULT_TRY;

    // Drafts written before the box replaced the Other button kept the typed count in
    // tryOther, and only meant it while tryIsOther was set - a leftover there belongs to
    // a button the judge picked afterwards, so reading it blind would change the count.
    const legacyTyped = draft.tryIsOther === true ? draft.tryOther : '';
    const tryInput = document.getElementById('try-input');
    if (tryInput) {
      tryInput.value = String(draft.tryTyped || legacyTyped || '').replace(/\D/g, '').slice(0, 2);
    }
    syncTryValueFromBox();
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

  /**
   * Photos are what fill the storage box, so a full store gives up the oldest one and
   * tries again - a run's scores are worth keeping even when its picture is not.
   */
  function writeSubmissionHistory_(entries) {
    let payload = entries;

    for (;;) {
      try {
        localStorage.setItem(getHistoryKey(), JSON.stringify(payload));
        return true;
      } catch (err) {
        // Entries run newest first, so the last one still holding a photo is the oldest.
        let dropIndex = -1;
        for (let i = payload.length - 1; i >= 0; i -= 1) {
          if (payload[i] && payload[i].photo) {
            dropIndex = i;
            break;
          }
        }

        if (dropIndex < 0) {
          console.warn('Could not save submission history:', err);
          return false;
        }

        payload = payload.slice();
        payload[dropIndex] = Object.assign({}, payload[dropIndex], { photo: '' });
      }
    }
  }

  /** Reads newest first and permanently removes records older than 24 hours. */
  function readSubmissionHistory_() {
    let parsed = [];
    let shouldRewrite = false;

    try {
      const raw = localStorage.getItem(getHistoryKey());
      parsed = raw ? JSON.parse(raw) : [];
    } catch (err) {
      parsed = [];
      shouldRewrite = true;
    }

    if (!Array.isArray(parsed)) {
      parsed = [];
      shouldRewrite = true;
    }

    const cutoff = Date.now() - HISTORY_TTL_MS;
    const fresh = parsed
      .filter((entry) => entry && Number(entry.submittedAt) >= cutoff)
      .sort((a, b) => Number(b.submittedAt) - Number(a.submittedAt));

    if (shouldRewrite || fresh.length !== parsed.length) writeSubmissionHistory_(fresh);
    return fresh;
  }

  function createSubmissionHistoryEntry_(submission) {
    const banner = document.getElementById('competition-banner');

    return {
      version: 1,
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
      submittedAt: Date.now(),
      status: '',
      row: '',
      submissionId: '',
      competition: banner ? banner.textContent.trim() : '',
      competitionDate: competitionInfo.competitionDate || '',
      // The Config this run was entered under. Once that Config is replaced the run stops
      // marking its team as submitted, though it stays in History as it was.
      configStamp: configStamp,
      sheetId: submission.sheetId,
      deviceId: submission.deviceId,
      level: activeLevel,
      judge: submission.judge,
      team: submission.team,
      round: submission.round,
      totalScore: submission.totalScore,
      missionTime: submission.missionTime,
      tryCount: submission.tryCount,
      scores: Object.assign({}, scoreState),
      leanbots: Object.assign({}, leanbotState),
      hasPhoto: !!(submission.photoBase64 || submission.photoUrl),
      photo: currentPhotoThumbUrl,
      photoInfo: currentPhotoInfo ? Object.assign({}, currentPhotoInfo) : null,
      photoPreview: currentPhotoThumbInfo ? Object.assign({}, currentPhotoThumbInfo) : null,
      // The photo half of the run. The submit half is not known yet and is patched in when
      // the request comes back.
      timing: currentPhotoTiming ? Object.assign({}, currentPhotoTiming) : {}
    };
  }

  /**
   * A Config load, filed alongside the runs.
   *
   * Not a run, but the same question is asked of both: how long did this device wait, and
   * when did it last talk to the Sheet. The second half answers "did you press Reload?"
   * without anyone having to remember.
   */
  function saveConfigHistoryEntry_(durationMs, data, err) {
    const banner = document.getElementById('competition-banner');

    const entry = {
      version: 1,
      kind: 'config',
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
      submittedAt: Date.now(),
      status: err ? 'failed' : 'config',
      competition: data && data.competition ? data.competition : (banner ? banner.textContent.trim() : ''),
      competitionDate: data && data.competitionDate ? data.competitionDate : '',
      level: data && data.level ? data.level : '',
      judgeCount: data && Array.isArray(data.judges) ? data.judges.length : 0,
      teamCount: data && Array.isArray(data.teams) ? data.teams.length : 0,
      grouped: !!(data && data.teamsByJudge),
      error: err ? errorMessageOf_(err) : '',
      timing: { configMs: durationMs }
    };

    const entries = readSubmissionHistory_();
    entries.unshift(entry);

    const saved = writeSubmissionHistory_(entries);
    renderSubmissionHistory_();
    return saved;
  }

  function saveSubmissionHistoryEntry_(entry, status, result) {
    const savedEntry = Object.assign({}, entry, {
      status: status,
      row: result && result.row ? result.row : '',
      submissionId: result && result.submissionId ? result.submissionId : ''
    });
    const entries = readSubmissionHistory_();
    entries.unshift(savedEntry);

    const saved = writeSubmissionHistory_(entries);
    renderSubmissionHistory_();
    return saved;
  }

  /**
   * Moves a run already on the list to what became of it, rather than adding a second row
   * for the same run. The record goes down before the network is touched, so every later
   * outcome - sent, queued, refused - is an edit to a line the judge can already see.
   */
  function updateSubmissionHistoryEntry_(id, status, result, timing) {
    const entries = readSubmissionHistory_();
    const index = entries.findIndex((item) => item && item.id === id);
    // Missing only when the first write was refused for space, and that was reported then.
    if (index < 0) return false;

    entries[index] = Object.assign({}, entries[index], {
      status: status,
      row: result && result.row ? result.row : entries[index].row,
      submissionId: result && result.submissionId ? result.submissionId : entries[index].submissionId,
      timing: Object.assign({}, entries[index].timing, timing)
    });

    const saved = writeSubmissionHistory_(entries);
    renderSubmissionHistory_();
    return saved;
  }

  function formatHistoryTimestamp_(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';

    const two = (value) => String(value).padStart(2, '0');
    return two(date.getDate()) + '/' + two(date.getMonth() + 1)
      + ' ' + two(date.getHours()) + ':' + two(date.getMinutes()) + ':' + two(date.getSeconds());
  }

  /** The list only ever holds the last 24 hours, so the row needs the clock, not the date. */
  function formatHistoryClock_(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';

    const two = (value) => String(value).padStart(2, '0');
    return two(date.getHours()) + ':' + two(date.getMinutes()) + ':' + two(date.getSeconds());
  }

  function renderSubmissionHistory_() {
    const body = document.getElementById('history-body');
    const empty = document.getElementById('history-empty');
    const tableWrap = document.getElementById('history-table-wrap');
    if (!body || !empty || !tableWrap) return;

    const entries = readSubmissionHistory_();
    empty.hidden = entries.length > 0;
    tableWrap.hidden = entries.length === 0;

    body.innerHTML = entries.map((entry) => {
      const status = HISTORY_STATUS_ICONS[entry.status] ? entry.status : 'submitted';
      const icon = HISTORY_STATUS_ICONS[entry.status] || HISTORY_STATUS_ICON_SENT;
      const statusClass = HISTORY_STATUS_CLASSES[entry.status] || '';
      const round = entry.round === '' || entry.round === undefined ? '-' : entry.round;
      const total = Number.isFinite(Number(entry.totalScore)) ? Number(entry.totalScore) : 0;
      const what = entry.kind === 'config' ? 'Config load' : (entry.team || 'submission');
      const label = 'View ' + String(what) + ' details';

      return '<tr class="history-entry' + statusClass + '" data-history-id="'
        + escapeHtml(entry.id || '') + '" tabindex="0" role="button" aria-label="'
        + escapeHtml(label) + '">'
        + '<td>' + escapeHtml(formatHistoryClock_(entry.submittedAt)) + '</td>'
        + '<td>' + escapeHtml(entry.kind === 'config' ? '-' : round) + '</td>'
        + '<td>' + escapeHtml(entry.kind === 'config' ? 'Config load' : (entry.team || '-')) + '</td>'
        + '<td>' + escapeHtml(entry.kind === 'config' ? '-' : total) + '</td>'
        + '<td><span class="history-status is-' + status + '" role="img" aria-label="'
        + escapeHtml(icon[1]) + '" title="' + escapeHtml(icon[1]) + '">' + icon[0]
        + '</span></td>'
        + '</tr>';
    }).join('');
  }

  function getHistoryMissionText_(blockId, missionType) {
    if (!missionType || !HISTORY_MISSION_NAMES[missionType]) return '-';
    return HISTORY_MISSION_NAMES[missionType] + ' (' + getMissionPoints(blockId, missionType) + ')';
  }

  /** Never hand an <img> a stored value that is not still a data: image of its own. */
  function getHistoryPhotoUrl_(entry) {
    const url = entry && typeof entry.photo === 'string' ? entry.photo : '';
    return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ? url : '';
  }

  /** A demo run has no Sheet behind it, so it can only report what this device holds. */
  function historyPhotoLabel_(entry, photoUrl) {
    if (!entry.hasPhoto) return 'None';
    if (entry.status === 'demo') return photoUrl ? 'Stored on this device' : 'Not kept';
    return photoUrl ? 'Included in Sheet submission' : 'In Sheet only';
  }

  /** A Config load has no mission table and no score, so it gets its own short panel. */
  function buildConfigDetails_(entry) {
    const timing = entry.timing && typeof entry.timing === 'object' ? entry.timing : {};
    const fields = [
      ['Loaded', formatHistoryTimestamp_(entry.submittedAt)],
      ['Status', entry.error ? 'Failed' : 'Config loaded'],
      ['Load Time', formatDuration_(timing.configMs)],
      ['Competition', entry.competition || '-'],
      ['Competition Date', entry.competitionDate || '-'],
      ['Level', entry.level || '-'],
      ['Judges', entry.judgeCount || 0],
      ['Team IDs', entry.teamCount || 0],
      // Whether Config groups teams under judges, which is what the scoresheet filters by.
      ['Grouped By Judge', entry.grouped ? 'Yes' : 'No']
    ];

    if (entry.error) fields.push(['Error', entry.error]);

    return '<div class="history-detail-grid">' + fields.map((field) => (
      '<div class="history-detail-field"><span>' + escapeHtml(field[0]) + '</span><strong>'
      + escapeHtml(field[1]) + '</strong></div>'
    )).join('') + '</div>';
  }

  function buildHistoryDetails_(entry) {
    if (entry.kind === 'config') return buildConfigDetails_(entry);

    const level = String(entry.level || '').toLowerCase();
    const blockIds = LEVELS[level] || ALL_BLOCKS.map((block) => block.id);
    const botIds = LEANBOT_LEVELS[level] || [];
    const savedScores = entry.scores && typeof entry.scores === 'object' ? entry.scores : {};
    const savedLeanbots = entry.leanbots && typeof entry.leanbots === 'object' ? entry.leanbots : {};
    const status = HISTORY_STATUS_LABELS[entry.status] || 'Submitted';
    const round = entry.round === '' || entry.round === undefined ? '-' : entry.round;
    // Older records, and any whose photo was dropped to make room, keep the flag but not the copy.
    const photoUrl = getHistoryPhotoUrl_(entry);

    // What the run was. How it got there is a table of its own at the bottom: that half is
    // diagnostic, and someone reading a score back should not have to read past four
    // durations and an id to find it.
    const fields = [
      ['Submitted', formatHistoryTimestamp_(entry.submittedAt)],
      ['Status', status],
      ['Competition', entry.competition || '-'],
      ['Competition Date', entry.competitionDate || '-'],
      ['Level', level || '-'],
      ['Judge', entry.judge || '-'],
      ['Team ID', entry.team || '-'],
      ['Round', round],
      ['Time', entry.missionTime || '-'],
      ['Try', entry.tryCount === undefined ? '-' : entry.tryCount],
      ['Total Score', Number.isFinite(Number(entry.totalScore)) ? Number(entry.totalScore) : 0],
      ['Photo', historyPhotoLabel_(entry, photoUrl)]
    ];

    // How the run got there. Every step the judge actually waited through, in the order
    // they happen, then what was sent and where it landed. The Logs tab on the Sheet
    // measures only the server's share of the last of these.
    //
    // Every row is always here, '-' when the step did not happen. A run with no photo did
    // not wait zero seconds for one, and a table that quietly loses rows is one nobody can
    // compare two runs with.
    const timing = entry.timing && typeof entry.timing === 'object' ? entry.timing : {};
    const tracking = [
      ['Photo Compress', formatDuration_(timing.compressMs)],
      ['Photo Upload', formatDuration_(timing.uploadMs)],
      ['Waited For Photo', formatDuration_(timing.waitMs)],
      ['Submit', formatDuration_(timing.submitMs)],
      // What went to the Sheet, which is not the smaller copy shown above it.
      ['Photo Size', formatPhotoInfo_(entry.photoInfo)],
      ['Sheet Row', entry.row],
      ['Submission ID', entry.submissionId]
    ];

    const trackingHtml = tracking.map((row) => (
      '<tr><td>' + escapeHtml(row[0]) + '</td><td>' + escapeHtml(row[1] || '-') + '</td></tr>'
    )).join('');

    const fieldHtml = fields.map((field) => (
      '<div class="history-detail-field"><span>' + escapeHtml(field[0]) + '</span><strong>'
      + escapeHtml(field[1]) + '</strong></div>'
    )).join('');

    const blockHtml = blockIds.map((blockId) => {
      const block = ALL_BLOCKS.find((item) => item.id === blockId);
      return '<tr><td>' + escapeHtml(block ? block.name : blockId) + '</td><td>'
        + escapeHtml(getHistoryMissionText_(blockId, savedScores[blockId])) + '</td></tr>';
    }).join('');

    const leanbotHtml = botIds.map((botId) => {
      const bot = ALL_LEANBOTS.find((item) => item.id === botId);
      const value = savedLeanbots[botId] ? 'CRL (' + POINTS.crl + ')' : '-';
      return '<tr><td>' + escapeHtml(bot ? bot.name : botId) + '</td><td>'
        + escapeHtml(value) + '</td></tr>';
    }).join('');

    const previewInfo = formatPhotoInfo_(entry.photoPreview);
    const photoHtml = photoUrl
      ? '<h3>Mission Photo</h3><div class="history-detail-photo"><img src="'
        + escapeHtml(photoUrl) + '" alt="Mission photo for '
        + escapeHtml(entry.team || 'this run') + '">'
        + (previewInfo
          ? '<p class="history-detail-photo-meta">Local copy · ' + escapeHtml(previewInfo) + '</p>'
          : '')
        + '</div>'
      : '';

    return '<div class="history-detail-grid">' + fieldHtml + '</div>'
      + '<h3>Mission Scores</h3>'
      + '<div class="history-detail-table-wrap"><table class="history-detail-table"><tbody>'
      + blockHtml + leanbotHtml + '</tbody></table></div>'
      + photoHtml
      + '<h3>Tracking</h3>'
      + '<div class="history-detail-table-wrap"><table class="history-detail-table"><tbody>'
      + trackingHtml + '</tbody></table></div>';
  }

  function openSubmissionHistory_(id) {
    const entry = readSubmissionHistory_().find((item) => item.id === id);
    const modal = document.getElementById('history-modal');
    const content = document.getElementById('history-detail-content');
    if (!entry || !modal || !content) {
      renderSubmissionHistory_();
      return;
    }

    historyLastFocus = document.activeElement;
    content.innerHTML = buildHistoryDetails_(entry);
    modal.hidden = false;
    document.body.classList.add('history-modal-open');

    const close = document.getElementById('history-close');
    if (close) close.focus();
  }

  function closeSubmissionHistory_() {
    const modal = document.getElementById('history-modal');
    if (!modal || modal.hidden) return;

    modal.hidden = true;
    document.body.classList.remove('history-modal-open');
    if (historyLastFocus && typeof historyLastFocus.focus === 'function') historyLastFocus.focus();
    historyLastFocus = null;
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
    currentPhotoThumbUrl = '';
    currentPhotoInfo = null;
    currentPhotoThumbInfo = null;
    currentPhotoId = '';
    currentPhotoUrl = '';
    currentPhotoUploadKb = 0;
    currentPhotoUpload = null;
    currentPhotoTiming = null;
    renderPhotoMeta_();
  }

  /**
   * Fired the moment the photo is ready, not when Submit is pressed. Creating the Drive
   * file costs about 2.4 seconds and does not depend on the score, so it belongs in the
   * minutes the judge spends scoring rather than in the wait after they finish.
   *
   * Never rejects: a failure here just leaves the run carrying the photo itself, which is
   * how it worked before this existed.
   */
  function startPhotoUpload_(dataUrl) {
    if (isDemoMode_()) return null;

    const startedAt = Date.now();
    return SheetSubmit.uploadPhoto(getActiveSheetId(), dataUrl)
      .then((stored) => {
        currentPhotoId = stored.photoId;
        currentPhotoUrl = stored.photoUrl;
        currentPhotoUploadKb = stored.photoSizeKb;
        if (currentPhotoTiming) currentPhotoTiming.uploadMs = Date.now() - startedAt;
      })
      .catch(() => {
        currentPhotoId = '';
        currentPhotoUrl = '';
        currentPhotoUploadKb = 0;
        // Recorded even so: how long it took to fail is worth as much as how long it took.
        if (currentPhotoTiming) currentPhotoTiming.uploadMs = Date.now() - startedAt;
      });
  }

  function renderPhotoMeta_() {
    const el = document.getElementById('photo-meta');
    if (el) el.textContent = formatPhotoInfo_(currentPhotoInfo);
  }

  /**
   * Takes the camera File, or a data URL already produced by this same function, and
   * resolves { dataUrl, width, height, bytes } - the canvas already knows the size it
   * wrote, so measuring here costs nothing and saves decoding the result again to ask.
   */
  /**
   * WebP writes the same picture in appreciably fewer bytes where the browser can encode
   * it. Where it cannot, toDataURL returns PNG and says nothing about it - and a PNG here
   * would be several times the JPEG it replaced. Reading the type back off the result is
   * the documented way to tell, so ask a one-pixel canvas once and take JPEG wherever the
   * answer is no. Safari is the one to watch: it displays WebP but has long been unable to
   * write it, so an iPad stays on JPEG and nothing about that needs handling here.
   */
  let webpEncoding = null;

  function photoMimeType_() {
    if (webpEncoding === null) {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      webpEncoding = probe.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }
    return webpEncoding ? 'image/webp' : 'image/jpeg';
  }

  function compressImage(source, maxSize = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const isFile = typeof source !== 'string';
      const src = isFile ? URL.createObjectURL(source) : source;
      const release = () => {
        if (isFile) URL.revokeObjectURL(src);
      };
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        release();

        const dataUrl = canvas.toDataURL(photoMimeType_(), quality);
        resolve({
          dataUrl: dataUrl,
          width: canvas.width,
          height: canvas.height,
          bytes: dataUrlBytes_(dataUrl)
        });
      };

      img.onerror = () => {
        release();
        reject(new Error('Could not read the photo'));
      };

      img.src = src;
    });
  }

  /**
   * Build the stopwatch value from left to right as the judge types: 1, 1:2, 1:23,
   * 1:23.4, 1:23.45. Separators are display-only, so pasted/formatted values normalize too.
   */
  /**
   * '' when the field holds a usable mission time, otherwise the reason it does not.
   *
   * The mask guarantees the shape and nothing else: '2:75.00' types perfectly cleanly and
   * is not a time, and neither is anything past the two minutes a run is allowed. Both are
   * caught here rather than at the Sheet, where a bad value is already a row.
   *
   * Hundredths may be missing or half-typed; '1:30' is a whole answer and is treated as
   * one. Seconds may not - a two-digit seconds field is what makes the value readable.
   */
  function missionTimeError_(value) {
    const match = /^(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
    if (!match) return 'Time must be written m:ss.ss.';

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (minutes > MISSION_TIME_MAX_MINUTES) {
      return 'Minutes must be ' + MISSION_TIME_MAX_MINUTES + ' or less.';
    }
    if (seconds > 59) return 'Seconds must be 59 or less.';

    // '.5' is five tenths, so half a second, not five hundredths of one.
    const hundredths = Number((match[3] || '0').padEnd(2, '0'));
    if (minutes * 60000 + seconds * 1000 + hundredths * 10 > MISSION_TIME_LIMIT_MS) {
      return 'Time cannot pass ' + DEFAULT_MISSION_TIME + '.';
    }

    return '';
  }

  /** Red on the field, or not, from one place - three callers ask the same question. */
  function markMissionTime_(input) {
    if (!input) return '';

    const error = missionTimeError_(input.value);
    if (error) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');

    return error;
  }

  function formatMissionTime(raw) {
    const digits = String(raw).replace(/[^0-9]/g, '').slice(0, 5);
    if (!digits) return '';
    if (digits.length === 1) return digits;
    if (digits.length <= 3) return digits.slice(0, 1) + ':' + digits.slice(1);

    return digits.slice(0, 1) + ':' + digits.slice(1, 3) + '.' + digits.slice(3);
  }

  function renderTryButtons() {
    const group = document.getElementById('try-options');
    const boxActive = tryUsesTextInput() || tryBoxHasFocus();
    const lit = tryMatchesButton() && !boxActive;
    if (group) {
      group.querySelectorAll('.try-btn').forEach((btn) => {
        const active = lit && btn.getAttribute('data-try') === String(tryValue);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }

    const input = document.getElementById('try-input');
    if (input) input.classList.toggle('active', boxActive);
  }

  function getTypedTry() {
    const input = document.getElementById('try-input');
    return input ? input.value.trim() : '';
  }

  /** A typed count above 4 has no button to light; every other valid state has one. */
  function tryMatchesButton() {
    const typed = getTypedTry();
    if (!typed) return true;

    const n = Number(typed);
    return Number.isInteger(n) && n >= DEFAULT_TRY && n <= MAX_TRY_BUTTON;
  }

  function tryUsesTextInput() {
    const typed = getTypedTry();
    if (!/^\d{1,2}$/.test(typed)) return false;
    return Number(typed) > MAX_TRY_BUTTON;
  }

  /** Tapping the box is already the answer "not one of these four", so it lights up
   *  on focus instead of waiting for the count to be typed. */
  function tryBoxHasFocus() {
    const input = document.getElementById('try-input');
    return !!input && document.activeElement === input;
  }

  /** Typing 1-4 is the same answer as tapping that button, so the two never drift apart. */
  function syncTryValueFromBox() {
    const typed = getTypedTry();
    if (typed !== '' && tryMatchesButton()) tryValue = Number(typed);
  }

  /** Read at submit time rather than tracked on every keystroke, so there is one truth. */
  function getTryCount() {
    const raw = getTypedTry();
    if (!raw) return tryValue;
    if (!/^\d{1,2}$/.test(raw)) return null;

    // 0 has no button and no meaning now: a run that happened was attempted at least once.
    const typed = Number(raw);
    return Number.isInteger(typed) && typed >= DEFAULT_TRY && typed <= 99 ? typed : null;
  }

  function resetTry() {
    tryValue = DEFAULT_TRY;

    const input = document.getElementById('try-input');
    if (input) {
      input.value = '';
      input.removeAttribute('aria-invalid');
    }
    renderTryButtons();
  }

  function pendingCount() {
    return typeof SheetSubmit === 'undefined' ? 0 : SheetSubmit.pending();
  }

  /**
   * ' - 4820 ms', appended to whatever the submit ended up saying.
   *
   * The Logs tab measures the server only: its Total is fixed before the run has written
   * its log row, produced a response, or answered the redirect Apps Script replies with,
   * and it never sees the upload at all. This is the number the judge actually waits
   * through, so the gap between the two is where all of that lives.
   */
  function elapsedNote_(sentAt) {
    return ' - ' + (Date.now() - sentAt) + ' ms';
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
    if (timeInput) {
      timeInput.value = DEFAULT_MISSION_TIME;
      timeInput.removeAttribute('aria-invalid');
    }
    resetTry();

    initScoreState();
    clearPhoto();
    renderTable();
  }

  function setConfigLoadingState(message, tone) {
    const app = document.getElementById('scoresheet-app');
    const status = document.getElementById('config-loading');
    const text = document.getElementById('config-loading-text');
    const isLoading = !!message;

    if (app) app.classList.toggle('is-config-loading', isLoading);
    if (!status) return;

    if (text) text.textContent = message || '';
    status.className = 'config-loading' + (tone ? ' is-' + tone : '');
  }

  /**
   * Label, colour, and whether the button can be pressed - one state, one place.
   *
   * This replaced a modal over the whole page. The modal said only that something was
   * happening; the button says what, where the judge is already looking, and leaves the
   * run visible behind it so the numbers just sent can be read back.
   */
  const SUBMIT_BUTTON_STATES = {
    idle: ['Submit', ''],
    sending: ['Submitting …', ' is-sending'],
    done: ['Submitted', ' is-done'],
    queued: ['Saved Offline', ' is-queued'],
    failed: ['Failed to Submit', ' is-failed']
  };

  function setSubmitButtonState_(state) {
    const btn = document.getElementById('btn-submit');
    if (!btn) return;

    const spec = SUBMIT_BUTTON_STATES[state] || SUBMIT_BUTTON_STATES.idle;
    btn.textContent = spec[0];
    btn.className = 'btn-submit' + spec[1];
    // Nothing left to press while a run is in flight or already recorded. A failed one is
    // the opposite: the retry is the whole point of showing it.
    btn.disabled = state === 'sending' || state === 'done' || state === 'queued';
  }

  /**
   * Where every path out of a send ends.
   *
   * A run that reached somewhere - the Sheet or the offline queue - stays frozen until
   * another team is picked. A failed one unfreezes on the spot, because fixing it is the
   * only thing left to do with it.
   */
  function finishSubmit_(state) {
    runLocked = state !== 'failed';
    setSubmitButtonState_(state);
    applyFormLocks_();
  }

  /** The way back to a blank run: the freeze lifts and the button forgets the last one. */
  function unlockRun_() {
    runLocked = false;
    setSubmitButtonState_('idle');
    setSubmitStatus('', null);
    applyFormLocks_();
  }

  /**
   * Judges, teams, level and schedule are set before the competition and do not move during
   * it, so the first answer is kept and every later page load reads it off the device. That
   * is one request per device per competition instead of one per reload, and it is also
   * what lets a phone that lost signal still open the scoresheet. Reload Config is the one
   * thing that goes back to the Sheet, and the judge decides when the copy is stale.
   */
  async function loadMetadata(force) {
    // Nothing to fetch, and nothing to cache either: the schedule is read off the clock,
    // so a stored copy would freeze it at whatever hour it was first built.
    if (isDemoMode_()) {
      applyMetadata(buildDemoConfig_());
      setConfigLoadingState('', null);
      return true;
    }

    const sheetId = getActiveSheetId();

    // Update View Submission link
    const viewLink = document.getElementById('view-submission-link');
    if (viewLink) {
      viewLink.href = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    }

    if (!force) {
      const cached = readCachedConfig_();
      if (cached) {
        applyMetadata(cached);
        setConfigLoadingState('', null);
        return true;
      }
    }

    // Measured around the request alone, so it lines up with the server's own Config total
    // in the Logs tab and the gap between them means the same thing it does for a submit.
    const startedAt = Date.now();

    try {
      const data = await SheetSubmit.fetchMetadata(sheetId);
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Invalid Config response');

      writeCachedConfig_(data);
      applyMetadata(data);
      saveConfigHistoryEntry_(Date.now() - startedAt, data, null);
      setConfigLoadingState('', null);
      return true;
    } catch (err) {
      saveConfigHistoryEntry_(Date.now() - startedAt, null, err);
      showError_('Loading Config', err);
      // A failed reload leaves the Config already on screen alone. Only a cold start with
      // nothing to show has to stay behind the loading card.
      if (!force) setConfigLoadingState('Could not load Config. Please reload.', 'error');
      return false;
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

  function getConfiguredSchedule() {
    const rounds = (competitionInfo.rounds || [])
      .map((r) => ({ round: Number(r.round), time: r.time, seconds: parseConfigTime(r.time) }))
      .filter((r) => (r.round === 1 || r.round === 2) && r.seconds !== null)
      .sort((a, b) => a.round - b.round);
    const round1 = rounds.find((r) => r.round === 1);
    const round2 = rounds.find((r) => r.round === 2);
    const endSeconds = parseConfigTime(competitionInfo.endTime);
    const valid = !!round1 && !!round2 && endSeconds !== null
      && round1.seconds < round2.seconds && round2.seconds < endSeconds;

    return { rounds: rounds, round1: round1, round2: round2, endSeconds: endSeconds, valid: valid };
  }

  /**
   * Config gives times of day, not instants. Placing them on the competition date is what
   * lets a page opened the day before read "Start at ..." instead of jumping to the last
   * round. The badge and the schedule share this so the two can never disagree.
   */
  function getScheduleMidnight_(now) {
    const date = parseConfigDate(competitionInfo.competitionDate);
    return date
      ? new Date(date[0], date[1], date[2]).getTime()
      : new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  /** The clock picks one of the two fixed rounds, and End Time closes the schedule. */
  function resolveRound(now) {
    const schedule = getConfiguredSchedule();
    if (!schedule.valid) return null;

    const midnight = getScheduleMidnight_(now);

    const ended = now.getTime() >= midnight + schedule.endSeconds * 1000;
    if (ended) return { current: null, first: schedule.round1, ended: true };

    let current = null;
    schedule.rounds.forEach((r) => {
      if (now.getTime() >= midnight + r.seconds * 1000) current = r;
    });

    return { current: current, first: schedule.round1, ended: false };
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

  function setTimetableValue_(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '-';
  }

  function formatCurrentTime_(now) {
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }

  /** The three fixed milestones, in the order they happen. */
  function getScheduleMilestones_() {
    const rounds = Array.isArray(competitionInfo.rounds) ? competitionInfo.rounds : [];
    const round1 = rounds.find((item) => Number(item.round) === 1);
    const round2 = rounds.find((item) => Number(item.round) === 2);

    return [
      { label: 'Round 1', time: round1 && round1.time },
      { label: 'Round 2', time: round2 && round2.time },
      { label: 'End', time: competitionInfo.endTime }
    ];
  }

  function timetableRow_(label, value, stateClass) {
    return '<tr class="timetable-row' + (stateClass ? ' ' + stateClass : '') + '">'
      + '<th scope="row">' + escapeHtml(label) + '</th>'
      + '<td>' + escapeHtml(value || '-') + '</td></tr>';
  }

  /**
   * Rebuilt whole on every tick rather than patched cell by cell, because Current Time is
   * a row of its own that slides down the list as milestones pass - the schedule then
   * reads top to bottom as a timeline, with everything above it behind and below ahead.
   */
  function renderTimetable_() {
    const modal = document.getElementById('timetable-modal');
    const body = document.getElementById('timetable-body');
    if (!modal || modal.hidden || !body) return;

    const now = new Date();
    setTimetableValue_('timetable-date', competitionInfo.competitionDate);

    const milestones = getScheduleMilestones_();
    // Only a complete, in-order schedule can say what is behind, running, or still ahead.
    const ordered = getConfiguredSchedule().valid;
    const midnight = getScheduleMidnight_(now);
    const passed = ordered
      ? milestones.filter((item) => now.getTime() >= midnight + parseConfigTime(item.time) * 1000).length
      : 0;
    const finished = ordered && passed >= milestones.length;

    const rows = milestones.map((item, index) => {
      if (!ordered) return timetableRow_(item.label, item.time, '');
      // End is a boundary, never a round in progress, so it goes straight from ahead to behind.
      if (finished || index < passed - 1) return timetableRow_(item.label, item.time, 'is-done');
      if (index === passed - 1) return timetableRow_(item.label, item.time, 'is-active');
      return timetableRow_(item.label, item.time, 'is-upcoming');
    });

    rows.splice(passed, 0, timetableRow_('Current Time', formatCurrentTime_(now), 'is-now'));
    body.innerHTML = rows.join('');
  }

  function openTimetable_() {
    const modal = document.getElementById('timetable-modal');
    const trigger = document.getElementById('meta-round');
    if (!modal) return;

    timetableLastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('timetable-modal-open');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    renderTimetable_();

    if (!timetableTicker) timetableTicker = setInterval(renderTimetable_, 1000);
    const close = document.getElementById('timetable-close');
    if (close) close.focus();
  }

  function closeTimetable_() {
    const modal = document.getElementById('timetable-modal');
    if (!modal || modal.hidden) return;

    modal.hidden = true;
    document.body.classList.remove('timetable-modal-open');
    const trigger = document.getElementById('meta-round');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (timetableTicker) {
      clearInterval(timetableTicker);
      timetableTicker = null;
    }
    if (timetableLastFocus && typeof timetableLastFocus.focus === 'function') timetableLastFocus.focus();
    timetableLastFocus = null;
  }

  function isCompetitionDate(now, expected) {
    return now.getFullYear() === expected[0]
      && now.getMonth() === expected[1]
      && now.getDate() === expected[2];
  }

  function getCompetitionDateError() {
    return 'Error: Competition setup for ' + competitionInfo.competitionDate;
  }

  /**
   * The round is read off the device clock, so a tablet left on the wrong date reports a
   * wrong round and says nothing about it. Putting the error where the date belongs makes
   * that impossible to miss; Submit also uses the same date check and blocks the run until
   * the device clock is corrected.
   */
  function renderCompetitionDate() {
    const el = document.getElementById('meta-date');
    if (!el) return;

    const expected = parseConfigDate(competitionInfo.competitionDate);
    const wrongDate = !!expected && !isCompetitionDate(new Date(), expected);

    // A date this cannot parse still goes up as typed; only the clock check reports here.
    el.textContent = wrongDate ? getCompetitionDateError() : competitionInfo.competitionDate;
    el.classList.toggle('is-error', wrongDate);
  }

  function renderClock() {
    renderRound();
    renderCompetitionDate();
    renderTimetable_();
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

    renderClock();
  }

  /** One Sheet ID means one level, so this is the only thing that can change it. */
  function applyConfiguredLevel(level) {
    const key = String(level || '').toLowerCase();
    if (!LEVELS[key]) return;
    if (key === activeLevel) {
      renderLevel();
      return;
    }
    // Switching level rebuilds the block list, which would throw away a run in progress.
    if (getTotalScore() > 0) {
      renderLevel();
      return;
    }

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
    // First, because renderTeamOptions_ at the bottom of this reads it to decide which
    // teams still count as submitted.
    configStamp = hashText_(configFingerprint_(data));

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

      const onlyJudge = data.judges.length === 1 ? String(data.judges[0]).trim() : '';
      judgeSelect.value = onlyJudge || (optionExists(judgeSelect, currentVal) ? currentVal : '');

      // A competition with one judge has no choice to make. Select that judge immediately
      // and remember it just like a manual selection, so refreshes keep the same state.
      if (onlyJudge) {
        try {
          localStorage.setItem(JUDGE_KEY, onlyJudge);
        } catch (e) {}
      }
    }

    // Teams come from the judge, so they are filled in after the judge above is settled.
    allTeams = Array.isArray(data.teams) ? data.teams : [];
    teamRoster = data.teamsByJudge && typeof data.teamsByJudge === 'object'
      ? data.teamsByJudge
      : null;
    judgeCount = Array.isArray(data.judges) ? data.judges.length : 0;
    renderTeamOptions_();
    applyFormLocks_();
  }

  /**
   * Which teams this judge may score. A grouped Config answers with their own list and
   * nothing else, so picking the wrong judge cannot put a run under the wrong team; a flat
   * one has no opinion and gives everyone the same list, the way it always did.
   *
   * With grouping on and no judge chosen yet there is nothing truthful to offer, so the
   * list stays empty until one is.
   */
  function teamsForJudge_(judge) {
    if (!teamRoster) return allTeams;
    if (!judge) return [];

    return Array.isArray(teamRoster[judge]) ? teamRoster[judge] : [];
  }

  /**
   * A signature of the Config a run was entered under.
   *
   * Built from named fields rather than from the whole reply, so a field the server adds
   * later cannot look like a Config change on every device at once. Order counts: a
   * reordered judge list is a different Config, and treating a real edit as noise is the
   * worse mistake of the two.
   *
   * Demo mode builds its schedule off the clock, so every load there is a new Config and
   * the marks start clean. That is what a demo wants anyway.
   */
  function configFingerprint_(data) {
    const d = data || {};
    const list = (value) => (Array.isArray(value) ? value : []).join(',');

    const rounds = (Array.isArray(d.rounds) ? d.rounds : [])
      .map((r) => r.round + '@' + r.time)
      .join(',');

    const grouped = d.teamsByJudge && typeof d.teamsByJudge === 'object'
      ? Object.keys(d.teamsByJudge).sort()
          .map((judge) => judge + ':' + list(d.teamsByJudge[judge]))
          .join(';')
      : '';

    return [
      d.competition || '', d.competitionDate || '', d.level || '', d.endTime || '',
      rounds, list(d.judges), list(d.teams), grouped
    ].join('|');
  }

  /** djb2. Every history entry carries this, and they carry photos too - keep it short. */
  function hashText_(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  }

  /**
   * Teams this device has already scored in the round now running.
   *
   * Scoped to the round on purpose: a team scores once per round, so without the scope
   * every team would be marked from Round 2 onward and the warning would mean nothing.
   * A run that failed to send is not counted - that one still has to be done. Nor is the
   * test team, which exists to be submitted over and over.
   *
   * Nor is a run entered under a different Config. The mark answers "has this team been
   * scored", and once the roster or the schedule has been replaced the old answer is about
   * a different competition - C2 in the Config that was is not C2 in the Config that is.
   * Reloading a Config that has not changed produces the same signature and changes nothing,
   * which is the point: the reset follows the edit, not the button.
   *
   * The run itself is untouched and stays in History either way. Only the mark is dropped.
   */
  function submittedTeamsThisRound_() {
    const done = {};
    const state = resolveRound(new Date());
    const round = state && state.current ? String(state.current.round) : '';
    if (!round) return done;

    readSubmissionHistory_().forEach((entry) => {
      if (!entry || entry.status === 'failed') return;
      // Entries written before this field existed carry undefined and no longer mark: what
      // Config they were made under is not known, and guessing would be worse.
      if (entry.configStamp !== configStamp) return;
      if (String(entry.round) !== round) return;
      if (entry.team && entry.team !== TEST_TEAM) done[entry.team] = true;
    });

    return done;
  }

  /**
   * Rebuilt whenever the judge changes, keeping the current pick only if it survives.
   *
   * The test team heads the list and stands in for the old "-- Select Team ID --" row, so
   * the option sitting there by default is the one run that changes no standings.
   *
   * That does trade one guard for another. There is no longer an empty pick for Submit to
   * refuse, so a judge who forgets the team files a test run instead of being stopped - and
   * a test run is harmless, where the old blank was merely loud.
   */
  function renderTeamOptions_() {
    const teamSelect = document.getElementById('team-select');
    if (!teamSelect) return;

    const currentVal = getSelectedTeam() || restoredTeam;
    // Put in here rather than listed in Config, so every copy has it and no judge lacks it.
    const teams = [TEST_TEAM].concat(
      teamsForJudge_(getSelectedJudge()).filter((t) => t !== TEST_TEAM)
    );

    // The suffix is on the label only. The value stays the bare team, so nothing further
    // down - draft, history, the row on the Sheet - ever sees it.
    const submitted = submittedTeamsThisRound_();
    let opts = '';
    teams.forEach((t) => {
      const label = submitted[t] ? t + ' - submitted' : t;
      opts += `<option value="${escapeHtml(t)}">${escapeHtml(label)}</option>`;
    });
    teamSelect.innerHTML = opts;
    // No blank row left to fall back on, so an unknown pick lands on the test team rather
    // than on selectedIndex -1, which shows an empty box that cannot be explained.
    teamSelect.value = optionExists(teamSelect, currentVal) ? currentVal : TEST_TEAM;
    restoredTeam = teamSelect.value;
  }

  // Everything a run is entered into. The Judge select and Reload Config are deliberately
  // outside it - one is how you get past the gate - and so is History, which is a record of
  // runs already made rather than part of making one.
  const JUDGE_GATE_SECTIONS = '.run-entry-panel, .table-wrap, .score-action-bar, .submit-section';
  // What a sent run freezes: everything the run consisted of. Team is pointedly not here -
  // picking another one is the way out - and neither is Submit, which reports the outcome.
  const RUN_LOCK_SECTIONS =
    '.entry-row-time, .entry-row-try, .table-wrap, .score-action-bar, .photo-preview-container';

  /**
   * Both locks on the run form, applied together.
   *
   * The judge gate holds until a judge is picked, and only where there is a pick to make:
   * one judge is filled in automatically by applyMetadata, and the teams below belong to
   * whichever judge is chosen, so scoring before that is scoring against an empty list.
   * The run lock holds from Submit until another team is picked.
   *
   * Classes and `inert` rather than `disabled` on each control. The submit flow already
   * owns `disabled` on the Submit button, and two owners of one property is how a button
   * ends up stuck off after an error.
   */
  function applyFormLocks_() {
    const judgeLocked = judgeCount > 1 && !getSelectedJudge();

    setSectionLock_(JUDGE_GATE_SECTIONS, 'is-judge-locked', judgeLocked);
    setSectionLock_(RUN_LOCK_SECTIONS, 'is-run-locked', runLocked);

    // The two selectors overlap on the score tables and the photo bar, and `inert` is one
    // attribute. Read back off the classes so it answers to both locks rather than to
    // whichever of them was applied second.
    document.querySelectorAll(JUDGE_GATE_SECTIONS + ', ' + RUN_LOCK_SECTIONS).forEach((el) => {
      const off = el.classList.contains('is-judge-locked') || el.classList.contains('is-run-locked');
      // pointer-events in the stylesheet stops taps; this is what stops the keyboard and
      // takes the locked controls out of the accessibility tree with them.
      if (off) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });

    const hint = document.getElementById('judge-gate-hint');
    if (hint) hint.hidden = !judgeLocked;
  }

  function setSectionLock_(selector, className, on) {
    document.querySelectorAll(selector).forEach((el) => el.classList.toggle(className, on));
  }

  function validateSubmission(now) {
    const reasons = [];
    let focusTarget = null;
    let round = '';

    // Read before the schedule check: a test run is the one that may go outside the rounds.
    const team = getSelectedTeam();
    const isTestRun = team === TEST_TEAM;

    const expectedDate = parseConfigDate(competitionInfo.competitionDate);
    const schedule = getConfiguredSchedule();
    if (!expectedDate || !schedule.valid) {
      reasons.push('Competition date or schedule is missing or invalid.');
    } else if (!isCompetitionDate(now, expectedDate)) {
      reasons.push(getCompetitionDateError());
    } else {
      const state = resolveRound(now);
      if (state.ended && !isTestRun) {
        reasons.push('End Time ' + competitionInfo.endTime + ' has passed.');
      } else if (state.current) {
        round = state.current.round;
      } else if (!isTestRun) {
        reasons.push('Round 1 has not started. Start time is ' + schedule.round1.time + '.');
      }
      // A test run outside the rounds - before Round 1, or after End Time - leaves Round
      // blank. There is no round to name, and a row with no round is one the ranking skips,
      // so the pipeline stays testable at either end of the day without touching the
      // standings. The date is still checked: a test is for today's event, not any day.
    }

    const judge = getSelectedJudge();
    if (!judge) {
      reasons.push('Judge is required.');
      focusTarget = document.getElementById('judge-select');
    }

    if (!team) {
      reasons.push('Team ID is required.');
      if (!focusTarget) focusTarget = document.getElementById('team-select');
    }

    const timeInput = document.getElementById('mission-time');
    let missionTime = timeInput ? timeInput.value.trim() : '';
    if (!missionTime) {
      missionTime = DEFAULT_MISSION_TIME;
      if (timeInput) {
        timeInput.value = DEFAULT_MISSION_TIME;
        timeInput.removeAttribute('aria-invalid');
      }
    }

    const timeError = markMissionTime_(timeInput);
    if (timeError) {
      reasons.push(timeError);
      if (!focusTarget) focusTarget = timeInput;
    }

    const tryCount = getTryCount();
    if (tryCount === null) {
      reasons.push('Try must be a whole number from 1 to 99.');
      const input = document.getElementById('try-input');
      if (input) input.setAttribute('aria-invalid', 'true');
      if (!focusTarget) focusTarget = input;
    }

    return {
      reasons: reasons,
      focusTarget: focusTarget,
      judge: judge,
      team: team,
      missionTime: missionTime,
      tryCount: tryCount,
      round: round,
    };
  }

  function showSubmitBlocked(validation) {
    const message = 'Cannot submit:\n\n'
      + validation.reasons.map((reason) => '• ' + reason).join('\n');
    window.alert(message);
    setSubmitStatus(validation.reasons[0], 'error');
    if (validation.focusTarget) validation.focusTarget.focus();
  }

  async function handleSubmit() {
    const btn = document.getElementById('btn-submit');
    if (!btn) return;

    const validation = validateSubmission(new Date());
    if (validation.reasons.length > 0) {
      showSubmitBlocked(validation);
      return;
    }

    const totalScore = getTotalScore();
    if (totalScore === 0 && !window.confirm('Total score is 0. Submit anyway?')) return;

    // Set before the photo wait below, not after it. That wait used to be covered by the
    // modal; the button is what covers it now, so it has to be yellow before it starts.
    runLocked = true;
    setSubmitButtonState_('sending');
    applyFormLocks_();
    setSubmitStatus('', null);

    // Usually finished long ago, while the judge was still scoring; this waits out only
    // whatever is left of it.
    const photoWaitAt = Date.now();
    const hadPhotoUpload = !!currentPhotoUpload;
    if (currentPhotoUpload) await currentPhotoUpload;
    // Nearly always nothing. A number here means the judge finished scoring before Drive
    // finished storing, which is the one case the pre-upload cannot help with. Left off the
    // record entirely for a run with no photo, where a zero would say nothing.
    const photoWait = hadPhotoUpload ? { waitMs: Date.now() - photoWaitAt } : {};

    const deviceId = getOrCreateDeviceId();
    const sheetId = getActiveSheetId();
    const submission = {
      sheetId: sheetId,
      deviceId: deviceId,
      judge: validation.judge,
      team: validation.team,
      round: validation.round,
      totalScore: totalScore,
      missionTime: validation.missionTime,
      tryCount: validation.tryCount,
      scores: Object.assign({}, scoreState, leanbotState),
      photoId: currentPhotoId,
      photoUrl: currentPhotoUrl,
      photoSizeKb: currentPhotoUrl ? currentPhotoUploadKb : 0,
      // Only sent when the photo never made it up on its own - half a megabyte the server
      // would otherwise have to take delivery of while the judge waits.
      photoBase64: currentPhotoUrl ? '' : currentPhotoDataUrl,
    };
    const historyEntry = createSubmissionHistoryEntry_(submission);

    // Demo mode has nowhere to send the run, so history is the whole of the record.
    if (isDemoMode_()) {
      const savedLocally = saveSubmissionHistoryEntry_(historyEntry, 'demo', null);
      setSubmitStatus(
        savedLocally
          ? 'Saved to History on this device. No Sheet is linked, so nothing was sent.'
          : 'History could not be saved on this device.',
        savedLocally ? 'ok' : 'warn'
      );
      finishSubmit_(savedLocally ? 'done' : 'failed');
      return;
    }

    const pendingBefore = pendingCount();

    // On this device's list before it goes anywhere. A judge watching the History section
    // sees the run land the moment they submit, and a tab that dies mid-request still
    // leaves the record behind - which is the whole reason the list exists.
    const historySaved = saveSubmissionHistoryEntry_(historyEntry, 'sending', null);

    const sentAt = Date.now();

    try {
      // Competition and level are read from Config by the server, rather than trusted from
      // values sent by the scoring device.
      const result = await SheetSubmit.submit(submission);
      updateSubmissionHistoryEntry_(historyEntry.id, 'submitted', result,
        Object.assign({ submitMs: Date.now() - sentAt }, photoWait));

      // Nothing to announce on the way out. The button has gone green, and the row number,
      // the timings, and whether the server saw this as a repeat are all on the History
      // entry written a moment ago - a line of text under the button only said it twice.
      //
      // Unless History is the thing that failed. That is the one case worth interrupting
      // for, because it is what everything above now points at.
      setSubmitStatus(
        historySaved ? '' : 'Sent, but History could not be saved on this device.',
        historySaved ? null : 'warn'
      );

      finishSubmit_('done');

    } catch (err) {
      const pending = pendingCount();
      if (pending > pendingBefore) {
        updateSubmissionHistoryEntry_(historyEntry.id, 'queued', null,
          Object.assign({ submitMs: Date.now() - sentAt }, photoWait));
        const historyWarning = historySaved ? '' : ' History could not be saved.';
        setSubmitStatus(
          'Saved on this device (' + pending + ' waiting), ' + err.message + historyWarning
            + elapsedNote_(sentAt),
          'warn'
        );
        finishSubmit_('queued');
      } else {
        updateSubmissionHistoryEntry_(historyEntry.id, 'failed', null,
          Object.assign({ submitMs: Date.now() - sentAt }, photoWait));
        finishSubmit_('failed');
        setSubmitStatus('Submit failed: ' + err.message + elapsedNote_(sentAt), 'error');
        showError_('Submitting a run', err);
      }

    } finally {
      // The team just scored now carries the marker, whichever way the run ended up.
      renderTeamOptions_();
    }
  }

  async function flushQueue(announceIdle) {
    // The queue belongs to a real Sheet; demo mode never puts anything into it.
    if (isDemoMode_() || pendingCount() === 0) return;

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

    // Reload Config: the button carries its own state, so the scoresheet stays usable
    // while the request is out and stays on screen if it fails.
    const btnReloadConfig = document.getElementById('btn-reload-config');
    if (btnReloadConfig) {
      btnReloadConfig.addEventListener('click', async () => {
        btnReloadConfig.disabled = true;
        btnReloadConfig.textContent = 'Loading…';

        const loaded = await loadMetadata(true);

        btnReloadConfig.disabled = false;
        btnReloadConfig.textContent = loaded ? 'Reload Config' : 'Reload failed';
        if (loaded) return;

        setTimeout(() => {
          if (btnReloadConfig.textContent === 'Reload failed') {
            btnReloadConfig.textContent = 'Reload Config';
          }
        }, 3000);
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

        const takenAt = Date.now();

        compressImage(file).then((photo) => {
          currentPhotoDataUrl = photo.dataUrl;
          currentPhotoInfo = { width: photo.width, height: photo.height, bytes: photo.bytes };
          currentPhotoTiming = { compressMs: Date.now() - takenAt, uploadMs: 0 };
          renderPhotoMeta_();
          currentPhotoUpload = startPhotoUpload_(photo.dataUrl);

          const previewImg = document.getElementById('photo-preview');
          const container = document.getElementById('photo-container');
          if (previewImg && container) {
            previewImg.src = photo.dataUrl;
            container.style.display = 'block';
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }

          // Re-encoded from the finished photo rather than the file, so it costs one cheap
          // decode - and a failure here only means history shows no picture.
          return compressImage(photo.dataUrl, HISTORY_PHOTO_MAX_SIZE, HISTORY_PHOTO_QUALITY)
            .then((thumb) => {
              currentPhotoThumbUrl = thumb.dataUrl;
              currentPhotoThumbInfo = { width: thumb.width, height: thumb.height, bytes: thumb.bytes };
            })
            .catch(() => {
              currentPhotoThumbUrl = '';
              currentPhotoThumbInfo = null;
            });
        }).catch((err) => {
          setSubmitStatus(err.message, 'error');
          showError_('Reading the photo', err);
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

        // A different judge scores different teams, so the list below has to follow.
        renderTeamOptions_();
        // And that list lands on a different team, so a run frozen here belongs to the
        // judge who just left. Re-applies both locks on its way out.
        unlockRun_();
      });
    }

    const teamSelect = document.getElementById('team-select');
    if (teamSelect) {
      teamSelect.addEventListener('change', () => {
        const nextTeam = teamSelect.value;
        const selectedNewTeam = !!nextTeam && nextTeam !== restoredTeam;

        // Picking one already scored this round is usually a mistap on a list where the
        // wanted team sits next to a finished one, so it has to be said out loud. Backing
        // out restores the previous pick rather than clearing the run in progress.
        if (selectedNewTeam && submittedTeamsThisRound_()[nextTeam] && !window.confirm(
          '"' + nextTeam + '" has already been submitted this round.\n\nScore it again?'
        )) {
          teamSelect.value = restoredTeam;
          return;
        }

        restoredTeam = nextTeam;

        // Another team is another run. Whatever the last one ended as, this one starts on
        // a blank sheet - which is also the way out of the freeze a sent run leaves.
        if (selectedNewTeam) {
          resetRunState();
          unlockRun_();
        }
        saveDraft();
      });
    }

    // Try buttons. Tapping one is also the way out of a half-typed box, so it clears
    // the field - otherwise the two would disagree about the count.
    const tryOptions = document.getElementById('try-options');
    if (tryOptions) {
      tryOptions.addEventListener('click', (e) => {
        const btn = e.target.closest('.try-btn');
        if (!btn) return;

        const input = document.getElementById('try-input');
        const hadTryError = input && input.getAttribute('aria-invalid') === 'true';
        tryValue = Number(btn.getAttribute('data-try'));
        if (input) {
          input.value = '';
          input.removeAttribute('aria-invalid');
        }
        renderTryButtons();
        if (hadTryError) setSubmitStatus('', null);
        saveDraft();
      });
    }

    const tryInput = document.getElementById('try-input');
    if (tryInput) {
      tryInput.addEventListener('focus', renderTryButtons);
      tryInput.addEventListener('blur', renderTryButtons);

      tryInput.addEventListener('input', () => {
        const hadTryError = tryInput.getAttribute('aria-invalid') === 'true';
        tryInput.value = tryInput.value.replace(/\D/g, '').slice(0, 2);
        tryInput.removeAttribute('aria-invalid');
        // Follow a typed 0-3 with the buttons, so clearing the box lands on that same count.
        syncTryValueFromBox();
        renderTryButtons();
        if (hadTryError) setSubmitStatus('', null);
        saveDraft();
      });
    }

    // Mission Time: digits only, the mask puts the separators in.
    const timeInput = document.getElementById('mission-time');
    if (timeInput) {
      // The default is a starting point, not an answer, so reaching for the field to type
      // a real time should not mean clearing seven characters by hand first. A time the
      // judge typed is left alone - only the untouched default steps aside.
      timeInput.addEventListener('focus', () => {
        if (timeInput.value === DEFAULT_MISSION_TIME) timeInput.value = '';
      });

      // Opened and left as it was: the default comes back rather than an empty box.
      timeInput.addEventListener('blur', () => {
        if (!timeInput.value.trim()) timeInput.value = DEFAULT_MISSION_TIME;
        // Leaving the field ends the typing, so half a value here is simply a wrong one.
        markMissionTime_(timeInput);
      });

      timeInput.addEventListener('input', () => {
        timeInput.value = formatMissionTime(timeInput.value);

        // Only once the seconds are both there. On '2:7' the field is on its way to '2:75'
        // and to '2:07' alike, and turning red on the second of those would be wrong.
        if (/^\d{1,2}:\d{2}/.test(timeInput.value)) markMissionTime_(timeInput);
        else timeInput.removeAttribute('aria-invalid');

        saveDraft();
      });
    }

    // Submit button
    const btnSubmit = document.getElementById('btn-submit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', handleSubmit);
    }

    const historyBody = document.getElementById('history-body');
    if (historyBody) {
      historyBody.addEventListener('click', (e) => {
        const entry = e.target.closest('[data-history-id]');
        if (entry) openSubmissionHistory_(entry.getAttribute('data-history-id'));
      });

      historyBody.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const entry = e.target.closest('[data-history-id]');
        if (!entry) return;

        e.preventDefault();
        openSubmissionHistory_(entry.getAttribute('data-history-id'));
      });
    }

    const historyClose = document.getElementById('history-close');
    if (historyClose) historyClose.addEventListener('click', closeSubmissionHistory_);

    const historyModal = document.getElementById('history-modal');
    if (historyModal) {
      historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) closeSubmissionHistory_();
      });
    }

    const timetableTrigger = document.getElementById('meta-round');
    if (timetableTrigger) timetableTrigger.addEventListener('click', openTimetable_);

    const timetableClose = document.getElementById('timetable-close');
    if (timetableClose) timetableClose.addEventListener('click', closeTimetable_);

    const timetableModal = document.getElementById('timetable-modal');
    if (timetableModal) {
      timetableModal.addEventListener('click', (e) => {
        if (e.target === timetableModal) closeTimetable_();
      });
    }

    window.addEventListener('online', () => flushQueue(false));

    // A phone that sat locked through the break comes back showing the round it left on.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderClock();
    });

    const errorClose = document.getElementById('error-close');
    if (errorClose) errorClose.addEventListener('click', closeError_);

    const errorCopy = document.getElementById('error-copy');
    if (errorCopy) errorCopy.addEventListener('click', copyErrorReport_);

    const errorModal = document.getElementById('error-modal');
    if (errorModal) {
      errorModal.addEventListener('click', (e) => {
        if (e.target === errorModal) closeError_();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeError_();
        closeSubmissionHistory_();
        closeTimetable_();
      }
    });
  }

  /** Nothing else has to remember to report: whatever escapes a handler lands here. */
  function installErrorReporting_() {
    window.addEventListener('error', (e) => {
      showError_('Uncaught error', e.error || errorFromEvent_(e));
    });

    window.addEventListener('unhandledrejection', (e) => {
      showError_('Unhandled promise', e.reason);
    });
  }

  function init() {
    installErrorReporting_();

    const devId = getOrCreateDeviceId();
    const devDisplay = document.getElementById('device-id-display');
    if (devDisplay) devDisplay.textContent = devId;

    initScoreState();
    restoreDraft();
    renderTable();
    renderTryButtons();
    renderSubmissionHistory_();
    setupEvents();
    loadMetadata();
    flushQueue(true);

    if (!roundTicker) roundTicker = setInterval(renderClock, 20000);
    if (!historyCleanupTicker) {
      historyCleanupTicker = setInterval(renderSubmissionHistory_, HISTORY_CLEANUP_INTERVAL_MS);
    }
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
