#!/usr/bin/env python3
"""Иконки приложения: Кубыш на тёмном поле.

Геометрия задана здесь один раз и отдаётся и в SVG, и в PNG. Держать её
в двух файлах значило бы однажды поправить одно и забыть другое — и получить
иконку, которая на одном устройстве не такая, как на другом.

PNG рисуется с четырёхкратным запасом и уменьшается: у PIL нет сглаживания
при рисовании, но есть при уменьшении, и этого достаточно.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"

BG = "#080a0e"
# Маскируемая иконка обрезается системой по своей форме, поэтому фон у неё
# чуть светлее: на краю среза чёрное поле сливается с рамкой виджета.
BG_MASKABLE = "#10141b"
ACCENT = "#3666ff"
INK = "#0a1018"
WHITE = "#ffffff"

# Кубыш в системе координат 512×512. Числа подобраны так, чтобы фигура стояла
# по центру поля и не упиралась в края: iOS кладёт иконку под свою маску,
# и всё, что ближе десятка пикселей к краю, срезается.
BODY = (256, 214, 132, 138)          # cx, cy, rx, ry
EYES = [(212, 192), (300, 192)]      # центры белков, r ниже
EYE_R = 42
PUPILS = [(220, 199), (308, 199)]
PUPIL_R = 21
SMILE = ((208, 266), (256, 298), (304, 266))  # начало, управляющая, конец
SMILE_W = 16
LEGS = [((214, 342), (196, 408)), ((298, 342), (316, 408))]
LEG_W = 26
FEET = [(196, 412), (316, 412)]
FOOT_R = 26


def scaled(scale):
    """Та же фигура, сжатая к центру поля."""
    c = 256

    def p(x, y):
        return (c + (x - c) * scale, c + (y - c) * scale)

    def r(v):
        return v * scale

    return p, r


def quad_points(p0, p1, p2, steps=24):
    """Квадратичная кривая точками: у PIL кривых нет, а дуга улыбки нужна."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def draw_png(size, bg, scale, path):
    ss = 4
    n = size * ss
    k = n / 512
    img = Image.new("RGB", (n, n), bg)
    d = ImageDraw.Draw(img)
    p, r = scaled(scale)

    def px(pt):
        return (pt[0] * k, pt[1] * k)

    def ellipse(cx, cy, rx, ry, fill):
        x, y = px(p(cx, cy))
        a, b = r(rx) * k, r(ry) * k
        d.ellipse([x - a, y - b, x + a, y + b], fill=fill)

    # Ноги и ступни рисуются первыми: тело ложится на них сверху и скрывает
    # места стыка, как и в самом зверьке на экране.
    for a, b in LEGS:
        d.line([px(p(*a)), px(p(*b))], fill=ACCENT, width=int(r(LEG_W) * k), joint="curve")
    for cx, cy in FEET:
        ellipse(cx, cy, FOOT_R, FOOT_R, ACCENT)

    ellipse(*BODY, fill=ACCENT)

    for (cx, cy) in EYES:
        ellipse(cx, cy, EYE_R, EYE_R, WHITE)
    for (cx, cy) in PUPILS:
        ellipse(cx, cy, PUPIL_R, PUPIL_R, INK)

    d.line([px(p(*q)) for q in quad_points(*SMILE)], fill=INK,
           width=int(r(SMILE_W) * k), joint="curve")

    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    return path


def draw_svg(path, bg, scale):
    p, r = scaled(scale)
    bx, by, brx, bry = BODY
    body = p(bx, by)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
        f'  <rect width="512" height="512" fill="{bg}"/>',
    ]
    for a, b in LEGS:
        x1, y1 = p(*a)
        x2, y2 = p(*b)
        parts.append(
            f'  <path d="M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}" stroke="{ACCENT}" '
            f'stroke-width="{r(LEG_W):.1f}" stroke-linecap="round" fill="none"/>'
        )
    for cx, cy in FEET:
        x, y = p(cx, cy)
        parts.append(f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="{r(FOOT_R):.1f}" fill="{ACCENT}"/>')
    parts.append(
        f'  <ellipse cx="{body[0]:.1f}" cy="{body[1]:.1f}" rx="{r(brx):.1f}" ry="{r(bry):.1f}" fill="{ACCENT}"/>'
    )
    for cx, cy in EYES:
        x, y = p(cx, cy)
        parts.append(f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="{r(EYE_R):.1f}" fill="{WHITE}"/>')
    for cx, cy in PUPILS:
        x, y = p(cx, cy)
        parts.append(f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="{r(PUPIL_R):.1f}" fill="{INK}"/>')
    s0, s1, s2 = (p(*q) for q in SMILE)
    parts.append(
        f'  <path d="M{s0[0]:.1f} {s0[1]:.1f} Q{s1[0]:.1f} {s1[1]:.1f} {s2[0]:.1f} {s2[1]:.1f}" '
        f'stroke="{INK}" stroke-width="{r(SMILE_W):.1f}" stroke-linecap="round" fill="none"/>'
    )
    parts.append('</svg>')
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    made = [
        draw_png(192, BG, 1.0, OUT / "icon-192.png"),
        draw_png(512, BG, 1.0, OUT / "icon-512.png"),
        draw_png(180, BG, 1.0, OUT / "apple-touch-icon.png"),
        # Маскируемая: система обрежет края по своей форме, поэтому фигура
        # ужата в безопасную зону — иначе ей отрежет ноги.
        draw_png(512, BG_MASKABLE, 0.72, OUT / "icon-maskable-512.png"),
        draw_svg(OUT / "icon.svg", BG, 1.0),
    ]
    for f in made:
        print(f"{f.name:26} {f.stat().st_size:>7} Б")
