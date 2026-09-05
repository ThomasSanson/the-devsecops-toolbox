#!/usr/bin/env sh
#
# ============================================================================
# Source publication — publish a private repository's source to a public one
# ============================================================================
#
# DESCRIPTION:
#   Some projects live in a PRIVATE repository and must, at the same time,
#   publish their source. This publishes a FILTERED SNAPSHOT of the tracked
#   files to a second, public repository: one commit per release, no history
#   rewriting, no force-push, and nothing that was held back was ever in the
#   public history to be found later.
#
#   Three things decide, in this order:
#     1. allowlist        what may be published at all
#     2. denylist         what must never be, even when the allowlist matched
#     3. denylist.base    the framework floor, applied always, never editable
#                         downstream
#     …and then the manifest: the exact list of paths somebody APPROVED. What
#     is published equals what was approved, so a new file landing inside an
#     already-published folder stops the publication instead of riding along.
#
#   Publishing is a `git push`, so the mechanism is forge-neutral by
#   construction. The only forge-specific part is the sign-off (opening the
#   approval merge request and reading who answered it), and it lives behind
#   the four functions at the end of this file.
#
# USAGE:
#   sh .config/publication/publish.sh check     # dry run, no token needed
#   sh .config/publication/publish.sh approve   # open the approval merge request
#   sh .config/publication/publish.sh publish   # the real thing (task release)
#
# ENVIRONMENT:
#   TASK_PUBLICATION_ENABLED          off unless "true"
#   TASK_PUBLICATION_TARGET_URL       the public repository's git URL
#   TASK_PUBLICATION_TARGET_BRANCH    default: main
#   TASK_PUBLICATION_TOKEN            write access to the TARGET repository
#   TASK_PUBLICATION_TOKEN_USERNAME   default: oauth2 (x-access-token on GitHub)
#   TASK_PUBLICATION_SOURCE_TOKEN     read/write API on THIS repository, for the
#                                     approval merge request; falls back to
#                                     GITLAB_TOKEN then TASK_COMMITIZEN_TOKEN
#   TASK_PUBLICATION_API_URL          default: derived from the origin remote
#   TASK_PUBLICATION_PROJECT_PATH     default: derived from the origin remote
#   TASK_PUBLICATION_APPROVAL_BRANCH  default: publication-approval
#   TASK_PUBLICATION_SOURCE_REF       what gets published: a branch or a tag.
#                                     default: the repository's default branch
#   TASK_PUBLICATION_ON               when it happens by itself: release (default),
#                                     tag, or manual
#   TASK_PUBLICATION_SCAN             required (default) or off — whether
#                                     the snapshot is scanned for secrets first
#   TASK_PUBLICATION_SCAN_IMAGE       default: ghcr.io/betterleaks/betterleaks:latest
#   TASK_PUBLICATION_SCAN_CONFIG      default: .config/betterleaks/config.toml
#
# EXIT CODES:
#   0  published, or nothing to do
#   1  refused (nothing approved, wrong signatory, misconfiguration)
#
# ============================================================================

set -eu

PUB_DIR=".config/publication"
ALLOWLIST="${PUB_DIR}/allowlist"
DENYLIST="${PUB_DIR}/denylist"
DENY_BASE="${PUB_DIR}/denylist.base"
OWNERS="${PUB_DIR}/owners"
MANIFEST="${PUB_DIR}/manifest"

# The settings live in the dotenv files the root Taskfile loads, and `task
# publication:publish` therefore has them. A CI job runs THIS script directly —
# no task, no dotenv — so it would see none of them. Read them here, in the same
# priority the Taskfile uses, and only for a variable the environment did not
# already set: a CI/CD variable must always beat a file in the repository.
dotenv_value() {
  for _file in .env .env.dev .env.dist; do
    [ -f "${_file}" ] || continue
    # The LAST assignment wins, the way every dotenv reader resolves a key that
    # appears twice — and a file that ships the key empty and has it filled in
    # further down is exactly that case.
    _found="$(sed -n "s/^[[:space:]]*$1=//p" "${_file}" | sed '/^$/d' | tail -n 1 |
      sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")"
    if [ -n "${_found}" ]; then
      printf '%s' "${_found}"
      return 0
    fi
  done
  printf ''
}

TARGET_URL="${TASK_PUBLICATION_TARGET_URL:-$(dotenv_value TASK_PUBLICATION_TARGET_URL)}"
TARGET_BRANCH="${TASK_PUBLICATION_TARGET_BRANCH:-$(dotenv_value TASK_PUBLICATION_TARGET_BRANCH)}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
# What gets published. Empty means the repository's default branch, resolved at
# run time: publishing "whatever is checked out" is how a feature branch reaches
# a public repository from a laptop that happened to have the switch on.
SOURCE_REF="${TASK_PUBLICATION_SOURCE_REF:-$(dotenv_value TASK_PUBLICATION_SOURCE_REF)}"
PUBLICATION_ON="${TASK_PUBLICATION_ON:-$(dotenv_value TASK_PUBLICATION_ON)}"
PUBLICATION_ON="${PUBLICATION_ON:-release}"
SCAN_MODE="${TASK_PUBLICATION_SCAN:-$(dotenv_value TASK_PUBLICATION_SCAN)}"
SCAN_MODE="${SCAN_MODE:-required}"
SCAN_IMAGE="${TASK_PUBLICATION_SCAN_IMAGE:-ghcr.io/betterleaks/betterleaks:latest}"
SCAN_CONFIG="${TASK_PUBLICATION_SCAN_CONFIG:-.config/betterleaks/config.toml}"
TOKEN="${TASK_PUBLICATION_TOKEN:-}"
TOKEN_USERNAME="${TASK_PUBLICATION_TOKEN_USERNAME:-oauth2}"
SOURCE_TOKEN="${TASK_PUBLICATION_SOURCE_TOKEN:-${GITLAB_TOKEN:-${TASK_COMMITIZEN_TOKEN:-}}}"
APPROVAL_BRANCH="${TASK_PUBLICATION_APPROVAL_BRANCH:-publication-approval}"
COMMIT_AUTHOR_NAME="${TASK_PUBLICATION_AUTHOR_NAME:-DevSecOps Toolbox}"
COMMIT_AUTHOR_EMAIL="${TASK_PUBLICATION_AUTHOR_EMAIL:-noreply@devsecops.toolbox}"

TITLE="📄 Source publication"

WORK=""
cleanup() { [ -n "${WORK}" ] && rm -rf "${WORK}" || true; }
trap cleanup EXIT

say() { printf '   %s\n' "$*"; }
head_line() { printf '\n%s\n\n' "${TITLE}"; }
refuse() {
  printf '   ❌ %s\n' "$1"
  shift
  for line in "$@"; do printf '      %s\n' "${line}"; done
  printf '\n'
  exit 1
}

validate_target_url() {
  case "${TARGET_URL}" in
  http*://*@* | http*://*\?* | http*://*\#*)
    refuse "The public repository URL must not contain credentials, a query or a fragment." \
      "Use a plain repository URL and TASK_PUBLICATION_TOKEN."
    ;;
  esac
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    head_line
    refuse "\"$1\" is required by source publication and is not installed."
  }
}

# ---------------------------------------------------------------------------
# Where this repository lives, read from the repository itself. Credentials are
# stripped: an origin URL can carry a token, and nothing here may print one.
# ---------------------------------------------------------------------------
origin_url() { git remote get-url origin 2>/dev/null || printf ''; }

strip_credentials() { printf '%s' "$1" | sed -E 's#^(https?://)[^@/]*@#\1#'; }

derive_api_url() {
  if [ -n "${TASK_PUBLICATION_API_URL:-}" ]; then
    printf '%s' "${TASK_PUBLICATION_API_URL}"
    return
  fi
  if [ -n "${CI_API_V4_URL:-}" ]; then
    printf '%s' "${CI_API_V4_URL}"
    return
  fi
  _o="$(strip_credentials "$(origin_url)")"
  case "${_o}" in
  http*) printf '%s/api/v4' "$(printf '%s' "${_o}" | sed -E 's#^(https?://[^/]+)/.*#\1#')" ;;
  *) printf '' ;;
  esac
}

