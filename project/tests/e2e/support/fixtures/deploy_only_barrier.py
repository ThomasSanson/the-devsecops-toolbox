"""Scheduling fixture only: hold plan, then let release advance the branch."""

import importlib.util
import os
import sys
import time

SPEC = importlib.util.spec_from_file_location(
    "deploy_only", ".config/devsecops/scripts/deploy-only.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load the shipped HTTP transport")
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


def api(endpoint, body=None):
    status, _headers, payload = POLICY.request_json(
        "GET" if body is None else "POST",
        f"{os.environ['CI_API_V4_URL']}/projects/"
        f"{os.environ['CI_PROJECT_ID']}/{endpoint}",
        os.environ["TASK_COMMITIZEN_TOKEN"],
        body,
        timeout=15,
    )
    if status == 404:
        raise LookupError("The plan barrier is not open")
    if not 200 <= status < 300:
        raise RuntimeError(f"Scheduling fixture API request failed: HTTP {status}")
    return payload


def plan():
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        try:
            value = api(f"variables/BARRIER_{os.environ['CI_PIPELINE_ID']}")["value"]
            print("The test opened the plan barrier.")
            return int(value)
        except LookupError:
            print("Waiting for the test to open the plan barrier.", flush=True)
        time.sleep(1)
    raise RuntimeError("The test did not open the plan barrier")


def release():
    if os.environ.get("CI_COMMIT_BRANCH") != os.environ["CI_DEFAULT_BRANCH"]:
        print("Release ran outside the default branch.")
        return 0
    api(
        "repository/commits",
        {
            "branch": os.environ["CI_DEFAULT_BRANCH"],
            "commit_message": "build: bump version in scheduling fixture",
            "actions": [
                {
                    "action": "create",
                    "file_path": f"release-{os.environ['CI_PIPELINE_ID']}.txt",
                    "content": "released\n",
                }
            ],
        },
    )
    print("Release advanced the default branch after plan.")
    return 0


if __name__ == "__main__":
    sys.exit({"plan": plan, "release": release}[sys.argv[1]]())
