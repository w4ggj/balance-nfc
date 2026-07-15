# In-store signage — TV kiosk setup

Runs the two shop TVs on the in-store signage board. Each TV needs one small
device that boots into a full-screen browser pointed at one URL. Any of these
work — pick per screen:

- **Amazon Fire TV Stick** + Fully Kiosk Browser — cheapest, easiest (Option A)
- **Mini PC / old laptop** (Windows or Linux) + Chrome kiosk — most reliable, and
  the right choice for the **portrait** screen because it rotates in one click
- **Raspberry Pi** — works, but **only the Pi Zero 2 W / Pi 3 / Pi 4** (Option B).
  The original **Pi Zero W (ARMv6, no NEON) can NOT run this** — modern Chromium
  won't install and the page won't render.

> **The two URLs (no tokens, no Worker):**
> - **75″ landscape** → `https://nfc.balancegamingfl.com/signage.html?screen=main`
> - **40″ portrait**  → `https://nfc.balancegamingfl.com/signage.html?screen=entrance`
>
> **Portrait TV on a landscape-only device (Fire Stick)?** Add `&rotate=ccw` to
> rotate the whole board 90° counter-clockwise in the browser, so a device that
> can't rotate at the OS level still fills a portrait-mounted screen:
> `…signage.html?screen=entrance&rotate=ccw` (use `&rotate=cw` if it comes out
> upside-down). Devices that rotate at the OS level (mini PC / Pi) don't need this.
>
> These are plain pages on GitHub Pages. Anything like `…workers.dev/display/TOKEN`
> is a **different project** — not this system — and will show a blank screen.

The page already self-reloads hourly with a cache-buster, so once a device is
running it keeps itself current with no maintenance.

---

## Option A — Amazon Fire TV Stick (easiest)

The signage page is just a website, so a Fire Stick + a kiosk browser runs it.

### 1. Enable sideloading
1. **Settings → My Fire TV → About** → highlight the device name, press **Select 7×**
   → "You are now a developer."
