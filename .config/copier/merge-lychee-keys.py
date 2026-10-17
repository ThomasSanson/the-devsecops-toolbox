"""After-migration: merge the top-level keys an update left twice in lychee's settings.

Runs in the project, with copier's own Python. Before .lycheeignore a project kept
its own lychee settings in the toolbox's file, so a release adding a key the
project had already set merged cleanly and left the key twice: TOML refuses
that, and lychee stopped before checking a single link. A list keeps every
value of each copy, in order. Any other value keeps its last copy, as lychee
does across two settings files. A file still holding conflict markers is the
developer's to settle, and is left alone.
"""

import json
import pathlib
import re
import tomllib

CONFIG = pathlib.Path(".config/lychee/config.toml")
KEY = re.compile(r"\s*([A-Za-z0-9_-]+)\s*=")


def top_level_keys(lines):
    """Yield (key, first line, line after, value) up to the first table."""
    start = 0
    while start < len(lines) and not lines[start].lstrip().startswith("["):
        match = KEY.match(lines[start])
        if not match:
            start += 1
            continue
        # The shortest run of lines that reads as TOML is the key's whole value.
        for end in range(start + 1, len(lines) + 1):
            try:
                value = tomllib.loads("".join(lines[start:end]))[match.group(1)]
            except tomllib.TOMLDecodeError:
                continue
            yield match.group(1), start, end, value
            start = end
            break
        else:
            return


def toml(value):
    """A list item as TOML: a regular expression reads best as a literal string."""
    if isinstance(value, str) and "'" not in value and value.isprintable():
        return f"'{value}'"
    return json.dumps(value, ensure_ascii=False)


def merged(key, values):
    """One list holding every item of every copy, or None for a plain value."""
    items = {}
    for value in values:
        if not isinstance(value, list):
            return None
        for item in value:
            if not isinstance(item, (str, int, float)):
                return None
            items.setdefault(str(item), item)
    body = ",\n".join(f"  {toml(item)}" for item in items.values())
    return f"{key} = [\n{body}\n]\n"


def main():
    if not CONFIG.is_file():
        return
    lines = CONFIG.read_text(encoding="utf-8").splitlines(True)
    if any(line.startswith("<<<<<<< ") for line in lines):
        return
    copies = {}
    for key, start, end, value in top_level_keys(lines):
        copies.setdefault(key, []).append((start, end, value))
    edits = []
    for key, places in copies.items():
        if len(places) < 2:
            continue
        start, end, _ = places[-1]
        text = merged(key, [value for _, _, value in places])
        if text:
            edits.append((start, end, text))
        for first, after, _ in places[:-1]:
            # Take the blank line under a block that opened the file or a paragraph.
            opens = first == 0 or not lines[first - 1].strip()
            if opens and after < len(lines) and not lines[after].strip():
                after += 1
            edits.append((first, after, ""))
        times = "twice" if len(places) == 2 else f"{len(places)} times"
        done = "merged into one list" if text else "kept the last one"
        print(f"[lychee migration] {key} was set {times} in {CONFIG}: {done}")
    for start, end, text in sorted(edits, reverse=True):
        lines[start:end] = [text]
    if edits:
        CONFIG.write_text("".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
