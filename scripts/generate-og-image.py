#!/usr/bin/env python3
"""Compose a 1200x630 Open Graph image from the canonical house mascot."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
WIDTH, HEIGHT = 1200, 630
SKY = (232, 243, 255)
PAPER = (245, 249, 254)
INK = (18, 35, 63)
NAVY = (27, 58, 107)
BLUE = (47, 128, 237)
MUTED = (91, 107, 130)


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def fit(image: Image.Image, size: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    return image


def main() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH, HEIGHT), fill=PAPER)
    draw.ellipse((720, -180, 1380, 480), fill=SKY)

    mascot = fit(load(PUBLIC / "brand" / "house-mascot.png"), 390)
    canvas.paste(mascot, (760, 120), mascot)

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

    mark = fit(load(PUBLIC / "brand" / "house-mascot.png"), 72)
    canvas.paste(mark, (72, 72), mark)
    draw.text((160, 90), "Enkel Utleie", font=font_brand, fill=INK)
    draw.text((72, 220), "Utleie, helt", font=font_title, fill=INK)
    draw.text((72, 290), "enkelt", font=font_title, fill=BLUE)
    draw.text(
        (72, 400),
        "Kontrakt, husleie, chat og vedlikehold\ni én app for utleier og leietaker.",
        font=font_body,
        fill=MUTED,
        spacing=8,
    )

    out = PUBLIC / "og-image.png"
    canvas.save(out, "PNG")
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
