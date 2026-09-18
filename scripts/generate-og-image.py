#!/usr/bin/env python3
"""Generate a simple 1200x630 PNG Open Graph image without extra deps."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

WIDTH, HEIGHT = 1200, 630
LINEN = (243, 239, 230)
FOREST = (63, 111, 82)
INK = (36, 48, 40)
SAGE = (228, 238, 230)
PAPER = (255, 253, 248)
CHEEK = (231, 182, 164)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(
        ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
    )


def in_house(x: int, y: int) -> bool:
    # Roof triangle + body
    roof_top = 168
    roof_bottom = 292
    body_top = 286
    body_bottom = 508
    cx = 980
    if body_top <= y <= body_bottom and 832 <= x <= 1128:
        return True
    if roof_top <= y <= roof_bottom:
        progress = (y - roof_top) / (roof_bottom - roof_top)
        half = 28 + progress * 148
        return abs(x - cx) <= half
    return False


def in_face(x: int, y: int) -> bool:
    return 300 <= y <= 508 and 888 <= x <= 1072


def circle(x: int, y: int, cx: int, cy: int, r: int) -> bool:
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x: int, y: int) -> tuple[int, int, int]:
    if x < 18:
        return FOREST
    if circle(x, y, 980, 150, 168):
        if not in_house(x, y):
            return SAGE
    if in_house(x, y):
        if in_face(x, y):
            if circle(x, y, 948, 382, 16) or circle(x, y, 1012, 382, 16):
                return INK
            if circle(x, y, 942, 376, 5) or circle(x, y, 1006, 376, 5):
                return PAPER
            if circle(x, y, 910, 430, 9) or circle(x, y, 1050, 430, 9):
                return CHEEK
            return PAPER
        return FOREST
    return LINEN


def main() -> None:
    rows = bytearray()
    for y in range(HEIGHT):
        rows.append(0)
        for x in range(WIDTH):
            rows.extend(pixel(x, y))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )
    out = Path(__file__).resolve().parent.parent / "public" / "og-image.png"
    out.write_bytes(png)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
