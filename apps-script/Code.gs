/**
 * Synapse City Scoresheet — endpoint that provides metadata and writes scoring runs into Google Sheets.
 *
 * Central setup — do this once, not once per spreadsheet:
 *   1. Create one standalone project at script.google.com and paste this into Code.gs
 *   2. Fill in DEFAULT_SHEET_ID and SHARED_KEY
 *   3. Deploy › New deployment › Web app
 *        Execute as     : Me
 *        Who has access : Anyone
 *   4. Copy the /exec URL into ENDPOINT in submit.js; SHARED_KEY must match
 *
 * Every spreadsheet copy uses this same deployment. The website sends that copy's
 * spreadsheet ID with each request, and this project opens it with openById(). Do not
 * paste or deploy this project again inside a copied spreadsheet. The account that
 * deploys this web app must have edit access to every target spreadsheet.
 *
 * After editing this file, update this one deployment only:
 * Deploy › Manage deployments › Edit › Version: New version. All existing spreadsheet
 * copies then use the new backend code automatically on their next request.
 */

const DEFAULT_SHEET_ID = '1jnnh5phoBJO1JsKtzumCIOHQUl3kyeY13fThvHza2Bc';
const LEGACY_SHEET_NAME_SCORES = 'Scores';
const SCORE_SHEET_PREFIX = 'Scores - ';
const SHEET_NAME_CONFIG = 'Config';
/**
 * Every level's log lives in one workbook, one tab each, rather than in the level file it
 * describes. A run that cannot open its own Sheet - wrong ID, revoked access - still has
 * somewhere to be recorded; that failure used to go unlogged, because the log went into
 * the very file that would not open.
 */
const LOG_SHEET_ID = '1Adg6eF-K_VkB5QwNLjtR0iDIxYLLk56B3mlqMIcGgDQ';
const LOG_SHEET_PREFIX = 'Logs - ';
// Where a run lands when its level cannot be worked out: a sheetId outside LEVEL_SHEET_IDS,
// or a failure early enough that Config was never read. Created only when something needs it.
const LOG_SHEET_OTHER = 'Logs - Other';

/**
 * The dashboard sits on top of the log rows in the one Logs tab, so the header is no
 * longer row 1. Above the rows rather than beside them on purpose: appendRow() looks at
 * the last used row of the whole sheet, and a block off to the right would push the first
 * log rows down past it. Everything that reads or writes the log derives its position
 * from these, and the tab is frozen through the header so the dashboard stays on screen
 * while the log scrolls underneath it.
 */
const LOG_DASHBOARD_ROWS = 15;
const LOG_HEADER_ROW = LOG_DASHBOARD_ROWS + 2;   // one blank row between the two
const LOG_FIRST_DATA_ROW = LOG_HEADER_ROW + 1;
// Photos are created one Drive file at a time, and file creation is the quota that could
// bite. Storage is not: this counts files, not megabytes.
const PHOTO_QUOTA_PER_DAY = 1500;
const SHARED_KEY = '5Utxx6W06WnkEPHIbJYqr3uNBTB9ryeA';
// Must match ENDPOINT in submit.js. Only the Ranking link needs it: everything else is
// reached from the client, which already has it.
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyFo41U6Hg2bMGknSf9ZtDqYUa6ARHv5wNGWqcN1k7dweK1Eo_OyMWVlUpAyVeGEyWvkQ/exec';
const DRIVE_FOLDER_ID = '1c6iWXPivzN28jq27S_5Zkj6gUC28ms2C';
const SUBMISSION_TIME_FORMAT = 'HH:mm:ss';

/**
 * Ranking layout, five rows of preamble and then the table:
 *
 *   1  Last Updated at ...            2  Click here to update Ranking
 *   3  (blank, and the tab's one guaranteed-empty cell)
 *   4  group row:   Overall Result | Round 1 | Round 2
 *   5  header row:  Team ID, then each block's own column names
 *   6+ one row per team, best placed first
 *
 * Each of the first two rows carries one thing, in column A, with the whole width to spill
 * across. They used to share row 1 and had to be spaced apart by hand so neither clipped
 * the other; a row each costs nothing and ends that arithmetic.
 *
 * Overall Result comes first because it is the answer. Round 1 and Round 2 are the working
 * behind it, and a reader who wants only the standings should not have to cross ten columns
 * of it to arrive. The two round blocks keep their order, separated by a blank column each,
 * so the three blocks read as three.
 *
 * Every column is written by a rebuild, Normalized included. It was left alone for as
 * long as nothing here defined what normalising meant; Base Top Score defines it, so the
 * column stopped being somebody else's.
 */
const RANKING_SHEET_PREFIX = 'Ranking - ';
// The Result tab: the same standings, flat, with the roster details that a results
// announcement needs and the two round blocks that only a judge needs left off. Built by
// reading the Ranking tab back rather than by working the placings out again, so the two
// can never disagree about who came where.
const RESULT_SHEET_PREFIX = 'Result - ';
const RESULT_TEAM_DATA_SHEET = 'Team Data';
// Joined on Team ID. A column that tab does not carry comes out blank rather than stopping
// the rebuild: the standings are the point of this sheet and the roster is what dresses
// them, so a missing school name is not worth an error in the middle of an event.
const RESULT_TEAM_DATA_COLUMNS = ['State', 'Code', 'School', 'Stu1', 'Stu2', 'Stu3'];
const RESULT_COLUMNS = ['Rank', 'Team ID', 'Category']
  .concat(RESULT_TEAM_DATA_COLUMNS)
  .concat(['Best Score', 'Variation', 'Try', 'Time']);
// Two preamble rows and a blank one, the same shape the Ranking tab uses and for the same
// reason: a line each, so the hint and the link can both run as wide as they need without
// either setting the width of column A.
const RESULT_LABEL_ROW = 1;
const RESULT_URL_ROW = 2;
const RESULT_HEADER_ROW = 4;
const RESULT_FIRST_DATA_ROW = RESULT_HEADER_ROW + 1;
// A field label and the empty box under it, which is all this needs to be. Guidance written
// out in sentences would sit on a sheet people print and hand round, and a rebuild writes it
// back, so deleting it does not even work.
//
// The placeholder is what says which cell to use. It is not a URL, so readTeamDataUrl_
// passes over it exactly as it passes over an empty cell.
const RESULT_URL_LABEL = 'Team Data URL';
const RESULT_URL_PLACEHOLDER = 'Paste link here';
// Named, because the offset below is found by looking this exact string up in the list. A
// rename that touched only one of the two would leave indexOf at -1, and -1 does not throw:
// it quietly writes the column one to the left of Raw Score.
const RANKING_NORMALIZED_LABEL = 'Normalized';
const RANKING_ROUND_COLUMNS = [
  'Submission', 'Raw Score', RANKING_NORMALIZED_LABEL, 'Time', 'Try'
];
const RANKING_OVERALL_GROUP = 'Overall Result';
// Rank, then which round earned it, then rulebook 10.3 in its own order: Best Score, then
// Variation, then Try, then Time. Reading left to right is reading the tiebreak - where two
// teams draw level, the next column along is the one that separated them.
//
// Try and Time lose their "of Best Round" suffix here because Best Round is sitting two
// columns to the left; inside this block there is no other round to mean.
const RANKING_OVERALL_COLUMNS = [
  'Rank', 'Best Round', 'Best Score', 'Variation', 'Try', 'Time'
];
const RANKING_LINK_LABEL = 'Click here to update Ranking';
const RANKING_UPDATED_LABEL = 'Last Updated at ';
const RANKING_UPDATED_FORMAT = 'HH:mm:ss dd/MM/yyyy';

// Rows, top to bottom. Row 3 stays empty by design and is the one cell on the tab that can
// be borrowed for a moment without asking what is in it - see the separator probe.
const RANKING_UPDATED_ROW = 1;
const RANKING_LINK_ROW = 2;
const RANKING_BLANK_ROW = 3;
const RANKING_GROUP_ROW = 4;
const RANKING_HEADER_ROW = 5;
const RANKING_FIRST_DATA_ROW = 6;

// Columns, left to right: A, then three blocks with a blank column between them.
const RANKING_OVERALL_COLUMN = 2;
const RANKING_OVERALL_END = RANKING_OVERALL_COLUMN + RANKING_OVERALL_COLUMNS.length - 1;
const RANKING_SPACER1_COLUMN = RANKING_OVERALL_END + 1;
const RANKING_ROUND1_COLUMN = RANKING_SPACER1_COLUMN + 1;
const RANKING_SPACER2_COLUMN = RANKING_ROUND1_COLUMN + RANKING_ROUND_COLUMNS.length;
const RANKING_ROUND2_COLUMN = RANKING_SPACER2_COLUMN + 1;
const RANKING_LAST_COLUMN = RANKING_ROUND2_COLUMN + RANKING_ROUND_COLUMNS.length - 1;
// The blank columns are a gap, not a column, so they are the one width nothing measures.
const RANKING_SPACER_WIDTH = 24;
// Right of the rebuild time, on the same row, far enough that neither clips the other.
// Where Round 1 starts is geometry, not meaning.
const RANKING_INVALID_COLUMN = RANKING_ROUND1_COLUMN;
const RANKING_INVALID_NOTE = 'A submission is ranked only if it landed on the Competition '
  + 'Date, between Round 1 Time and End Time. Both ends count as inside. A bound left blank '
  + 'in Config is not checked at all. Test Submission answers to the date alone.';
// Must match TEST_TEAM in script.js: it is what the app writes into the Team column, and
// the two sides have to agree on the spelling for the exemption below to mean anything.
const RANKING_TEST_TEAM = 'Test Submission';
// The top five is read off Raw Score, the column the app actually produces. Normalized
// Score beside it is derived from that same five, so ranking on it would be circular.
const RANKING_SCORE_OFFSET = RANKING_ROUND_COLUMNS.indexOf('Raw Score');
// Rulebook 10.2: Normalized Score = (Raw Score / Base Top Score) x 1000. A run level with
// the average of its round's top five reads 1000.0, and everything else reads against that.
//
// One decimal at this scale is what two were at a scale of 100, and the shown value is also
// the compared one - see rankTeams_. Carrying more precision than the tab displays would
// mean two teams reading 1000.0 taking different places for a difference nobody can see,
// and it would keep the tiebreakers in 10.3 from ever being reached.
const RANKING_NORMALIZED_SCALE = 1000;
const RANKING_NORMALIZED_DIGITS = '0.0';
const RANKING_TIE_DECIMALS = (RANKING_NORMALIZED_DIGITS.split('.')[1] || '').length;
const RANKING_NORMALIZED_OFFSET = RANKING_ROUND_COLUMNS.indexOf(RANKING_NORMALIZED_LABEL);
// Every column of the Overall Result block, addressed by the name it carries in the header
// so the two can never drift apart. All six come off the pair of Normalized values, which
// sit on one scale by construction - each already measured against its own round's top five
// - and that is the whole reason a team's two rounds can be compared to each other at all.
const RANKING_RANK_COLUMN = overallColumn_('Rank');
const RANKING_BEST_ROUND_COLUMN = overallColumn_('Best Round');
const RANKING_BEST_SCORE_COLUMN = overallColumn_('Best Score');
const RANKING_VARIATION_COLUMN = overallColumn_('Variation');
const RANKING_BEST_TIME_COLUMN = overallColumn_('Time');
const RANKING_BEST_TRY_COLUMN = overallColumn_('Try');
// Variation runs the opposite direction to every other number on this tab: low is steady.
// Time and Try are copied off whichever round produced the Best Score, not off the better
// time and the better try picked separately, which would describe a run nobody made.
const RANKING_TIME_OFFSET = RANKING_ROUND_COLUMNS.indexOf('Time');
const RANKING_TRY_OFFSET = RANKING_ROUND_COLUMNS.indexOf('Try');
// Whole numbers, all three of them: a count of submissions, a score summed from missions
// that are worth whole points each, and a count of tries. Named and set outright, because a
// column nobody formats keeps the format some earlier layout left on it.
const RANKING_INTEGER_DIGITS = '0';
const RANKING_INTEGER_OFFSETS = [
  RANKING_ROUND_COLUMNS.indexOf('Submission'), RANKING_SCORE_OFFSET, RANKING_TRY_OFFSET
];
const RANKING_TOP_COUNT = 5;
const RANKING_TOP_BACKGROUND = '#e6f4ea';
// Base Top Score: the mean of those top five, written into the group row directly above the
// Raw Score column of its own round.
const RANKING_BASE_NOTE = 'Base Top Score: the average of the top '
  + RANKING_TOP_COUNT + ' Raw Scores in this round.';

/**
 * A column of the Overall Result block, by its header name.
 *
 * Loud on the spot, because the quiet failure is worse than a broken load: indexOf answers
 * -1 for a name that is not there, -1 does not throw, and the block start minus one is the
 * Team ID column - a whole column of formulas written over the roster. A name that is not
 * in the list is a typo in this file, and the first execution should say so.
 */
function overallColumn_(label) {
  const at = RANKING_OVERALL_COLUMNS.indexOf(label);
  if (at === -1) throw new Error('Ranking: no Overall column named "' + label + '".');
  return RANKING_OVERALL_COLUMN + at;
}

/**
 * Two questions were being asked of Sheets on every single submit, inside the lock, and
 * both have the same answer they had twelve seconds earlier: which level is this file, and
 * does its Scores tab still have the layout this code writes. Reading the Config tab for
 * the first cost a full getValues() of the whole tab to extract one word.
 *
 * Cached across the deployment, so all four files draw on the same store. Both are
 * best-effort: a miss falls through to the original check, so nothing here can make the
 * code wrong, only slower. An hour bounds how long a Level change or a hand-broken layout
 * can go unnoticed - and doGet refreshes the level whenever a judge reloads Config.
 */