derive_project_path() {
  if [ -n "${TASK_PUBLICATION_PROJECT_PATH:-}" ]; then
    printf '%s' "${TASK_PUBLICATION_PROJECT_PATH}"
    return
  fi
  if [ -n "${CI_PROJECT_PATH:-}" ]; then
    printf '%s' "${CI_PROJECT_PATH}"
    return
  fi
  _o="$(strip_credentials "$(origin_url)")"
  case "${_o}" in
  http*) printf '%s' "$(printf '%s' "${_o}" | sed -E 's#^https?://[^/]+/##; s#\.git$##')" ;;
  *) printf '' ;;
  esac
}

source_project_url() {
  _o="$(strip_credentials "$(origin_url)")"
  printf '%s' "$(printf '%s' "${_o}" | sed -E 's#\.git$##')"
}

# URL-encode a project path for the GitLab REST API (group/sub/project).
url_encode_path() { printf '%s' "$1" | sed 's#/#%2F#g'; }

# ---------------------------------------------------------------------------
# The three lists, evaluated BY GIT. The patterns are gitignore syntax, so a
# path, a folder and a glob all behave exactly the way every developer already
# expects, on every platform, with no matcher of ours to get wrong. --cached is
# what makes the candidate set the TRACKED files only: an untracked .env in a
# working copy cannot be published even when the allowlist says `**`.
# ---------------------------------------------------------------------------
# core.quotepath=off, everywhere a path is read: git otherwise QUOTES any path
# holding a byte outside ASCII — "src/caf\303\251.js" — and that quoted string
# is not a path. It would travel through the lists, reach checkout-index, and
# publish a file under a name nobody has. A project with an accent in a filename
# is not an edge case.
git_paths() { git -c core.quotepath=off "$@"; }

# Every path decision reads ONE index: the working copy's when the answer is
# about the working copy, a throwaway one built from the published ref when the
# answer is about what leaves. Never both in the same run, and never the
# destination's — `git -C <dest> add` must not inherit this one, which is why it
# travels in a wrapper rather than in the environment.
SOURCE_INDEX=""
git_src() {
  if [ -n "${SOURCE_INDEX}" ]; then
    GIT_INDEX_FILE="${SOURCE_INDEX}" git -c core.quotepath=off --literal-pathspecs "$@"
  else
    git -c core.quotepath=off --literal-pathspecs "$@"
  fi
}

matching() {
  _file="$1"
  git_src ls-files --cached --ignored --exclude-from="${_file}"
}

# The branch a project publishes unless it says otherwise. CI knows it; outside
# CI the remote's HEAD does; a repository with neither is on main.
default_branch() {
  if [ -n "${CI_DEFAULT_BRANCH:-}" ]; then
    printf '%s' "${CI_DEFAULT_BRANCH}"
    return
  fi
  _head="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [ -n "${_head}" ]; then
    printf '%s' "${_head#origin/}"
    return
  fi
  printf '%s' "${TASK_GIT_DEFAULT_BRANCH:-main}"
}

# A ref is a name here and a commit everywhere after. In CI the ref being built
# is usually not a local branch at all — the runner leaves a detached HEAD with
# one ref fetched — so the commit it checked out counts as an answer, and a
# fetch is the last resort rather than the first move.
resolve_source_sha() {
  _ref="$1"
  # CI first, and not as a fallback: the runner reuses its build directory, so a
  # remote-tracking ref there can be older than the commit the job was started
  # for. What the pipeline checked out is what the pipeline is about.
  _sha=""
  if [ "${CI_COMMIT_REF_NAME:-}" = "${_ref}" ]; then
    _sha="${CI_COMMIT_SHA:-}"
  fi
  [ -n "${_sha}" ] || _sha="$(git rev-parse --verify --quiet "${_ref}"'^{commit}' 2>/dev/null || true)"
  [ -n "${_sha}" ] || _sha="$(git rev-parse --verify --quiet "origin/${_ref}"'^{commit}' 2>/dev/null || true)"
  if [ -z "${_sha}" ] && [ "${2:-ref}" = "ref" ]; then
    git fetch --quiet origin "${_ref}" 2>/dev/null &&
      _sha="$(git rev-parse --verify --quiet 'FETCH_HEAD^{commit}' 2>/dev/null || true)"
  fi
  printf '%s' "${_sha}"
}

# A list file: comments are lines that START with #, blank lines are dropped.
# Never strip from the middle of a line — "src/tag#1.js" is a real filename, and
# cutting it there would quietly drop it from the approved list.
read_list() {
  [ -f "$1" ] || return 0
  sed -e 's/^[[:space:]]*#.*$//' -e 's/[[:space:]]*$//' "$1" | sed '/^$/d'
}

# Two ways to answer, and the caller says which. "worktree" is the dry run a
# developer reads while editing a list. "ref" is what actually leaves: the files
# AND the four files that decide, taken from the published ref, so nothing
# uncommitted can widen what becomes public.
compute_lists() {
  _mode="${1:-worktree}"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    head_line
    refuse "This is not a git repository." \
      "Source publication reads the tracked files, so it runs inside the project."
  }
  WORK="$(mktemp -d)"
  ALLOWLIST_F="${ALLOWLIST}"
  DENYLIST_F="${DENYLIST}"
  DENY_BASE_F="${DENY_BASE}"
  OWNERS_F="${OWNERS}"
  MANIFEST_F="${MANIFEST}"

  if [ "${_mode}" = "ref" ] || [ -n "${SOURCE_REF}" ]; then
    SOURCE_LABEL="${SOURCE_REF:-$(default_branch)}"
    SOURCE_SHA="$(resolve_source_sha "${SOURCE_LABEL}" "${_mode}")"
    if [ -z "${SOURCE_SHA}" ]; then
      head_line
      refuse "No such ref: \"${SOURCE_LABEL}\"." \
        "TASK_PUBLICATION_SOURCE_REF names the branch or tag that gets published."
    fi
    SOURCE_INDEX="${WORK}/index"
    GIT_INDEX_FILE="${SOURCE_INDEX}" git read-tree "${SOURCE_SHA}"
    for _name in allowlist denylist denylist.base owners manifest; do
      git show "${SOURCE_SHA}:${PUB_DIR}/${_name}" >"${WORK}/list-${_name}" 2>/dev/null ||
        refuse "Cannot read ${PUB_DIR}/${_name} from ${SOURCE_LABEL}." \
          "Restore the publication policy before trying again."
    done
    ALLOWLIST_F="${WORK}/list-allowlist"
    DENYLIST_F="${WORK}/list-denylist"
    DENY_BASE_F="${WORK}/list-denylist.base"
    OWNERS_F="${WORK}/list-owners"
    MANIFEST_F="${WORK}/list-manifest"
  else
    SOURCE_LABEL="working copy"
    SOURCE_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
  fi

  for _policy in "${ALLOWLIST_F}" "${DENYLIST_F}" "${DENY_BASE_F}" "${OWNERS_F}" "${MANIFEST_F}"; do
    [ -f "${_policy}" ] && [ -r "${_policy}" ] ||
      refuse "Cannot read publication policy ${_policy}."
  done

  git_src ls-files | LC_ALL=C sort >"${WORK}/tracked"
  # Read before sorting: POSIX pipelines otherwise hide a failed git command.
  matching "${ALLOWLIST_F}" >"${WORK}/allowed-raw" || refuse "Cannot evaluate ${ALLOWLIST}."
  matching "${DENY_BASE_F}" >"${WORK}/floor-raw" || refuse "Cannot evaluate ${DENY_BASE}."
  matching "${DENYLIST_F}" >"${WORK}/denied-raw" || refuse "Cannot evaluate ${DENYLIST}."
  LC_ALL=C sort -u "${WORK}/allowed-raw" >"${WORK}/allowed"
  LC_ALL=C sort -u "${WORK}/floor-raw" >"${WORK}/floor"
  LC_ALL=C sort -u "${WORK}/denied-raw" >"${WORK}/denied"

  # Held back by the framework floor, then by the project's own denylist. A file
  # caught by both is reported once, under the floor: that is the rule a project
  # cannot change, so it is the one worth naming.
  LC_ALL=C comm -12 "${WORK}/allowed" "${WORK}/floor" >"${WORK}/held-floor"
  LC_ALL=C comm -12 "${WORK}/allowed" "${WORK}/denied" |
    LC_ALL=C comm -23 - "${WORK}/held-floor" >"${WORK}/held-denylist"

  LC_ALL=C sort -u "${WORK}/held-floor" "${WORK}/held-denylist" >"${WORK}/held"
  LC_ALL=C comm -23 "${WORK}/allowed" "${WORK}/held" >"${WORK}/published"

  # The approved list, comments and blank lines stripped.
  read_list "${MANIFEST_F}" | LC_ALL=C sort -u >"${WORK}/manifest"
  LC_ALL=C comm -23 "${WORK}/published" "${WORK}/manifest" >"${WORK}/unapproved"

  OUTSIDE_COUNT="$(LC_ALL=C comm -23 "${WORK}/tracked" "${WORK}/allowed" | wc -l | tr -d ' ')"
  PUBLISHED_COUNT="$(wc -l <"${WORK}/published" | tr -d ' ')"
  HELD_COUNT="$(wc -l <"${WORK}/held" | tr -d ' ')"
  UNAPPROVED_COUNT="$(wc -l <"${WORK}/unapproved" | tr -d ' ')"
  validate_snapshot_entries
}

