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
#   TASK_PUBLICATION_ENABLED          off unless "true" (checked by the Taskfile)
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

TARGET_URL="${TASK_PUBLICATION_TARGET_URL:-}"
TARGET_BRANCH="${TASK_PUBLICATION_TARGET_BRANCH:-main}"
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
  if [ -n "${TASK_PUBLICATION_API_URL:-}" ]; then printf '%s' "${TASK_PUBLICATION_API_URL}"; return; fi
  if [ -n "${CI_API_V4_URL:-}" ]; then printf '%s' "${CI_API_V4_URL}"; return; fi
  _o="$(strip_credentials "$(origin_url)")"
  case "${_o}" in
  http*) printf '%s/api/v4' "$(printf '%s' "${_o}" | sed -E 's#^(https?://[^/]+)/.*#\1#')" ;;
  *) printf '' ;;
  esac
}

derive_project_path() {
  if [ -n "${TASK_PUBLICATION_PROJECT_PATH:-}" ]; then printf '%s' "${TASK_PUBLICATION_PROJECT_PATH}"; return; fi
  if [ -n "${CI_PROJECT_PATH:-}" ]; then printf '%s' "${CI_PROJECT_PATH}"; return; fi
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

matching() {
  _file="$1"
  [ -f "${_file}" ] || return 0
  git_paths ls-files --cached --ignored --exclude-from="${_file}" 2>/dev/null || true
}

# A list file: comments are lines that START with #, blank lines are dropped.
# Never strip from the middle of a line — "src/tag#1.js" is a real filename, and
# cutting it there would quietly drop it from the approved list.
read_list() {
  [ -f "$1" ] || return 0
  sed -e 's/^[[:space:]]*#.*$//' -e 's/[[:space:]]*$//' "$1" | sed '/^$/d'
}

compute_lists() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    head_line
    refuse "This is not a git repository." \
      "Source publication reads the tracked files, so it runs inside the project."
  }
  WORK="$(mktemp -d)"
  git_paths ls-files | LC_ALL=C sort >"${WORK}/tracked"
  matching "${ALLOWLIST}" | LC_ALL=C sort -u >"${WORK}/allowed"
  matching "${DENY_BASE}" | LC_ALL=C sort -u >"${WORK}/floor"
  matching "${DENYLIST}" | LC_ALL=C sort -u >"${WORK}/denied"

  # Held back by the framework floor, then by the project's own denylist. A file
  # caught by both is reported once, under the floor: that is the rule a project
  # cannot change, so it is the one worth naming.
  LC_ALL=C comm -12 "${WORK}/allowed" "${WORK}/floor" >"${WORK}/held-floor"
  LC_ALL=C comm -12 "${WORK}/allowed" "${WORK}/denied" |
    LC_ALL=C comm -23 - "${WORK}/held-floor" >"${WORK}/held-denylist"

  LC_ALL=C sort -u "${WORK}/held-floor" "${WORK}/held-denylist" >"${WORK}/held"
  LC_ALL=C comm -23 "${WORK}/allowed" "${WORK}/held" >"${WORK}/published"

  # The approved list, comments and blank lines stripped.
  read_list "${MANIFEST}" | LC_ALL=C sort -u >"${WORK}/manifest"
  LC_ALL=C comm -23 "${WORK}/published" "${WORK}/manifest" >"${WORK}/unapproved"

  OUTSIDE_COUNT="$(LC_ALL=C comm -23 "${WORK}/tracked" "${WORK}/allowed" | wc -l | tr -d ' ')"
  PUBLISHED_COUNT="$(wc -l <"${WORK}/published" | tr -d ' ')"
  HELD_COUNT="$(wc -l <"${WORK}/held" | tr -d ' ')"
  UNAPPROVED_COUNT="$(wc -l <"${WORK}/unapproved" | tr -d ' ')"
}

owner_list() { read_list "${OWNERS}"; }

owners_inline() { owner_list | tr '\n' ' ' | sed 's/ *$//'; }

# "1 file" / "3 files". A count is read by a human, and "1 files" reads like a bug.
plural() {
  if [ "$1" -eq 1 ]; then printf '%s' "$2"; else printf '%s' "$3"; fi
}

# The release this snapshot belongs to: the tag on HEAD when the release just
# made one, otherwise the most recent tag that is reachable, otherwise the
# commit itself. A project with no tags at all still publishes.
release_name() {
  git describe --tags --exact-match HEAD 2>/dev/null ||
    git describe --tags --abbrev=0 2>/dev/null ||
    git rev-parse --short HEAD
}

# ---------------------------------------------------------------------------
# check — the dry run. No token, no network, no side effect: this is what you
# run before switching publication on, and what a reviewer runs to see the
# answer for themselves.
# ---------------------------------------------------------------------------
cmd_check() {
  compute_lists
  head_line
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
  resolve_approval
  if [ "${APPROVAL_OK}" -eq 1 ]; then
    printf 'approved by "%s" in merge request !%s' "${APPROVAL_SIGNER}" "${APPROVAL_MR_IID}"
  elif [ -n "${APPROVAL_SIGNER}" ]; then
    printf 'signed off by "%s", who is not an owner' "${APPROVAL_SIGNER}"
  else
    printf 'the approved list carries no owner signature'
  fi
}