const LEVEL_CACHE_TTL = 3600;
const SCHEMA_CACHE_TTL = 3600;

const SCORE_LEVEL_TITLES = {
  explorer: 'Explorer',
  creator: 'Creator',
  innovator: 'Innovator',
  master: 'Master'
};

/**
 * Column order of the Scores tab. The block columns follow the order the judge sees them
 * in on screen, not the order they happen to sit in the payload.
 *
 * Competition is deliberately absent because one Sheet belongs to one competition. Level
 * is stored on every row so combined/exported score data remains self-describing.
 */
const HEADERS_SCORES = [
  'Submission Time', 'Device ID', 'Level', 'Judge', 'Team', 'Round', 'Score', 'Time', 'Try',
  '', 'Green', 'Blue', 'Purple', 'Mystery', 'Red', 'Yellow 1', 'Yellow 2', 'Leanbot 1', 'Leanbot 2',
  'Photo URL', 'Photo Size (KB)', 'Submission ID', 'User Agent'
];

/**
 * Column order of the system Logs tab for monitoring performance and usage.
 *
 * Total is what the judge waited. It splits into Wait, the time this run spent queued
 * behind other runs on the script lock, and Work, the time it held the lock itself. Only
 * Work says how many runs a minute the deployment can take; Total mixes in the queue and
 * would read worse the busier things get, which is the opposite of what it has to measure.
 */
const HEADERS_LOGS = [
  'Timestamp', 'Action', 'Level', 'Judge', 'Team',
  'Total (s)', 'Wait (s)', 'Work (s)', 'Photo Size (KB)',
  'Status', 'Submission ID', 'Error / Notes'
];

/**
 * Config tab layout. A label sits in one cell and its value in the cell to its right,
 * while Judge and Team are column headers with their entries listed underneath:
 *
 *        A                  B                  C   D                       E
 *   1  Level              Explorer                 *** Config Source ***   https://…/d/<this file>
 *   2
 *   3                                              Competition Name        AIROC Vietnam 2026 testing
 *   4  Judge              Team                     Competition Date        25/08/2026
 *   5                                              Round 1 Time            09:00:00
 *   6  Explorer Judge A   Explorer Team 10         Round 2 Time            13:00:00
 *   7                     Explorer Team 11         End Time                15:00:00
 *   8                     Explorer Team 12
 *
 * Nothing is pinned to a fixed cell: the labels are searched for, so extra rows or a
 * shifted block keep working as long as label and value stay side by side. Config Source
 * is written from the file's own ID, so it cannot drift from the file it sits in.
 *
 * The schedule is fixed to Round 1, Round 2, and End Time. Any other Round label is ignored.
 *
 * The Explorer file carries one extra block from row 12 listing every level's Sheet and
 * scoresheet link. Nothing here reads it - it is a directory for the organisers - and it
 * lives in the Explorer file alone so there is only ever one copy to keep correct:
 *
 *        D            E                        F
 *  12                 Google Sheet             Scoresheet URL
 *  13   Explorer      https://…/d/1ljm-…       https://…/?link=1ljm-…
 *  14   Creator       …                        …
 *  15   Innovator     …                        …
 *  16   Master        …                        …
 */
const SHEET_URL_PREFIX = 'https://docs.google.com/spreadsheets/d/';
const SCORESHEET_URL_PREFIX = 'https://ngv2an.github.io/synapse-city-scoresheet/?link=';

/** Every level's Sheet, in level order. Only the Explorer Config lists them. */
const LEVEL_SHEET_IDS = [
  ['Explorer', '1ljm-gzjs3UgJB-fuNghADJn_byl-CtHib0APSNol2T0'],
  ['Creator', '1jnnh5phoBJO1JsKtzumCIOHQUl3kyeY13fThvHza2Bc'],
  ['Innovator', '16E0nKN3FAS44ZiRJAISuG6dJNCrGehCvuInQhtRAyTA'],
  ['Master', '1fuRBaq0HJ3_w8JRM4wgEN5KhbK534XcDs6gnqGDal4o']
];

// Judge and Team entries start on this row, one blank row under their headers.
const CONFIG_ENTRY_START_ROW = 6;
// Sample files show three teams; a real one is as long as its longest list.
const CONFIG_SAMPLE_ENTRIES = 3;
// Blank rows between the config block and the Explorer link directory.
const CONFIG_DIRECTORY_GAP = 3;

const CONFIG_SAMPLE = {
  competition: 'AIROC Vietnam 2026 testing',
  competitionDate: '25/08/2026',
  round1: '09:00:00',
  round2: '13:00:00',
  endTime: '15:00:00'
};

function findRoundTime_(rounds, number) {
  const match = (rounds || []).filter(function (item) { return Number(item.round) === number; })[0];
  return match ? match.time : '';
}

/**
 * Builds the tab contents for one file. Pass the config read out of an existing tab to keep
 * what the organisers typed - every value is carried across and only the arrangement
 * changes. Pass nothing and the sample values stand in, carrying the level in their names
 * so a freshly seeded file never looks like it belongs to a different one.
 *
 * Returns the grid plus the two row numbers the caller needs for formatting, because both
 * move once a file has more judges or teams than the sample.
 */
function buildConfigTemplate_(levelTitle, sheetId, config) {
  const source = config || {};
  const judges = Array.isArray(source.judges) ? source.judges : [];
  const teams = Array.isArray(source.teams) ? source.teams : [];
  // Grouping is part of what the tab says, so a rebuild has to write it back grouped -
  // flattening it here would quietly reassign every team to a different judge.
  const roster = buildRosterRows_(judges, teams, source.teamsByJudge);
  const entries = Math.max(roster.length, CONFIG_SAMPLE_ENTRIES);
  const blockRows = CONFIG_ENTRY_START_ROW - 1 + entries;

  const rows = [];
  for (let r = 0; r < blockRows; r++) rows.push(['', '', '', '', '', '']);

  rows[0][0] = 'Level';
  rows[0][1] = levelTitle;
  rows[0][3] = '*** Config Source ***';
  rows[0][4] = SHEET_URL_PREFIX + sheetId;

  rows[2][3] = 'Competition Name';
  rows[2][4] = source.competition || CONFIG_SAMPLE.competition;
  rows[3][0] = 'Judge';
  rows[3][1] = 'Team';
  rows[3][3] = 'Competition Date';
  rows[3][4] = source.competitionDate || CONFIG_SAMPLE.competitionDate;
  rows[4][3] = 'Round 1 Time';
  rows[4][4] = findRoundTime_(source.rounds, 1) || CONFIG_SAMPLE.round1;
  rows[5][3] = 'Round 2 Time';
  rows[5][4] = findRoundTime_(source.rounds, 2) || CONFIG_SAMPLE.round2;
  rows[6][3] = 'End Time';
  rows[6][4] = source.endTime || CONFIG_SAMPLE.endTime;

  for (let i = 0; i < entries; i++) {
    const row = rows[CONFIG_ENTRY_START_ROW - 1 + i];
    const pair = roster[i];

    if (pair) {
      row[0] = pair[0];
      row[1] = pair[1];
    } else if (!config) {
      row[0] = i === 0 ? levelTitle + ' Judge A' : '';
      row[1] = levelTitle + ' Team 1' + i;
    }
  }

  if (levelTitle !== 'Explorer') {
    return { rows: rows, blockRows: blockRows, directoryRow: 0 };
  }

  for (let g = 0; g < CONFIG_DIRECTORY_GAP; g++) rows.push(['', '', '', '', '', '']);

  const directoryRow = rows.length + 1;
  rows.push(['', '', '', '', 'Google Sheet', 'Scoresheet URL']);

  LEVEL_SHEET_IDS.forEach(function (entry) {
    rows.push(['', '', '', entry[0], SHEET_URL_PREFIX + entry[1], SCORESHEET_URL_PREFIX + entry[1]]);
  });

  return { rows: rows, blockRows: blockRows, directoryRow: directoryRow };
}

// Label in the Config tab -> field name in the JSON reply.
const CONFIG_LABELS = {
  'competition name': 'competition',
  'competition date': 'competitionDate',
  'end time': 'endTime',
  'level': 'level'
};

const CONFIG_ROUND_LABELS = {
  'round 1 time': 1,
  'round 2 time': 2
};

const CONFIG_JUDGE_HEADERS = ['judge', 'judges', 'judge name'];
const CONFIG_TEAM_HEADERS = ['team', 'teams', 'team id', 'team name'];

/**
 * GET Handler: Returns everything the scoresheet needs from the Config tab —
 * competition name, date, two round times, end time, level, and the Judge / Team lists.
 */
function doGet(e) {
  const startTime = Date.now();
  let sheetId = '';

  // Rebuilding the standings is a write, so it is its own action rather than something
  // every Config load quietly does. Anyone with the link can fire it when they want to
  // look, which is what a timed trigger grinding away all day was standing in for.
  if (e && e.parameter && e.parameter.action === 'ranking') {
    return handleRankingRequest_(e.parameter, startTime);
  }

  try {
    sheetId = resolveSheetId_(e && e.parameter ? (e.parameter.sheetId || e.parameter.link) : '');
    const ss = SpreadsheetApp.openById(sheetId);
    const config = readConfig_(ss);
    // This read is the expensive half of what doPost used to repeat under the lock, and it
    // has just been paid for out here where nothing queues behind it. Hand it over.
    cacheLevelTitle_(sheetId, SCORE_LEVEL_TITLES[config.level] || '');

    // Config reads take no lock, so all of it is work.
    logActivity_({
      action: 'Config',
      sheetId: sheetId,
      level: SCORE_LEVEL_TITLES[config.level] || config.level,
      total: secondsSince_(startTime),
      status: 'OK'
    });

    return json(Object.assign({ ok: true, sheetId: sheetId }, config));

  } catch (err) {
    // No longer conditional on the Sheet having opened: the log is its own workbook now,
    // and a request that never reached its Sheet is exactly the one worth recording.
    logActivity_({
      action: 'Config',
      sheetId: sheetId,
      total: secondsSince_(startTime),
      status: 'ERROR',
      error: String(err)
    });
    return json({ ok: false, error: String(err) });
  }
}

/**
 * Rewrites the Config tab into the layout above. Run by hand from the editor, once per
 * file: resetConfigSheet('SHEET_ID_OR_URL'), or with no argument for DEFAULT_SHEET_ID.
 *
 * Values are carried across - level, competition name and date, both round times, end
 * time, and the full judge and team lists all come back in their new positions. What does
 * not survive is anything this script cannot read: notes, colours, extra columns, and any
 * label it does not recognise. Copy the tab first if the file holds more than config.
 */
function resetConfigSheet(sheetId) {
  const ss = SpreadsheetApp.openById(resolveSheetId_(sheetId));
  const existing = ss.getSheetByName(SHEET_NAME_CONFIG);
  const carried = existing ? readConfig_(ss) : null;
  // Only the layout is being reset, so the file stays the level it already was - otherwise
  // resetting a Creator file would quietly reseed it as Explorer, link directory and all.
  const levelTitle = carried ? SCORE_LEVEL_TITLES[carried.level] : '';

  // Guessing here would rebuild the file as the wrong level, and this deletes the tab
  // before it writes, so refuse instead.
  if (carried && !levelTitle) {
    throw new Error(
      'Config Level must be Explorer, Creator, Innovator, or Master before the tab can be '
      + 'rebuilt; received "' + carried.level + '".'
    );
  }

  // Put it back where it was rather than at the end of the tab strip.
  const index = existing ? existing.getIndex() : 0;
  if (existing) ss.deleteSheet(existing);

  return createConfigSheet_(ss, levelTitle, carried, index);
}

/**
 * The editor's Run button takes a function name and no arguments, so each file gets its
 * own entry in the dropdown. IDs come from LEVEL_SHEET_IDS, which is the same list the
 * Explorer link directory is built from - there is no second copy to keep in step.
 *
 * Run them one at a time and check the file in between; this rewrites a live Config tab.
 */
function resetConfigExplorer() {
  return resetConfigSheet(LEVEL_SHEET_IDS[0][1]);
}

function resetConfigCreator() {
  return resetConfigSheet(LEVEL_SHEET_IDS[1][1]);
}

function resetConfigInnovator() {
  return resetConfigSheet(LEVEL_SHEET_IDS[2][1]);
}

function resetConfigMaster() {
  return resetConfigSheet(LEVEL_SHEET_IDS[3][1]);
}

