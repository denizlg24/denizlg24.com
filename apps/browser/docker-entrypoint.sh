#!/bin/sh
set -eu

# Chrome runs headful: the headless builds identify themselves to every
# challenge script. Chrome is launched lazily on the first session, long after
# the display is up.
if [ "${BROWSER_HEADLESS:-0}" != "1" ]; then
  Xvfb "${DISPLAY}" -screen 0 "${BROWSER_SCREEN:-1920x1080}x24" -nolisten tcp &
fi

exec bun run dist/index.js
