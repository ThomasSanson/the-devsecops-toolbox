#!/bin/sh

set -eu

# Pure shell helper for consistent terminal UI

ui_supports_color() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
    return 0
  fi
  return 1
}

ui_blue() {
  if ui_supports_color; then printf "\033[34m%s\033[0m" "$1"; else printf "%s" "$1"; fi
}

ui_dim() {
  if ui_supports_color; then printf "\033[2m%s\033[0m" "$1"; else printf "%s" "$1"; fi
}

ui_bold() {
  if ui_supports_color; then printf "\033[1m%s\033[0m" "$1"; else printf "%s" "$1"; fi
}

ui_success() {
  if ui_supports_color; then printf "\033[32m✓\033[0m %s\n" "$1"; else printf "✓ %s\n" "$1"; fi
}

ui_error() {
  if ui_supports_color; then printf "\033[31m✗\033[0m %s\n" "$1"; else printf "✗ %s\n" "$1"; fi
}

ui_pause() {
  if ui_supports_color; then printf "\033[33m⏸\033[0m %s\n" "$1"; else printf "⏸ %s\n" "$1"; fi
}

ui_resume() {
  if ui_supports_color; then printf "\033[36m↻\033[0m %s\n" "$1"; else printf "↻ %s\n" "$1"; fi
}