function readConfig_(ss) {
  // A file with no Config tab has no level to preserve, so it is seeded as Explorer.
  const sheet = ss.getSheetByName(SHEET_NAME_CONFIG) || createConfigSheet_(ss, '');
  const data = sheet.getDataRange().getValues();
  // Asked for only when a cell turns out to be a real Date. A tab written by
  // createConfigSheet_ is plain text throughout, so on those files this round trip is
  // never made at all.
  let zone = '';
  const tz = function () {
    if (!zone) zone = ss.getSpreadsheetTimeZone();
    return zone;
  };

  const config = {
    competition: 'Synapse City',
    competitionDate: '',
    rounds: [],
    endTime: '',
    level: '',
    judges: [],
    teams: [],
    // null where the tab does not group teams under judges, which is how the scoresheet
    // tells "this judge scores these five" from "everyone scores everything".
    teamsByJudge: null
  };

  const roster = readJudgeTeams_(data);
  config.judges = roster.judges;
  config.teams = roster.teams;
  config.teamsByJudge = roster.grouped ? roster.teamsByJudge : null;

  const roundTimes = {};

  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length - 1; c++) {
      const label = normalizeLabel_(data[r][c]);

      const roundNumber = CONFIG_ROUND_LABELS[label];
      if (roundNumber) {
        const time = formatConfigValue_(data[r][c + 1], 'roundTime', tz);
        if (time) roundTimes[roundNumber] = time;
        continue;
      }

      const field = CONFIG_LABELS[label];
      if (!field) continue;

      const value = formatConfigValue_(data[r][c + 1], field, tz);
      if (value) config[field] = value;
    }
  }

  config.rounds = [1, 2]
    .filter((n) => roundTimes[n])
    .map((n) => ({ round: n, time: roundTimes[n] }));

  config.level = config.level.toLowerCase();
  return config;
}

/** Where the first header cell matching one of `headers` sits, or null if there is none. */
function findConfigColumn_(data, headers) {
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (headers.indexOf(normalizeLabel_(data[r][c])) !== -1) return { row: r, column: c };
    }
  }
  return null;
}

function cellText_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/**
 * Judges and the teams that belong to them, read as one block rather than two lists.
 *
 * A name in the Judge column opens a group and every team below it belongs to that judge,
 * until the next name appears. Blank rows are separators an organiser may or may not leave
 * between groups, so they never close one.
 *
 * The older layout put one team beside each judge and meant nothing by the pairing. Both
 * still parse. They are told apart by whether any team sits on a row with no judge beside
 * it, which only the grouped layout produces - counting teams per judge would misread a
 * group that happens to hold one.
 */
function readJudgeTeams_(data) {
  const judgeColumn = findConfigColumn_(data, CONFIG_JUDGE_HEADERS);
  const teamColumn = findConfigColumn_(data, CONFIG_TEAM_HEADERS);
  if (!judgeColumn || !teamColumn) return { judges: [], teams: [], teamsByJudge: {}, grouped: false };

  const judges = [];
  const teams = [];
  const teamsByJudge = {};
  let current = '';
  let grouped = false;

  for (let r = Math.max(judgeColumn.row, teamColumn.row) + 1; r < data.length; r++) {
    const judge = cellText_(data[r][judgeColumn.column]);
    const team = cellText_(data[r][teamColumn.column]);

    if (judge) {
      current = judge;
      if (judges.indexOf(judge) === -1) {
        judges.push(judge);
        teamsByJudge[judge] = [];
      }
    }

    if (!team) continue;
    // A team standing on its own row belongs to the judge above it, and says so.
    if (!judge && current) grouped = true;
    if (teams.indexOf(team) === -1) teams.push(team);
    if (current && teamsByJudge[current].indexOf(team) === -1) teamsByJudge[current].push(team);
  }

  return { judges: judges, teams: teams, teamsByJudge: teamsByJudge, grouped: grouped };
}

/**
 * The Judge/Team block as [judge, team] rows, written back the way it was read: a judge
 * opens a group and their teams run down beside an empty Judge cell, one blank row between
 * groups. Without grouping it falls back to the flat pairing the old tabs used.
 */
function buildRosterRows_(judges, teams, teamsByJudge) {
  const rows = [];

  if (!teamsByJudge) {
    for (let i = 0; i < Math.max(judges.length, teams.length); i++) {
      rows.push([judges[i] || '', teams[i] || '']);
    }
    return rows;
  }

  judges.forEach(function (judge, index) {
    const owned = Array.isArray(teamsByJudge[judge]) ? teamsByJudge[judge] : [];
    if (index > 0) rows.push(['', '']);

    rows.push([judge, owned[0] || '']);
    for (let i = 1; i < owned.length; i++) rows.push(['', owned[i]]);
  });

  return rows;
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
    const pattern = field === 'competitionDate' ? 'dd/MM/yyyy' : 'HH:mm:ss';
    // tz is a function, not a string: the file's zone is only worth a round trip once a
    // Date has actually turned up, and most tabs never produce one.
    return Utilities.formatDate(cell, tz(), pattern);
  }
  return String(cell).trim();
}

function createConfigSheet_(ss, levelTitle, config, index) {
  const level = SCORE_LEVEL_TITLES[String(levelTitle || '').toLowerCase()] || 'Explorer';
  const template = buildConfigTemplate_(level, ss.getId(), config);
  const rows = template.rows.length;
  const cols = template.rows[0].length;

  const sheet = index > 0
    ? ss.insertSheet(SHEET_NAME_CONFIG, index - 1)
    : ss.insertSheet(SHEET_NAME_CONFIG);

  // Plain text on the value column, set before writing: otherwise Sheets turns dates and
  // times into values and reformats them to whatever the locale prefers. Only the config
  // block needs it - the link rows below are left alone so Sheets can still linkify them.
  sheet.getRange(1, 5, template.blockRows, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows, cols).setValues(template.rows);

  // Every label lives in column D; Level and the Judge / Team headers are the exceptions.
  sheet.getRange(1, 4, rows, 1).setFontWeight('bold');
  sheet.getRange('A1').setFontWeight('bold');
  sheet.getRange('A4:B4').setFontWeight('bold');
  if (template.directoryRow) {
    sheet.getRange(template.directoryRow, 5, 1, 2).setFontWeight('bold');
  }

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 24);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 430);
  sheet.setColumnWidth(6, 430);

  return sheet;
}

/**
 * POST Handler: Appends a scoring run into Scores tab
 */
function doPost(e) {
  const startTime = Date.now();
  const lock = LockService.getScriptLock();
  let targetSs = null;
  let body = null;
  let id = '';
  let sheetId = '';
  let photoSizeKb = 0;
  let levelTitle = '';
  let waitStart = 0;
  let lockedAt = 0;
  // Filled in on the way out and written once the lock is back, never while holding it.
  let pending = null;

  try {
    body = JSON.parse(e.postData.contents);
    if (body.key !== SHARED_KEY) {
      return json({ ok: false, error: 'unauthorized' });
    }

    // A photo sent ahead of the run it belongs to: no lock, no Sheet, nothing to dedupe.
    // Answering it here is what keeps Drive file creation out of the Submit a judge waits on.
    if (body.action === 'photo') return handlePhotoUpload_(body, startTime);

    id = String(body.submissionId || Utilities.getUuid());

    // Opened before the cache check so a duplicate has somewhere to be recorded. A retry
    // is a real execution against the quota, and its rate is the first sign of a bad link.
    sheetId = resolveSheetId_(body.sheetId || body.link);
    targetSs = SpreadsheetApp.openById(sheetId);

    // Deduplication via cache
    const cache = CacheService.getScriptCache();
    const cachedRow = cache.get(id);
    if (cachedRow) {
      pending = {
        action: 'Submit',
        sheetId: sheetId,
        judge: body.judge || '',
        team: body.team || '',
        total: secondsSince_(startTime),
        status: 'DUPLICATE',
        submissionId: id,
        error: 'Answered from cache, row ' + cachedRow
      };
      return json({ ok: true, duplicate: true, submissionId: id, row: Number(cachedRow) });
    }

    const photo = resolvePhoto_(body, id);
    // Only a file this execution created spends the day's Drive allowance; one sent ahead
    // was already counted on its own log row, and counting it twice would overstate usage.
    photoSizeKb = photo.created ? photo.sizeKb : 0;

    // Wait for lock to append row safely
    waitStart = Date.now();
    lock.waitLock(30000);
    lockedAt = Date.now();

    const sheet = prepareScoreSheet_(targetSs);
    levelTitle = sheet.getName().slice(SCORE_SHEET_PREFIX.length);
    const s = body.scores || {};

    sheet.appendRow([
      new Date(),
      body.deviceId || '',
      levelTitle,
      body.judge || '',
      body.team || '',
      body.round !== undefined && body.round !== '' ? Number(body.round) : '',
      Number(body.totalScore) || 0,
      body.missionTime || '',
      body.tryCount !== undefined && body.tryCount !== '' ? Number(body.tryCount) : '',
      '',
      s.green || '',
      s.blue || '',
      s.purple || '',
      s.mystery || '',
      s.red || '',
      s.yellow1 || '',
      s.yellow2 || '',
      s.leanbot1 ? 'CRL' : '',
      s.leanbot2 ? 'CRL' : '',
      photo.url,
      // Blank rather than 0 for a run with no photo, so it reads like the empty Photo URL
      // beside it instead of like a photo that measured nothing.
      photo.sizeKb || '',
      id,
      String(body.userAgent || '').slice(0, 200)
    ]);

    const row = sheet.getLastRow();
    // appendRow() can apply the default date-time format to the newly written Date even
    // when the column was formatted already, so format this exact cell after the append.
    sheet.getRange(row, 1).setNumberFormat(SUBMISSION_TIME_FORMAT);
    cache.put(id, String(row), 21600); // 6 hours

    pending = {
      action: 'Submit',
      sheetId: sheetId,
      level: levelTitle,
      judge: body.judge || '',
      team: body.team || '',
      total: secondsSince_(startTime),
      wait: secondsBetween_(waitStart, lockedAt),
      work: secondsSince_(lockedAt),
      photoSizeKb: photoSizeKb,
      status: 'OK',
      submissionId: id
    };

    return json({ ok: true, submissionId: id, row: row });

  } catch (err) {
    pending = {
      action: 'Submit',
      sheetId: sheetId,
      level: levelTitle,
      judge: body ? body.judge : '',
      team: body ? body.team : '',
      total: secondsSince_(startTime),
      // A run that never got the lock has no work time, only the wait that timed out -
      // which is exactly the number that explains a 30 second failure.
      wait: waitStart ? secondsBetween_(waitStart, lockedAt || Date.now()) : '',
      work: lockedAt ? secondsSince_(lockedAt) : '',
      photoSizeKb: photoSizeKb,
      status: 'ERROR',
      submissionId: id,
      error: String(err)
    };
    return json({ ok: false, error: String(err) });

  } finally {
    // Release first: bookkeeping for one run must not hold up the next. The lock is shared
    // by every spreadsheet on this deployment, so anything left inside it costs everyone.
    lock.releaseLock();
    if (pending) logActivity_(pending);
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

/** Returns the display form of Config Level, for example "Explorer". */
function getScoreLevelTitle_(ss) {
  const level = readConfig_(ss).level;
  const levelTitle = SCORE_LEVEL_TITLES[level];

  if (!levelTitle) {
    throw new Error(
      'Config Level must be Explorer, Creator, Innovator, or Master; received "' + level + '".'
    );
  }

  return levelTitle;
}

/** Returns the active Scores tab name, for example "Scores - Explorer". */
function getScoreSheetName_(ss) {
  return SCORE_SHEET_PREFIX + getScoreLevelTitle_(ss);
}

/**
 * Finds the active Scores tab. This also recognizes the old "Scores" name and a tab
 * carrying a different level name, which is what a newly copied spreadsheet contains.
 */
function findScoreSheet_(ss, expectedName) {
  const exact = ss.getSheetByName(expectedName);
  if (exact) return exact;

  const legacy = ss.getSheetByName(LEGACY_SHEET_NAME_SCORES);
  if (legacy) return legacy;

  const levelSheets = ss.getSheets().filter(function (sheet) {
    return /^Scores - (Explorer|Creator|Innovator|Master)$/.test(sheet.getName());
  });

  if (levelSheets.length > 1) {
    throw new Error(
      'More than one active level Scores tab was found. Keep only the tab for this file\'s level.'
    );
  }

  return levelSheets.length === 1 ? levelSheets[0] : null;
}

/** Creates the level Scores tab or renames the copied/legacy tab to the current level. */
function ensureScoreSheet_(ss, levelTitle) {
  const expectedName = SCORE_SHEET_PREFIX + (levelTitle || getScoreLevelTitle_(ss));
  let sheet = findScoreSheet_(ss, expectedName);

  if (!sheet) return ss.insertSheet(expectedName);
  if (sheet.getName() !== expectedName) sheet.setName(expectedName);
  return sheet;
}

/**
 * Upgrades the old Scores layout by inserting Level before Judge, a blank separator
 * between Try and Green, and Photo Size (KB) after Photo URL. Existing rows keep their
 * data aligned through all three migrations; the sizes of photos already sent are not
 * known, so those cells stay empty.
 */
function ensureScoreSheetSchema_(sheet, levelTitle, sheetId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'schema:' + sheetId;
  if (sheetId && cache.get(cacheKey)) return;

  if (sheet.getLastRow() === 0) {
    writeScoreHeaders_(sheet);
    if (sheetId) cache.put(cacheKey, '1', SCHEMA_CACHE_TTL);
    return;
  }

  // One read of the header row rather than one per column inspected. Bounded by what the
  // tab actually has, because an unmigrated tab is narrower than HEADERS_SCORES.
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const headerAt = function (column) {
    const value = header[column - 1];
    return String(value === null || value === undefined ? '' : value).trim();
  };

  const thirdHeader = headerAt(3);

  if (thirdHeader === 'Judge') {
    sheet.insertColumnBefore(3);
    sheet.getRange(1, 3).setValue('Level').setFontWeight('bold');

    const dataRowCount = sheet.getLastRow() - 1;
    if (dataRowCount > 0) {
      const levels = Array.from({ length: dataRowCount }, function () {
        return [levelTitle];
      });
      sheet.getRange(2, 3, dataRowCount, 1).setValues(levels);
    }
  } else if (thirdHeader !== 'Level') {
    throw new Error(
      'Unexpected Scores layout: cell C1 must be "Level" (new) or "Judge" (old).'
    );
  }

  // After the Level migration, Try is column I. Older layouts put Green immediately in J;
  // insert a blank J so the mission columns begin at K without shifting row values apart.
  const headerAfterTry = headerAt(10);
  const followingHeader = headerAt(11);

  if (headerAfterTry === 'Green') {
    sheet.insertColumnBefore(10);
  } else if (headerAfterTry !== '' || followingHeader !== 'Green') {
    throw new Error(
      'Unexpected Scores layout: the column after Try must be blank and followed by Green.'
    );
  }

  // Photo Size sits beside Photo URL in column T, so U is either it or the Submission ID
  // that used to follow. Anything else is a layout this cannot safely widen.
  const headerAfterPhotoUrl = headerAt(21);

  if (headerAfterPhotoUrl === 'Submission ID') {
    sheet.insertColumnBefore(21);
    sheet.getRange(1, 21).setValue('Photo Size (KB)').setFontWeight('bold');
  } else if (headerAfterPhotoUrl !== 'Photo Size (KB)') {
    throw new Error(
      'Unexpected Scores layout: cell U1 must be "Photo Size (KB)" (new) or "Submission ID" (old).'
    );
  }

  formatSubmissionTimeColumn_(sheet);
  if (sheetId) cache.put(cacheKey, '1', SCHEMA_CACHE_TTL);
}

function cacheLevelTitle_(sheetId, levelTitle) {
  if (!sheetId || !levelTitle) return;
  CacheService.getScriptCache().put('level:' + sheetId, levelTitle, LEVEL_CACHE_TTL);
}

/**
 * Config says which level a file is, and that answer outlives one submit. Read it from
 * cache where there is one; otherwise ask Config and remember what it said.
 */
function cachedLevelTitle_(ss, sheetId) {
  const cached = sheetId ? CacheService.getScriptCache().get('level:' + sheetId) : '';
  if (cached) return cached;

  const levelTitle = getScoreLevelTitle_(ss);
  cacheLevelTitle_(sheetId, levelTitle);
  return levelTitle;
}

/** Called when Config is edited, so the next submit asks Config rather than the cache. */
function invalidateSheetCache_(sheetId) {
  if (!sheetId) return;
  CacheService.getScriptCache().removeAll(['level:' + sheetId, 'schema:' + sheetId]);
}

function prepareScoreSheet_(ss) {
  const sheetId = ss.getId();
  const levelTitle = cachedLevelTitle_(ss, sheetId);
  const sheet = ensureScoreSheet_(ss, levelTitle);
  ensureScoreSheetSchema_(sheet, levelTitle, sheetId);
  return sheet;
}

/**
 * Container-bound copies run these simple triggers automatically. Opening a copy or
 * editing its Config tab updates the Scores tab name after its Level changes.
 */
function onOpen(e) {
  const ss = e && e.source ? e.source : SpreadsheetApp.getActiveSpreadsheet();
  if (ss) prepareScoreSheet_(ss);
}

function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== SHEET_NAME_CONFIG) return;

  // Config just changed, so whatever was cached about this file is no longer trustworthy.
  invalidateSheetCache_(e.source.getId());
  prepareScoreSheet_(e.source);
}

