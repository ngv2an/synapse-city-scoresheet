/**
 * Synapse City Scoresheet — endpoint that provides metadata and writes scoring runs into Google Sheets.
 *
 * Setup:
 *   1. Open the target Google Sheet › Extensions › Apps Script, paste this into Code.gs
 *   2. Fill in DEFAULT_SHEET_ID and SHARED_KEY
 *   3. Deploy › New deployment › Web app
 *        Execute as     : Me
 *        Who has access : Anyone
 *   4. Copy the /exec URL into ENDPOINT in submit.js; SHARED_KEY must match
 *
 * Every edit to this file needs a fresh deployment, otherwise /exec keeps running the
 * old code: Deploy › Manage deployments › Edit › Version: New version
 */

const DEFAULT_SHEET_ID = '1jnnh5phoBJO1JsKtzumCIOHQUl3kyeY13fThvHza2Bc';
const SHEET_NAME_SCORES = 'Scores';
const SHEET_NAME_CONFIG = 'Config';
const SHARED_KEY = '5Utxx6W06WnkEPHIbJYqr3uNBTB9ryeA';
const DRIVE_FOLDER_ID = ''; // Optional Google Drive Folder ID to store photos (leave empty to skip Drive upload)

const HEADERS_SCORES = [
  'submissionId', 'submittedAt', 'competition', 'judge', 'team', 'level', 'totalScore',
  'missionTime', 'tryCount', 'deviceId',
  'red', 'yellow1', 'yellow2', 'green', 'blue', 'purple', 'mystery',
  'leanbot1', 'leanbot2', 'photoUrl', 'userAgent'
];

/**
 * Config tab layout. A label sits in one cell and its value in the cell to its right,
 * while Judge and Team are column headers with their entries listed underneath:
 *
 *        A          B                  C   D                   E
 *   1  Judge      Team                     Competition Name    Synapse City 123
 *   2                                      Competition Date    24/08/26
 *   3  Thầy An    Team 01 - Alpha        Round 1 Time        10:00 AM
 *   4  Cô Linh    Team 02 - Beta         Round 2 Time        11:00 AM
 *   5
 *   6                                      Level               Creator
 *
 * Nothing is pinned to a fixed cell: the labels are searched for, so extra rows or a
 * shifted block keep working as long as label and value stay side by side.
 *
 * Rounds are open-ended. Any "Round <n> Time" row is picked up and sorted by n, so a
 * third round is a row in the sheet, not an edit here.
 */
const CONFIG_TEMPLATE = [
  ['Judge', 'Team', '', 'Competition Name', 'Synapse City 123'],
  ['', '', '', 'Competition Date', '24/08/26'],
  ['Thầy An', 'Team 01 - Alpha', '', 'Round 1 Time', '10:00 AM'],
  ['Cô Linh', 'Team 02 - Beta', '', 'Round 2 Time', '11:00 AM'],
  ['', '', '', '', ''],
  ['', '', '', 'Level', 'Creator']
];

// Label in the Config tab -> field name in the JSON reply.
const CONFIG_LABELS = {
  'competition name': 'competition',
  'competition date': 'competitionDate',
  'level': 'level'
};

// Matches 'Round 1 Time' .. 'Round 99 Time'; the number decides the order they go out in.
const CONFIG_ROUND_LABEL = /^round\s*(\d+)\s*time$/;

const CONFIG_JUDGE_HEADERS = ['judge', 'judges', 'judge name'];
const CONFIG_TEAM_HEADERS = ['team', 'teams', 'team id', 'team name'];

/**
 * GET Handler: Returns everything the scoresheet needs from the Config tab —
 * competition name, date, round times, level, and the Judge / Team lists.
 */
function doGet(e) {
  try {
    const sheetId = resolveSheetId_(e && e.parameter ? (e.parameter.sheetId || e.parameter.link) : '');
    const ss = SpreadsheetApp.openById(sheetId);
    const config = readConfig_(ss);

    return json(Object.assign({ ok: true, sheetId: sheetId }, config));

  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Rewrites the Config tab into the layout above. Run by hand from the editor. */
function resetConfigSheet() {
  const ss = SpreadsheetApp.openById(DEFAULT_SHEET_ID);
  const existing = ss.getSheetByName(SHEET_NAME_CONFIG);
  if (existing) ss.deleteSheet(existing);
  createConfigSheet_(ss);
}

function readConfig_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAME_CONFIG) || createConfigSheet_(ss);
  const data = sheet.getDataRange().getValues();
  const tz = ss.getSpreadsheetTimeZone();

  const config = {
    competition: 'Synapse City',
    competitionDate: '',
    rounds: [],
    level: '',
    judges: readConfigColumn_(data, CONFIG_JUDGE_HEADERS),
    teams: readConfigColumn_(data, CONFIG_TEAM_HEADERS)
  };

  const roundTimes = {};

  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length - 1; c++) {
      const label = normalizeLabel_(data[r][c]);

      const round = CONFIG_ROUND_LABEL.exec(label);
      if (round) {
        const time = formatConfigValue_(data[r][c + 1], 'roundTime', tz);
        if (time) roundTimes[Number(round[1])] = time;
        continue;
      }

      const field = CONFIG_LABELS[label];
      if (!field) continue;

      const value = formatConfigValue_(data[r][c + 1], field, tz);
      if (value) config[field] = value;
    }
  }

  config.rounds = Object.keys(roundTimes)
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => ({ round: n, time: roundTimes[n] }));

  config.level = config.level.toLowerCase();
  return config;
}

