#!/usr/bin/env python3
"""Generate a short, original Norwegian private tenancy PDF template.

Requires reportlab (DejaVu fonts are the same as generate-og-image.py):

    python3 -m pip install reportlab
    python3 scripts/generate-leieavtale.py
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUT = PUBLIC / "leieavtale.pdf"
MASCOT = PUBLIC / "brand" / "house-mascot.png"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

NAVY = (0x1B / 255, 0x3A / 255, 0x6B / 255)
INK = (0x12 / 255, 0x23 / 255, 0x3F / 255)
MUTED = (0x5B / 255, 0x6B / 255, 0x82 / 255)
LINE = (0xD5 / 255, 0xE3 / 255, 0xF4 / 255)
SKY = (0xE8 / 255, 0xF3 / 255, 0xFF / 255)
PAPER = (1, 1, 1)

WIDTH, HEIGHT = A4
MARGIN = 38
FIELD_H = 24
GUTTER = 12


def fill(c: canvas.Canvas, color: tuple[float, float, float]) -> None:
    c.setFillColorRGB(*color)


def stroke(c: canvas.Canvas, color: tuple[float, float, float]) -> None:
    c.setStrokeColorRGB(*color)


def field(c: canvas.Canvas, x: float, y: float, w: float, label: str) -> None:
    fill(c, MUTED)
    c.setFont("DejaVu", 7.2)
    c.drawString(x, y + FIELD_H - 8, label)
    stroke(c, LINE)
    c.setLineWidth(0.8)
    c.line(x, y + 1, x + w, y + 1)


def heading(c: canvas.Canvas, x: float, y: float, number: str, title: str) -> None:
    fill(c, NAVY)
    c.setFont("DejaVuBold", 9.6)
    c.drawString(x, y, f"{number}   {title}")


def mascot_reader() -> ImageReader:
    image = Image.open(MASCOT).convert("RGBA")
    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
    buf = BytesIO()
    image.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return ImageReader(buf)


def main() -> None:
    pdfmetrics.registerFont(TTFont("DejaVu", FONT_REG))
    pdfmetrics.registerFont(TTFont("DejaVuBold", FONT_BOLD))

    c = canvas.Canvas(str(OUT), pagesize=A4)
    c.setTitle("Husleiekontrakt — mal")
    c.setAuthor("Enkel Utleie")
    c.setSubject("Kort mal for privat husleiekontrakt")
    c.setCreator("Enkel Utleie")

    fill(c, PAPER)
    c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)

    header_top = HEIGHT - 28
    header_h = 70
    fill(c, SKY)
    c.roundRect(MARGIN, header_top - header_h, WIDTH - 2 * MARGIN, header_h, 9, fill=1, stroke=0)
    c.drawImage(
        mascot_reader(),
        MARGIN + 12,
        header_top - header_h + 9,
        width=50,
        height=50,
        mask="auto",
        preserveAspectRatio=True,
        anchor="c",
    )
    fill(c, NAVY)
    c.setFont("DejaVuBold", 10)
    c.drawString(MARGIN + 74, header_top - 28, "Enkel Utleie")
    fill(c, INK)
    c.setFont("DejaVuBold", 18)
    c.drawString(MARGIN + 74, header_top - 50, "Husleiekontrakt")
    fill(c, MUTED)
    c.setFont("DejaVu", 8.4)
    c.drawString(MARGIN + 74, header_top - 64, "Kort mal for privat utleie")

    inner = WIDTH - 2 * MARGIN
    col = (inner - GUTTER) / 2
    third = (inner - 2 * GUTTER) / 3
    left = MARGIN
    right = MARGIN + col + GUTTER
    y = header_top - header_h - 22

    fill(c, MUTED)
    c.setFont("DejaVu", 8)
    c.drawString(
        left,
        y,
        "Fyll ut feltene og tilpass til leieforholdet. Husleieloven gjelder. Dette er en mal, ikke juridisk rådgivning.",
    )

    y -= 26
    heading(c, left, y, "1", "Partene")
    y -= 16
    fill(c, NAVY)
    c.setFont("DejaVuBold", 8)
    c.drawString(left, y, "Utleier")
    c.drawString(right, y, "Leietaker")
    y -= FIELD_H + 2
    for label in ("Navn", "Adresse", "Fødselsnummer / org.nr.", "Telefon og e-post"):
        field(c, left, y, col, label)
        field(c, right, y, col, label)
        y -= FIELD_H + 2

    y -= 10
    heading(c, left, y, "2", "Boligen")
    y -= FIELD_H + 2
    field(c, left, y, inner, "Adresse")
    y -= FIELD_H + 2
    field(c, left, y, third, "Type (leilighet / hus / hybel)")
    field(c, left + third + GUTTER, y, third, "Gnr. / bnr. / snr.")
    field(c, left + 2 * (third + GUTTER), y, third, "Areal og antall rom")
    y -= FIELD_H + 2
    field(c, left, y, third, "Møblert (ja / nei)")
    field(c, left + third + GUTTER, y, third, "Bod / parkering")
    field(c, left + 2 * (third + GUTTER), y, third, "Andre rom eller tillegg")

    y -= 20
    heading(c, left, y, "3", "Leieperiode")
    y -= FIELD_H + 2
    field(c, left, y, third, "Startdato")
    field(c, left + third + GUTTER, y, third, "Sluttdato (om tidsbestemt)")
    field(c, left + 2 * (third + GUTTER), y, third, "Oppsigelsestid")

    y -= 20
    heading(c, left, y, "4", "Husleie")
    y -= FIELD_H + 2
    field(c, left, y, third, "Månedlig husleie (kr)")
    field(c, left + third + GUTTER, y, third, "Forfall (dato hver måned)")
    field(c, left + 2 * (third + GUTTER), y, third, "Kontonummer")
    y -= FIELD_H + 2
    field(c, left, y, inner, "Hva som inngår i husleien (f.eks. fellesutgifter, internett, kommunale avgifter)")

    y -= 20
    heading(c, left, y, "5", "Depositum")
    y -= FIELD_H + 2
    field(c, left, y, col, "Beløp (kr)")
    field(c, right, y, col, "Bank / sperret depositumskonto")
    y -= 14
    fill(c, MUTED)
    c.setFont("DejaVu", 7.3)
    c.drawString(left, y, "Depositum settes på sperret konto i leietakers navn, slik husleieloven krever.")

    y -= 22
    heading(c, left, y, "6", "Andre merknader")
    y -= 10
    note_h = 58
    y -= note_h
    fill(c, SKY)
    stroke(c, LINE)
    c.setLineWidth(0.7)
    c.roundRect(left, y, inner, note_h, 6, fill=1, stroke=1)
    fill(c, MUTED)
    c.setFont("DejaVu", 7.2)
    c.drawString(left + 8, y + note_h - 14, "Husdyr, røyking, vedlikehold eller annet dere avtaler")

    y -= 20
    heading(c, left, y, "7", "Underskrifter")
    y -= FIELD_H + 2
    field(c, left, y, col, "Sted")
    field(c, right, y, col, "Dato")
    y -= FIELD_H + 10
    field(c, left, y, col, "Utleier (signatur og navn)")
    field(c, right, y, col, "Leietaker (signatur og navn)")

    if y < 56:
        raise SystemExit(f"Layout overflow: last field y={y:.1f}")

    stroke(c, LINE)
    c.setLineWidth(0.6)
    c.line(MARGIN, 42, WIDTH - MARGIN, 42)
    fill(c, MUTED)
    c.setFont("DejaVu", 7.2)
    c.drawString(MARGIN, 28, "enkelutleie.com   ·   Mal for privat husleie   ·   Ikke en ferdig avtale")
    c.drawRightString(WIDTH - MARGIN, 28, "Side 1 av 1")

    c.save()
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes), last field y={y:.1f}")


if __name__ == "__main__":
    main()
