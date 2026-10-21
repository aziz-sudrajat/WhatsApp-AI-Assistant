#!/usr/bin/env python3
"""Generate assets/demo.gif: an ILLUSTRATED, SIMULATED terminal walkthrough.

This GIF is not a recording of a real WhatsApp session. It draws fake
terminal screens with PIL: QR pairing, connection, an incoming message,
a draft, and an approval. The QR-like grid is random noise WITHOUT QR
finder patterns, so it cannot be scanned or pair any account. All names,
numbers, and messages are invented.

Usage: python3 scripts/make_demo_gif.py
Output: assets/demo.gif (kept small on purpose).
"""

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "demo.gif"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")

W, H = 800, 460
BG = (17, 24, 39)        # dark terminal background
PANEL = (31, 41, 55)      # panel background
TEXT = (229, 231, 235)    # near-white
GREEN = (34, 197, 94)
CYAN = (103, 232, 249)
YELLOW = (250, 204, 21)
DIM = (156, 163, 175)

random.seed(42)


def font(size, bold=False):
    name = "DejaVuSansMono-Bold.ttf" if bold else "DejaVuSansMono.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size)


def wrap(draw, text, fnt, max_width):
    """Greedy word wrap to a pixel width."""
    words = text.split(" ")
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def base_frame(title):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # Window top bar
    d.rectangle([0, 0, W, 36], fill=(30, 41, 59))
    for i, color in enumerate([(248, 113, 113), (250, 204, 21), (74, 222, 128)]):
        d.ellipse([14 + i * 24, 11, 26 + i * 24, 23], fill=color)
    d.text((90, 9), title, font=font(17, bold=True), fill=TEXT)
    # Simulated-demo watermark
    d.text((W - 250, H - 28), "SIMULATED DEMO", font=font(14, bold=True), fill=DIM)
    return img, d


def text_block(d, lines, x, y, size=19, gap=30, color=TEXT, bold_first=False):
    fnt = font(size, bold=False)
    fnt_bold = font(size, bold=True)
    for i, line in enumerate(lines):
        f = fnt_bold if (bold_first and i == 0) else fnt
        d.text((x, y), line, font=f, fill=color)
        y += gap
    return y


def fake_qr_grid(d, x, y, cell=7, modules=21):
    """Random light/dark modules WITHOUT QR finder patterns, so the grid
    cannot be scanned as a QR code. Pure illustration."""
    for row in range(modules):
        for col in range(modules):
            if random.random() < 0.5:
                d.rectangle(
                    [x + col * cell, y + row * cell,
                     x + (col + 1) * cell - 1, y + (row + 1) * cell - 1],
                    fill=TEXT,
                )
    d.rectangle([x - 2, y - 2, x + modules * cell + 1, y + modules * cell + 1],
                outline=DIM, width=2)


def frame_qr():
    img, d = base_frame("terminal — wa-ai start")
    y = text_block(d, [
        "$ wa-ai start",
        "WhatsApp AI Assistant v0.1.0",
        "Provider: openai | Default mode: draft",
        "",
        "Scan this QR code with WhatsApp:",
    ], 40, 60, color=GREEN)
    fake_qr_grid(d, 40, y + 6)
    d.text((230, y + 60), "SIMULATED QR CODE", font=font(19, bold=True), fill=YELLOW)
    d.text((230, y + 95), "Not a real code.", font=font(18), fill=DIM)
    d.text((230, y + 130), "It cannot pair any account.", font=font(18), fill=DIM)
    return img


def frame_connected():
    img, d = base_frame("terminal — wa-ai start")
    text_block(d, [
        "$ wa-ai start",
        "",
        "✓ Connected! (simulated session)",
        "Gateway running. Press Ctrl+C to stop.",
        "",
        "Listening for messages...",
    ], 40, 60, color=GREEN)
    return img


def frame_incoming():
    img, d = base_frame("terminal — incoming message")
    y = text_block(d, [
        "INCOMING MESSAGE",
        "From: Alice (simulated contact)",
        "",
    ], 40, 60, color=CYAN)
    # Chat bubble
    d.rounded_rectangle([40, y, 700, y + 90], radius=14, fill=PANEL)
    d.text((60, y + 16), "Hey, are you free tomorrow", font=font(19), fill=TEXT)
    d.text((60, y + 48), "afternoon?", font=font(19), fill=TEXT)
    text_block(d, [
        "",
        "Mode: draft — generating a reply...",
    ], 40, y + 110, color=DIM)
    return img


def frame_draft():
    img, d = base_frame("terminal — draft approval")
    text_block(d, [
        "DRAFT CREATED (not sent yet)",
        'Draft: "Yes! I am free after 3pm.',
        '        Want to meet for coffee?"',
        "",
        "$ wa-ai list-drafts",
        "- draft-... | chat Alice | pending",
        "",
        "$ wa-ai approve-draft draft-...",
    ], 40, 60, color=YELLOW)
    return img


def frame_sent():
    img, d = base_frame("terminal — reply sent")
    text_block(d, [
        "✓ Draft approved by owner",
        "✓ Reply sent (simulated)",
        "",
        "Chat: Alice — reply delivered.",
        "",
        "Modes: auto · draft · off",
        "Safety: human takeover, rate limits,",
        "pause / resume — see README.md",
    ], 40, 60, color=GREEN)
    return img


def main():
    frames = [
        frame_qr(),
        frame_connected(),
        frame_incoming(),
        frame_draft(),
        frame_sent(),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=1600,
        loop=0,
        optimize=True,
    )
    size_kb = OUT.stat().st_size // 1024
    print(f"Wrote {OUT} ({size_kb} KB, {len(frames)} frames)")


if __name__ == "__main__":
    main()
