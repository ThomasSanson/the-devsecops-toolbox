#!/usr/bin/env sh
# Install the pinned betterleaks binary used by the binary scan mode.
#
# The scan tasks run betterleaks inside a container by default, which needs
# privileges a lot of runners refuse to grant (issue #225). A project that
# answered so at install time carries TASK_BETTERLEAKS_MODE=binary, and the
# scan then uses what this installs: one pinned version, verified against the
# checksums file published with the release, in a directory the job can already
# write to. No container, no root, no sudo.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${TASK_BETTERLEAKS_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null || true)}"
BIN_DIR="${TASK_BETTERLEAKS_BIN_DIR:-$HOME/.local/bin}"
RELEASES="https://github.com/betterleaks/betterleaks/releases/download"

log() { printf "%s\n" "$*"; }

if [ -z "$VERSION" ]; then
  log "❌ Could not determine the betterleaks version. Check .config/betterleaks/version."
  exit 1
fi

# Already there at the pinned version: nothing to download.
if [ -x "$BIN_DIR/betterleaks" ] && "$BIN_DIR/betterleaks" version 2>/dev/null | grep -q "$VERSION"; then
  log "🎉 betterleaks $VERSION already installed in $BIN_DIR"
  exit 0
fi

# Upstream names its assets linux_x64 / linux_arm64, not amd64.
case "$(uname -s)" in
Linux) OS="linux" ;;
Darwin) OS="darwin" ;;
*)
  log "❌ Unsupported system for the binary mode: $(uname -s). Use TASK_BETTERLEAKS_MODE=docker."
  exit 1
  ;;
esac
case "$(uname -m)" in
x86_64 | amd64) ARCH="x64" ;;
aarch64 | arm64) ARCH="arm64" ;;
*)
  log "❌ Unsupported architecture for the binary mode: $(uname -m). Use TASK_BETTERLEAKS_MODE=docker."
  exit 1
  ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  log "❌ curl is required to install the betterleaks binary."
  exit 1
fi

ASSET="betterleaks_${VERSION}_${OS}_${ARCH}.tar.gz"
TMP_DIR="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$TMP_DIR'" EXIT

log "🔍 Installing betterleaks $VERSION (binary mode, no container)"

# Same retry/timeout flags as the other pinned installers: shared-runner egress
# stalls often enough that an unbounded curl hangs until the job times out.
CURL="curl --location --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 300"
$CURL "$RELEASES/v$VERSION/$ASSET" -o "$TMP_DIR/$ASSET"
$CURL "$RELEASES/v$VERSION/checksums.txt" -o "$TMP_DIR/checksums.txt"

# The release publishes one checksums.txt for every asset; keep the line for
# ours and let sha256sum say yes or no. A tampered or truncated download stops
# here instead of becoming the scanner that guards the repository.
if command -v sha256sum >/dev/null 2>&1; then
  CHECK="sha256sum -c"
elif command -v shasum >/dev/null 2>&1; then
  CHECK="shasum -a 256 -c"
else
  log "❌ Neither sha256sum nor shasum is available to verify the download."
  exit 1
fi
grep " $ASSET\$" "$TMP_DIR/checksums.txt" >"$TMP_DIR/expected.sha256"
if [ ! -s "$TMP_DIR/expected.sha256" ]; then
  log "❌ No checksum published for $ASSET in the v$VERSION release."
  exit 1
fi
if ! (cd "$TMP_DIR" && $CHECK expected.sha256 >/dev/null 2>&1); then
  log "❌ Checksum mismatch for $ASSET — refusing to install."
  exit 1
fi
log "✅ Checksum verified against the published checksums.txt"

tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR" betterleaks
mkdir -p "$BIN_DIR"
mv "$TMP_DIR/betterleaks" "$BIN_DIR/betterleaks"
chmod +x "$BIN_DIR/betterleaks"

log "🎉 betterleaks $VERSION installed in $BIN_DIR"
