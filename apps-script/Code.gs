/**
 * Synapse City Scoresheet — endpoint that writes one scoring run into a Google Sheet.
 *
 * Setup:
 *   1. Open the target Google Sheet › Extensions › Apps Script, paste this into Code.gs
 *   2. Fill in SHEET_ID (the part between /d/ and /edit in the sheet URL) and SHARED_KEY
 *   3. Deploy › New deployment › Web app
 *        Execute as     : Me
 *        Who has access : Anyone
 *   4. Copy the /exec URL into ENDPOINT in submit.js; SHARED_KEY must match
 *
 * Every edit to this file needs a fresh deployment, otherwise /exec keeps running the
 * old code: Deploy › Manage deployments › Edit › Version: New version
 */

const SHEET_ID = 'PASTE_SPREADSHEET_ID';
const SHEET_NAME = 'Scores';
const SHARED_KEY = 'PASTE_A_LONG_RANDOM_STRING';
const DRIVE_FOLDER_ID = ''; // leave empty to skip photo storage

const HEADERS = [
  'submissionId', 'submittedAt', 'judge', 'team', 'level', 'totalScore',
  'red', 'yellow1', 'yellow2', 'green', 'blue', 'purple', 'mystery',
  'leanbot1', 'leanbot2', 'photoUrl', 'userAgent'
];

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    // Queue up so simultaneous clients cannot overwrite each other
    lock.waitLock(30000);

    const body = JSON.parse(e.postData.contents);
    if (body.key !== SHARED_KEY) {
      return json({ ok: false, error: 'unauthorized' });
    }

    const id = String(body.submissionId || Utilities.getUuid());

    // A flaky network makes the client resend the same run. Same id, no extra row.
    const cache = CacheService.getScriptCache();
    if (cache.get(id)) {
      return json({ ok: true, duplicate: true, submissionId: id });
    }

    const sheet = getSheet_();
    const photoUrl = body.photoBase64 ? savePhoto_(id, body.photoBase64) : '';
    const s = body.scores || {};

    sheet.appendRow([
      id,
      new Date(),
      body.judge || '',
      body.team || '',
      body.level || '',
      Number(body.totalScore) || 0,
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

    cache.put(id, '1', 21600); // 6 hours, long enough to cover a scoring session
    return json({ ok: true, submissionId: id, row: sheet.getLastRow() });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
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
