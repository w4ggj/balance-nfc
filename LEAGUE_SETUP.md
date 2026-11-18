# Balance League Pass — setup

Open-play check-in points for **Pokémon League (Mondays)** and **One Piece open
play (Tuesdays)**, with a monthly prize drawing per game.

Pages:
- `league.html?game=pokemon|onepiece` — players (what the QR opens)
- `league-admin.html` — staff console (check kids in by name, prize, drawing)
- `league-board.html?game=…` — TV roster (`?demo=1` / `?demo=draw` previews sample data)
- `league-qr.html?game=…` — printable counter sign

It reuses the shared Firebase project (`balance-nfc`) and the Commander League's
email-link sign-in, so **Firebase Auth needs nothing new** (email-link is already
on and `nfc.balancegamingfl.com` is already an authorized domain).

## Firebase rules (`/league`) — required before it works

Merge this block into the database rules **alongside** the existing `active`,
`tournament`, `commander`, `display`, etc. Do **not** replace the whole ruleset.
Until it's in, check-ins and the staff console get "permission denied".

```json
"league": {
  ".read": true,

  "meta": {
    "$game": { ".write": "$game === 'pokemon' || $game === 'onepiece'" }
  },

  "players": {
    "$pid": {
      ".write": "$pid.beginsWith('walk_') || (auth != null && ($pid === auth.uid || $pid.beginsWith(auth.uid + '_')))",
      ".validate": "newData.hasChildren(['first', 'li']) && newData.child('first').isString() && newData.child('first').val().length > 0 && newData.child('first').val().length <= 30 && newData.child('li').isString() && newData.child('li').val().length <= 1"
    }
  },

  "checkins": {
    "$game": {
      "$date": {
        "$pid": {
          ".write": "($game === 'pokemon' || $game === 'onepiece') && (!data.exists() || !newData.exists())",
          ".validate": "newData.isNumber() && newData.val() === now && root.child('league/players/' + $pid).exists()"
        }
      }
    }
  },

  "draws": {
    "$game": {
      "$date": { ".write": "$game === 'pokemon' || $game === 'onepiece'" }
    }
  }
}
```

What each part does:
- `players/$pid` — a signed-in account can only write its own players: `uid`
  for the first, `uid_2`, `uid_3`… for kids/siblings on the same email. `walk_…`
  players are staff-added from the console (no email). Only a first name and
  a last **initial** are stored; emails live in Firebase Auth, never here.
- `checkins/$game/$date/$pid` — write-once, and the value must be the **server
  timestamp** (`now`). The engine also ignores any check-in whose timestamp
  isn't on the date it's filed under, so nobody can back-fill an old night.
  Deleting is allowed so staff can remove a mistaken check-in.
- `draws` / `meta` — staff console (open, like every staff page here).

## How it scores

- 1 point per league-night check-in. Points come from showing up only, never
  from a purchase (a purchase-for-entry drawing can count as an illegal lottery
  in Florida).
- Every 4 points = 1 entry in that game's drawing.
- The drawing is the **last Monday (Pokémon) / last Tuesday (One Piece) of the
  month**. Staff hit **Run the drawing** in the console at the end of that night.
  Entries are used up by the drawing whether or not you win; leftover points
  carry (6 points → 1 entry + 2 toward next month).
- Nothing stores a running total. The ledger is recomputed from check-ins and
  drawings every time, so removing a check-in or **Undo tonight's drawing**
  fixes every number automatically.
- Players can self check-in from noon on their league night (store time).
  Staff can check anyone in from the console any day (it asks first if it
  isn't league night).

## On the TV

On league night, turn on that game in `config.html` plus **Live event on TV**.
The main signage TV then overlays `league-board.html` instead of the usual
"tonight's event" splash: tonight's open play (from the game's Shopify events
collection), the check-in QR, and the month's roster sorted by points (green
edge = here tonight). A live tournament board (TOM for Pokémon, the extension
for One Piece) still wins over the roster. When the drawing runs, every TV on
the roster spins through the names and reveals the winner, then keeps a winner
banner up for the rest of the night.

## Deliberately not done

- NFC table taps still go to the normal game page on league night. Check-in is
  by QR only, so the existing tap routing didn't change.
- No backdating. A missed check-in from a past night can't be added, since the
  rules require the server time. That's the anti-cheat, so it stays.
- No staff PIN, same as the other staff pages.
