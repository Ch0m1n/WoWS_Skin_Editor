from __future__ import annotations

import struct
from pathlib import Path


class MoCatalog:
    def __init__(self, messages: dict[str, str] | None = None):
        self.messages = messages or {}

    def gettext(self, key: str) -> str:
        return self.messages.get(key, key)


def read_mo(path: Path) -> MoCatalog:
    raw = path.read_bytes()
    if len(raw) < 28:
        return MoCatalog()
    magic = int.from_bytes(raw[:4], "little")
    if magic == 0x950412DE:
        endian = "<"
    elif magic == 0xDE120495:
        endian = ">"
    else:
        return MoCatalog()
    _, count, originals_offset, translations_offset = struct.unpack_from(
        endian + "4I", raw, 4
    )
    messages: dict[str, str] = {}
    for index in range(count):
        original_length, original_offset = struct.unpack_from(
            endian + "2I", raw, originals_offset + index * 8
        )
        translated_length, translated_offset = struct.unpack_from(
            endian + "2I", raw, translations_offset + index * 8
        )
        original = raw[original_offset : original_offset + original_length]
        translated = raw[translated_offset : translated_offset + translated_length]
        if not original:
            continue
        key = original.split(b"\0", 1)[0].decode("utf-8", "replace")
        value = translated.split(b"\0", 1)[0].decode("utf-8", "replace")
        if value:
            messages[key] = value
    return MoCatalog(messages)
