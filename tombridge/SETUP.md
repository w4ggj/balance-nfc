# TOM Bridge — setup on the TOM Windows machine

Mirrors TOM's HTML reports into Firebase so the wall boards and tap view update
live. TOM is read-only — this never writes back to TOM.

## One-time setup

1. **Install Node.js** (LTS) — https://nodejs.org
2. **Get the code** — download the repo ZIP (green *Code → Download ZIP* on
   github.com/w4ggj/balance-nfc) or `git clone`. Work inside the `tombridge/` folder.
3. **Open a terminal in `tombridge/`** — in File Explorer, click the address bar,
   type `cmd`, Enter.
4. **Install dependencies:**
   ```
   npm install
   ```
5. **Service-account key** — Firebase console → ⚙️ Project settings → Service
   accounts → **Generate new private key**. Save the file as **`serviceAccount.json`**
   in this `tombridge/` folder. (Keep it private; it's gitignored.)
6. **Config:**
   ```
   copy config.example.json config.json
   ```
   The database URL is already filled in. Leave the rest as-is for auto-detect,
   or set `reportsDir` if TOM writes reports somewhere non-standard.
7. **Firebase rule** — in Realtime Database → Rules, make sure `tournaments` is
   publicly readable (writes stay locked to the service account):
   ```json
   {
     "rules": {
       "active":      { ".read": true, ".write": "newData.isString() && newData.val().matches(/^(main|pokemon|onepiece|riftbound|mtg|tournament)$/)" },
       "tournament":  { ".read": true, ".write": true },
       "tournaments": { ".read": true }
     }
   }
   ```

## Running

- **Test (no write):** `npm run dry` — prints the snapshot from current TOM reports.
- **Write once:** `npm run once` — writes to Firebase and exits.
- **Live watch:** `npm run start` (or double-click **`start-watcher.bat`**) — watches
  TOM's reports folder and writes on every report change. Leave it running during
  the event.

## Auto-start at login (pick one)

**Easiest — Startup folder:**
1. Right-click `start-watcher.bat` → **Create shortcut**.
2. Press `Win + R`, type `shell:startup`, Enter.
3. Move the shortcut into that Startup folder. It now launches at login.

**Task Scheduler (runs without a visible window):**
- Create Task → Trigger: *At log on* → Action: Start a program
  - Program/script: `node`
  - Add arguments: `watcher.js`
  - Start in: the full path to this `tombridge` folder
- (Optional) "Run whether user is logged on or not" to keep it headless.

## Display pages

- Pairings board: `https://nfc.balancegamingfl.com/pairings.html`
- Standings board: `https://nfc.balancegamingfl.com/standings.html`
- Tap view (per table): `https://nfc.balancegamingfl.com/table.html?tbl=6`
- Add `?demo=1` to any page to preview with bundled sample data (no Firebase).

The boards auto-pick the most recently updated tournament, so you don't edit URLs
between events. During a live tournament, scanning a table (the Pokémon toggle)
shows that table's pairing.