# The manifest is line-oriented. Refuse Git's quoted paths and unsupported
# object modes instead of advertising a file that cannot be copied faithfully.
snapshot_entry() {
  _entry="$(git_src ls-files --stage -- "$1")"
  ENTRY_MODE="${_entry%% *}"
  ENTRY_OBJECT="${_entry#* }"
  ENTRY_OBJECT="${ENTRY_OBJECT%% *}"
}

validate_snapshot_entries() {
  while IFS= read -r _path; do
    case "${_path}" in
    \"* | \#*) refuse "Unsupported publication path: ${_path}." ;;
    esac
    snapshot_entry "${_path}"
    case "${ENTRY_MODE}" in
    100644 | 100755) ;;
    *) refuse "Unsupported publication file: ${_path} (Git mode ${ENTRY_MODE})." \
      "Symlinks and submodules must be excluded in ${DENYLIST}." ;;
    esac
    if [ "$(git cat-file -s "${ENTRY_OBJECT}")" -le 1024 ] &&
      git cat-file blob "${ENTRY_OBJECT}" | grep -qxF 'version https://git-lfs.github.com/spec/v1'; then
      refuse "Unsupported publication file: ${_path} (Git LFS pointer)." \
        "Exclude it in ${DENYLIST}; publication does not fetch LFS objects."
    fi
  done <"${WORK}/published"
}

owner_list() { read_list "${OWNERS_F}"; }

owners_inline() { owner_list | tr '\n' ' ' | sed 's/ *$//'; }

# "1 file" / "3 files". A count is read by a human, and "1 files" reads like a bug.
plural() {
  if [ "$1" -eq 1 ]; then printf '%s' "$2"; else printf '%s' "$3"; fi
}

# The release this snapshot belongs to: the tag on HEAD when the release just
# made one, otherwise the most recent tag that is reachable, otherwise the
# commit itself. A project with no tags at all still publishes.
release_name() {
  _at="${SOURCE_SHA:-HEAD}"
  git describe --tags --exact-match "${_at}" 2>/dev/null ||
    git describe --tags --abbrev=0 "${_at}" 2>/dev/null ||
    git rev-parse --short "${_at}"
}

# ---------------------------------------------------------------------------
# The secret scan. What is scanned is the SNAPSHOT — the files that are about to
# become public — and not the repository around them: a secret in a file that
# never leaves is the code phase's business, and this one's whole job is that
# nothing secret goes out. The snapshot carries no history either, so scanning
# its contents covers everything the public repository will ever hold.
# ---------------------------------------------------------------------------
export_snapshot() {
  _dir="$1"
  mkdir -p "${_dir}" || return 1
  # checkout-index applies the workstation's smudge filters and attributes.
  # Read blobs directly so an uncommitted setting cannot change what is scanned.
  while IFS= read -r _path; do
    snapshot_entry "${_path}" || return 1
    _parent="${_path%/*}"
    [ "${_parent}" != "${_path}" ] || _parent=.
    mkdir -p "${_dir}/${_parent}" || return 1
    git cat-file blob "${ENTRY_OBJECT}" >"${_dir}/${_path}" || return 1
    case "${ENTRY_MODE}" in
    100755) chmod 755 "${_dir}/${_path}" || return 1 ;;
    *) chmod 644 "${_dir}/${_path}" || return 1 ;;
    esac
  done <"${WORK}/published"
}

# Prefer an installed binary, fall back to the container, and say so when there
# is neither: "no scanner" is not "no secret", so the publication stops there
# unless a human has said otherwise.
scan_snapshot() {
  case "${SCAN_MODE}" in
  off)
    say "⚠️  Secret scan skipped (TASK_PUBLICATION_SCAN=off)."
    return 0
    ;;
  required) ;;
  *) refuse "Invalid TASK_PUBLICATION_SCAN: use required or off." ;;
  esac

  _snap="${WORK}/snapshot"
  export_snapshot "${_snap}" || refuse "Could not export every published file; the snapshot was not scanned."

  # Scanned from INSIDE the snapshot, as ".", so every path the scanner tests is
  # the path that file has in the repository. It matters: a project allowlist
  # naming `tmp/` (a real one does) would otherwise match the whole snapshot,
  # since a temporary directory lives under /tmp — and a scan that skips
  # everything reports no secret at all.
  # -v so the report names the file and the line: a verdict nobody can act on is
  # not a verdict.
  if command -v betterleaks >/dev/null 2>&1; then
    _cfg=""
    [ -f "${SCAN_CONFIG}" ] && _cfg="$(cd "$(dirname "${SCAN_CONFIG}")" && pwd)/$(basename "${SCAN_CONFIG}")"
    if [ -n "${_cfg}" ]; then
      (cd "${_snap}" && betterleaks dir . --config="${_cfg}" -v) >"${WORK}/scan.log" 2>&1 || return 1
    else
      (cd "${_snap}" && betterleaks dir . -v) >"${WORK}/scan.log" 2>&1 || return 1
    fi
    return 0
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    _name="publication-scan-$$"
    docker rm -f "${_name}" >/dev/null 2>&1 || true
    docker run --rm -d --name "${_name}" --entrypoint sleep "${SCAN_IMAGE}" infinity >/dev/null 2>&1 || {
      say "❌ Could not start ${SCAN_IMAGE}."
      return 1
    }
    # Copied in rather than mounted: a bind mount hands the container the host's
    # ownership, and the framework's own betterleaks task learned that the hard
    # way.
    if ! docker cp "${_snap}/." "${_name}:/snapshot" >/dev/null 2>&1; then
      docker rm -f "${_name}" >/dev/null 2>&1 || true
      refuse "Could not copy the complete snapshot to the scanner."
    fi
    set --
    if [ -f "${SCAN_CONFIG}" ]; then
      if ! docker cp "${SCAN_CONFIG}" "${_name}:/betterleaks.toml" >/dev/null 2>&1; then
        docker rm -f "${_name}" >/dev/null 2>&1 || true
        refuse "Could not copy the scanner configuration."
      fi
      set -- --config=/betterleaks.toml
    fi
    docker exec -w /snapshot "${_name}" betterleaks dir . "$@" -v >"${WORK}/scan.log" 2>&1
    _rc=$?
    docker rm -f "${_name}" >/dev/null 2>&1 || true
    return ${_rc}
  fi

  head_line
  refuse "The secret scan cannot run here: no betterleaks, no docker." \
    "What becomes public is scanned before it leaves, and a scanner that is" \
    "missing is not a scanner that passed." \
    "Install docker, or set TASK_PUBLICATION_SCAN=off to publish without it."
}

cmd_scan() {
  compute_lists ref
  head_line
  say "Source      ${SOURCE_LABEL} ($(git rev-parse --short "${SOURCE_SHA}"))"
  say "Scanning    ${PUBLISHED_COUNT} $(plural "${PUBLISHED_COUNT}" file files) for secrets"
  printf '\n'
  if scan_snapshot; then
    # The scanner's own summary, kept: "no secret found" over an empty directory
    # reads exactly like "no secret found" over the real thing.
    grep -E "scanned" "${WORK}/scan.log" 2>/dev/null | tail -n 1 | sed -e 's/^/     /'
    say "✅ No secret found in what would become public."
    printf '\n'
    return 0
  fi
  sed -e 's/^/     /' "${WORK}/scan.log" 2>/dev/null | tail -n 30
  printf '\n'
  refuse "A secret was found in a file that was about to become public." \
    "Nothing was published. Remove it, or exclude the file in ${DENYLIST}."
}

