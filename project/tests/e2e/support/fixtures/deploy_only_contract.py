"""Exercise the shipped deployment policy with controlled, literal inputs."""

import contextlib
import importlib.util
import io
import os
import sys
import tempfile
import unittest
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

CHECKS = unittest.TestCase()
FAKE_CREDENTIAL = str(uuid.uuid4())

SPEC = importlib.util.spec_from_file_location(
    "deploy_only", ".config/devsecops/scripts/deploy-only.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load the shipped deployment policy")
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class PathContract(unittest.TestCase):
    """A rejected entry must keep the entire pipeline, including mixed lists."""

    def test_forbidden_paths(self):
        for entry in (
            "project",
            "project/",
            ".",
            "../deploy",
            "/deploy",
            "deploy/*",
            ".config/",
            "a/.config/b.yml",
            "a/b/.config",
            ".git/",
            "deploy//prod",
            "deploy/../prod",
            ".gitlab-ci.yml",
            ".agents/",
            ".claude/",
            ".codex/",
            "AGENTS.md",
            "CLAUDE.md",
            ".env.dist",
            "Taskfile.yml",
            "project/Taskfile.yml",
            "deploy/Taskfile.yaml",
            "deploy/a/AGENTS.md",
            "deploy/a/CLAUDE.md",
            "copier.yml",
            "deploy/tests/",
            "deploy/app.test.js",
            "deploy/test_policy.py",
            "deploy/specs/",
        ):
            with self.subTest(entry=entry):
                self.assertEqual(POLICY.pattern_for(entry), r"\A")
                self.assertEqual(POLICY.pattern_for("deploy/ " + entry), r"\A")

    def test_literal_and_multiline_paths(self):
        expected = r"\A(?!(?:deploy/|charts/values-prod\.yaml\z))"
        self.assertEqual(
            POLICY.pattern_for("deploy/ charts/values-prod.yaml"), expected
        )
        self.assertEqual(
            POLICY.pattern_for("deploy/\ncharts/values-prod.yaml\n"), expected
        )
        self.assertEqual(POLICY.pattern_for("deploy/ deploy/"), r"\A(?!(?:deploy/))")
        self.assertEqual(POLICY.pattern_for(""), r"\A")
        self.assertEqual(
            POLICY.pattern_for(".configuration/"), r"\A(?!(?:\.configuration/))"
        )

    def test_directories_and_pattern_budget(self):
        with tempfile.TemporaryDirectory(prefix="deploy-only-paths-") as directory:
            with contextlib.chdir(directory):
                Path("deployment-directory").mkdir()
                self.assertEqual(
                    POLICY.pattern_for("deployment-directory"),
                    r"\A(?!(?:deployment-directory/))",
                )
        # 10 fixed characters plus the directory name and slash.
        accepted = POLICY.pattern_for("a" * 244 + "/")
        self.assertEqual(len(accepted), 255)
        self.assertEqual(POLICY.pattern_for("a" * 245 + "/"), r"\A")

    def test_unreadable_path_keeps_full_pipeline(self):
        with patch.object(POLICY.Path, "is_dir", side_effect=PermissionError):
            self.assertEqual(POLICY.pattern_for("deploy"), r"\A")


