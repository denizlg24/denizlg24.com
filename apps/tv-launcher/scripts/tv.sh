#!/usr/bin/env bash
# Builds, installs and provisions the home screen on a Google TV over adb.
#   scripts/tv.sh <host:port> install | provision [pkg,pkg,...] | restore
set -euo pipefail

serial="${1:?usage: tv.sh <host:port> install|provision [packages]|restore}"
command="${2:?usage: tv.sh <host:port> install|provision [packages]|restore}"
root="$(cd "$(dirname "$0")/.." && pwd)"
home="com.denizlg24.home"
# Google TV's own launcher, and the setup package whose RecoveryActivity
# (HOME, priority 1) takes over the moment that launcher is gone. A
# third-party HOME filter is capped at priority 0, so both must be off.
stock=(com.google.android.apps.tv.launcherx com.google.android.tungsten.setupwraith)

tv() { adb -s "$serial" shell "$@"; }

case "$command" in
  install)
    (cd "$root" && ./gradlew -q assembleRelease)
    adb -s "$serial" install -r "$root/app/build/outputs/apk/release/app-release.apk"
    ;;
  provision)
    tv cmd notification allow_listener "$home/$home.MediaWatcher"
    if [[ -n "${3:-}" ]]; then
      tv am start -n "$home/.HomeActivity" --es home "$3" >/dev/null
    fi
    for package in "${stock[@]}"; do tv pm disable-user --user 0 "$package"; done
    tv cmd package set-home-activity "$home/.HomeActivity"
    for scale in window_animation_scale transition_animation_scale animator_duration_scale; do
      tv settings put global "$scale" 0.5
    done
    ;;
  restore)
    for package in "${stock[@]}"; do tv pm enable "$package"; done
    tv cmd notification disallow_listener "$home/$home.MediaWatcher"
    for scale in window_animation_scale transition_animation_scale animator_duration_scale; do
      tv settings put global "$scale" 1.0
    done
    ;;
  *)
    echo "unknown command: $command" >&2
    exit 1
    ;;
esac
