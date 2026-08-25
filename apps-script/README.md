# One Apps Script for every Scoresheet copy

Google copies a container-bound Apps Script when a spreadsheet is copied, but the copied
project is a separate snapshot. Later changes made in the original project's code are not
synchronized to those copies.

This scoresheet therefore uses one central Apps Script Web App. The copied spreadsheets
contain only competition data; they do not need their own Apps Script deployment.

## One-time setup

1. Create a **standalone** Apps Script project at <https://script.google.com/>.
2. Paste `Code.gs` into that project and set `DEFAULT_SHEET_ID`, `SHARED_KEY`, and
   `DRIVE_FOLDER_ID`.
3. Deploy it as a Web App:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Put the deployment `/exec` URL and the same key in `submit.js`.
5. Make sure the Google account that deployed the Web App has **Editor** access to every
   spreadsheet that the app will use. Copies owned by another account must be shared back
   to the deploying account.

## Create a competition copy

1. Make a copy of the spreadsheet template.
2. Edit the new copy's `Config` tab.
3. Open the scoresheet website with the copy's ID:

   ```text
   SCORESHEET_WEBSITE_URL?sheet=COPIED_SPREADSHEET_ID
   ```

   A full Google Sheets URL is also accepted as the `sheet` value.

The frontend includes that ID in metadata and submission requests. The central Web App
uses `SpreadsheetApp.openById()` to read and write the correct copy.

## Publish an update

Update `Code.gs`, then edit the existing Web App deployment and select **New version**.
Do not create a new deployment URL. Every old and new spreadsheet copy keeps using the
same `/exec` URL, so all of them receive the backend update without any per-sheet work.

Changes to spreadsheet data are different from code changes: values already present in a
copy's `Config` or `Scores` tab remain specific to that competition and are not overwritten
from the template.

## Rebuild a Config tab

`createConfigSheet_()` only runs when a file has no `Config` tab, so publishing a new
template does not touch files that already have one. To move an existing file onto the
current layout, run `resetConfigSheet` by hand from the Apps Script editor, once per file:

```js
resetConfigSheet('1ljm-gzjs3UgJB-fuNghADJn_byl-CtHib0APSNol2T0');  // ID or full Sheet URL
resetConfigSheet();                                               // DEFAULT_SHEET_ID
```

Everything the script can read is carried across and rewritten in its new position: level,
competition name and date, both round times, end time, and the full judge and team lists.
The tab keeps its place in the tab strip, and the lists grow to whatever length they need.

The tab is deleted and rewritten, so anything the script does not read is lost — notes,
colours, extra columns, and any label it does not recognise. Duplicate the tab first if the
file holds more than config. The function refuses to run when `Level` is not one of the
four level names, because it would otherwise have to guess which level to rebuild the file
as, and the Explorer link directory belongs to the Explorer file alone.