class FakeGitLab:
    """Stateful API and clock: a lost response can still have stored a write."""

    def __init__(self):
        self.now = 0
        self.waits = []
        self.calls = []
        self.variable: dict[str, Any] = {}
        self.sha = "a" * 40
        self.hook: Callable[..., tuple | None] = lambda *_: None
        self.after_sleep: Callable[[], None] = lambda: None
        self.env = {
            "CI": "true",
            "CI_COMMIT_BRANCH": "trunk",
            "CI_DEFAULT_BRANCH": "trunk",
            "CI_COMMIT_SHA": self.sha,
            "CI_API_V4_URL": "https://gitlab.example/api/v4",
            "CI_PROJECT_ID": "123",
            "TASK_COMMITIZEN_TOKEN": FAKE_CREDENTIAL,
            POLICY.PATHS: "deploy/",
        }

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds
        self.after_sleep()

    def request(self, method, url, token, body=None, *, timeout=30):
        CHECKS.assertTrue(
            token == self.env["TASK_COMMITIZEN_TOKEN"], "Fixture contract must hold"
        )
        CHECKS.assertTrue(0 < timeout <= 30, "Fixture contract must hold")
        self.calls.append((method, url, body, timeout))
        intercepted = self.hook(self, method, url, body)
        if intercepted is not None:
            return intercepted
        route = urlsplit(url)
        if "/repository/branches/" in route.path:
            CHECKS.assertTrue(method == "GET", "Fixture contract must hold")
            return 200, {}, {"commit": {"id": self.sha}}
        if method != "POST":
            CHECKS.assertTrue(
                parse_qs(route.query) == {"filter[environment_scope]": ["*"]},
                "Fixture contract must hold",
            )
        if method == "GET":
            return (200, {}, dict(self.variable)) if self.variable else (404, {}, {})
        CHECKS.assertTrue(method in {"POST", "PUT"}, "Fixture contract must hold")
        if body is None:
            raise AssertionError("A variable write requires a body")
        CHECKS.assertTrue(
            body["environment_scope"] == "*", "Fixture contract must hold"
        )
        if method == "POST":
            CHECKS.assertTrue(
                body["key"] == POLICY.REGEXP, "Fixture contract must hold"
            )
            CHECKS.assertTrue(not self.variable, "Fixture contract must hold")
        self.variable = {"key": POLICY.REGEXP, **body}
        return (201 if method == "POST" else 200), {}, dict(self.variable)

    def run(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status = POLICY.sync(
                self.env, request=self.request, sleep=self.sleep, clock=lambda: self.now
            )
        CHECKS.assertTrue(
            self.env.get("TASK_COMMITIZEN_TOKEN", FAKE_CREDENTIAL)
            not in output.getvalue(),
            "Fixture contract must hold",
        )
        return status

    def writes(self):
        return [call for call in self.calls if call[0] in {"POST", "PUT"}]


class SyncContract(unittest.TestCase):
    """Fault injection checks recovery, without waiting minutes or using a token."""

    def test_create_update_noop_and_attributes(self):
        api = FakeGitLab()
        self.assertEqual(api.run(), 0)
        self.assertEqual(
            api.variable,
            {
                "key": POLICY.REGEXP,
                "value": r"\A(?!(?:deploy/))",
                "environment_scope": "*",
                "variable_type": "env_var",
                "raw": True,
                "protected": False,
                "masked": False,
            },
        )
        self.assertEqual(len(api.writes()), 1)
        self.assertEqual(api.run(), 0)
        self.assertEqual(len(api.writes()), 1)
        api.env[POLICY.PATHS] = "charts/"
        self.assertEqual(api.run(), 0)
        self.assertEqual(api.variable["value"], r"\A(?!(?:charts/))")
        self.assertEqual([call[0] for call in api.writes()], ["POST", "PUT"])
        api.variable["protected"] = True
        self.assertEqual(api.run(), 0)
        self.assertFalse(api.variable["protected"])

    def test_ineligible_contexts_do_not_contact_gitlab(self):
        for changed in (
            {"CI": ""},
            {"CI_COMMIT_BRANCH": "feature"},
            {"CI_COMMIT_BRANCH": ""},
            {"CI_COMMIT_TAG": "1.0.0"},
        ):
            with self.subTest(changed=changed):
                api = FakeGitLab()
                api.env.update(changed)
                self.assertEqual(api.run(), 0)
                self.assertEqual(api.calls, [])

    def test_credentials_fail_without_retry(self):
        for status in (401, 403):
            api = FakeGitLab()
            api.hook = lambda *_: (status, {}, {})
            self.assertNotEqual(api.run(), 0)
            self.assertEqual(len(api.calls), 1)
            self.assertEqual(api.waits, [])
        api = FakeGitLab()
        del api.env["TASK_COMMITIZEN_TOKEN"]
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.calls, [])

    def test_transient_failures_wait_15_then_120_seconds(self):
        api = FakeGitLab()
        api.hook = lambda server, *_: (503, {}, {}) if len(server.calls) <= 2 else None
        self.assertEqual(api.run(), 0)
        self.assertEqual(api.waits, [15, 120])
        self.assertEqual(len(api.writes()), 1)

    def test_exhausted_retries_are_a_failure(self):
        api = FakeGitLab()
        api.hook = lambda *_: (503, {}, {})
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.waits, [15, 120])
        self.assertEqual(len(api.calls), 3)
        self.assertEqual(api.writes(), [])

    def test_retry_after_is_respected_within_budget(self):
        for retry_after in (40, 999):
            api = FakeGitLab()
            api.hook = lambda server, *_: (
                (429, {"Retry-After": str(retry_after)}, {})
                if len(server.calls) == 1
                else None
            )
            if retry_after == 40:
                self.assertEqual(api.run(), 0)
                self.assertEqual(api.waits, [40])
            else:
                self.assertNotEqual(api.run(), 0)
                self.assertEqual(api.waits, [])
                self.assertEqual(api.writes(), [])

    def test_total_budget_bounds_requests(self):
        api = FakeGitLab()

        def slow(server, *_):
            server.now += 30
            return 503, {}, {}

        api.hook = slow
        self.assertNotEqual(api.run(), 0)
        self.assertLessEqual(api.now, 300)
        self.assertEqual(len(api.calls), 3)

    def test_obsolete_commit_before_write_and_after_wait(self):
        api = FakeGitLab()
        api.sha = "b" * 40
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.writes(), [])
        api = FakeGitLab()
        api.hook = lambda server, *_: (503, {}, {}) if len(server.calls) == 1 else None
        api.after_sleep = lambda: setattr(api, "sha", "b" * 40)
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.waits, [15])
        self.assertEqual(api.writes(), [])

    def test_branch_advancing_during_read_prevents_mutation(self):
        api = FakeGitLab()

        def advance(server, method, url, _body):
            if method == "GET" and "/variables/" in url:
                server.sha = "b" * 40

        api.hook = advance
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.writes(), [])

    def test_lost_write_response_is_reconciled(self):
        api = FakeGitLab()

        def lose_response(server, method, _url, body):
            if method == "POST":
                server.variable = {"key": POLICY.REGEXP, **body}
                raise TimeoutError(FAKE_CREDENTIAL)

        api.hook = lose_response
        self.assertEqual(api.run(), 0)
        self.assertEqual(api.waits, [15])
        self.assertEqual(len(api.writes()), 1)

    def test_duplicate_creation_is_read_back(self):
        api = FakeGitLab()

        def duplicate(server, method, _url, body):
            if method == "POST":
                server.variable = {"key": POLICY.REGEXP, **body}
                return 400, {}, {"message": {"key": ["has already been taken"]}}
            return None

        api.hook = duplicate
        self.assertEqual(api.run(), 0)
        self.assertEqual(len(api.writes()), 1)

    def test_read_back_mismatch_and_malformed_success_fail(self):
        api = FakeGitLab()

        def mismatch(server, method, url, _body):
            if method == "GET" and "/variables/" in url and server.variable:
                return 200, {}, {**server.variable, "value": "unexpected"}
            return None

        api.hook = mismatch
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.waits, [])
        api = FakeGitLab()
        api.hook = lambda *_: (200, {}, None)
        self.assertNotEqual(api.run(), 0)
        self.assertEqual(api.writes(), [])

    def test_empty_or_invalid_list_publishes_full_pipeline(self):
        for setting in ("", "project/", "deploy/ a/.config/x", "a" * 256):
            with self.subTest(setting=setting):
                api = FakeGitLab()
                api.env[POLICY.PATHS] = setting
                self.assertEqual(api.run(), 0)
                self.assertEqual(api.variable["value"], r"\A")


if __name__ == "__main__":
    CASES = {"paths": PathContract, "sync": SyncContract}
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(
        CASES[os.environ.get("TASK_DEPLOY_ONLY_CONTRACT_CASE", "paths")]
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
