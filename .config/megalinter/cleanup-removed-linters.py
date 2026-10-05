"""Remove obsolete MegaLinter references without rewriting project settings."""

from pathlib import Path

import yaml

RETIRED = {"REPOSITORY_GITLEAKS", "REPOSITORY_KICS", "SQL_TSQLLINT"}
SELECTIONS = {"ENABLE", "DISABLE", "ENABLE_LINTERS", "DISABLE_LINTERS"}


def retired_key(name):
    """MegaLinter treats a retired linter's option keys as obsolete too."""
    return any(name == item or name.startswith(item + "_") for item in RETIRED)


def remove_empty_lines(text, edits):
    """Do not leave indentation behind when a removed item occupied a line."""
    for start, end, _ in sorted(edits):
        line_start = text.rfind("\n", 0, start) + 1
        newline = text.find("\n", end)
        line_end = len(text) if newline < 0 else newline + 1
        inside = {
            edit for edit in edits if line_start <= edit[0] <= edit[1] <= line_end
        }
        preview = text[line_start:line_end]
        for left, right, _ in sorted(inside, reverse=True):
            preview = preview[: left - line_start] + preview[right - line_start :]
        if not preview.strip():
            edits.difference_update(inside)
            edits.add((line_start, line_end, ""))
    return list(edits)


def flow_edits(text, value):
    """Edit scalar and comma tokens so comments inside a flow list survive."""
    commas = [
        token.start_mark.index
        for token in yaml.scan(text, Loader=yaml.SafeLoader)
        if isinstance(token, yaml.FlowEntryToken)
        and value.start_mark.index < token.start_mark.index < value.end_mark.index
    ]
    edits = set()
    for item in value.value:
        if item.value not in RETIRED:
            continue
        edits.add((item.start_mark.index, item.end_mark.index, ""))
        following = next((pos for pos in commas if pos >= item.end_mark.index), None)
        previous = [pos for pos in commas if pos < item.start_mark.index]
        comma = (
            following if following is not None else previous[-1] if previous else None
        )
        if comma is not None:
            edits.add((comma, comma + 1, ""))
    return remove_empty_lines(text, edits)


def selection_edits(text, offsets, key, value, remaining):
    """Remove list items without discarding surrounding project comments."""
    if value.flow_style:
        return flow_edits(text, value)
    edits = []
    for item in value.value:
        if item.value in RETIRED:
            end = item.end_mark.line + bool(item.end_mark.column)
            edits.append((offsets[item.start_mark.line], offsets[end], ""))
    if not remaining:
        colon = text.index(":", key.end_mark.index)
        edits.append((colon + 1, colon + 1, " []"))
    return edits


def cleaned(text):
    """Use YAML positions to retain comments and all unrelated formatting."""
    tree = yaml.compose(text, Loader=yaml.SafeLoader)
    original = yaml.safe_load(text)
    if not isinstance(tree, yaml.MappingNode) or not isinstance(original, dict):
        raise ValueError("MegaLinter configuration must be a YAML mapping")
    expected = original.copy()
    lines = text.splitlines(True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    edits = []
    for key, value in tree.value:
        if retired_key(key.value):
            expected.pop(key.value, None)
            end = value.end_mark.line + bool(value.end_mark.column)
            edits.append((offsets[key.start_mark.line], offsets[end], ""))
        elif key.value in SELECTIONS and isinstance(value, yaml.SequenceNode):
            remaining = [item for item in original[key.value] if item not in RETIRED]
            if remaining == original[key.value]:
                continue
            expected[key.value] = remaining
            edits.extend(selection_edits(text, offsets, key, value, remaining))
    result = text
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    # Aliases or unusual YAML layouts must never change an unrelated setting.
    if yaml.safe_load(result) != expected:
        raise ValueError("Refusing to change supported MegaLinter settings")
    return result


def main():
    """Validate every candidate before writing any inherited configuration."""
    updates = []
    for file in sorted(Path(".config/megalinter").glob("*.yml")):
        original = file.read_text()
        result = cleaned(original)
        if result != original:
            updates.append((file, result))
    for file, result in updates:
        file.write_text(result)
        print(f"[megalinter migration] removed retired references from {file}")


if __name__ == "__main__":
    main()
