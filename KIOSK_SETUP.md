# In-store signage — Raspberry Pi kiosk setup

Runs the two shop TVs on the in-store signage board. Each TV is a Raspberry
Pi Zero 2 W booting straight into a full-screen Chromium pointed at one URL.

> **The two URLs (no tokens, no Worker):**
> - **75″ landscape** → `https://nfc.balancegamingfl.com/signage.html?screen=main`
> - **40″ portrait**  → `https://nfc.balancegamingfl.com/signage.html?screen=entrance`
>
> These are plain pages on GitHub Pages. Anything like `…workers.dev/display/TOKEN`
> is a **different project** — not this system — and will show a blank screen.

The page already self-reloads hourly with a cache-buster, so once a Pi is
running it keeps itself current with no maintenance.

---

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
Chromium can run out of RAM on the Zero 2 W and the screen goes black. Add
compressed swap:
```
sudo apt install -y zram-tools
printf 'ALGO=lz4\nPERCENT=50\n' | sudo tee /etc/default/zramswap
sudo systemctl restart zramswap
```

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
