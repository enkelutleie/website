#!/usr/bin/env python3
"""Compose a 1200x630 Open Graph image from the real brand PNGs."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
WIDTH, HEIGHT = 1200, 630
LINEN = (243, 239, 230)
INK = (23, 32, 27)
MOSS = (63, 111, 82)
MUTED = (92, 103, 95)


def load(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    return image


def fit(image: Image.Image, size: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    return image


def main() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), LINEN)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 18, HEIGHT), fill=MOSS)

    logo = fit(load(PUBLIC / "brand" / "enkel-utleie-logo.png"), 92)
    mascot = fit(load(PUBLIC / "brand" / "house-mascot.png"), 360)

    canvas.paste(logo, (72, 72), logo)
    canvas.paste(mascot, (780, 130), mascot)

    try:
        font_title = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 58
        )
        font_body = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28
        )
        font_brand = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28
        )
    except OSError:
        font_title = font_body = font_brand = ImageFont.load_default()

    draw.text((188, 92), "Enkel Utleie", font=font_brand, fill=INK)
    draw.text((72, 230), "Full kontroll på", font=font_title, fill=INK)
    draw.text((72, 300), "utleien din", font=font_title, fill=MOSS)
    draw.text(
        (72, 400),
        "Samle informasjon, økonomi og dialog\nmed leietaker på ett sted.",
        font=font_body,
        fill=MUTED,
        spacing=8,
    )

    out = PUBLIC / "og-image.png"
    canvas.save(out, "PNG", optimize=True)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