cmd_export() {
  _dir="${1:-}"
  [ -n "${_dir}" ] || {
    printf 'usage: %s export <directory>\n' "$0" >&2
    exit 2
  }
  compute_lists ref
  export_snapshot "${_dir}"
  printf '%s\n' "${PUBLISHED_COUNT}"
}

# ---------------------------------------------------------------------------
# check — the dry run. No token, no network, no side effect: this is what you
# run before switching publication on, and what a reviewer runs to see the
# answer for themselves.
# ---------------------------------------------------------------------------
cmd_check() {
  compute_lists
  head_line
  say "Source      ${SOURCE_LABEL}, published on ${PUBLICATION_ON}"
  if [ -n "${TARGET_URL}" ]; then
    say "Target      ${TARGET_URL} (branch ${TARGET_BRANCH})"
  else
    say "Target      not configured (TASK_PUBLICATION_TARGET_URL)"
  fi
  say "Approval    $(approval_summary)"
  printf '\n'

  say "Publishing ${PUBLISHED_COUNT} $(plural "${PUBLISHED_COUNT}" file files)"
  while IFS= read -r p; do printf '     %s\n' "${p}"; done <"${WORK}/published"

  if [ "${HELD_COUNT}" -gt 0 ]; then
    printf '\n'
    say "Withholding ${HELD_COUNT} $(plural "${HELD_COUNT}" file files) the allowlist matched"
    while IFS= read -r p; do printf '     %-32s %s\n' "${p}" "framework floor"; done <"${WORK}/held-floor"
    while IFS= read -r p; do printf '     %-32s %s\n' "${p}" "${DENYLIST}"; done <"${WORK}/held-denylist"
  fi

  if [ "${OUTSIDE_COUNT}" -gt 0 ]; then
    printf '\n'
    if [ "${OUTSIDE_COUNT}" -eq 1 ]; then
      say "1 other tracked file is outside the allowlist and never leaves."
    else
      say "${OUTSIDE_COUNT} other tracked files are outside the allowlist and never leave."
    fi
  fi
  printf '\n'
}

approval_summary() {
  if [ ! -s "${WORK}/manifest" ]; then
    printf 'no approved list yet — nothing has ever been published'
    return
  fi
  if [ "${UNAPPROVED_COUNT}" -gt 0 ]; then
    printf '%s not in the approved list' "${UNAPPROVED_COUNT}"
    return
  fi
  printf 'paths match the manifest; owner signature is checked at publication'
}

# ---------------------------------------------------------------------------
# publish — refuse, or push the snapshot.
# ---------------------------------------------------------------------------
cmd_publish() {
  if [ "${TASK_PUBLICATION_ENABLED:-$(dotenv_value TASK_PUBLICATION_ENABLED)}" != "true" ]; then
    say "Publication disabled (TASK_PUBLICATION_ENABLED is not true)."
    return 0
  fi
  # Job rules cannot read a versioned dotenv file. Enforce the choice here too,
  # so a manual project never publishes merely because an automatic job exists.
  if [ -n "${CI:-}" ] && [ "${PUBLICATION_ON}" = "manual" ] && [ "${CI_JOB_MANUAL:-}" != "true" ]; then
    say "Publication waits for a manual job (TASK_PUBLICATION_ON=manual)."
    return 0
  fi
  if [ -n "${CI:-}" ] && [ "${PUBLICATION_ON}" = "tag" ] && [ -z "${CI_COMMIT_TAG:-}" ]; then
    say "Publication waits for a tag pipeline (TASK_PUBLICATION_ON=tag)."
    return 0
  fi
  require git
  # The ref, never the working copy: a laptop sitting on a feature branch with
  # the switch on would otherwise publish that branch.
  compute_lists ref
  head_line
  say "Source      ${SOURCE_LABEL} ($(git rev-parse --short "${SOURCE_SHA}"))"

  [ -n "${TARGET_URL}" ] || refuse \
    "No public repository configured." \
    "Set TASK_PUBLICATION_TARGET_URL to the git URL of the project to publish to."
  [ -n "${TOKEN}" ] || refuse \
    "No token for the public repository." \
    "Set TASK_PUBLICATION_TOKEN to a token that may push to ${TARGET_URL}."
  [ -n "$(owner_list)" ] || refuse \
    "${OWNERS} is empty, so nobody can approve what becomes public." \
    "List the people who decide, one username per line, before switching publication on."
  if [ "${PUBLISHED_COUNT}" -eq 0 ]; then
    refuse "The allowlist matches nothing, so there is nothing to publish." \
      "Check ${ALLOWLIST}: an empty or unmatched allowlist publishes nothing."
  fi

  if [ "${UNAPPROVED_COUNT}" -gt 0 ]; then
    printf '   %s %s would become public for the first time:\n' \
      "${UNAPPROVED_COUNT}" "$(plural "${UNAPPROVED_COUNT}" path paths)"
    while IFS= read -r p; do printf '     + %s\n' "${p}"; done <"${WORK}/unapproved"
    printf '\n'
    say "Nobody has approved that list, so nothing was published."
    open_approval_request
    printf '\n'
    exit 1
  fi

  resolve_approval
  if [ "${APPROVAL_OK}" -ne 1 ]; then
    if [ -n "${APPROVAL_SIGNER}" ]; then
      refuse "The approved list was signed off by \"${APPROVAL_SIGNER}\", who is not an owner." \
        "${OWNERS} lists: $(owners_inline)" \
        "Ask one of them to answer the thread on merge request !${APPROVAL_MR_IID}."
    fi
    refuse "The approved list carries no owner signature." \
      "${OWNERS} lists: $(owners_inline)" \
      "Run \`task publication:approve\` and let an owner answer the thread it opens."
  fi

  if ! scan_snapshot; then
    printf '\n'
    sed -e 's/^/     /' "${WORK}/scan.log" 2>/dev/null | tail -n 30
    printf '\n'
    refuse "A secret was found in a file that was about to become public." \
      "Nothing was published. Remove it, or exclude the file in ${DENYLIST}."
  fi

  push_snapshot "${APPROVAL_SIGNER}"
}

push_snapshot() {
  _who="$1"
  _version="$(release_name)"
  _sha="${SOURCE_SHA}"
  _dest="${WORK}/destination"

  _credential_file="${WORK}/credential-helper"
  # Only the helper's code is written. Credentials travel through the
  # environment and git's credential protocol, never process arguments.
  cat >"${_credential_file}" <<'CREDENTIAL_HELPER'
#!/bin/sh
[ "$1" = get ] || exit 0
while IFS= read -r field; do
  case "$field" in
  '') break ;;
  host=*) [ "${field#host=}" = "$PUBLICATION_CREDENTIAL_HOST" ] || exit 0 ;;
  esac