# ---------------------------------------------------------------------------
# publish — refuse, or push the snapshot.
# ---------------------------------------------------------------------------
cmd_publish() {
  require git
  compute_lists
  head_line

  [ -n "${TARGET_URL}" ] || refuse \
    "No public repository configured." \
    "Set TASK_PUBLICATION_TARGET_URL to the git URL of the project to publish to."
  [ -n "${TOKEN}" ] || refuse \
    "No token for the public repository." \
    "Set TASK_PUBLICATION_TOKEN to a token that may push to ${TARGET_URL}."
  [ -n "$(owner_list)" ] || refuse \
    "${OWNERS} is empty, so nobody can approve what becomes public." \
    "List the people who decide, one username per line, before switching publication on."
  # Tracked changes only. What gets published comes from the index, so a staged
  # or modified file WOULD go out and must stop the run; an untracked scratch
  # file cannot go out at all, and refusing because of one would be pointless.
  [ -z "$(git status --porcelain --untracked-files=no)" ] || refuse \
    "Tracked files have uncommitted changes." \
    "A publication is a snapshot of what is committed; commit or stash first."

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

  push_snapshot "${APPROVAL_SIGNER}"
}

push_snapshot() {
  _who="$1"
  _version="$(release_name)"
  _sha="$(git rev-parse HEAD)"
  _dest="${WORK}/destination"

  _credential_file="${WORK}/credential-store"
  # Scheme, user, token and HOST only: git's store helper matches a credential by
  # host, and an entry carrying the repository path is skipped unless
  # credential.useHttpPath is on — the request would then find nothing and git
  # would sit waiting for a password nobody is there to type.
  printf '%s\n' "$(printf '%s' "${TARGET_URL}" |
    sed -E "s#^(https?)://([^/]+).*#\\1://${TOKEN_USERNAME}:${TOKEN}@\\2#")" >"${_credential_file}"
  chmod 600 "${_credential_file}"
  # Never wait for a human: a missing credential must fail the job, not hang it.
  GIT_TERMINAL_PROMPT=0
  export GIT_TERMINAL_PROMPT
  # The token lives in that file and nowhere else: not in the URL git prints, not
  # in this process's arguments (which `ps` would show), not in the destination's
  # .git/config. Git's env interface carries the helper because a `-c
  # credential.helper="store --file=…"` value cannot survive shell word-splitting
  # — same idiom as .config/devsecops/Taskfile.release.yml.
  GIT_CONFIG_COUNT=1
  GIT_CONFIG_KEY_0=credential.helper
  GIT_CONFIG_VALUE_0="store --file=${_credential_file}"
  export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0

  # A full clone, not a shallow one: the push is a plain fast-forward on top of
  # whatever the public repository already has, and history stays intact.
  if ! git clone --quiet "${TARGET_URL}" "${_dest}" 2>"${WORK}/clone.err"; then
    refuse "Cannot reach the public repository ${TARGET_URL}." \
      "Check the URL and that TASK_PUBLICATION_TOKEN may push to it." \
      "$(sed -e "s#${TOKEN}#***#g" -e 's/^/git: /' "${WORK}/clone.err" | tail -n 3)"
  fi

  if git -C "${_dest}" rev-parse --verify --quiet "origin/${TARGET_BRANCH}" >/dev/null 2>&1; then
    git -C "${_dest}" checkout --quiet -B "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"
  else
    git -C "${_dest}" checkout --quiet -B "${TARGET_BRANCH}"
  fi

  # Everything the public repository holds goes, then the approved files come
  # back: a file removed from the allowlist disappears at the next release
  # instead of lingering. Emptied with find on the destination directory itself,
  # never with `git -C … ls-files | xargs rm`: git -C prints paths relative to
  # the destination while rm would resolve them against the CURRENT directory,
  # which is the private project — it deletes the source instead of the copy.
  find "${_dest}" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null || true
  git_paths checkout-index --prefix="${_dest}/" --force --stdin <"${WORK}/published"

  git -C "${_dest}" add -A
  if git -C "${_dest}" diff --cached --quiet; then
    say "The public repository is already up to date at ${_version}."
    printf '\n'
    return 0
  fi

  _message="$(printf 'publish %s\n\nSource: %s\nCommit: %s\nFiles:  %s published, %s withheld\n' \
    "${_version}" "$(source_project_url)" "${_sha}" "${PUBLISHED_COUNT}" "${HELD_COUNT}")"
  git -C "${_dest}" \
    -c "user.name=${COMMIT_AUTHOR_NAME}" -c "user.email=${COMMIT_AUTHOR_EMAIL}" \
    commit --quiet --no-verify -m "${_message}"

  if ! git -C "${_dest}" push --quiet origin "${TARGET_BRANCH}"; then
    refuse "The push to ${TARGET_URL} was refused." \
      "The public repository moved on its own; nothing here force-pushes over it."
  fi

  # Mirror the release tag when this snapshot is one. A project with no tag
  # publishes all the same — the commit message carries the source commit.
  if git describe --tags --exact-match HEAD >/dev/null 2>&1; then
    git -C "${_dest}" tag -f "${_version}" >/dev/null 2>&1 || true
    git -C "${_dest}" push --quiet origin "refs/tags/${_version}" 2>/dev/null || true
  fi

  say "Approved by \"${_who}\" in merge request !${APPROVAL_MR_IID}"
  say "Publishing ${PUBLISHED_COUNT} files, withholding ${HELD_COUNT}"
  say "Pushed ${_version} to ${TARGET_URL} (branch ${TARGET_BRANCH})"
  printf '\n'
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
  _method="$1"
  _path="$2"
  shift 2
  curl --silent --show-error --request "${_method}" \
    --header "PRIVATE-TOKEN: ${SOURCE_TOKEN}" \
    --header "Content-Type: application/json" \
    "$@" "${API_URL}${_path}"
}

