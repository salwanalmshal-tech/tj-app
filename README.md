# Trade Journal

A private trade register that runs in the browser. This repository holds **only the program (code)**. Your trading data is one JSON file in **your own Google Drive** and is never stored here.

- Sign in with Google (scope `drive.file`: the program can only see files it created itself).
- Folder `Trade Journal` in your Drive: `TradeJournal.json`, a lock file and a `Backups` folder.
- Exact decimal arithmetic for money (no floating point), formats dd-mm-yyyy and 1 234,56.
- No server, no cookies, no tracking, no analytics. Text typed or imported is always treated as plain text.

## Run the tests
`node --test tests/*.test.mjs` (Node 20 or newer, no packages needed).

## Settings
`js/config.js` holds the Google OAuth Client ID (not a secret). While it is empty, only the demo mode ("Try without Google, nothing is saved") works.

## Layout
- `js/decimal.js, dates.js, model.js, calc.js, marks.js, actions.js`: data rules and calculations (tested).
- `js/store.js, saver.js, storage.js, auth.js`: working copy and Undo, automatic saving, Google Drive and demo storage.
- `js/importer.js`: Excel import and export rules.
- `js/ui/`: screens. `css/app.css`: look. `vendor/`: bundled libraries (see `vendor/README.txt`).