done
printf 'username=%s\npassword=%s\n' "$PUBLICATION_CREDENTIAL_USER" "$PUBLICATION_CREDENTIAL_TOKEN"
CREDENTIAL_HELPER
  chmod 700 "${_credential_file}"
  PUBLICATION_CREDENTIAL_HOST="$(printf '%s' "${TARGET_URL}" | sed -E 's#^https?://([^/]+).*#\1#')"
  PUBLICATION_CREDENTIAL_USER="${TOKEN_USERNAME}"
  PUBLICATION_CREDENTIAL_TOKEN="${TOKEN}"
  export PUBLICATION_CREDENTIAL_HOST PUBLICATION_CREDENTIAL_USER PUBLICATION_CREDENTIAL_TOKEN
  # Never wait for a human: a missing credential must fail the job, not hang it.
  GIT_TERMINAL_PROMPT=0
  export GIT_TERMINAL_PROMPT
  # Reset inherited helpers so they cannot store this credential. Git's env
  # interface selects the helper without putting a token in argv or .git/config.
  GIT_CONFIG_COUNT=2
  GIT_CONFIG_KEY_0=credential.helper
  GIT_CONFIG_VALUE_0=""
  GIT_CONFIG_KEY_1=credential.helper
  GIT_CONFIG_VALUE_1="${_credential_file}"
  export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_CONFIG_KEY_1 GIT_CONFIG_VALUE_1

  # A full clone, not a shallow one: the push is a plain fast-forward on top of
  # whatever the public repository already has, and history stays intact.
  if ! git clone --quiet --no-checkout "${TARGET_URL}" "${_dest}" 2>"${WORK}/clone.err"; then
    refuse "Cannot reach the public repository ${TARGET_URL}." \
      "Check the URL and that TASK_PUBLICATION_TOKEN may push to it." \
      "$(redact_token <"${WORK}/clone.err" | tail -n 3)"
  fi

  if git -C "${_dest}" rev-parse --verify --quiet "origin/${TARGET_BRANCH}" >/dev/null 2>&1; then
    git -C "${_dest}" symbolic-ref HEAD "refs/heads/${TARGET_BRANCH}"
    git -C "${_dest}" update-ref HEAD "origin/${TARGET_BRANCH}"
  else
    git -C "${_dest}" symbolic-ref HEAD "refs/heads/${TARGET_BRANCH}"
  fi

  # Replace the destination index with exactly the approved blobs and modes.
  # No working-tree filter or ignore rule may rewrite or discard those bytes.
  git -C "${_dest}" read-tree --empty
  while IFS= read -r _path; do
    snapshot_entry "${_path}" || refuse "Cannot read the approved Git entry: ${_path}."
    # Check the reader separately: a successful hash-object at the end of a
    # pipeline could otherwise turn a failed read into a valid empty blob.
    git cat-file blob "${ENTRY_OBJECT}" >"${WORK}/public-blob" ||
      refuse "Cannot read the approved Git contents: ${_path}. Nothing was pushed."
    _object="$(git -C "${_dest}" hash-object -w --no-filters "${WORK}/public-blob")" ||
      refuse "Cannot store the approved Git contents: ${_path}. Nothing was pushed."
    git -C "${_dest}" update-index --add --cacheinfo "${ENTRY_MODE},${_object},${_path}"
  done <"${WORK}/published"

  # Same source commit means a retry; identical public bytes in a NEW release
  # still owe a publication commit and its tag.
  _previous="$(git -C "${_dest}" log -1 --format=%B 2>/dev/null || true)"
  if git -C "${_dest}" diff --cached --quiet && printf '%s\n' "${_previous}" | grep -qxF "Commit: ${_sha}"; then
    push_public_refs
    say "The public repository is already up to date at ${_version}."
    printf '\n'
    return 0
  fi

  _message="$(printf 'publish %s\n\nSource: %s\nCommit: %s\nFiles:  %s published, %s withheld\n' \
    "${_version}" "$(source_project_url)" "${_sha}" "${PUBLISHED_COUNT}" "${HELD_COUNT}")"
  git -C "${_dest}" \
    -c "user.name=${COMMIT_AUTHOR_NAME}" -c "user.email=${COMMIT_AUTHOR_EMAIL}" \
    commit --quiet --allow-empty --no-verify -m "${_message}"

  push_public_refs

  say "Approved by \"${_who}\" in merge request !${APPROVAL_MR_IID}"
  say "Publishing ${PUBLISHED_COUNT} files, withholding ${HELD_COUNT}"
  say "Pushed ${SOURCE_LABEL} as ${_version} to ${TARGET_URL} (branch ${TARGET_BRANCH})"
  printf '\n'
}

# Retrying a source commit must also settle its release tag. An earlier
# untagged publication already supplies the right public commit for a new tag.
push_public_refs() {
  set -- "HEAD:refs/heads/${TARGET_BRANCH}"
  if git describe --tags --exact-match "${SOURCE_SHA}" >/dev/null 2>&1; then
    _tag_commit="$(git -C "${_dest}" rev-parse --verify --quiet "refs/tags/${_version}^{commit}" 2>/dev/null || true)"
    if [ -n "${_tag_commit}" ]; then
      [ "${_tag_commit}" = "$(git -C "${_dest}" rev-parse HEAD)" ] ||
        refuse "The public tag ${_version} already identifies another commit."
    else
      git -C "${_dest}" tag "${_version}" || refuse "Could not create the public tag ${_version}."
    fi
    set -- "$@" "refs/tags/${_version}"
  fi
  if ! git -C "${_dest}" push --quiet --atomic origin "$@"; then
    refuse "The push to ${TARGET_URL} was refused." \
      "The public repository moved on its own; nothing here force-pushes over it."
  fi
}

# ---------------------------------------------------------------------------
# approve — open (or refresh) the merge request that asks the owners to approve
# the new list. Everything below this line is the only forge-specific part of
# the feature; a GitHub or Forgejo implementation replaces these four functions
# and nothing else.
# ---------------------------------------------------------------------------
API_URL="$(derive_api_url)"
PROJECT_PATH="$(derive_project_path)"
PROJECT_ENC="$(url_encode_path "${PROJECT_PATH}")"
APPROVAL_MR_IID=""
APPROVAL_SIGNER=""
APPROVAL_OK=0

api() {
  _api_method="$1"
  _api_path="$2"
  shift 2
  # Read the header and JSON body from stdin. jq quotes embedded newlines and
  # quotes without exposing either credential in an external process's argv.
  {
    printf 'header = '
    printf 'PRIVATE-TOKEN: %s' "${SOURCE_TOKEN}" | jq -Rs .
    printf 'header = "Content-Type: application/json"\n'
    if [ "$#" -gt 0 ]; then
      [ "$#" -eq 2 ] && [ "$1" = --data ] || return 2
      printf 'data = '
      printf '%s' "$2" | jq -Rs .
    fi
  } | curl --config - --silent --show-error --fail-with-body \
    --connect-timeout 10 --max-time 60 --request "${_api_method}" "${API_URL}${_api_path}"
}

redact_token() {
  PUBLICATION_REDACT_TOKEN="${TOKEN}" awk '
    BEGIN { token = ENVIRON["PUBLICATION_REDACT_TOKEN"] }
    {
      line = $0
      while (length(token) && (pos = index(line, token))) {
        line = substr(line, 1, pos - 1) "***" substr(line, pos + length(token))
      }
      print "git: " line
    }'
}

forge_ready() {
  [ -n "${API_URL}" ] && [ -n "${PROJECT_PATH}" ] && [ -n "${SOURCE_TOKEN}" ]
}