2. **My Fire TV → Developer options** → **Apps from Unknown Sources** ON (newer Fire
   OS approves per-app — you'll allow Downloader in the next step).

### 2. Install Downloader + Fully Kiosk
3. Home → search 🔍 → **Downloader** (orange, by AFTVnews) → install → open.
4. In Downloader's URL box, type the **direct APK link** (skips hunting the site):
   ```
   https://www.fully-kiosk.com/files/2025/10/Fully-Kiosk-Browser-v1.59.1.apk
   ```
   If that version 404s, grab the newest `.apk` from the Download box on
   **fully-kiosk.com** (same folder, higher version number).
5. **Go** → **Install** (approve unknown apps for Downloader if prompted).

> Fire OS notes: Fully Kiosk is built mainly for tablets and "may have a
> restricted feature set or issues" on Fire TV — fine for showing a URL, but
> test it. The free build works; a cheap one-time **PLUS single-device license**
> removes the branding and firms up auto-start for a permanent install.

### 3. Configure Fully Kiosk
6. Open **Fully Kiosk Browser** → set:
   - **Start URL** → `https://nfc.balancegamingfl.com/signage.html?screen=main`
   - **Start on Boot** → ON  ← makes it auto-open after power-up
   - **Keep Screen On** → ON
   - **Fullscreen Mode** → ON
   - Kiosk lock / "bring to front" → ON (snaps back if the home screen appears)
7. **Settings → Display & Sounds → Screensaver → Start Time → Never** (so Amazon's
   screensaver doesn't drift over the board).
8. Reopen Fully Kiosk settings later with the remote's **Menu (☰)** button.

> **Where those toggles live:** *Start on Boot* is under **Settings → Device
> Management**; a *Keep Screen On* type option is under **Power Settings**. They're
> in sub-menus, not the top list. On Fire OS these can be **PLUS-gated or hidden**
> (Fully's own note: Fire OS "may have a restricted feature set").
> - For *keep awake*, you don't actually need Fully's setting — set **Fire TV →
>   Display & Sounds → Screensaver → Never** (that's what blanks a Fire TV).
> - If *Start on Boot* is missing, either buy the cheap one-time **PLUS single-
>   device license** (unlocks it), or sideload a helper like **"Autostart - No
>   root"** and point it at Fully Kiosk.
>
> **Can't find the app after a reboot?** Sideloaded apps don't show on the Fire
> TV home. Go to **Your Apps & Channels → See All**, scroll to the **bottom** —
> Fully Kiosk is there. Highlight it, press the **☰** remote button → **Move** →
> pin it to the front row so it's one click next time. (Or **Settings →
> Applications → Manage Installed Applications → Fully Kiosk → Launch**.)
>
> **Boot behavior:** on power-up the stick shows the Fire TV home for a few
> seconds, then (with auto-start set) Fully Kiosk launches the URL. A store
> display stays powered, so reboots only happen on a power blip.
>
> **Portrait 40″ screen on a Fire Stick:** Fire OS can't rotate the display, so
> use the page's built-in rotation instead — set the Start URL to
> `https://nfc.balancegamingfl.com/signage.html?screen=entrance&rotate=ccw`
> (or `&rotate=cw` if it's upside-down). Mount the TV in portrait and it reads
> upright — no mini PC required.

---

## Option B — Raspberry Pi (Zero 2 W / 3 / 4 only)

## Hardware per unit
- Raspberry Pi Zero 2 W  (note: **512 MB RAM** — the steps below keep Chromium stable on it)
- 16 GB microSD card
- Mini-HDMI → HDMI cable
- Micro-USB 5 V / 2.5 A power supply

## 1. Flash the SD card (Raspberry Pi Imager)
- OS: **Raspberry Pi OS Lite (32-bit)**
- Gear ⚙️ settings:
  - Hostname: `signage1` (increment per unit)
  - Enable SSH ✓
  - Username `pi` + a password
  - WiFi SSID + password, country **US**

## 2. First boot + SSH (~90 s)
```
ssh pi@signage1.local
```

## 3. Install packages
```
sudo apt update && sudo apt install -y --no-install-recommends \
  xserver-xorg x11-xserver-utils xinit openbox chromium-browser unclutter
```

## 4. Prevent out-of-memory blanking (important on 512 MB)
Chromium can run out of RAM on the Zero 2 W and the screen goes black. Add a
1 GB swapfile (simple and reliable — zram-tools is finicky on Pi OS):
```
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h        # confirm the Swap line shows ~1.0 Gi
```

## 4b. Silence the "less than 1 GB RAM" Chromium popup (Zero 2 W)
The 512 MB Zero 2 W triggers Chromium's low-memory warning on every boot,
which blocks an unattended kiosk. Suppress it with the `--no-memcheck` flag,
added globally so it applies however Chromium is launched:
```
echo 'CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-memcheck"' | sudo tee /etc/chromium.d/00-nomemcheck
sudo reboot
```
If it still appears, find the launch script (`grep -rl chromium ~/ /etc/xdg /opt`)
and add `--no-memcheck` to its `chromium-browser` line.

## 5. Stop the display and console from blanking
Append `consoleblank=0` to the kernel cmdline (keep it all on one line):
```
sudo sed -i 's/$/ consoleblank=0/' /boot/cmdline.txt
```
(`xset` in the autostart below handles X screen-blanking / DPMS.)

## 6. Kiosk autostart
```
mkdir -p ~/.config/openbox
nano ~/.config/openbox/autostart
```

Paste this. **Set the URL** to this screen's URL (main or entrance), and for
the **portrait** TV also uncomment the rotate line:

```sh
# --- display: never blank / sleep ---
xset s off
xset s noblank
xset -dpms
unclutter -idle 0 &

# --- portrait (40") only: rotate the screen ---
# xrandr --output HDMI-1 --rotate right      # use 'left' if it's upside down

# --- wait for the network before launching, so the page actually loads ---
until ping -c1 -W2 nfc.balancegamingfl.com >/dev/null 2>&1; do sleep 2; done

# --- kiosk browser (flags tuned for the Zero 2 W) ---
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --disable-features=TranslateUI \
  --no-first-run --check-for-update-interval=31536000 \
  --disable-dev-shm-usage --disk-cache-dir=/tmp/chromium-cache \
  --disable-pinch --overscroll-history-navigation=0 \
  'https://nfc.balancegamingfl.com/signage.html?screen=main' &
```

`Ctrl+X` → `Y` → Enter.

> **If the screen is black right after Chromium starts (GPU issue),** add
> `--disable-gpu` to the chromium line and reboot. The board is mostly text,
> so software rendering runs fine on the Zero 2 W.

## 7. Auto-launch X on boot
```
sudo raspi-config nonint do_boot_behaviour B2
echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx' >> ~/.bash_profile
sudo reboot
```

## To change the URL later
```
ssh pi@signage1.local
nano ~/.config/openbox/autostart
sudo reboot
```

---

## Troubleshooting — figure out *which* blank you have

SSH in while it's blank and work down this list.

| What you see | Likely cause | Fix |
|---|---|---|
| **Chromium error page** ("can't be reached"), or blank that never loads | Network wasn't up when Chromium launched | The wait-for-network loop (step 6) fixes it. Test: `ping nfc.balancegamingfl.com` |
| **Black immediately** after Chromium starts | GPU/compositing on Lite OS | Add `--disable-gpu` to the chromium line |
| **Was fine, went black after a while** | Screen blanking / DPMS, or **OOM crash** | Confirm `consoleblank=0` + the `xset` lines ran; add zram (step 4). Check `dmesg \| grep -i -E "oom\|killed"` |
| **Wrong / unrelated content** | URL points at another system | Must be `nfc.balancegamingfl.com/signage.html?screen=main` (or `=entrance`) — **not** a `workers.dev/display/…` URL |
| **"No signal" on the TV** | TV powered on after the Pi booted | Set `hdmi_force_hotplug=1` in `/boot/config.txt`, or power the TV on before the Pi |

Quick health checks over SSH:
```
free -h                                   # is RAM/swap exhausted?
dmesg | grep -i -E "oom|killed"           # did the kernel kill Chromium?
DISPLAY=:0 xset q | grep -A1 "Monitor"    # is DPMS actually disabled?
curl -sI https://nfc.balancegamingfl.com/signage.html | head -1   # page reachable? (expect 200)
```

To see the page's own state, open either URL in a normal desktop browser —
it renders identically there, so if it looks right on a laptop the issue is
the Pi/display, not the page.
