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
 * GET Handler: Returns Competition Name, Judges, and Teams from Config tab
 */
function doGet(e) {
  try {
    const sheetId = resolveSheetId_(e && e.parameter ? (e.parameter.sheetId || e.parameter.link) : '');
    const ss = SpreadsheetApp.openById(sheetId);
    let configSheet = ss.getSheetByName(SHEET_NAME_CONFIG);

    if (!configSheet) {
      // Auto-create sample Config tab if it does not exist yet
      configSheet = ss.insertSheet(SHEET_NAME_CONFIG);
      configSheet.getRange('A1:B1').setValues([['Competition Name', 'Synapse City Championship 2026']]);
      configSheet.getRange('A2:B2').setValues([['Judge', 'Team ID']]);
      configSheet.getRange('A3:B5').setValues([
        ['Judge 1', 'Team 01'],
        ['Judge 2', 'Team 02'],
        ['Judge 3', 'Team 03']
      ]);
      configSheet.getRange('A1:B2').setFontWeight('bold');
    }

    const data = configSheet.getDataRange().getValues();
    let competitionName = 'Synapse City';
    const judges = [];
    const teams = [];

    if (data.length > 0) {
      // Cell B1 contains Competition Name
      if (data[0][1]) {
        competitionName = String(data[0][1]).trim();
      } else if (data[0][0] && data[0][0] !== 'Judge' && data[0][0] !== 'Competition Name') {
        competitionName = String(data[0][0]).trim();
      }

      // Read judges and teams starting from row 3 (or row 2 if no header on row 2)
      const startRow = (data.length > 1 && String(data[1][0]).toLowerCase().includes('judge')) ? 2 : 1;
      for (let i = startRow; i < data.length; i++) {
        const j = String(data[i][0] || '').trim();
        const t = String(data[i][1] || '').trim();
        if (j && j !== 'Judge') judges.push(j);
        if (t && t !== 'Team' && t !== 'Team ID') teams.push(t);
      }
    }

    return json({
      ok: true,
      sheetId: sheetId,
      competition: competitionName,
      judges: Array.from(new Set(judges)),
      teams: Array.from(new Set(teams))
    });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
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