function writeScoreHeaders_(sheet) {
  sheet.getRange(1, 1, 1, HEADERS_SCORES.length)
    .setValues([HEADERS_SCORES])
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  // The cell keeps a full timestamp so sorting still works across a day; only the display
  // drops the date. Applied to the whole column so appended rows inherit it.
  formatSubmissionTimeColumn_(sheet);
}

function formatSubmissionTimeColumn_(sheet) {
  sheet.getRange('A:A').setNumberFormat(SUBMISSION_TIME_FORMAT);
}

/**
 * Starts a fresh Scores tab with the column order above. Run by hand from the editor.
 * The old tab is renamed, never deleted: its rows follow the previous column order and the
 * two orders cannot share one tab.
 */
function resetScoresSheet() {
  const ss = SpreadsheetApp.openById(DEFAULT_SHEET_ID);
  const scoreSheetName = getScoreSheetName_(ss);
  const existing = findScoreSheet_(ss, scoreSheetName);

  if (existing) {
    const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HHmm');
    existing.setName(scoreSheetName + ' (old ' + stamp + ')');
  }

  writeScoreHeaders_(ss.insertSheet(scoreSheetName));
}

/**
 * Drive shows the file name, so the extension has to match what the bytes actually are:
 * the client writes WebP where the browser can encode it and JPEG where it cannot, and
 * one deployment serves both.
 */
const PHOTO_EXTENSIONS = { 'image/webp': 'webp', 'image/png': 'png' };
// A run hands back a URL it was given rather than one this code produced, so accept only
// what Drive itself would have returned.
const PHOTO_URL_PREFIX = 'https://drive.google.com/';
const PHOTO_CACHE_TTL = 21600;

/**
 * Stores one photo and says where it went. Called the moment the judge takes it, while
 * they are still scoring, so the run itself never pays the ~2.4s a Drive file costs.
 *
 * The URL is cached under the id the client chose as well as returned. A reply that does
 * not survive the redirect Apps Script answers with would otherwise strand a file nothing
 * can reference; this way the run can still ask for it by id.
 */
function handlePhotoUpload_(body, startTime) {
  const sheetId = resolveSheetId_(body.sheetId || body.link);
  const photoId = String(body.photoId || Utilities.getUuid());
  let sizeKb = 0;

  try {
    sizeKb = body.photoBase64 ? Math.round(body.photoBase64.length * 0.75 / 1024) : 0;
    const photoUrl = body.photoBase64 ? savePhoto_(photoId, body.photoBase64) : '';
    if (photoUrl) {
      CacheService.getScriptCache().put('photo:' + photoId, photoUrl + '|' + sizeKb, PHOTO_CACHE_TTL);
    }

    logActivity_({
      action: 'Photo',
      sheetId: sheetId,
      total: secondsSince_(startTime),
      // Only a size that belongs to a file that exists: the dashboard counts a row with
      // one as a Drive file created, and a failed upload created nothing.
      photoSizeKb: photoUrl ? sizeKb : 0,
      status: photoUrl ? 'OK' : 'ERROR',
      submissionId: photoId,
      error: photoUrl ? '' : 'No image data, or the Drive folder is not set'
    });

    return json({ ok: !!photoUrl, photoId: photoId, photoUrl: photoUrl, photoSizeKb: sizeKb });

  } catch (err) {
    logActivity_({
      action: 'Photo',
      sheetId: sheetId,
      total: secondsSince_(startTime),
      photoSizeKb: 0,
      status: 'ERROR',
      submissionId: photoId,
      error: String(err)
    });
    return json({ ok: false, error: String(err) });
  }
}

/**
 * Where this run's photo lives, in the order that costs least: a URL the client already
 * holds, the one cached against its id when the reply went missing, or - if neither
 * survived - the bytes carried on the run, uploaded here the way it always used to work.
 */
function resolvePhoto_(body, id) {
  const given = String(body.photoUrl || '');
  if (given.indexOf(PHOTO_URL_PREFIX) === 0) {
    return { url: given, sizeKb: Number(body.photoSizeKb) || 0, created: false };
  }

  if (body.photoId) {
    const stored = CacheService.getScriptCache().get('photo:' + String(body.photoId));
    if (stored) {
      const parts = stored.split('|');
      return { url: parts[0], sizeKb: Number(parts[1]) || 0, created: false };
    }
  }

  if (body.photoBase64) {
    const url = savePhoto_(id, body.photoBase64);
    return {
      url: url,
      sizeKb: Math.round(body.photoBase64.length * 0.75 / 1024),
      created: !!url
    };
  }

  return { url: '', sizeKb: 0, created: false };
}

function savePhoto_(id, dataUrl) {
  if (!DRIVE_FOLDER_ID) return '';
  const m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return '';

  const mime = m[1].toLowerCase();
  const name = id + '.' + (PHOTO_EXTENSIONS[mime] || 'jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), mime, name);
  return DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(blob).getUrl();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function secondsBetween_(from, to) {
  return Number(((to - from) / 1000).toFixed(2));
}

function secondsSince_(from) {
  return secondsBetween_(from, Date.now());
}

/** A number the sheet can chart, or a blank cell when the step did not happen. */
function logNumber_(value) {
  return value === undefined || value === null || value === '' ? '' : Number(value);
}

/** Maps a Sheet ID back to its level name, so a failed run still lands on the right tab. */
function levelTitleForSheet_(sheetId) {
  const match = LEVEL_SHEET_IDS.filter(function (entry) { return entry[1] === sheetId; })[0];
  return match ? match[0] : '';
}

/**
 * Which tab in the log workbook this entry belongs on. Level comes from Config when the
 * run got that far and from the Sheet ID when it did not: a duplicate answered from cache
 * never reads Config, and neither does a run whose Sheet would not open.
 */
function logSheetName_(entry) {
  const level = String(entry.level || levelTitleForSheet_(entry.sheetId || '')).toLowerCase();
  return SCORE_LEVEL_TITLES[level] ? LOG_SHEET_PREFIX + SCORE_LEVEL_TITLES[level] : LOG_SHEET_OTHER;
}

/**
 * Returns one level's tab in the log workbook, creating it when missing. A tab left over
 * from an older column order is renamed rather than appended to: the two orders cannot
 * share one sheet, and charting a column that means two different things is worse than
 * losing the old rows.
 */
function ensureLogSheet_(logSs, name) {
  let sheet = logSs.getSheetByName(name);

  if (sheet) {
    const header = sheet.getRange(LOG_HEADER_ROW, 1, 1, HEADERS_LOGS.length).getValues()[0].join('|');
    if (header === HEADERS_LOGS.join('|')) return sheet;

    const stamp = Utilities.formatDate(new Date(), logSs.getSpreadsheetTimeZone(), 'yyyy-MM-dd HHmm');
    sheet.setName(name + ' (old ' + stamp + ')');
  }

  sheet = logSs.insertSheet(name);
  sheet.getRange(LOG_HEADER_ROW, 1, 1, HEADERS_LOGS.length)
    .setValues([HEADERS_LOGS])
    .setFontWeight('bold');

  const widths = [160, 90, 100, 140, 160, 90, 90, 90, 130, 100, 220, 260];
  widths.forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });

  buildLogDashboard_(sheet);
  return sheet;
}

/**
 * Records system usage metrics into the log workbook for live monitoring.
 *
 * Call this outside the script lock. It opens a second spreadsheet and writes to it, so
 * holding the lock across it would add that whole round trip to the one section every
 * submit queues behind - and the durations it records would then be measuring its own cost.
 */