/** Collects every non-empty cell under the first header cell matching one of `headers`. */
function readConfigColumn_(data, headers) {
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (headers.indexOf(normalizeLabel_(data[r][c])) === -1) continue;

      const values = [];
      for (let i = r + 1; i < data.length; i++) {
        const value = String(data[i][c] === null || data[i][c] === undefined ? '' : data[i][c]).trim();
        if (value) values.push(value);
      }
      return Array.from(new Set(values));
    }
  }
  return [];
}

function normalizeLabel_(cell) {
  return String(cell === null || cell === undefined ? '' : cell)
    .trim().toLowerCase().replace(/[:\s]+$/, '').replace(/\s+/g, ' ');
}

/**
 * A cell typed as a date or a time comes back as a Date, so String() on it would leak
 * "Mon Aug 24 2026 00:00:00 GMT+0700". Only the shape that was typed goes out.
 */
function formatConfigValue_(cell, field, tz) {
  if (cell === null || cell === undefined || cell === '') return '';

  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return Utilities.formatDate(cell, tz, field === 'competitionDate' ? 'dd/MM/yy' : 'h:mm a');
  }
  return String(cell).trim();
}

function createConfigSheet_(ss) {
  const sheet = ss.insertSheet(SHEET_NAME_CONFIG);
  const rows = CONFIG_TEMPLATE.length;
  const cols = CONFIG_TEMPLATE[0].length;

  // Plain text on the value column, set before writing: otherwise Sheets turns 24/08/26
  // and 10:00 AM into date values and reformats them to whatever the locale prefers.
  sheet.getRange(1, 5, rows, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows, cols).setValues(CONFIG_TEMPLATE);

  sheet.getRange('A1:B1').setFontWeight('bold');
  sheet.getRange(1, 4, rows, 1).setFontWeight('bold');
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 24);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 190);

  return sheet;
}

/**
 * POST Handler: Appends a scoring run into Scores tab
 */
function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    const body = JSON.parse(e.postData.contents);
    if (body.key !== SHARED_KEY) {
      return json({ ok: false, error: 'unauthorized' });
    }

    const id = String(body.submissionId || Utilities.getUuid());

    // Deduplication via cache
    const cache = CacheService.getScriptCache();
    const cachedRow = cache.get(id);
    if (cachedRow) {
      return json({ ok: true, duplicate: true, submissionId: id, row: Number(cachedRow) });
    }

    const sheetId = resolveSheetId_(body.sheetId || body.link);
    const photoUrl = body.photoBase64 ? savePhoto_(id, body.photoBase64) : '';

    // Wait for lock to append row safely
    lock.waitLock(30000);
    const sheet = getScoreSheet_(sheetId);
    const s = body.scores || {};

    sheet.appendRow([
      id,
      new Date(),
      body.competition || '',
      body.judge || '',
      body.team || '',
      body.level || '',
      Number(body.totalScore) || 0,
      body.missionTime || '',
      body.tryCount !== undefined && body.tryCount !== '' ? Number(body.tryCount) : '',
      body.deviceId || '',
      s.red || '',
      s.yellow1 || '',
      s.yellow2 || '',
      s.green || '',
      s.blue || '',
      s.purple || '',
      s.mystery || '',
      s.leanbot1 ? 'CRL' : '',
      s.leanbot2 ? 'CRL' : '',
      photoUrl,
      String(body.userAgent || '').slice(0, 200)
    ]);

    const row = sheet.getLastRow();
    cache.put(id, String(row), 21600); // 6 hours
    return json({ ok: true, submissionId: id, row: row });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function resolveSheetId_(input) {
  if (!input) return DEFAULT_SHEET_ID;
  const str = String(input).trim();
  // If user passed a full URL, extract the ID between /d/ and /
  const match = str.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return str;
}

function getScoreSheet_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(SHEET_NAME_SCORES);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_SCORES);
    sheet.appendRow(HEADERS_SCORES);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS_SCORES.length).setFontWeight('bold');
  }

  return sheet;
}

function savePhoto_(id, dataUrl) {
  if (!DRIVE_FOLDER_ID) return '';
  const m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return '';

  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '.jpg');
  return DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(blob).getUrl();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