forge_ready() {
  [ -n "${API_URL}" ] && [ -n "${PROJECT_PATH}" ] && [ -n "${SOURCE_TOKEN}" ]
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

  _commit="$(git log -1 --format=%H -- "${MANIFEST}" 2>/dev/null || true)"
  [ -n "${_commit}" ] || return 0

  _mr="$(api GET "/projects/${PROJECT_ENC}/repository/commits/${_commit}/merge_requests" |
    jq -r 'if type=="array" and length>0 then .[0].iid else empty end' 2>/dev/null || true)"
  [ -n "${_mr}" ] || return 0
  APPROVAL_MR_IID="${_mr}"

  # EVERY answered thread, not just the first: an owner who arrives after
  # somebody else already ticked the box has to be able to answer on the same
  # merge request, and that late answer is what unblocks the publication.
  _signers="$(api GET "/projects/${PROJECT_ENC}/merge_requests/${_mr}/discussions?per_page=100" |
    jq -r '[.[]?.notes[]? | select(.system|not) | select(.resolved == true) | .resolved_by.username]
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
  _iid="$(cmd_approve_quiet)"
  if [ -n "${_iid}" ]; then
    say "Merge request !${_iid} asks the owners to approve it: $(owners_inline)"
    say "$(source_project_url)/-/merge_requests/${_iid}"
  fi
}

# Write the manifest onto the approval branch, open the merge request if there
# is none, and leave ONE resolvable thread on it: GitLab refuses the merge while
# that thread is unanswered, so the question cannot be skipped by accident.
cmd_approve_quiet() {
  _default="$(git rev-parse --abbrev-ref HEAD)"
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
  api POST "/projects/${PROJECT_ENC}/repository/commits" --data "${_payload}" >/dev/null 2>&1 || true

  if [ -n "${_open}" ]; then
    printf '%s' "${_open}"
    return 0
  fi

  _desc="$(printf '%s\n' \
    "These paths would become **public**. Read the change to \`${MANIFEST}\`: every added line is a file that leaves this repository at the next release." \
    '' \
    "Owners: $(owner_list | sed 's/^/@/' | tr '\n' ' ')" \
    '' \
    'Answering the thread below is the sign-off. The publication checks **who** answered it, so it has to be one of the owners above.')"
  _mr="$(api POST "/projects/${PROJECT_ENC}/merge_requests" --data "$(jq -n \
    --arg source "${APPROVAL_BRANCH}" \
    --arg target "${_default}" \
    --arg title "chore(publication): approve what becomes public" \
    --arg description "${_desc}" \
    '{source_branch: $source, target_branch: $target, title: $title,
      description: $description, remove_source_branch: true}')" |
    jq -r '.iid // empty' 2>/dev/null || true)"
  [ -n "${_mr}" ] || return 0

  api POST "/projects/${PROJECT_ENC}/merge_requests/${_mr}/discussions" --data "$(jq -n \
    --arg body "Do these paths become public? Resolve this thread to say yes. An owner has to be the one who does." \
    '{body: $body}')" >/dev/null 2>&1 || true

  printf '%s' "${_mr}"
}

cmd_approve() {
  compute_lists
  head_line
  if [ "${UNAPPROVED_COUNT}" -eq 0 ]; then
    say "The approved list is already up to date — nothing to ask."
    printf '\n'
    return 0
  fi
  open_approval_request
  printf '\n'
}

case "${1:-check}" in
check) cmd_check ;;
publish) cmd_publish ;;
approve) cmd_approve ;;
*)
  printf 'usage: %s check|approve|publish\n' "$0" >&2
  exit 2
  ;;
esac