function logActivity_(entry) {
  try {
    if (!entry) return;
    const sheet = ensureLogSheet_(SpreadsheetApp.openById(LOG_SHEET_ID), logSheetName_(entry));

    sheet.appendRow([
      new Date(),
      entry.action || 'Submit',
      entry.level || levelTitleForSheet_(entry.sheetId || ''),
      entry.judge || '',
      entry.team || '',
      logNumber_(entry.total),
      logNumber_(entry.wait),
      logNumber_(entry.work),
      entry.photoSizeKb !== undefined ? Number(entry.photoSizeKb) : 0,
      entry.status || 'OK',
      entry.submissionId || '',
      entry.error || ''
    ]);

    const row = sheet.getLastRow();
    sheet.getRange(row, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  } catch (err) {
    // Non-blocking: failure in logging must never disrupt normal scoring
    console.error('System log error:', err);
  }
}

/**
 * Sheets parses a formula in the file's own locale. A file set to Vietnam - or Germany, or
 * France - separates arguments with ';' and reads ',' as a decimal point, so US-style
 * formulas written into it come back as #ERROR! in every single cell.
 *
 * Asking the file which separator it takes beats keeping a table of locales: write one
 * formula whose answer is known and read it back. A ';' file makes the probe either a
 * parse error or SUM(1.1), and neither of those is 2, so both land on the right answer.
 */
function argumentSeparator_(probe) {
  probe.setFormula('=SUM(1,1)');
  SpreadsheetApp.flush();
  const separator = probe.getValue() === 2 ? ',' : ';';
  probe.clearContent();

  return separator;
}

/**
 * Writes the dashboard that sits above the log rows in the Logs tab: a read-only block of
 * formulas over the rows underneath it, rebuilt in place and holding no data of its own.
 *
 * Only the numbers that map to a limit that actually exists are here. There is no daily
 * quota on web app executions, so nothing counts seconds against a budget; what does bind
 * is Drive file creation, and how long each run holds the script lock.
 *
 * The formulas read A18:A downward rather than whole columns, which keeps the dashboard's
 * own labels out of its own totals - text sorts above every number in a comparison, so a
 * whole-column FILTER would sweep these rows into the throughput figures.
 *
 * Which day they report on comes from B2, so any past day can be read without editing a
 * formula. The log rows themselves are never trimmed, so every day the event ran is still
 * down there to be looked at.
 */
function buildLogDashboard_(sheet) {
  const sep = argumentSeparator_(sheet.getRange(1, 26));  // Z1: clear of the layout below
  const first = LOG_FIRST_DATA_ROW;
  const col = (letter) => letter + first + ':' + letter;

  // Blank falls back to today rather than to 1899: an empty cell is zero to a date
  // comparison, and every dashboard number would read as the whole event so far.
  const day = 'IF($B$2=""' + sep + 'TODAY()' + sep + '$B$2)';
  // Both ends of the day now. '>=TODAY()' on its own was open-ended and only ever read as
  // one day because no row can be stamped in the future - which stops being true the
  // moment the day being asked about is not the last one.
  const onDay = col('A') + sep + '">="&' + day + sep + col('A') + sep + '"<"&' + day + '+1';
  const inDay = col('A') + '>=' + day + sep + col('A') + '<' + day + '+1';

  // Row numbers are referenced by the derived formulas below, so this layout is fixed.
  // Decimals are written as fractions on purpose: '0.95' is a parse error wherever ','
  // is the decimal point, while 95/100 reads the same in every locale.
  const rows = [
    [sheet.getName(), '', 'Dashboard above, log rows from ' + first
      + ' down. Rebuild with buildMonitorSheets().'],
    ['Show date', '=TODAY()',
      'Pick any past date here. Rebuilding the dashboard sets it back to today.'],
    ['ON DATE', 'Value', 'Watch'],
    ['Submissions',
      '=COUNTIFS(' + col('B') + sep + '"Submit"' + sep + col('J') + sep + '"OK"' + sep + onDay + ')',
      'Runs that reached the sheet, retries excluded'],
    ['Config loads', '=COUNTIFS(' + col('B') + sep + '"Config"' + sep + onDay + ')',
      'Metadata reads - no lock taken and no Drive file created'],
    ['Retries (duplicate)',
      '=COUNTIFS(' + col('B') + sep + '"Submit"' + sep + col('J') + sep + '"DUPLICATE"' + sep + onDay + ')',
      'Extra executions from replies the client lost'],
    ['Retry rate', '=IFERROR(B6/(B4+B6)' + sep + '0)', 'Over 10% - look at the venue network'],
    ['Errors', '=COUNTIFS(' + col('J') + sep + '"ERROR"' + sep + onDay + ')',
      'Any row below is worth reading'],
    ['Photos created', '=COUNTIFS(' + col('I') + sep + '">0"' + sep + onDay + ')',
      'One Drive file each - the only cap this app spends per day'],
    ['Quota used', '=IFERROR(B9/' + PHOTO_QUOTA_PER_DAY + sep + '0)',
      'Of ' + PHOTO_QUOTA_PER_DAY + '/day on Workspace; 250 on a consumer account'],
    ['Upload size (MB)', '=ROUND(SUMIFS(' + col('I') + sep + onDay + ')/1024' + sep + '1)',
      'Reference only - storage is not the limit'],
    ['p95 Work (s)',
      '=IFERROR(PERCENTILE(FILTER(' + col('H') + sep + col('B') + '="Submit"' + sep
        + col('J') + '="OK"' + sep + inDay + ')' + sep + '95/100)' + sep + '0)',
      'Time spent holding the script lock - photos upload before it is taken'],
    ['Capacity (submits/min)', '=IFERROR(60/B12' + sep + '0)',
      'For the whole deployment, all four files'],
    ['Burst headroom (judges)', '=IFERROR(INT(30/B12)+1' + sep + '0)',
      'Submitting at once before one hits the 30s lock timeout'],
    ['Longest lock wait (s)',
      '=IFERROR(MAX(FILTER(' + col('G') + sep + inDay + '))' + sep + '0)',
      'Approaching 30 means the next judge gets refused']
  ];

  sheet.getRange(1, 1, LOG_DASHBOARD_ROWS, 3).clearContent();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);

  sheet.getRange('A1').setFontWeight('bold').setFontSize(13);
  sheet.getRange('A2').setFontWeight('bold');
  sheet.getRange('A3:C3').setFontWeight('bold');
  sheet.getRange('B4:B15').setHorizontalAlignment('right');
  sheet.getRange('C1:C15').setFontColor('#64748b');

  // Boxed because it is the one cell here meant to be typed in; everything else is output.
  // The pattern is written in the API's own tokens, which do not follow the file's locale.
  //
  // The date rule is what puts a calendar on a double click, which is the point of it. It
  // warns rather than refuses: refusing would also refuse the '=TODAY()' this very function
  // writes on the next rebuild, and a warning triangle already says enough.
  sheet.getRange('B2')
    .setNumberFormat('yyyy-mm-dd')
    .setHorizontalAlignment('right')
    .setFontWeight('bold')
    .setBackground('#fffbeb')
    .setBorder(true, true, true, true, false, false, '#d97706',
      SpreadsheetApp.BorderStyle.SOLID)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireDate()
        .setAllowInvalid(true)
        .setHelpText('Pick the day to report on. Clear the cell to fall back to today.')
        .build()
    );

  // Column C is narrow because the log's Level column shares it; the hints spill into the
  // empty cells to their right, which is why nothing else is written in D:L up here.
  const formats = ['0', '0', '0', '0.0%', '0', '0', '0.0%', '0.0', '0.00', '0.0', '0', '0.00'];
  formats.forEach(function (format, i) {
    sheet.getRange(i + 4, 2).setNumberFormat(format);
  });

  sheet.setFrozenRows(LOG_HEADER_ROW);

  // Amber says look, red says act. Only the four numbers that can warn before a failure.
  const amber = { background: '#fef7e0', color: '#b45309' };
  const red = { background: '#fce8e6', color: '#b91c1c' };
  // Sheets applies the first rule that matches, so each red threshold has to be listed
  // ahead of its amber one - the other way round, amber would swallow every red value.
  sheet.setConditionalFormatRules([
    threshold_(sheet.getRange('B8'), 1, red),
    threshold_(sheet.getRange('B7'), 0.1, amber),
    threshold_(sheet.getRange('B10'), 0.8, red),
    threshold_(sheet.getRange('B10'), 0.5, amber),
    threshold_(sheet.getRange('B15'), 20, red),
    threshold_(sheet.getRange('B15'), 10, amber)
  ]);

  return sheet;
}

function threshold_(range, atLeast, style) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThanOrEqualTo(atLeast)
    .setBackground(style.background)
    .setFontColor(style.color)
    .setRanges([range])
    .build();
}

/**
 * Rebuilds one level's Ranking tab on request and answers with a page a person can read,
 * because the thing clicking this is a browser tab, not the scoresheet.
 *
 * Behind the shared key: doGet is otherwise read-only, and this one writes.
 */
function handleRankingRequest_(params, startTime) {
  const sheetId = resolveSheetId_(params.sheetId || params.link);

  try {
    if (params.key !== SHARED_KEY) throw new Error('Wrong or missing key.');

    const sheet = buildRankingSheet(sheetId);
    const seconds = secondsSince_(startTime);

    logActivity_({
      action: 'Ranking',
      sheetId: sheetId,
      total: seconds,
      status: 'OK'
    });

    return rankingPage_('Rebuilt "' + sheet.getName() + '" in ' + seconds + ' s.', true);

  } catch (err) {
    logActivity_({
      action: 'Ranking',
      sheetId: sheetId,
      total: secondsSince_(startTime),
      status: 'ERROR',
      error: String(err)
    });

    return rankingPage_(String(err), false);
  }
}

function rankingPage_(message, ok) {
  const colour = ok ? '#15803d' : '#b91c1c';

  return HtmlService.createHtmlOutput(
    '<div style="font:16px/1.5 system-ui,sans-serif;padding:24px;color:' + colour + '">'
    + '<strong>' + (ok ? 'Ranking updated' : 'Ranking failed') + '</strong>'
    + '<p style="color:#334155">' + message.replace(/[<>&]/g, ' ') + '</p>'
    + '<p style="color:#64748b;font-size:14px">Close this tab and go back to the Sheet.</p>'
    + '</div>'
  );
}

/**
 * One row per team, one block of five columns per round, in a 'Ranking - <Level>' tab
 * beside the Scores tab it is built from.
 *
 * Rebuilt on demand rather than kept live. A formula version would recalculate on every
 * appended row, which is every submit, and this reads the whole Scores tab to do its work.
 * Run it from the editor when you want the standings, or point a time-driven trigger at
 * buildRankingSheets().
 *
 * Normalized is written as a formula against the Base Top Score in the header, so it
 * follows a hand-edited Raw Score without waiting for the next rebuild.
 */
function buildRankingSheet(sheetId) {
  const ss = SpreadsheetApp.openById(resolveSheetId_(sheetId || DEFAULT_SHEET_ID));
  const levelTitle = getScoreLevelTitle_(ss);
  const scores = findScoreSheet_(ss, SCORE_SHEET_PREFIX + levelTitle);

  if (!scores) throw new Error('No "' + SCORE_SHEET_PREFIX + levelTitle + '" tab in this file.');

  // Read once and used twice: the roster below, and the schedule that decides which
  // submissions are allowed to count at all.
  const config = readConfig_(ss);
  const tally = readLatestRuns_(scores, config, ss.getSpreadsheetTimeZone());
  // Exactly the Config list, no more and no less. The ranking is the roster, so a team with
  // no run yet still gets its row and nothing outside Config gets one at all. The order the
  // rows end up in is decided further down, by the standings.
  const teams = config.teams;
  const name = RANKING_SHEET_PREFIX + levelTitle;
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  ensureRankingLayout_(sheet);
  writeRankingHeaders_(sheet);

  // Probed once here rather than inside each writer: it costs a write and a flush, and all
  // of them need it. A3 is the blank row, so this borrows the one cell on the tab that is
  // guaranteed to have nothing to put back.
  const sep = argumentSeparator_(sheet.getRange(RANKING_BLANK_ROW, 1));

  // Written twice, and that is the design. The standings decide the row order, the standings
  // are formulas, and a formula's answer is not knowable until Sheets has evaluated it - so
  // the first pass exists to be read back, and the second puts the same rows down in the
  // order that read produced. Working the placings out in JavaScript instead would avoid the
  // second pass at the price of a second definition of Normalized, and those two would drift.
  writeRankingRows_(sheet, teams, tally.runs, sep);
  applyTopScores_(sheet, sep);

  const order = rankRankingRows_(sheet, teams.length);
  writeRankingRows_(sheet, order.map(function (entry) { return teams[entry.at]; }),
    tally.runs, sep);
  writeRankPlaces_(sheet, order);

  // The table is complete and rows 1 and 2 are still empty, which is the one moment the
  // columns can be measured against the table alone.
  autoSizeRankingColumns_(sheet);

  // And now the two rows that were kept out of the way, free to spill as far as they need.
  writeRankingLink_(sheet, ss.getId());
  writeInvalidNotice_(sheet, tally);

  // Last, so the stamp means "this tab was rebuilt" and not "a rebuild was attempted". A
  // step above throwing leaves the previous time standing, which is the true one.
  writeRankingStamp_(sheet);

  // After the stamp, and deliberately: it is the Ranking tab the stamp speaks for, and a
  // Result tab that fails to build should not make a finished rebuild look unfinished.
  buildResultSheet_(ss, sheet, levelTitle, teams.length);
  return sheet;
}

/**
 * "Result - <Level>": the standings in one flat table, in the order the Ranking tab put
 * them, with each team's details from the Team Data tab beside them.
 *
 * Read off the Ranking tab, not rebuilt from the runs. Everything here has already been
 * decided one screen away, and deciding it twice is how two tabs come to name two different
 * champions.
 *
 * Values, not formulas. This is a result: a record of what the standings said when it was
 * made, which is exactly what a sheet meant to be printed, sent on or signed should be.
 */
function buildResultSheet_(ss, ranking, levelTitle, rows) {
  const name = RESULT_SHEET_PREFIX + levelTitle;
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  // Before the clear, and this is the only thing on the tab that has to survive one. It is
  // typed by a person and belongs to them; everything else here this script wrote itself.
  const url = readTeamDataUrl_(sheet);

  // Wholesale, every rebuild. Nothing else on this tab is not written in the lines below,
  // and a clear is the only thing that makes a column which has stopped being written stop
  // being shown - notes included, which clear() does not take.
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();

  sheet.getRange(RESULT_HEADER_ROW, 1, 1, RESULT_COLUMNS.length)
    .setValues([RESULT_COLUMNS])
    .setFontWeight('bold');
  sheet.setFrozenRows(RESULT_HEADER_ROW);

  if (rows) {
    // The Ranking tab was written by this same execution and half of it is formulas, so
    // without this the read below comes back on an empty tab.
    SpreadsheetApp.flush();

    const standings = ranking
      .getRange(RANKING_FIRST_DATA_ROW, 1, rows, RANKING_OVERALL_END)
      .getValues();
    const details = readTeamData_(resolveTeamDataSheet_(ss, url), levelTitle);
    const blank = RESULT_TEAM_DATA_COLUMNS.map(function () { return ''; });

    const values = standings.map(function (row) {
      const team = cellText_(row[0]);

      return [row[RANKING_RANK_COLUMN - 1], team, levelTitle]
        .concat(details[teamKey_(team)] || blank)
        .concat([
          row[RANKING_BEST_SCORE_COLUMN - 1],
          row[RANKING_VARIATION_COLUMN - 1],
          row[RANKING_BEST_TRY_COLUMN - 1],
          row[RANKING_BEST_TIME_COLUMN - 1]
        ]);
    });

    // Text format before the values, not after. A Code of "007" written into a General cell
    // is the number 7 by the time any format could rescue it.
    ['Team ID'].concat(RESULT_TEAM_DATA_COLUMNS).concat(['Time']).forEach(function (label) {
      sheet.getRange(RESULT_FIRST_DATA_ROW, resultColumn_(label), rows, 1)
        .setNumberFormat('@');
    });

    sheet.getRange(RESULT_FIRST_DATA_ROW, 1, rows, RESULT_COLUMNS.length).setValues(values);

    sheet.getRange(RESULT_FIRST_DATA_ROW, resultColumn_('Rank'), rows, 1)
      .setNumberFormat(RANKING_INTEGER_DIGITS);
    sheet.getRange(RESULT_FIRST_DATA_ROW, resultColumn_('Try'), rows, 1)
      .setNumberFormat(RANKING_INTEGER_DIGITS);
    ['Best Score', 'Variation'].forEach(function (label) {
      sheet.getRange(RESULT_FIRST_DATA_ROW, resultColumn_(label), rows, 1)
        .setNumberFormat(RANKING_NORMALIZED_DIGITS);
    });
  }

  // Sized against the table, with the two preamble rows still empty - the same order the
  // Ranking tab uses, and for the same reason: a link is a line to read, not a column width.
  sheet.autoResizeColumns(1, RESULT_COLUMNS.length);

  sheet.getRange(RESULT_LABEL_ROW, 1).setValue(RESULT_URL_LABEL).setFontWeight('bold');

  // Put back exactly as it was found. A URL that could not be used has already thrown by
  // now, so anything reaching here is either working or deliberately blank - and blank
  // shows the placeholder again rather than an empty cell nobody would think to fill.
  sheet.getRange(RESULT_URL_ROW, 1)
    .setNumberFormat('@')
    .setValue(url || RESULT_URL_PLACEHOLDER)
    .setFontColor(url ? null : '#9aa0a6')
    .setFontStyle(url ? 'normal' : 'italic');
  return sheet;
}

