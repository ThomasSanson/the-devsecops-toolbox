"""Keep Commitizen's generated YAML sequences indented before its commit."""

import sys
from pathlib import Path

import yaml


class IndentedDumper(yaml.SafeDumper):
    """Use the same list indentation as the framework's YAML linters."""

    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)


config = Path(sys.argv[1])
settings = yaml.safe_load(config.read_text(encoding="utf-8"))
config.write_text(
    yaml.dump(settings, Dumper=IndentedDumper, explicit_start=True, sort_keys=False),
    encoding="utf-8",
)
