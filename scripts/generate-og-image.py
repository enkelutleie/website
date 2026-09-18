#!/usr/bin/env python3
"""Compose a 1200x630 Open Graph image from the real brand PNGs."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
WIDTH, HEIGHT = 1200, 630
CANVAS = (232, 243, 255)
INK = (27, 58, 107)
BRAND = (47, 128, 237)
MUTED = (83, 104, 135)


def load(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    return image


def fit(image: Image.Image, size: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    return image


def main() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), CANVAS)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 18, HEIGHT), fill=BRAND)

    logo = fit(load(PUBLIC / "brand" / "house-mascot.png"), 92)
    mascot = fit(load(PUBLIC / "brand" / "house-mascot-happy.png"), 360)

    canvas.paste(logo, (72, 72), logo)
    canvas.paste(mascot, (780, 130), mascot)

    # Use a real scalable font on both macOS and Linux; never silently render
    # an unreadable bitmap fallback into the published sharing image.
    font_pairs = [
        ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Helvetica.ttc"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    bold, regular = next((pair for pair in font_pairs if all(Path(p).exists() for p in pair)), (None, None))
    if bold is None:
        raise RuntimeError("Install DejaVu Sans or provide a local scalable font.")
    font_title = ImageFont.truetype(bold, 58)
    font_body = ImageFont.truetype(regular, 28)
    font_brand = ImageFont.truetype(bold, 28)

    draw.text((188, 92), "Enkel Utleie", font=font_brand, fill=INK)
    draw.text((72, 230), "Full kontroll på", font=font_title, fill=INK)
    draw.text((72, 300), "utleien din", font=font_title, fill=BRAND)
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