/**
 * The Team Data URL a person typed on this tab, or '' for none.
 *
 * Read before the rebuild wipes the tab, and only believed when it looks like a link. This
 * cell sat inside the table in the first version of this sheet, so on a tab built by that
 * version it holds a team's Rank - a number, not a link, and quietly ignored rather than
 * reported as a broken URL.
 */
function readTeamDataUrl_(sheet) {
  const text = cellText_(sheet.getRange(RESULT_URL_ROW, 1).getValue());
  return /^https?:\/\//i.test(text) ? text : '';
}

/**
 * The tab holding Team Data: the one a URL names, or the one in this file.
 *
 * Two different silences on purpose. No URL means nobody has asked for anything, so a
 * missing "Team Data" tab is simply a file without one and the roster columns come out
 * blank. A URL that cannot be used is the opposite - somebody stated where the data is and
 * the statement is false - and that throws, naming what it could not do. The Result tab is
 * built after the Ranking tab is finished and stamped, so nothing already earned is lost.
 *
 * gid is what makes any tab reachable, not just one named "Team Data". A link without one -
 * someone copied the address bar before clicking the tab - falls back to the name.
 */
function resolveTeamDataSheet_(ss, url) {
  if (!url) return findTeamDataSheet_(ss);

  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  if (!id) throw new Error('Team Data URL is not a Google Sheets link: ' + url);

  let book;
  try {
    book = SpreadsheetApp.openById(id[1]);
  } catch (err) {
    throw new Error('Team Data URL could not be opened - check the link and that this '
      + 'account may read that file: ' + url);
  }

  // Tested for a match, not for truth: gid=0 is the first tab of every file and is a
  // perfectly good answer that reads as false.
  const gid = /[#?&]gid=(\d+)/.exec(url);
  if (!gid) {
    const named = findTeamDataSheet_(book);
    if (named) return named;

    throw new Error('Team Data URL names no tab (no gid) and "' + book.getName()
      + '" has no "' + RESULT_TEAM_DATA_SHEET + '" tab.');
  }

  const wanted = Number(gid[1]);
  const found = book.getSheets().filter(function (tab) {
    return tab.getSheetId() === wanted;
  })[0];

  if (!found) {
    throw new Error('Team Data URL points at gid ' + wanted + ', which "' + book.getName()
      + '" has no tab for.');
  }

  return found;
}

/** A column of the Result tab, by name. Loud for the same reason overallColumn_ is. */
function resultColumn_(label) {
  const at = RESULT_COLUMNS.indexOf(label);
  if (at === -1) throw new Error('Result: no column named "' + label + '".');
  return at + 1;
}

/**
 * A Team ID as a join key. Config and Team Data are two lists kept by two people, and a
 * lone difference of case between them would blank the roster half of every result row
 * without anything anywhere saying why.
 */
function teamKey_(value) {
  return cellText_(value).toUpperCase();
}

/**
 * The Team Data tab, keyed by Team ID.
 *
 * Optional at every step. No tab, no Team ID column on it, or a column named something this
 * does not recognise, and those cells come out blank. That tab is kept by hand and is not
 * what the competition runs on; refusing to publish a result because a school name is
 * missing would be the wrong trade during an event. Which tab this is was settled by
 * resolveTeamDataSheet_, which is where a URL that names nothing real is reported.
 *
 * Headers and the tab name are matched without regard to case or spacing, for the same
 * reason: they are typed by a person, not written by this script - "TEAM ID" and "Team ID"
 * are the same column.
 *
 * One tab holds every category, so a Team ID could in principle appear twice under two of
 * them. A row carrying this file's own Category wins; a row under any other is kept only as
 * a fallback, so a Category column spelt in some way this cannot read narrows nothing and
 * the join is never worse than matching on Team ID alone.
 */
function readTeamData_(sheet, levelTitle) {
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  const header = data[0].map(function (value) { return cellText_(value).toLowerCase(); });
  const columnOf = function (names) {
    for (let i = 0; i < names.length; i++) {
      const at = header.indexOf(names[i].toLowerCase());
      if (at !== -1) return at;
    }
    return -1;
  };

  const teamAt = columnOf(['Team ID', 'Team', 'Team Name']);
  if (teamAt === -1) return {};

  const wanted = RESULT_TEAM_DATA_COLUMNS.map(function (label) { return columnOf([label]); });
  const categoryAt = columnOf(['Category', 'Level']);
  const level = cellText_(levelTitle).toUpperCase();

  const own = {};
  const other = {};

  for (let r = 1; r < data.length; r++) {
    const key = teamKey_(data[r][teamAt]);
    if (!key) continue;

    const mine = categoryAt === -1 || !level
      || cellText_(data[r][categoryAt]).toUpperCase() === level;
    const into = mine ? own : other;

    // First row for an ID wins within its half. A duplicate under one category is a fault
    // on that tab, and picking the later one over the earlier would not make it less so.
    if (!into[key]) {
      into[key] = wanted.map(function (at) {
        return at === -1 ? '' : cellText_(data[r][at]);
      });
    }
  }

  Object.keys(other).forEach(function (key) {
    if (!own[key]) own[key] = other[key];
  });

  return own;
}

/** By exact name first, then ignoring case and spacing. */
function findTeamDataSheet_(ss) {
  const exact = ss.getSheetByName(RESULT_TEAM_DATA_SHEET);
  if (exact) return exact;

  const wanted = RESULT_TEAM_DATA_SHEET.toLowerCase().replace(/\s+/g, '');
  return ss.getSheets().filter(function (sheet) {
    return sheet.getName().toLowerCase().replace(/\s+/g, '') === wanted;
  })[0] || null;
}

/**
 * When this tab was last rebuilt, on the link row beside the link.
 *
 * Text, and deliberately not a Date carrying the wording in its number format. Sheets only
 * spills TEXT into the empty cells beside it - a number or a date too wide for its column
 * renders as ###### instead - and this stamp is about 220px against a 100px column. Writing
 * it as a string is what buys it the same overflow the link gets out of A1.
 *
 * The cost is that the cell no longer holds a sortable moment, which nothing here wanted:
 * this is a banner, not data. Formatting against the file's timezone rather than the
 * script's keeps it honest, since the two need not agree.
 *
 * NOW() would be wrong for a different reason - it re-evaluates on every open and would
 * report a rebuild that never happened.
 */
function writeRankingStamp_(sheet) {
  const when = Utilities.formatDate(
    new Date(), sheet.getParent().getSpreadsheetTimeZone(), RANKING_UPDATED_FORMAT
  );

  // Plain-text format first, so a tab rebuilt by the previous version - which left a date
  // format on this cell - does not try to read the string back as a date.
  sheet.getRange(RANKING_UPDATED_ROW, 1)
    .setNumberFormat('@')
    .setValue(RANKING_UPDATED_LABEL + when)
    .setHorizontalAlignment('left')
    .setFontColor('#5f6368')
    .setFontStyle('italic');
}

/** Column number to letter: a custom formula is handed to Sheets as text, not as a Range. */
function columnLetter_(column) {
  let letter = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + (n - 1) % 26) + letter;
  }
  return letter;
}

/**
 * The top five Raw Scores of each round: light green behind them, and their mean written
 * into the header cell above them as the Base Top Score.
 *
 * Both are formulas rather than values written during a rebuild. Between two rebuilds the
 * numbers here get edited by hand, and a painted cell - or a stored average - would still
 * be describing the run that used to be there.
 *
 * Rank comes from counting the scores that beat this one, not from LARGE alone, which is an
 * error in a round holding fewer than five runs: the state every round is in before it
 * starts. Ties are all kept in both places. Five teams level at the top are five teams in
 * the top five, there is no honest way to pick which of them loses the colour, and the
 * average is over whatever the colour covers.
 */
function applyTopScores_(sheet, sep) {
  const first = RANKING_FIRST_DATA_ROW;
  const height = Math.max(sheet.getMaxRows() - first + 1, 1);

  const rules = [RANKING_ROUND1_COLUMN, RANKING_ROUND2_COLUMN].map(function (round) {
    const column = round + RANKING_SCORE_OFFSET;
    const at = columnLetter_(column);
    const cell = at + first;
    const down = '$' + at + '$' + first + ':$' + at;
    const scores = at + first + ':' + at;

    // MIN against COUNT is what keeps this alive early on: LARGE(range, 5) is an error
    // until five scores exist, and a round with two runs has a top five of two. Averaging
    // everything at or above that cut-off is also what makes ties agree with the colour.
    sheet.getRange(RANKING_GROUP_ROW, column)
      .setFormula('=IFERROR(AVERAGEIF(' + scores + sep + '">="&LARGE(' + scores + sep
        + 'MIN(' + RANKING_TOP_COUNT + sep + 'COUNT(' + scores + '))))' + sep + '"")')
      .setNumberFormat('0.00')
      .setNote(RANKING_BASE_NOTE);

    return SpreadsheetApp.newConditionalFormatRule()
      // Anchored to the top-left of the range below, so 'C4' reads as "this row's score".
      .whenFormulaSatisfied('=AND(ISNUMBER(' + cell + ')' + sep + 'COUNTIF(' + down + sep
        + '">"&' + cell + ')<' + RANKING_TOP_COUNT + ')')
      .setBackground(RANKING_TOP_BACKGROUND)
      .setRanges([sheet.getRange(first, column, height, 1)])
      .build();
  });

  sheet.setConditionalFormatRules(rules);
}

/**
 * The last run each team made in each round, how many they made, and how many submissions
 * were thrown out for landing outside the Config schedule.
 *
 * Latest is decided by the timestamp in column A rather than by position, so a Scores tab
 * somebody sorted by hand still reports the right run; position only breaks ties.
 *
 * Columns are found by header name, not by number. This tab has been widened twice already
 * and reading it by position is how a migration turns into wrong standings.
 *
 * An off-schedule submission is dropped before it is counted, so the Submission column
 * counts what was ranked rather than what was sent. The two numbers differ, and the cell on
 * row 1 is where the difference is reported.
 */
function readLatestRuns_(sheet, config, zone) {
  const data = sheet.getDataRange().getValues();
  const runs = {};
  const tally = { runs: runs, invalid: 0, checked: 0 };
  if (data.length < 2) return tally;

  const schedule = rankingSchedule_(config);

  const header = data[0].map(function (value) { return cellText_(value); });
  const columnOf = function (names) {
    for (let i = 0; i < names.length; i++) {
      const at = header.indexOf(names[i]);
      if (at !== -1) return at;
    }
    return -1;
  };

  const teamAt = columnOf(['Team ID', 'Team']);
  const roundAt = columnOf(['Round']);
  const scoreAt = columnOf(['Score']);
  const stampAt = columnOf(['Submission Time']);
  const missionAt = columnOf(['Time']);
  const tryAt = columnOf(['Try']);

  if (teamAt === -1 || roundAt === -1) {
    throw new Error('The Scores tab needs a Team and a Round column to rank by.');
  }

  for (let r = 1; r < data.length; r++) {
    const team = cellText_(data[r][teamAt]);
    const round = cellText_(data[r][roundAt]);
    // A run with no round belongs in neither block - a test sent before Round 1 opened.
    if (!team || !round) continue;

    const when = stampAt === -1 ? null : data[r][stampAt];

    // No timestamp column at all means there is nothing to check against, and the whole
    // schedule quietly stands down rather than voiding every row on the tab.
    if (stampAt !== -1) {
      tally.checked += 1;
      if (!onSchedule_(when, team, schedule, zone)) {
        tally.invalid += 1;
        continue;
      }
    }

    const key = team + '\t' + round;
    const entry = runs[key] || (runs[key] = { count: 0, stamp: -1, order: -1 });
    entry.count += 1;

    const stamp = Object.prototype.toString.call(when) === '[object Date]' ? when.getTime() : 0;
    if (stamp < entry.stamp || (stamp === entry.stamp && r < entry.order)) continue;

    entry.stamp = stamp;
    entry.order = r;
    entry.score = scoreAt === -1 ? '' : Number(data[r][scoreAt]) || 0;
    entry.mission = missionAt === -1 ? '' : cellText_(data[r][missionAt]);
    entry.tries = tryCount_(tryAt === -1 ? '' : data[r][tryAt]);
  }

  return tally;
}

