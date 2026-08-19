#!/usr/bin/env python3
"""Canonical Audit issue title identity matcher shared by repository workflows."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

_CANONICAL_TITLE = re.compile(
    r"^(?:AUDIT|BUG|DASHBOARD|UX|USER|RISK|WORKFLOW)[1-9]\d*-\d{2,}:",
    re.IGNORECASE,
)
_LEGACY_TITLE = re.compile(
    r"^\[(?:AUDIT|BUG|UX|USER|RISK)[1-9]\d*-\d+\](?=$|\s|\[|:)",
    re.IGNORECASE,
)


def audit_issue_title_style(title: object) -> Optional[str]:
    """Return canonical/legacy when title itself identifies an Audit issue."""
    if not isinstance(title, str):
        return None
    if _CANONICAL_TITLE.match(title):
        return "canonical"
    if _LEGACY_TITLE.match(title):
        return "legacy"
    return None


def is_audit_issue_title(title: object) -> bool:
    """Return True only when the issue title carries a supported Audit identity."""
    return audit_issue_title_style(title) is not None


def _check_fixtures(path: Path) -> int:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise SystemExit("fixture file must contain a JSON array")

    failures = []
    for index, fixture in enumerate(raw, start=1):
        if not isinstance(fixture, dict):
            failures.append(f"fixture {index}: expected object")
            continue

        title = fixture.get("title")
        expected = fixture.get("audit")
        expected_style = fixture.get("style")
        if not isinstance(title, str) or not isinstance(expected, bool):
            failures.append(f"fixture {index}: title must be string and audit must be boolean")
            continue

        actual_style = audit_issue_title_style(title)
        actual = actual_style is not None
        if actual != expected:
            failures.append(
                f"fixture {index}: expected audit={expected}, got audit={actual}: {title!r}"
            )
        if expected_style is not None and actual_style != expected_style:
            failures.append(
                f"fixture {index}: expected style={expected_style!r}, "
                f"got style={actual_style!r}: {title!r}"
            )

    if failures:
        for failure in failures:
            print(f"::error::{failure}", file=sys.stderr)
        return 1

    print(f"Verified {len(raw)} Audit issue identity fixtures from {path}.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--title", help="classify one issue title")
    mode.add_argument("--check-fixtures", type=Path, metavar="PATH")
    args = parser.parse_args()

    if args.check_fixtures is not None:
        return _check_fixtures(args.check_fixtures)

    style = audit_issue_title_style(args.title)
    if style is None:
        print("not-audit")
        return 1
    print(style)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
