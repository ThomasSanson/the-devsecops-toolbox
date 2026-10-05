"""Read effective settings through the shipped MegaLinter configuration loader."""

import json
from pathlib import Path

from megalinter import config
from megalinter.removed_linters import find_removed_references

REQUEST = "retired-linters"
config.init_config(REQUEST, str(Path.cwd()))
settings = config.get(REQUEST)
linters = config.get_list(REQUEST, "ENABLE_LINTERS", []) + config.get_list(
    REQUEST, "DISABLE_LINTERS", []
)
descriptors = config.get_list(REQUEST, "ENABLE", []) + config.get_list(
    REQUEST, "DISABLE", []
)
removed = find_removed_references(settings, linters, descriptors)
observed = {
    "removed_references": removed,
    "supported_disabled_linters": [
        name
        for name in config.get_list(REQUEST, "DISABLE_LINTERS", [])
        if name not in removed
    ],
    "enable_linters": config.get_list(REQUEST, "ENABLE_LINTERS", []),
    "enable_descriptors": config.get_list(REQUEST, "ENABLE", []),
    "disable_descriptors": config.get_list(REQUEST, "DISABLE", []),
    "formatters_disable_errors": config.get(REQUEST, "FORMATTERS_DISABLE_ERRORS"),
    "error_on_missing_exec_bit": config.get(REQUEST, "ERROR_ON_MISSING_EXEC_BIT"),
}
print(json.dumps(observed, indent=2, sort_keys=True))