/**
 * A try count as a number.
 *
 * Mission Time beside it stays text - "1:23.45" is not a number and must not become one -
 * but Try is a count, and left as text it sits left-aligned beside the numbers and ignores
 * the integer format on its column. Anything that will not read as a number is handed back
 * untouched rather than turned into a 0 that looks like a real answer.
 */
function tryCount_(value) {
  const text = cellText_(value);
  return text !== '' && isFinite(Number(text)) ? Number(text) : text;
}

/**
 * Config's schedule reduced to what a submission can be measured against: the competition
 * day, and the one window the whole event runs inside.
 *
 * One window, not one per round, and Round 2 Time takes no part in it. A per-round window
 * assumes a judge submits while the round is still running, and they do not - scores go in
 * late, or in a batch once the round is over. Round 1 submissions arriving after Round 2
 * opened would then all be void, which empties the Round 1 block and takes Normalized
 * Score, Consistency and both Best Round columns down with it. This check exists to catch a
 * stray run from another day or a test fired at midnight, and that is all it should do.
 *
 * Anything Config does not say - or says in a way this cannot read - comes back null, and
 * the check it would have driven is simply not made. The Config tab is edited by hand while
 * the event runs, and a blank End Time voiding the whole tab would be a far worse failure
 * than not checking one bound.
 */
function rankingSchedule_(config) {
  return {
    day: parseConfigDay_(config.competitionDate),
    open: parseConfigClock_(findRoundTime_(config.rounds, 1)),
    close: parseConfigClock_(config.endTime)
  };
}

/**
 * Whether one submission is allowed to count.
 *
 * The round it belongs to does not come into it: which round a run was is the judge's
 * declaration, not something to be inferred from the clock. Both ends of the window are
 * inside it, because being lenient at a boundary costs less than dropping a real score.
 *
 * A test run answers to the date and nothing else, matching what the app allows. It exists
 * to prove the pipeline works, which is worth doing before Round 1 opens and after End Time
 * has passed, and it is never ranked either way - ranking rows come from Config, and no
 * Config lists a team by this name.
 */
function onSchedule_(when, team, schedule, zone) {
  if (Object.prototype.toString.call(when) !== '[object Date]') return false;

  // A time-only cell in Sheets sits on 1899-12-30 and carries no date worth comparing.
  if (schedule.day && when.getFullYear() > 1900
    && Utilities.formatDate(when, zone, 'yyyy-MM-dd') !== schedule.day) {
    return false;
  }

  if (team === RANKING_TEST_TEAM) return true;

  // Read through the file's timezone, the same one the date was read through. getHours()
  // would answer in the script's zone, and the two need not be the same zone.
  const at = parseConfigClock_(Utilities.formatDate(when, zone, 'HH:mm:ss'));

  if (schedule.open !== null && at < schedule.open) return false;
  if (schedule.close !== null && at > schedule.close) return false;
  return true;
}

/** 'dd/MM/yyyy', 'd/M/yyyy' or 'yyyy-MM-dd' to 'yyyy-MM-dd'. null when it is none of them. */
function parseConfigDay_(text) {
  const value = String(text || '').trim();

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) return slash[3] + '-' + pad2_(slash[2]) + '-' + pad2_(slash[1]);

  const dash = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (dash) return dash[1] + '-' + pad2_(dash[2]) + '-' + pad2_(dash[3]);

  return null;
}

/** 'HH:mm' or 'HH:mm:ss' to seconds since midnight. null when it is neither. */
function parseConfigClock_(text) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text || '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function pad2_(value) {
  return ('0' + value).slice(-2);
}

/**
 * How many submissions the schedule threw out, on row 1 where the rebuild link is.
 *
 * Red and bold only when the number is not zero: a count that changes nothing should not
 * look like a warning, and a count that does should not have to be hunted for.
 */
function writeInvalidNotice_(sheet, tally) {
  const bad = tally.invalid;
  const text = 'Invalid submissions: ' + bad + ' of ' + tally.checked
    + (bad ? ' (off the Config schedule, not ranked)' : '');

  sheet.getRange(RANKING_UPDATED_ROW, RANKING_INVALID_COLUMN)
    .setNumberFormat('@')
    .setValue(text)
    .setHorizontalAlignment('left')
    .setFontWeight(bad ? 'bold' : 'normal')
    .setFontStyle(bad ? 'normal' : 'italic')
    .setFontColor(bad ? '#b3261e' : '#5f6368')
    .setNote(RANKING_INVALID_NOTE);
}

/**
 * A tab left over from an older layout is cleared rather than migrated.
 *
 * Everything on this tab is written by the rebuild below - values, formulas, formats and
 * notes alike - so a wipe loses nothing that the next few lines do not put back. Migrating
 * would mean moving three column blocks and three rows, in an order that depends on which
 * previous layout it happens to be, to arrive at precisely what a clear and a rebuild give
 * for free.
 *
 * Recognised by comparing the whole header row against the one this version writes, rather
 * than by a single marker cell. A marker only catches the changes that happen to move it:
 * the block heading stayed "Overall Result" through a rewrite of every column beneath it,
 * and a tab that had already been rebuilt once would have kept the old columns for good.
 * Conditional formatting survives a clear(), which is why applyTopScores_ replaces the whole
 * rule set rather than adding to it.
 */
function ensureRankingLayout_(sheet) {
  const want = rankingHeaderLabels_();
  // A tab too small to hold this layout cannot be this layout, and asking for the range
  // would throw rather than answer.
  const roomy = sheet.getMaxColumns() >= want.length && sheet.getMaxRows() >= RANKING_HEADER_ROW;
  const have = roomy ? sheet.getRange(RANKING_HEADER_ROW, 1, 1, want.length).getValues()[0] : [];

  if (!roomy || want.some(function (label, i) { return cellText_(have[i]) !== label; })) {
    sheet.clear();
  }

  // Notes go on every rebuild, not only on a layout change. clear() takes content and
  // formatting and leaves notes precisely where they were, so a note written by an older
  // layout outlives both the value it described and the wipe meant to remove it. It also
  // outlives the marker above - one rebuild sets that, and from then on the check passes
  // and the stale notes are never reached - which is why this cannot sit behind it.
  //
  // The notes this version wants are written back a few lines below, so what a reader hovers
  // over is always what this version had to say.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();

  // The two preamble rows go back at the end of the rebuild, and they have to be gone while
  // the columns are being sized. Each holds one long line meant to spill across the empty
  // cells beside it; left in place, they would set the width of column A instead.
  sheet.getRange(RANKING_UPDATED_ROW, 1,
      RANKING_LINK_ROW - RANKING_UPDATED_ROW + 1, sheet.getMaxColumns())
    .clearContent();
}

/**
 * The rebuild link, written as rich text rather than a HYPERLINK formula: a formula is
 * parsed in the file's own locale and would need the argument separator probed first,
 * which is a round trip and a write for something that never changes.
 *
 * The key is in the URL, and it is not a secret - submit.js ships it to every browser that
 * opens the scoresheet. It is here to keep the endpoint from being fired by accident, not
 * to keep anyone out.
 */
function writeRankingLink_(sheet, sheetId) {
  const url = WEB_APP_URL + '?action=ranking&key=' + encodeURIComponent(SHARED_KEY)
    + '&sheetId=' + encodeURIComponent(sheetId);

  sheet.getRange(RANKING_LINK_ROW, 1).setRichTextValue(
    SpreadsheetApp.newRichTextValue().setText(RANKING_LINK_LABEL).setLinkUrl(url).build()
  );
}

/**
 * The header row as one array, built once and used twice: written here, and compared
 * against the tab by ensureRankingLayout_ to decide whether the tab is still this layout.
 * One source means a column added to either block is a rebuild the next run does by itself.
 */
function rankingHeaderLabels_() {
  const labels = new Array(RANKING_LAST_COLUMN).fill('');
  labels[0] = 'Team ID';
  RANKING_OVERALL_COLUMNS.forEach(function (label, i) {
    labels[RANKING_OVERALL_COLUMN - 1 + i] = label;
  });
  RANKING_ROUND_COLUMNS.forEach(function (label, i) {
    labels[RANKING_ROUND1_COLUMN - 1 + i] = label;
    labels[RANKING_ROUND2_COLUMN - 1 + i] = label;
  });
  return labels;
}

function writeRankingHeaders_(sheet) {
  const width = RANKING_LAST_COLUMN;
  if (sheet.getMaxColumns() < width) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  }

  // A block is named on the column it starts at and nowhere else, so the group row reads as
  // three headings over three stretches rather than as a row of repeated words.
  const group = new Array(width).fill('');
  group[RANKING_OVERALL_COLUMN - 1] = RANKING_OVERALL_GROUP;
  group[RANKING_ROUND1_COLUMN - 1] = 'Round 1';
  group[RANKING_ROUND2_COLUMN - 1] = 'Round 2';

  sheet.getRange(RANKING_GROUP_ROW, 1, 2, width)
    .setValues([group, rankingHeaderLabels_()])
    .setFontWeight('bold');
  // Through the header row, so the two preamble rows and both headings stay on screen while
  // the standings scroll. The blank row is inside that and is what separates the two.
  sheet.setFrozenRows(RANKING_HEADER_ROW);

}

/**
 * Column widths, fitted to what is in them.
 *
 * Every width on the tab is set here and nowhere else. A column keeps its width through a
 * clear(), so a column this never names goes on wearing whatever size an earlier layout
 * gave it - which is how the old "Time of Best Round" left two round columns at 140px.
 *
 * Run after the table is written and before the two preamble rows are. Auto-fit measures
 * every cell in a column, and those rows hold one long line each: with them in place,
 * column A comes out as wide as "Click here to update Ranking" and the whole point of a
 * line that spills is lost.
 *
 * The blank columns are set by hand afterwards, because auto-fitting an empty column gives
 * it a default width and being narrow is the only thing they do.
 */
function autoSizeRankingColumns_(sheet) {
  sheet.autoResizeColumns(1, RANKING_OVERALL_END);
  sheet.autoResizeColumns(RANKING_ROUND1_COLUMN, RANKING_ROUND_COLUMNS.length);
  sheet.autoResizeColumns(RANKING_ROUND2_COLUMN, RANKING_ROUND_COLUMNS.length);

  sheet.setColumnWidth(RANKING_SPACER1_COLUMN, RANKING_SPACER_WIDTH);
  sheet.setColumnWidth(RANKING_SPACER2_COLUMN, RANKING_SPACER_WIDTH);
}

function writeRankingRows_(sheet, teams, runs, sep) {
  const height = Math.max(sheet.getLastRow() - RANKING_HEADER_ROW, teams.length, 0);
  const needed = RANKING_HEADER_ROW + height;
  if (height > 0 && sheet.getMaxRows() < needed) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  }

  // One block per round, all five columns of it. This used to skip Normalized, back
  // when that column held a formula nobody here had written; it holds one written below now.
  if (height > 0) {
    sheet.getRange(RANKING_FIRST_DATA_ROW, 1, height, 1).clearContent();
    sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_OVERALL_COLUMN, height,
      RANKING_OVERALL_COLUMNS.length).clearContent();
    [RANKING_ROUND1_COLUMN, RANKING_ROUND2_COLUMN].forEach(function (column) {
      sheet.getRange(RANKING_FIRST_DATA_ROW, column, height, RANKING_ROUND_COLUMNS.length)
        .clearContent();
    });
  }

  if (!teams.length) return;

  sheet.getRange(RANKING_FIRST_DATA_ROW, 1, teams.length, 1)
    .setValues(teams.map(function (team) { return [team]; }));

  [['1', RANKING_ROUND1_COLUMN], ['2', RANKING_ROUND2_COLUMN]].forEach(function (round) {
    const cells = teams.map(function (team) {
      const entry = runs[team + '\t' + round[0]];
      return entry ? [entry.count, entry.score, entry.mission, entry.tries] : ['', '', '', ''];
    });

    sheet.getRange(RANKING_FIRST_DATA_ROW, round[1], teams.length, 2)
      .setValues(cells.map(function (c) { return [c[0], c[1]]; }));
    sheet.getRange(RANKING_FIRST_DATA_ROW, round[1] + 3, teams.length, 2)
      .setValues(cells.map(function (c) { return [c[2], c[3]]; }));

    // Time is deliberately not among these: it is the judge's own "1:23.45" and a number
    // format is how that turns into something else.
    RANKING_INTEGER_OFFSETS.forEach(function (offset) {
      sheet.getRange(RANKING_FIRST_DATA_ROW, round[1] + offset, teams.length, 1)
        .setNumberFormat(RANKING_INTEGER_DIGITS);
    });

    writeNormalizedColumn_(sheet, round[1], teams.length, sep);
  });

  writeOverallColumns_(sheet, teams.length, sep);
}

