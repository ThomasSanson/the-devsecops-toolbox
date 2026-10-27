"""Generate GitLab's deployment-path rule before the pipeline is created."""

import argparse
import json
import os
import re
import sys
import time
from collections.abc import Mapping
from email.utils import parsedate_to_datetime
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PATHS = "TASK_DEVSECOPS_TEST_DEPLOY_PATHS"
REGEXP = "TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP"
FULL_PIPELINE = r"\A"
PROTECTED_PATH = (
    r"\A(?:\.env[^/]*|copier\.ya?ml|\.gitlab-ci\.ya?ml)\Z"
    r"|(?:\A|/)(?:Taskfile\.ya?ml|(?:AGENTS|CLAUDE)\.md)\Z"
    r"|(?:\A|/)(?:\.(?:config|git|agents|claude|codex)|tests?|specs?)(?:/|\Z)"
    r"|(?:\A|/)(?:test_|spec_)|[._](?:test|spec)\.[^/]*\Z"
)


def pattern_for(paths: str) -> str:
    """Directories cover descendants; every other entry is an exact file."""
    alternatives = []
    for entry in dict.fromkeys(paths.split()):
        parts = entry.rstrip("/").split("/")
        if (
            not re.fullmatch(r"[\w./-]+", entry)
            or any(part in {"", ".", ".."} for part in parts)
            or entry.rstrip("/") == "project"
            or re.search(PROTECTED_PATH, entry.rstrip("/"))
        ):
            return FULL_PIPELINE
        try:
            folder = entry.endswith("/") or Path(entry).is_dir()
        except OSError:
            return FULL_PIPELINE
        alternatives.append(
            entry.rstrip("/").replace(".", r"\.") + ("/" if folder else r"\z")
        )
    pattern = r"\A(?!(?:" + "|".join(alternatives) + "))"
    return pattern if alternatives and len(pattern) <= 255 else FULL_PIPELINE


def configured_pattern(paths: str) -> str:
    """Explain disabled optimization without echoing environment contents."""
    pattern = pattern_for(paths)
    if paths.strip() and pattern == FULL_PIPELINE:
        print(
            "Deployment paths are unsupported, protected or exceed the 255-character "
            "pattern limit. Correct TASK_DEVSECOPS_TEST_DEPLOY_PATHS; "
            "the full pipeline remains enabled.",
            file=sys.stderr,
        )
    return pattern


class NoRedirect(HTTPRedirectHandler):
    """Never forward the project token to a redirect destination."""

    def redirect_request(self, req, fp, code, msg, headers, new_url):
        return None


def request_json(
    method: str, url: str, token: str, body: dict | None = None, *, timeout: float = 30
) -> tuple[int, dict, object]:
    """One HTTP(S) request; retain standard TLS and proxy handling, no redirects."""
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("An HTTP(S) API endpoint is required.")
    request = Request(
        url,
        method=method,
        headers={"PRIVATE-TOKEN": token, "Content-Type": "application/json"},
        data=None if body is None else json.dumps(body).encode("utf-8"),
    )
    try:
        response = build_opener(NoRedirect()).open(request, timeout=timeout)
    except HTTPError as error:
        response = error
    with response:
        try:
            payload = json.load(response)
        except (ValueError, UnicodeError):
            payload = None
        return response.status, dict(response.headers), payload


class SyncError(Exception):
    """Only explicitly transient failures may spend another attempt."""

    def __init__(self, message, *, retry=False, wait=0):
        super().__init__(message)
        self.retry = retry
        self.wait = wait


def retry_after(headers):
    """GitLab normally sends seconds; also accept the HTTP-date form."""
    value = next((v for k, v in headers.items() if k.lower() == "retry-after"), "0")
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        try:
            return max(0, parsedate_to_datetime(value).timestamp() - time.time())
        except (TypeError, ValueError, OverflowError):
            return 0


def duplicate_key(payload):
    """Recognize only GitLab's documented variable-creation conflict."""
    if not isinstance(payload, dict):
        return False
    message = payload.get("message")
    return isinstance(message, dict) and message.get("key") == [
        "has already been taken"
    ]


def checked_response(status, headers, payload, *, missing, duplicate):
    """Classify API outcomes without exposing response bodies or credentials."""
    if status == 429:
        raise SyncError(
            "GitLab rate limit reached.", retry=True, wait=retry_after(headers)
        )
    if status in {408, 500, 502, 503, 504}:
        raise SyncError(
            f"GitLab is temporarily unavailable (HTTP {status}).", retry=True
        )
    if status in {401, 403}:
        raise SyncError(
            "Check TASK_COMMITIZEN_TOKEN: API scope, expiry and Maintainer permissions."
        )
    if status == 404 and missing:
        return None
    if duplicate and status == 400 and duplicate_key(payload):
        return None
    if not 200 <= status < 300:
        raise SyncError(
            f"GitLab rejected synchronization (HTTP {status}); "
            "check project/API configuration."
        )
    if not isinstance(payload, dict):
        raise SyncError("GitLab returned an unexpected API response.")
    return payload


