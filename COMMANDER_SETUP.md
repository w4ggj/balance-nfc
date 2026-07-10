# Balance Commander League — setup

The league reuses the shared Firebase Realtime Database (`balance-nfc`) and
GitHub Pages. Pages: `commander.html` (players), `commander-admin.html` (staff),
`commander-board.html` (TV). Control-panel toggle: **Commander League** in
`config.html`.

## Firebase rules (`/commander`)

The **staff console writes over anonymous REST** (no login), while **players
write through Firebase Auth** (email-link). So the rules must let the console
manage the league/night structure, while player-authored data (their own
player record, attendance, votes, questionnaire) stays integrity-checked.

Merge this block into your database rules, alongside the existing `active`,
`tournament`, `display`, etc. rules — do **not** replace the whole ruleset:

```json
"commander": {
  ".read": true,

  "league": { ".write": true },

  "players": {
    ".write": "!newData.exists()",
    "$uid": {
      ".write": "(auth != null && auth.uid === $uid) || $uid.beginsWith('walk_')",
      ".validate": "newData.hasChildren(['name'])"
    }
  },

  "nights": {
    ".write": "!newData.exists()",
    "$night": {
      "status":      { ".write": true, ".validate": "newData.isString()" },
      "currentGame": { ".write": true, ".validate": "newData.isNumber()" },
      "pods":        { ".write": true },

      "attendance": {
        "$uid": {
          ".write": "(auth != null && auth.uid === $uid) || $uid.beginsWith('walk_')",
          ".validate": "newData.val() === true"
        }
      },

      "votes": {
        "$game": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid && !data.exists()",
            ".validate": "newData.child('target').val() !== auth.uid"
          }
        }
      },

      "questionnaire": {
        "$uid": {
          ".write": "auth != null && auth.uid === $uid && !data.exists()"
        }
      }
    }
  }
}
```

What each part does:

- `league` — staff console writes the league name/scoring. Open (private link).
- `players/$uid` — a signed-in player can only write **their own** record. The
  `$uid.beginsWith('walk_')` clause also lets the **staff console** add
  phone-less **walk-in** players (their uids all start with `walk_`).
- `nights/$night/status|currentGame|pods` — staff console controls the phase and
  seating. Open.
- `attendance/$uid` — a player can only check **themselves** in; the same
  `walk_` clause lets the console check a walk-in in for tonight.
- `votes/$game/$uid` — one **write-once** vote per player per game; the
  `.validate` blocks voting for yourself.
- `questionnaire/$uid` — one write-once end-of-night response per player.
- The `".write": "!newData.exists()"` on the `players` and `nights` parents lets
  the console's **Reset** button clear the subtrees, without allowing anyone to
  overwrite values there.

## Firebase Auth (players)

1. Authentication → Sign-in method → enable **Email link (passwordless)**.
2. Authentication → Settings → Authorized domains → add **nfc.balancegamingfl.com**
   (and `localhost` if you test locally).

## Running a night

1. Open `commander-admin.html` → **Create league** → **Start tonight's session**.
2. Players tap a table tag → sign in by email → auto-checked-in.
   - **No NFC phone?** Same table's QR on `qr-sheet.html` opens the identical
     page — scan it with any camera.
   - **No phone at all?** During check-in, use **Walk-ins (no phone)** on the
     console to add them by name. They're seated in a pod and can be voted for
     by their table (they just skip the self-questionnaire point).
3. **Assign pods** → **Start Game 1** → **Start Game 2/3…** → **End games →
   Questionnaire** → **Close the night**.
4. Put `commander-board.html` on the TV for season standings.

If a staff action does nothing and you see a toast about Firebase blocking the
write, the `/commander` rules above aren't applied yet.