/**
 * The six Overall Result columns, all read off the same pair of Normalized values.
 *
 * Best Score is the better of the two. Variation is how far apart they were - the same
 * pair, asked how steady rather than how high. Best Round names the round that won, and
 * Time and Try are lifted off it, so the block describes one actual run of one team. Rank
 * is not here - it needs all six of these settled first, and rankRankingRows_ reads them
 * back once Sheets has worked them out.
 *
 * They are comparable across rounds because each side is already a ratio against its own
 * round's top five, so a hard Round 2 does not quietly outrank an easy Round 1, and a gap
 * between the rounds means the team moved rather than the course.
 *
 * The COUNT guards differ on purpose, and that is the whole design here. Best Score needs
 * one run: a team that ran only Round 1 is judged on Round 1, which MAX gives for free, and
 * only a team that never went out has no best score - =0 rather than an empty MAX, which
 * would read 0 and rank them below the worst real run. Consistency needs both: with one
 * round missing ABS would return that round's own score, and a team that has run once would
 * show up as wildly inconsistent for no reason but the schedule. So =2, and blank until the
 * second run lands.
 *
 * N() around each side of the comparison is not decoration. An empty Normalized cell is
 * the string "" and not a blank cell, and Sheets sorts text above every number, so a plain
 * D>=J is TRUE for a team that has only run Round 2 and would report Round 1's empty Time.
 * N() reads "" as 0 and the comparison means what it looks like it means.
 *
 * Round 1 takes a tie, and all three columns that depend on the winner are built from one
 * shared prefix so they cannot disagree about which round it was - a row naming Round 1
 * beside Round 2's time would be a run that never happened.
 */
function writeOverallColumns_(sheet, rows, sep) {
  const first = columnLetter_(RANKING_ROUND1_COLUMN + RANKING_NORMALIZED_OFFSET);
  const second = columnLetter_(RANKING_ROUND2_COLUMN + RANKING_NORMALIZED_OFFSET);
  const time1 = columnLetter_(RANKING_ROUND1_COLUMN + RANKING_TIME_OFFSET);
  const time2 = columnLetter_(RANKING_ROUND2_COLUMN + RANKING_TIME_OFFSET);
  const try1 = columnLetter_(RANKING_ROUND1_COLUMN + RANKING_TRY_OFFSET);
  const try2 = columnLetter_(RANKING_ROUND2_COLUMN + RANKING_TRY_OFFSET);
  const bestRound = [];
  const best = [];
  const gap = [];
  const bestTime = [];
  const bestTry = [];

  for (let i = 0; i < rows; i++) {
    const row = RANKING_FIRST_DATA_ROW + i;
    const a = first + row;
    const b = second + row;
    const pair = a + sep + b;
    const ran = 'COUNT(' + pair + ')';

    // Shared by every column that has to know which round won, so no edit can move one of
    // them without moving the rest.
    const won = '=IF(' + ran + '=0' + sep + '""' + sep
      + 'IF(N(' + a + ')>=N(' + b + ')' + sep;

    best.push(['=IF(' + ran + '=0' + sep + '""' + sep + 'MAX(' + pair + '))']);
    gap.push(['=IF(' + ran + '=2' + sep + 'ABS(' + a + '-' + b + ')' + sep + '"")']);
    bestRound.push([won + '1' + sep + '2))']);
    bestTime.push([won + time1 + row + sep + time2 + row + '))']);
    bestTry.push([won + try1 + row + sep + try2 + row + '))']);
  }

  sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_BEST_ROUND_COLUMN, rows, 1)
    .setFormulas(bestRound)
    .setNumberFormat(RANKING_INTEGER_DIGITS);

  // The same format as the columns they are read from: one number must not read two ways
  // depending on which column it is sitting in.
  sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_BEST_SCORE_COLUMN, rows, 1)
    .setFormulas(best)
    .setNumberFormat(RANKING_NORMALIZED_DIGITS);
  sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_VARIATION_COLUMN, rows, 1)
    .setFormulas(gap)
    .setNumberFormat(RANKING_NORMALIZED_DIGITS);

  // Copies, and each takes the format of the column it copies: a count of tries reads the
  // same here as it does over in its round.
  sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_BEST_TRY_COLUMN, rows, 1)
    .setFormulas(bestTry)
    .setNumberFormat(RANKING_INTEGER_DIGITS);

  // Time is the one column on the tab that must carry no number format at all. It holds the
  // judge's own "1:23.45", and a number format is how that turns into something else.
  sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_BEST_TIME_COLUMN, rows, 1)
    .setFormulas(bestTime);
}

/**
 * Where every team came, and therefore what order the rows belong in.
 *
 * Rulebook 10.3 is four criteria deep, and a formula spelling all four out is one nobody
 * could read, let alone check against the rulebook during an event. In script it is a
 * comparison function that can be set beside 10.3 and matched line for line.
 *
 * The price is that Rank is a snapshot where the five columns beside it are live. Correct a
 * Raw Score by hand and Best Score follows at once while Rank, and the row order with it,
 * waits for the next rebuild. The link on row 2 is the fix.
 *
 * Read back rather than recomputed. Normalized, Best Score and Variation are already
 * decided by formulas a few lines above, and working them out a second time in JavaScript
 * would be two definitions of the same number waiting to disagree.
 *
 * Returns one entry per row, in the order the rows should be written: placed teams first by
 * 10.3, then everyone with no run at all. Each carries `at`, its index in the Config list.
 */
function rankRankingRows_(sheet, rows) {
  if (!rows) return [];

  // Those formulas were written by this same execution and have not been evaluated yet.
  // Without this the read below comes back empty and every team ranks nowhere.
  SpreadsheetApp.flush();

  const values = sheet
    .getRange(RANKING_FIRST_DATA_ROW, 1, rows, RANKING_LAST_COLUMN)
    .getValues();

  const try1 = RANKING_ROUND1_COLUMN + RANKING_TRY_OFFSET - 1;
  const try2 = RANKING_ROUND2_COLUMN + RANKING_TRY_OFFSET - 1;

  const entries = values.map(function (row, at) {
    return {
      at: at,
      best: rankingNumber_(row[RANKING_BEST_SCORE_COLUMN - 1], null),
      // A team that ran one round has no gap to show and has not shown it is steady, so it
      // loses this criterion rather than winning it with a gap of nothing. 10.3 assumes two
      // rounds; this is the reading that does not reward the missing one.
      variation: rankingNumber_(row[RANKING_VARIATION_COLUMN - 1], Infinity),
      // Both rounds, per 10.3: "total Tries". Only Time is read off the best round alone.
      tries: (Number(row[try1]) || 0) + (Number(row[try2]) || 0),
      time: missionTimeMs_(row[RANKING_BEST_TIME_COLUMN - 1])
    };
  });

  const placed = entries.filter(function (entry) { return entry.best !== null; });
  // V8's sort is stable, so teams alike on all four of 10.3 stay in the order Config lists
  // them. Something has to break that last tie, and the roster is at least a reason.
  placed.sort(rankingOrder_);

  let place = 0;
  placed.forEach(function (entry, i) {
    // Alike on all four criteria means the same place, and the next one is skipped: 1, 2, 2, 4.
    if (i === 0 || rankingOrder_(placed[i - 1], entry) !== 0) place = i + 1;
    entry.place = place;
  });

  // A team with no run at all is not last, it is unplaced. They go under the standings in
  // Config order, because a placing invented for them would put them in a race they never
  // entered.
  return placed.concat(entries.filter(function (entry) { return entry.best === null; }));
}

/** The placings, once the rows below have been put in this order. */
function writeRankPlaces_(sheet, order) {
  if (!order.length) return;

  sheet.getRange(RANKING_FIRST_DATA_ROW, RANKING_RANK_COLUMN, order.length, 1)
    .setValues(order.map(function (entry) { return [entry.place || '']; }))
    .setNumberFormat(RANKING_INTEGER_DIGITS);
}

/**
 * Rulebook 10.3, in its own order:
 *
 *   1. Highest Normalized Score of the best round.
 *   2. Consistency: smallest difference in Normalized Scores between the two rounds.
 *   3. Efficiency: lowest number of total Tries.
 *   4. Speed: fastest completion time.
 *
 * Negative when a places above b. Each line falls through to the next only on an exact tie,
 * which is what "in case of a tie" asks for.
 */
function rankingOrder_(a, b) {
  return compareRanked_(b.best, a.best)
    || compareRanked_(a.variation, b.variation)
    || compareRanked_(a.tries, b.tries)
    || compareRanked_(a.time, b.time);
}

/**
 * -1, 0 or 1.
 *
 * Not x - y: two absent values are both Infinity, Infinity - Infinity is NaN, and a sort
 * fed NaN orders those rows however it likes and differently each run.
 */
function compareRanked_(x, y) {
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/**
 * A cell that should hold a number, rounded to the precision the tab displays.
 *
 * Rounding is what makes a tie a tie. Two teams both showing 1000.0 must place level and go
 * on to criterion 2; comparing the unrounded values would separate them by a millionth
 * nobody can see and leave the rest of 10.3 unreachable.
 */
function rankingNumber_(value, absent) {
  if (typeof value !== 'number' || !isFinite(value)) return absent;

  const factor = Math.pow(10, RANKING_TIE_DECIMALS);
  return Math.round(value * factor) / factor;
}

/**
 * 'm:ss.ss' to milliseconds, and Infinity for anything unreadable - blank, an unfinished
 * run, a cell someone typed into. Infinity sorts last under every comparison above, which
 * is where a time nobody recorded belongs.
 */
function missionTimeMs_(value) {
  const match = /^(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?$/.exec(cellText_(value));
  if (!match) return Infinity;

  // '.5' is five tenths, so half a second - the reading the app applies on entry.
  const hundredths = Number((match[3] || '0').padEnd(2, '0'));
  return Number(match[1]) * 60000 + Number(match[2]) * 1000 + hundredths * 10;
}

/**
 * Normalized, one formula per team row: this team's Raw Score over the Base Top Score
 * sitting in the header of the same column block, on a scale where the top five average is
 * 100 rather than 1. The same ranking either way - it is one constant factor - so this is
 * about reading two-digit differences off the column without counting leading zeros.
 *
 * A formula and not a number, because Raw Score gets corrected by hand between rebuilds and
 * a stored ratio would go on describing the score it replaced. It also means the whole
 * column moves the moment the Base Top Score above it does.
 *
 * The empty test comes first and the divide-by-zero guard second, because they mean
 * different things: a team with no run has no ratio, and a round whose top five is still
 * empty has no scale to measure against. Both read as blank, neither as zero.
 */
function writeNormalizedColumn_(sheet, roundColumn, rows, sep) {
  const raw = columnLetter_(roundColumn + RANKING_SCORE_OFFSET);
  const base = '$' + raw + '$' + RANKING_GROUP_ROW;
  const column = roundColumn + RANKING_NORMALIZED_OFFSET;

  const formulas = [];
  for (let i = 0; i < rows; i++) {
    const cell = raw + (RANKING_FIRST_DATA_ROW + i);
    formulas.push(['=IF(' + cell + '=""' + sep + '""' + sep
      + 'IFERROR(' + RANKING_NORMALIZED_SCALE + '*' + cell + '/' + base + sep + '""))']);
  }

  sheet.getRange(RANKING_FIRST_DATA_ROW, column, rows, 1)
    .setFormulas(formulas)
    .setNumberFormat(RANKING_NORMALIZED_DIGITS);
}

/**
 * The Run button takes a function name and no arguments, so each file gets its own entry
 * in the dropdown - the same shape the resetConfig wrappers use.
 */
function buildRankingExplorer() {
  return buildRankingSheet(LEVEL_SHEET_IDS[0][1]);
}

function buildRankingCreator() {
  return buildRankingSheet(LEVEL_SHEET_IDS[1][1]);
}

function buildRankingInnovator() {
  return buildRankingSheet(LEVEL_SHEET_IDS[2][1]);
}

function buildRankingMaster() {
  return buildRankingSheet(LEVEL_SHEET_IDS[3][1]);
}

/** All four at once, and what a time-driven trigger should be pointed at. */
function buildRankingSheets() {
  LEVEL_SHEET_IDS.forEach(function (entry) {
    buildRankingSheet(entry[1]);
  });
}

/**
 * Creates or rebuilds the four level tabs in the log workbook. Safe to re-run: the
 * dashboard block holds formulas only, so rewriting it loses nothing. Run from the
 * editor's function dropdown.
 *
 * The level files keep no log of their own once this has run; removeLegacyLogSheets()
 * clears out what they were left holding.
 */
function buildMonitorSheets() {
  const logSs = SpreadsheetApp.openById(LOG_SHEET_ID);

  LEVEL_SHEET_IDS.forEach(function (entry) {
    buildLogDashboard_(ensureLogSheet_(logSs, LOG_SHEET_PREFIX + entry[0]));
  });
}

/**
 * Deletes the log tabs left behind in the four level files. The log moved to its own
 * workbook, so nothing writes to these any more and their dashboards read zero, which is
 * worse than not being there at all - a judge checking mid-competition would see a file
 * reporting no submissions. Run once from the editor's function dropdown.
 *
 * Takes 'Logs', every 'Logs (old ...)' archive, and the 'Monitor' tab the dashboard lived
 * in before it moved into Logs. Nothing else is touched, and nothing is copied out first:
 * the rows in those tabs are gone for good. Returns what it removed.
 */
function removeLegacyLogSheets() {
  const removed = [];

  LEVEL_SHEET_IDS.forEach(function (entry) {
    const ss = SpreadsheetApp.openById(entry[1]);

    ss.getSheets()
      .filter(function (sheet) { return /^(Logs|Monitor)\b/.test(sheet.getName()); })
      .forEach(function (sheet) {
        removed.push(entry[0] + ': ' + sheet.getName());
        ss.deleteSheet(sheet);
      });
  });

  console.log(removed.length ? removed.join('\n') : 'Nothing to remove.');
  return removed;
}
