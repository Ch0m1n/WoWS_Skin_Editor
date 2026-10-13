from __future__ import annotations

"""Retain the completed build cache and safely retire older build folders."""

import os
from pathlib import Path
import shutil
import stat


def _reparse(path: Path) -> bool:
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def _safe_tree(path: Path) -> bool:
    if _reparse(path):
        return False
    for directory, folders, files in os.walk(path, followlinks=False):
        for name in folders + files:
            if _reparse(Path(directory) / name):
                return False
    return True


def prune_old_build_caches(root: Path, completed_build: int) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {"removed": [], "skipped": []}
    root = root.absolute()
    if not root.is_dir():
        return result
    # Reject redirects in the root and its ancestors, as well as inside a target.
    if any(_reparse(parent) for parent in (root, *root.parents)):
        result["skipped"].append(str(root))
        return result
    resolved = root.resolve()
    current = root / str(completed_build)
    if not current.is_dir() or _reparse(current):
        return result
    for child in sorted(root.iterdir(), key=lambda path: path.name):
        if not child.name.isascii() or not child.name.isdecimal() or int(child.name) >= completed_build:
            continue
        try:
            if not child.is_dir() or child.resolve().parent != resolved or not _safe_tree(child):
                result["skipped"].append(child.name)
                continue
            shutil.rmtree(child)
            result["removed"].append(child.name)
        except OSError:
            # Locked or inaccessible caches must not fail an otherwise valid extraction.
            result["skipped"].append(child.name)
    return result
