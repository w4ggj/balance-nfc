# NFC Tag Reference — Balance Gaming FL

The URL written to each table's NFC tag. All tags point at the same base;
only the `?tbl=` number differs, and it never changes for a given table.

**Base URL:** `https://nfc.balancegamingfl.com/?tbl=N`

| Table | URL |
|------:|-----|
| 1  | https://nfc.balancegamingfl.com/?tbl=1  |
| 2  | https://nfc.balancegamingfl.com/?tbl=2  |
| 3  | https://nfc.balancegamingfl.com/?tbl=3  |
| 4  | https://nfc.balancegamingfl.com/?tbl=4  |
| 5  | https://nfc.balancegamingfl.com/?tbl=5  |
| 6  | https://nfc.balancegamingfl.com/?tbl=6  |
| 7  | https://nfc.balancegamingfl.com/?tbl=7  |
| 8  | https://nfc.balancegamingfl.com/?tbl=8  |
| 9  | https://nfc.balancegamingfl.com/?tbl=9  |
| 10 | https://nfc.balancegamingfl.com/?tbl=10 |
| 11 | https://nfc.balancegamingfl.com/?tbl=11 |
| 12 | https://nfc.balancegamingfl.com/?tbl=12 |
| 13 | https://nfc.balancegamingfl.com/?tbl=13 |
| 14 | https://nfc.balancegamingfl.com/?tbl=14 |
| 15 | https://nfc.balancegamingfl.com/?tbl=15 |
| 16 | https://nfc.balancegamingfl.com/?tbl=16 |

## Notes
- Write each as a **URL / URI record** (NDEF) so phones open the browser on tap.
- **Lock / make read-only** after writing so tags can't be overwritten.
- These are also the destinations behind the **`?table=N`** parameter TOM's tap
  view accepts, and map 1:1 to TOM table numbers (tag 5 = TOM table 5).
- **Backup:** `qr-sheet.html` in this repo is a printable page with one QR code per
  table (same URLs) — cut out and tape under each table in case a tag ever fails.
  Live at `https://nfc.balancegamingfl.com/qr-sheet.html`.
