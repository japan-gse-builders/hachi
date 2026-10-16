#!/usr/bin/env bash
# frames.html の各コマと poster.html を PNG に書き出す。macOS の Google Chrome を使う。
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() { # <url> <out> <width> <height>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --virtual-time-budget=3000 --window-size="$3,$4" --screenshot="$2" "$1" 2>/dev/null
}
mkdir -p frames
for id in $(grep -o 'class="frame" id="[^"]*"' frames.html | sed 's/.*id="//;s/"//'); do
  shot "file://$PWD/frames.html#$id" "frames/$id.png" 1280 720
done
shot "file://$PWD/poster.html" poster.png 1800 "$(grep -o 'data-height="[0-9]*"' poster.html | grep -o '[0-9]*')"
