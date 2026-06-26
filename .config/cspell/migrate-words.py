#!/usr/bin/env python3
"""Keep a generated project's cspell vocabulary across a `copier update`.

The framework owns config.json (structural, word-free) and config.base.json (the
base vocabulary, refreshed every update). A project's OWN words live in
config.project.json (skip-if-exists, never overwritten). Older projects — from
before this split — kept their words inline in config.json; a plain update would
drop them. This runs as a copier migration:

- capture (BEFORE the update applies, inlined in copier.yml because the old
  project does not ship this script yet): copy config.json's inline words into
  config.project.json before the refresh empties config.json.
- dedup (AFTER): drop the framework base words from config.project.json, leaving
  only the project's own. config.json is then word-free, the framework image.

Idempotent: a no-op once config.json carries no words (every up-to-date project).
"""

import json
import pathlib
import sys

CFG = pathlib.Path(".config/cspell/config.json")
OVERRIDE = pathlib.Path(".config/cspell/config.project.json")
BASE = pathlib.Path(".config/cspell/config.base.json")


def _words(path):
    if not path.exists():
        return []
    return json.loads(path.read_text()).get("words") or []


def _write_override(words):
    payload = {"version": "0.2", "words": sorted(set(words))}
    OVERRIDE.write_text(json.dumps(payload, indent=2) + "\n")


def capture():
    legacy = _words(CFG)
    if legacy:
        _write_override(_words(OVERRIDE) + legacy)


def dedup():
    # The update rejects the project's inline-words hunk into config.json.rej (the
    # new framework config.json has an empty words list, so the project's edit has
    # no context to apply onto). We've preserved those words in config.project.json,
    # so the reject is resolved: drop it instead of leaving a stale artifact.
    rej = CFG.parent / (CFG.name + ".rej")
    if rej.exists():
        rej.unlink()
    if OVERRIDE.exists():
        base = set(_words(BASE))
        kept = [w for w in _words(OVERRIDE) if w not in base]
        _write_override(kept)
        if kept:
            print("[cspell migration] project words moved to config.project.json")


if __name__ == "__main__":
    {"capture": capture, "dedup": dedup}[sys.argv[1]]()