def default_branch_context(env):
    """Only a branch pipeline on the configured default branch may synchronize."""
    return (
        env.get("CI") == "true"
        and bool(env.get("CI_COMMIT_BRANCH"))
        and env["CI_COMMIT_BRANCH"] == env.get("CI_DEFAULT_BRANCH")
        and not env.get("CI_COMMIT_TAG")
    )


def check_configuration(token, expected_sha, project_id, api_url):
    """Refuse incomplete identity before making an authenticated request."""
    if not token or not expected_sha or not project_id:
        raise SyncError("Missing TASK_COMMITIZEN_TOKEN or CI project/commit identity.")
    parsed = urlsplit(api_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
    ):
        raise SyncError(
            "CI_API_V4_URL must identify the GitLab API without embedded credentials."
        )


def sync(
    env: Mapping[str, str],
    *,
    request=request_json,
    sleep=time.sleep,
    clock=time.monotonic,
) -> int:
    """Reconcile one unprotected project variable on the current default branch."""
    branch = env.get("CI_COMMIT_BRANCH", "")
    if not default_branch_context(env):
        print("Deployment policy synchronization only runs on the CI default branch.")
        return 0
    deadline = clock() + 300
    token = env.get("TASK_COMMITIZEN_TOKEN", "")
    expected_sha = env.get("CI_COMMIT_SHA", "")
    api_url = env.get("CI_API_V4_URL", "").rstrip("/")
    project_id = env.get("CI_PROJECT_ID", "")
    desired = {
        "key": REGEXP,
        "value": configured_pattern(env.get(PATHS, "")),
        "environment_scope": "*",
        "variable_type": "env_var",
        "raw": True,
        "protected": False,
        "masked": False,
    }
    root = f"{api_url}/projects/{quote(project_id, safe='')}"
    variables = f"{root}/variables"
    variable = f"{variables}/{REGEXP}?{urlencode({'filter[environment_scope]': '*'})}"
    branch_url = f"{root}/repository/branches/{quote(branch, safe='')}"

    def call(method, url, body=None, *, missing=False, duplicate=False):
        remaining = deadline - clock()
        if remaining <= 0:
            raise SyncError("The 300-second synchronization budget was exhausted.")
        try:
            status, headers, payload = request(
                method, url, token, body, timeout=min(30, remaining)
            )
        except (OSError, HTTPException) as error:
            raise SyncError("GitLab could not be reached.", retry=True) from error
        except ValueError as error:
            raise SyncError("Invalid GitLab API request configuration.") from error
        if clock() >= deadline:
            raise SyncError("The 300-second synchronization budget was exhausted.")
        return checked_response(
            status, headers, payload, missing=missing, duplicate=duplicate
        )

    def current():
        head = call("GET", branch_url)
        commit = head.get("commit")
        if not isinstance(commit, dict) or not isinstance(commit.get("id"), str):
            raise SyncError("GitLab returned an unexpected branch response.")
        if commit["id"] != expected_sha:
            raise SyncError(
                "This pipeline commit is obsolete; run a new default-branch pipeline."
            )

    def matches(value):
        return isinstance(value, dict) and all(
            type(value.get(key)) is type(wanted) and value[key] == wanted
            for key, wanted in desired.items()
        )

    def reconcile():
        current()
        stored = call("GET", variable, missing=True)
        changed = not matches(stored)
        if changed:
            current()
            if stored is None:
                call("POST", variables, desired, duplicate=True)
            else:
                call("PUT", variable, {k: v for k, v in desired.items() if k != "key"})
        # Reconcile uncertain earlier writes before ever writing again.
        if not matches(call("GET", variable)):
            raise SyncError(
                "Deployment policy read-back did not match; check the project variable."
            )
        current()
        print(
            "Deployment policy synchronized and verified."
            if changed
            else "Deployment policy is already synchronized and verified."
        )

    try:
        check_configuration(token, expected_sha, project_id, api_url)
        pending_wait = 0
        for attempt, delay in enumerate((0, 15, 120)):
            if delay:
                wait = max(delay, pending_wait)
                if wait >= deadline - clock():
                    raise SyncError(
                        "GitLab requires a wait beyond the synchronization budget; "
                        "retry later."
                    )
                print(
                    "Retrying deployment policy synchronization "
                    f"after {wait:g} seconds."
                )
                sleep(wait)
            try:
                reconcile()
                return 0
            except SyncError as error:
                if not error.retry or attempt == 2:
                    raise
                pending_wait = error.wait
    except (SyncError, ValueError) as error:
        message = (
            str(error)
            if isinstance(error, SyncError)
            else "Invalid GitLab API configuration."
        )
        print(f"Deployment policy synchronization failed: {message}", file=sys.stderr)
        print(
            "The previous policy may still be active. "
            "Retry this job if its commit is current; "
            "otherwise start a new default-branch pipeline.",
            file=sys.stderr,
        )
    return 1


def main():
    """Preview locally or synchronize the project variable from CI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["pattern", "sync"])
    args = parser.parse_args()
    if args.action == "pattern":
        print(configured_pattern(os.environ.get(PATHS, "")))
        return 0
    return sync(os.environ)


if __name__ == "__main__":
    sys.exit(main())
