#!/usr/bin/env bash
# List hidraw device nodes belonging to the Xiaomi/Redmi desktop speaker (B03).
set -euo pipefail
found=0
for d in /sys/class/hidraw/hidraw*; do
  [ -e "$d" ] || continue
  uevent="$(cat "$d/device/uevent" 2>/dev/null || true)"
  if echo "$uevent" | grep -qiE 'VID=2717'; then
    name="$(echo "$uevent" | grep '^HID_NAME=' | cut -d= -f2- || true)"
    echo "$(basename "$d")  ${name:-<unknown>}"
    found=1
  fi
done
[ "$found" = 1 ] || { echo "no speaker hidraw found — is the speaker plugged in?" >&2; exit 1; }