# GitLab keeps the old resolver when a note is edited. A resolved question is
# usable only while its body predates that decision. Normalize UTC fractions
# without rounding: an edit within the same second must invalidate the answer.
# Open questions remain reusable, since an owner still has to resolve them.
approval_notes() {
  jq --arg marker "$1" '
    def instant:
      (try (
        select(type == "string")
        | capture("^(?<whole>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.(?<fraction>[0-9]{1,9}))?Z$")
        | . as $parts
        | ($parts.whole + "Z") as $whole
        | select(($whole | fromdateiso8601 | todateiso8601) == $whole)
        | $parts.whole + "." + ((($parts.fraction // "") + "000000000")[0:9]) + "Z"
      ) catch null) // null;
    def unedited:
      (.updated_at | instant) as $updated
      | (.resolved_at | instant) as $resolved
      | $updated != null and $resolved != null and $updated <= $resolved;
    [.[]?.notes[]?
      | select(.system | not)
      | select(.resolvable == true)
      | select((.body // "" | split("\n")) | index($marker))
      | select(.resolved == false or (.resolved == true and unedited))]
  '
}

# WHO put their name on the approved list. The chain: the commit that last
# changed the manifest, the merge request that brought it in, and the thread
# somebody answered on it. The forge blocks a merge while a thread is open even
# on the free tier — that part is enforced by the forge; reading WHO answered is
# what turns "somebody" into "an owner", and that part is this function.
#
# It sets globals rather than printing a name, because a `$(…)` call runs in a
# subshell and every assignment made in one is thrown away when it returns.
resolve_approval() {
  APPROVAL_MR_IID=""
  APPROVAL_SIGNER=""
  APPROVAL_OK=0

  forge_ready || return 0
  command -v jq >/dev/null 2>&1 || return 0

  _commit="$(git log -1 --format=%H "${SOURCE_SHA:-HEAD}" -- "${MANIFEST}" 2>/dev/null || true)"
  [ -n "${_commit}" ] || return 0

  _mr="$(api GET "/projects/${PROJECT_ENC}/repository/commits/${_commit}/merge_requests?state=merged" |
    jq -r '[.[]? | select(.state == "merged")] | .[0].iid // empty' 2>/dev/null || true)"
  [ -n "${_mr}" ] || return 0
  APPROVAL_MR_IID="${_mr}"

  # EVERY answered thread, not just the first: an owner who arrives after
  # somebody else already ticked the box has to be able to answer on the same
  # merge request, and that late answer is what unblocks the publication.
  _marker="Publication-manifest: $(git hash-object "${MANIFEST_F}")"
  _signers="$(api GET "/projects/${PROJECT_ENC}/merge_requests/${_mr}/discussions?per_page=100" |
    approval_notes "${_marker}" |
    jq -r '[.[]? | select(.resolved == true) | .resolved_by.username]
            | unique | .[]' 2>/dev/null || true)"
  [ -n "${_signers}" ] || return 0

  # An owner among them settles it; otherwise keep the first name, so the
  # refusal can say who did answer instead of only who should have.
  APPROVAL_SIGNER="$(printf '%s\n' "${_signers}" | head -n 1)"
  for _candidate in ${_signers}; do
    if owner_list | grep -qxF "${_candidate}"; then
      APPROVAL_SIGNER="${_candidate}"
      APPROVAL_OK=1
      break
    fi
  done
  return 0
}

open_approval_request() {
  if ! forge_ready; then
    say "Run \`task publication:approve\` and have an owner approve the list."
    return 0
  fi
  require jq
  # "asks", not "opened": the same merge request is reused while it is open, so
  # a second refusal must not claim to have created a second one.
  _iid="$(cmd_approve_quiet)" || refuse "The forge refused the approval request. Nothing was approved."
  if [ -n "${_iid}" ]; then
    say "Merge request !${_iid} asks the owners to approve it: $(owners_inline)"
    say "$(source_project_url)/-/merge_requests/${_iid}"
  fi
}

# Write the manifest onto the approval branch, open the merge request if there
# is none, and leave ONE resolvable thread on it: GitLab refuses the merge while
# that thread is unanswered, so the question cannot be skipped by accident.
cmd_approve_quiet() {
  # The branch the approval lands on: the one being published when that is a
  # branch here, the repository's default branch otherwise. Never
  # `git rev-parse --abbrev-ref HEAD`: a CI checkout is detached, that call
  # answers "HEAD", and a merge request cannot target a branch by that name.
  _default="$(default_branch)"
  if [ "${SOURCE_LABEL:-}" != "working copy" ] && [ -n "${SOURCE_LABEL:-}" ] &&
    git show-ref --verify --quiet "refs/heads/${SOURCE_LABEL}"; then
    _default="${SOURCE_LABEL}"
  fi
  # Byte-identical to the header the shipped manifest carries, so the approval
  # merge request's diff is the paths and nothing else. Written to a file and
  # read back with jq's --rawfile: a command substitution eats trailing
  # newlines, and the diff would then carry a "\ No newline at end of file".
  {
    printf '%s\n' \
      '# Paths approved to be published, written by "task publication:approve".' \
      '# Every change to this file goes through a merge request an owner has to answer.'
    cat "${WORK}/published"
  } >"${WORK}/manifest-next"

  _open="$(api GET "/projects/${PROJECT_ENC}/merge_requests?state=opened&source_branch=${APPROVAL_BRANCH}" |
    jq -r 'if type=="array" and length>0 then .[0].iid else empty end' 2>/dev/null || true)"

  if [ -z "${_open}" ]; then
    api DELETE "/projects/${PROJECT_ENC}/repository/branches/${APPROVAL_BRANCH}" >/dev/null 2>&1 || true
  fi

  _ref="${APPROVAL_BRANCH}"
  [ -n "${_open}" ] || _ref="${_default}"
  _exists="$(api GET "/projects/${PROJECT_ENC}/repository/files/$(url_encode_path "${MANIFEST}")?ref=${_ref}" |
    jq -r 'if .file_path? then "yes" else "no" end' 2>/dev/null || printf 'no')"
  _action="create"
  [ "${_exists}" = "yes" ] && _action="update"

  _payload="$(jq -n \
    --arg branch "${APPROVAL_BRANCH}" \
    --arg start "${_default}" \
    --arg msg "chore(publication): approve ${UNAPPROVED_COUNT} new path(s) for publication" \
    --arg action "${_action}" \
    --arg file "${MANIFEST}" \
    --rawfile content "${WORK}/manifest-next" \
    --argjson fresh "$([ -n "${_open}" ] && printf 'false' || printf 'true')" \
    '{branch: $branch, commit_message: $msg,
      actions: [{action: $action, file_path: $file, content: $content}]}
      + (if $fresh then {start_branch: $start} else {} end)')"
  api POST "/projects/${PROJECT_ENC}/repository/commits" --data "${_payload}" >/dev/null || return 1

  if [ -n "${_open}" ]; then
    ensure_approval_thread "${_open}" || return 1
    printf '%s' "${_open}"
    return 0
  fi

  _desc="$(printf '%s\n' \
    "These paths would become **public**. Read the change to \`${MANIFEST}\`: every added line is a file that leaves this repository at the next release." \
    '' \
    "Owners: $(owner_list | sed 's/^/@/' | tr '\n' ' ')" \
    '' \
    'Answering the thread below is the sign-off. The publication checks **who** answered it, so it has to be one of the owners above.')"
  _created="$(api POST "/projects/${PROJECT_ENC}/merge_requests" --data "$(jq -n \
    --arg source "${APPROVAL_BRANCH}" \
    --arg target "${_default}" \
    --arg title "chore(publication): approve what becomes public" \
    --arg description "${_desc}" \
    '{source_branch: $source, target_branch: $target, title: $title,
      description: $description, remove_source_branch: true}')")" || return 1
  _mr="$(printf '%s' "${_created}" | jq -r '.iid // empty' 2>/dev/null || true)"
  if [ -z "${_mr}" ]; then
    # Silence here is how a refusal looks like a bug: the publication stopped and
    # nobody was asked anything, with no reason on screen.
    say "❌ Could not open the approval merge request onto \"${_default}\"."
    say "   $(printf '%s' "${_created}" |
      jq -r '(.message | if type=="object" then (to_entries[] | "\(.key) \(.value|join(", "))") elif type=="array" then join(", ") else . end)? // "the API refused the call"' 2>/dev/null)"
    return 1
  fi

  ensure_approval_thread "${_mr}" || return 1

  printf '%s' "${_mr}"
}

# The question names the exact manifest blob. Refreshing an approval request
# opens a new question when its paths changed; the old answer cannot sign it.
ensure_approval_thread() {
  _thread_mr="$1"
  _thread_marker="Publication-manifest: $(git hash-object "${WORK}/manifest-next")"
  _thread_body="$(printf '%s\n\n%s' \
    'Do these paths become public? Resolve this thread to say yes. An owner has to be the one who does.' \
    "${_thread_marker}")"
  _threads="$(api GET "/projects/${PROJECT_ENC}/merge_requests/${_thread_mr}/discussions?per_page=100")" || return 1
  _thread_exists="$(printf '%s' "${_threads}" |
    approval_notes "${_thread_marker}" |
    jq -r --arg body "${_thread_body}" '[.[]? | select(.body == $body)] | length')"
  if [ "${_thread_exists}" -eq 0 ]; then
    api POST "/projects/${PROJECT_ENC}/merge_requests/${_thread_mr}/discussions" --data "$(jq -n \
      --arg body "${_thread_body}" '{body: $body}')" >/dev/null
  fi
}

cmd_approve() {
  # What will be published, not what is on this machine: approving a list the
  # publication would not use is worse than not approving at all.
  compute_lists ref
  head_line
  if [ "${UNAPPROVED_COUNT}" -eq 0 ]; then
    resolve_approval
    if [ "${APPROVAL_OK}" -eq 1 ]; then
      say "The approved list is already up to date — nothing to ask."
      printf '\n'
      return 0
    fi
    # Older approvals did not identify the manifest. Ask on the merge request
    # that introduced this exact blob, even when no path needs to be added.
    if [ -n "${APPROVAL_MR_IID}" ]; then
      cp "${MANIFEST_F}" "${WORK}/manifest-next"
      ensure_approval_thread "${APPROVAL_MR_IID}" || refuse "The forge refused the approval thread."
      say "Merge request !${APPROVAL_MR_IID} asks the owners to approve it: $(owners_inline)"
      say "$(source_project_url)/-/merge_requests/${APPROVAL_MR_IID}"
      printf '\n'
      return 0
    fi
  fi
  open_approval_request
  printf '\n'
}

# ---------------------------------------------------------------------------
# init — the forge setup a project needs ONCE, when it installed only this
# component. Two things stand between such a project and staying up to date: a
# token Renovate can authenticate with, and something that runs it. The complete
# framework does this with `task glab:renovate-token`, which needs the glab CLI;
# a project that took one component has no glab, so the same calls live here in
# curl. The name, the scope and the access level are the framework's, to the
# letter — a project that later installs the whole toolbox finds its token
# already correct instead of a second one beside it.
# ---------------------------------------------------------------------------
RENOVATE_TOKEN_NAME="${TASK_PUBLICATION_RENOVATE_TOKEN_NAME:-TASK_RENOVATE_TOKEN}"
SCHEDULE_CRON="${TASK_PUBLICATION_SCHEDULE_CRON:-0 4 * * *}"
ENV_FILE="${TASK_PUBLICATION_ENV_FILE:-.env.dist}"

# A token is typed, never echoed and never written to a file. `read -s` is bash,
# not POSIX sh: turning the terminal echo off around a plain read is what works
# in every shell this script runs under.
ask_secret() {
  printf '   %s' "$1" >&2
  if [ -t 0 ]; then
    stty -echo 2>/dev/null || true
    read -r _secret
    stty echo 2>/dev/null || true
    printf '\n' >&2
  else
    read -r _secret
  fi
  printf '%s' "${_secret}"
}

ask_line() {
  printf '   %s' "$1" >&2
  read -r _line
  printf '%s' "${_line}"
}

# The destination and the on/off switch are settings, not secrets: they belong
# in the versioned defaults file, where the whole team can see where the source
# goes. Replace the line if it is there, append it if it is not.
set_env_value() {
  _key="$1"
  _value="$2"
  [ -f "${ENV_FILE}" ] || : >"${ENV_FILE}"
  if grep -q "^${_key}=" "${ENV_FILE}" 2>/dev/null; then
    _tmp="${ENV_FILE}.publication-tmp"
    _v="${_value}" awk -v key="${_key}" \
      'BEGIN{v=ENVIRON["_v"]} $0 ~ "^" key "=" {print key "=" v; next} {print}' \
      "${ENV_FILE}" >"${_tmp}" && mv "${_tmp}" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${_key}" "${_value}" >>"${ENV_FILE}"
  fi
}

# Masking is a promise to the person who typed a secret, so a variable GitLab
# refused to mask must not be stored unmasked behind their back: it is reported
# instead, with the reason GitLab gave.
put_ci_variable() {
  _key="$1"
  _value="$2"
  _variable_path="/projects/${PROJECT_ENC}/variables"
  _variable_method="POST"
  if api GET "${_variable_path}/${_key}" >/dev/null 2>&1; then
    _variable_path="${_variable_path}/${_key}"
    _variable_method="PUT"
  fi
  _res="$(api "${_variable_method}" "${_variable_path}" --data "$(PUBLICATION_VARIABLE_VALUE="${_value}" jq -n \
    --arg key "${_key}" \
    '{key: $key, value: env.PUBLICATION_VARIABLE_VALUE, masked: true, protected: true}')")" || return 1
  if [ -z "$(printf '%s' "${_res}" | jq -r '.key? // empty' 2>/dev/null)" ]; then
    say "❌ ${_key} was not stored: $(printf '%s' "${_res}" |
      jq -r '(.message | if type=="object" then (to_entries[] | "\(.key) \(.value|join(", "))") else . end)? // "the API refused the call"' 2>/dev/null)"
    return 1
  fi
  return 0
}

# The token is created, read once, and stored. GitLab never shows its value
# again, so a token whose CI variable is missing is a token nobody can use: when
# one exists already, it is replaced rather than trusted.
#
# It is stored under two names on purpose. Renovate reads one, the publication
# reads the other, and they want the same thing: the api scope on THIS
# repository. One project token doing both jobs is what keeps a human's personal
# token out of CI entirely.
init_token() {
  _existing="$(api GET "/projects/${PROJECT_ENC}/access_tokens?per_page=100" |
    jq -r --arg n "${RENOVATE_TOKEN_NAME}" \
      '[.[]? | select(.name == $n and (.revoked | not))] | .[0].id // empty' 2>/dev/null || true)"

  # An expiry is not optional: a GitLab that enforces one refuses the call
  # outright ("expires_at is missing"). Ninety days is the framework's own figure
  # for this token, in .config/glab/project-token.sh, and rerunning this command
  # is what renews it. BSD date first, GNU date second: the same two-step the
  # framework uses, so a laptop and a runner agree.
  if _expires="$(date -v +90d +%Y-%m-%d 2>/dev/null)"; then
    :
  else
    _expires="$(date -d '+90 days' +%Y-%m-%d)"
  fi
  _created="$(api POST "/projects/${PROJECT_ENC}/access_tokens" --data "$(jq -n \
    --arg name "${RENOVATE_TOKEN_NAME}" --arg exp "${_expires}" \
    '{name: $name, scopes: ["api"], access_level: 40, expires_at: $exp}')")"
  _value="$(printf '%s' "${_created}" | jq -r '.token // empty' 2>/dev/null || true)"
  if [ -z "${_value}" ]; then
    say "❌ Could not create the project access token ${RENOVATE_TOKEN_NAME}."
    say "   $(printf '%s' "${_created}" | jq -r '.message? // .error? // "the API refused the call"' 2>/dev/null)"
    say "   The token you gave needs the api scope and Maintainer on this repository."
    return 1
  fi

  # Keep the previous token valid until both variables hold the replacement.
  # A partial failure may leave both tokens active, but CI retains valid access.
  put_ci_variable "${RENOVATE_TOKEN_NAME}" "${_value}" || return 1
  put_ci_variable "TASK_PUBLICATION_SOURCE_TOKEN" "${_value}" || return 1
  if [ -n "${_existing}" ]; then
    api DELETE "/projects/${PROJECT_ENC}/access_tokens/${_existing}" >/dev/null || return 1
  fi
  say "✅ ${RENOVATE_TOKEN_NAME} created, and stored masked for Renovate and for the approval."
  return 0
}

# Something has to start the pipeline that runs Renovate. On the default branch
# every push already does; a repository that is quiet for a month would hear
# about no release at all, so a nightly schedule is what makes it automatic.
init_schedule() {
  _branch="$(default_branch)"
  _found="$(api GET "/projects/${PROJECT_ENC}/pipeline_schedules?per_page=100" |
    jq -r '[.[]? | select(.description == "Source publication — check for toolbox releases")] | .[0].id // empty' 2>/dev/null || true)"
  if [ -n "${_found}" ]; then
    say "✅ The nightly schedule is already there."
    return 0
  fi
  _res="$(api POST "/projects/${PROJECT_ENC}/pipeline_schedules" --data "$(jq -n \
    --arg desc "Source publication — check for toolbox releases" \
    --arg ref "${_branch}" --arg cron "${SCHEDULE_CRON}" \
    '{description: $desc, ref: $ref, cron: $cron}')")"
  if [ -n "$(printf '%s' "${_res}" | jq -r '.id // empty' 2>/dev/null)" ]; then
    say "✅ A nightly schedule runs it on ${_branch}, at ${SCHEDULE_CRON}."
  else
    say "⚠️  Could not create the schedule: $(printf '%s' "${_res}" | jq -r '.message? // "the API refused the call"' 2>/dev/null)"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# doctor — everything this component needs, checked one by one, with the fix
# beside each answer. Written because "it did not publish" is a bad way to find
# out that a token was never stored, and because somebody setting this up for
# the first time should be able to see the whole list before the first attempt.
# ---------------------------------------------------------------------------
DOCTOR_MISSING=0

verdict() {
  _ok="$1"
  _label="$2"
  _fix="$3"
  if [ "${_ok}" -eq 0 ]; then
    say "✅ ${_label}"
    return 0
  fi
  say "❌ ${_label}"
  [ -n "${_fix}" ] && say "   ${_fix}"
  DOCTOR_MISSING=$((DOCTOR_MISSING + 1))
  return 0
}

# Check the variable's metadata. Masking controls job-log redaction; authorized
# API clients can still retrieve its value, which must never be printed here.
has_ci_variable() {
  forge_ready || return 1
  command -v jq >/dev/null 2>&1 || return 1
  _found="$(api GET "/projects/${PROJECT_ENC}/variables/$1" | jq -r '.key? // empty' 2>/dev/null || true)"
  [ -n "${_found}" ]
}

cmd_doctor() {
  compute_lists
  head_line
  say "Checking what source publication needs, one thing at a time."
  printf '\n'

  verdict "$([ -f "${OWNERS}" ] && [ -n "$(owner_list)" ] && echo 0 || echo 1)" \
    "Someone can approve what becomes public" \
    "Write one username per line in ${OWNERS}. An empty file means nobody can sign off."

  verdict "$([ "${PUBLISHED_COUNT}" -gt 0 ] && echo 0 || echo 1)" \
    "${PUBLISHED_COUNT} $(plural "${PUBLISHED_COUNT}" file files) would be published" \
    "Nothing matches ${ALLOWLIST}. Name what may leave, then run \`task publication:check\`."

  verdict "$([ -n "${TARGET_URL}" ] && echo 0 || echo 1)" \
    "The public repository is known${TARGET_URL:+: ${TARGET_URL}}" \
    "Nobody has said where the source goes. \`task publication:init\` asks."

  if forge_ready; then
    verdict "$(has_ci_variable TASK_PUBLICATION_TOKEN && echo 0 || echo 1)" \
      "A token that may push to it is stored, masked" \
      "Create it on the public repository, then \`task publication:init\` stores it."
    verdict "$(has_ci_variable TASK_PUBLICATION_SOURCE_TOKEN && echo 0 || echo 1)" \
      "A token that may read this repository's merge requests is stored" \
      "\`task publication:init\` creates one project token and stores it under both names."
    _schedule="$(api GET "/projects/${PROJECT_ENC}/pipeline_schedules?per_page=100" |
      jq -r '[.[]? | select(.description | startswith("Source publication"))] | length' 2>/dev/null || echo 0)"
    verdict "$([ "${_schedule:-0}" -gt 0 ] && echo 0 || echo 1)" \
      "A nightly check looks for the next toolbox release" \
      "\`task publication:init\` schedules it."
  else
    say "⏭️  The forge was not asked: no token for this repository in the environment."
    say "   \`task publication:init\` asks for one, uses it once, and stores nothing."
  fi

  verdict "$(grep -q 'publication/gitlab-ci.yml' .gitlab-ci.yml 2>/dev/null && echo 0 || echo 1)" \
    "The pipeline includes the publication jobs" \
    "Add to .gitlab-ci.yml:  include:  - local: .config/publication/gitlab-ci.yml"

  if [ "${SCAN_MODE}" = "off" ]; then
    say "⚠️  The secret scan is switched off (TASK_PUBLICATION_SCAN=off)."
  else
    verdict "$(command -v betterleaks >/dev/null 2>&1 || { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; } && echo 0 || echo 1)" \
      "A secret scanner can run here" \
      "Install betterleaks or docker. In CI the scan job carries its own; on this machine the publication refuses without one."
  fi

  verdict "$([ "${TASK_PUBLICATION_ENABLED:-$(dotenv_value TASK_PUBLICATION_ENABLED)}" = "true" ] && echo 0 || echo 1)" \
    "The publication is switched on" \
    "Set TASK_PUBLICATION_ENABLED=true in ${ENV_FILE} when the rest is ready."

  printf '\n'
  if [ "${DOCTOR_MISSING}" -eq 0 ]; then
    say "Nothing missing. \`task publication:check\` says what would leave today."
    printf '\n'
    return 0
  fi

  say "${DOCTOR_MISSING} $(plural "${DOCTOR_MISSING}" thing things) to settle."
  if [ -t 0 ] && prompt_yes "Answer the setup questions now? [Y/n]: "; then
    printf '\n'
    cmd_init
    return 0
  fi
  say "When you are ready: task publication:init"
  printf '\n'
  return 0
}

# The installer has its own; this script is on its own, so it carries one.
prompt_yes() {
  printf '   %s' "$1"
  read -r _answer
  case "${_answer}" in
  [nN]*) return 1 ;;
  *) return 0 ;;
  esac
}

cmd_init() {
  head_line
  require jq
  require curl

  # Asked once, kept in memory, never written anywhere: it is a human's own
  # token, and its only job is to create the project token that CI will use.
  if [ -z "${SOURCE_TOKEN}" ] && [ -t 0 ]; then
    say "This repository needs to be told where its source goes, and given the"
    say "tokens to get it there. Four answers, once."
    printf '\n'
    SOURCE_TOKEN="$(ask_secret "Your token for THIS repository (api scope, Maintainer), not shown: ")"
  fi
  if ! forge_ready; then
    refuse "Nothing to talk to: run this inside the repository, with a token for it." \
      "Set TASK_PUBLICATION_SOURCE_TOKEN, or answer the question when asked."
  fi

  if [ -z "${TARGET_URL}" ] && [ -t 0 ]; then
    TARGET_URL="$(ask_line "The PUBLIC repository the source goes to (https://…): ")"
  fi
  if [ -n "${TARGET_URL}" ]; then
    validate_target_url
    set_env_value "TASK_PUBLICATION_TARGET_URL" "${TARGET_URL}"
    say "✅ ${ENV_FILE} records the public destination ${TARGET_URL}."
  fi

  # The push token belongs to the OTHER repository, so nothing here can create
  # it. It is typed, sent straight to the forge as a masked variable, and
  # forgotten: it never reaches the disk.
  if [ -t 0 ]; then
    _push="$(ask_secret "A token that may push to it, not shown (enter to skip): ")"
    if [ -n "${_push}" ] && put_ci_variable "TASK_PUBLICATION_TOKEN" "${_push}"; then
      say "✅ TASK_PUBLICATION_TOKEN stored as a masked CI/CD variable, and nowhere else."
    fi
  fi

  # The one question that is not about a credential: what to do when the secret
  # scan cannot run at all. Asked here because this is the moment somebody is
  # deciding how strict the project is, not the moment a publication is refused.
  if [ -t 0 ]; then
    _strict="$(ask_line "Refuse to publish when the secret scan cannot run? [Y/n]: ")"
    case "${_strict}" in
    [nN]*)
      set_env_value "TASK_PUBLICATION_SCAN" "off"
      say "⚠️  ${ENV_FILE} publishes without scanning. Turn it back on with TASK_PUBLICATION_SCAN=required."
      ;;
    *)
      set_env_value "TASK_PUBLICATION_SCAN" "required"
      say "✅ What becomes public is scanned for secrets first, and no scanner means no publication."
      ;;
    esac
  fi

  init_token || {
    printf '\n'
    exit 1
  }
  api PUT "/projects/${PROJECT_ENC}" --data \
    '{"only_allow_merge_if_all_discussions_are_resolved":true}' >/dev/null ||
    refuse "Could not enable the forge discussion merge gate."
  say "✅ GitLab requires all discussions to be resolved before merging."
  init_schedule || return 1
  if [ -n "${TARGET_URL}" ]; then
    set_env_value "TASK_PUBLICATION_ENABLED" "true"
    say "✅ Publication is enabled in ${ENV_FILE}."
  fi

  if [ -f .gitlab-ci.yml ] && ! grep -q '.config/publication/gitlab-ci.yml' .gitlab-ci.yml; then
    printf '\n'
    say "One line is still missing from your .gitlab-ci.yml:"
    say "  include:"
    say "    - local: .config/publication/gitlab-ci.yml"
  fi
  printf '\n'
  return 0
}

validate_target_url
case "${1:-check}" in
check) cmd_check ;;
doctor) cmd_doctor ;;
publish) cmd_publish ;;
approve) cmd_approve ;;
scan) cmd_scan ;;
export)
  shift
  cmd_export "$@"
  ;;
init) cmd_init ;;
*)
  printf 'usage: %s check|doctor|scan|approve|publish|export <dir>|init\n' "$0" >&2
  exit 2
  ;;
esac
