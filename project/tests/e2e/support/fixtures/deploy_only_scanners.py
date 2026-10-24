"""Check the actual pinned image's supported scanner modes before its scan."""

import importlib
import re
import tempfile
import unittest
from pathlib import Path

import megalinter
import yaml
from megalinter import config

CHECKS = unittest.TestCase()

descriptor = (
    Path(megalinter.__file__).parent
    / "descriptors/repository.megalinter-descriptor.yml"
)
definition = yaml.safe_load(descriptor.read_text())
linters = definition["linters"]
supported = {
    linter.get(
        "name", "REPOSITORY_" + linter["linter_name"].replace("-", "_").upper()
    ): linter.get("supported_cli_lint_modes", [linter.get("cli_lint_mode", "file")])
    for linter in linters
}
settings = Path(".config/gitlab/ci/variables.yml").read_text()
overrides = re.findall(
    r"^\s+(REPOSITORY_\w+)_CLI_LINT_MODE: (\w+)$", settings, re.MULTILINE
)
CHECKS.assertTrue(
    overrides, "The reduced scan must explicitly select supported file modes"
)
for name, mode in overrides:
    CHECKS.assertTrue(
        mode in supported[name], f"{name} does not support {mode} in the pinned image"
    )
    print(f"{name}: {mode} (supported)")

# An accepted CLI mode must actually receive the changed manifest. Repository
# descriptors normally have no extension filters because they scan a directory.
policy = yaml.safe_load(settings)[".deployment-only-megalinter"]["rules"][-1][
    "variables"
]
with tempfile.TemporaryDirectory() as directory:
    # Exercise optional scanners in a project that has enabled them normally.
    rules = Path(directory) / "semgrep.yml"
    rules.write_text("rules: []\n")
    (Path(directory) / ".ls-lint.yml").write_text("ls:\n  .yaml: kebab-case\n")
    config.set_config(
        "deployment-selection", {**policy, "REPOSITORY_SEMGREP_RULESETS": [str(rules)]}
    )
    changed = [
        str(Path(directory) / name) for name in ("pod.yaml", "package-lock.json")
    ]
    Path(changed[0]).write_text("apiVersion: v1\nkind: Pod\n")
    Path(changed[1]).write_text(
        '{"name":"deployment","lockfileVersion":3,"packages":{}}'
    )
    for name, mode in overrides:
        descriptor_linter = next(
            item
            for item in linters
            if item.get(
                "name", "REPOSITORY_" + item["linter_name"].replace("-", "_").upper()
            )
            == name
        )
        class_name = descriptor_linter["class"]
        scanner_class = getattr(
            importlib.import_module("megalinter.linters." + class_name), class_name
        )
        scanner = scanner_class(
            params={
                "request_id": "deployment-selection",
                "default_linter_activation": True,
                "workspace": directory,
                "report_folder": str(Path(directory) / "reports"),
            },
            linter_config={
                **{key: value for key, value in definition.items() if key != "linters"},
                **descriptor_linter,
            },
        )
        scanner.collect_files(changed)
        CHECKS.assertEqual(
            scanner.files, changed, f"{name} must receive the changed deployment files"
        )
        batches: list[str | None] = [*changed] if mode == "file" else [None]
        for batch in batches:
            command = scanner.build_lint_command(batch)
            arguments = " ".join(command)
            for file in [batch] if isinstance(batch, str) else changed:
                CHECKS.assertIn(
                    file, arguments, f"{name} must pass the changed file to its CLI"
                )
            CHECKS.assertNotIn(
                ".", command, f"{name} must not scan the repository root"
            )
        print(f"{name}: changed files selected and passed to the CLI")
