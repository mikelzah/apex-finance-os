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

BG = "#08090b"
# Маскируемая иконка обрезается системой по своей форме, поэтому фон у неё
# чуть светлее: на краю среза чёрное поле сливается с рамкой виджета.
BG_MASKABLE = "#12151a"

# Жёлтый — тот же, что красит действие в приложении. Прежде здесь был синий
# #3666FF: он остался от оформления, от которого приложение ушло, и иконка
# на домашнем экране полгода не совпадала с тем, что открывалось по нажатию.
ACCENT = "#ffdd2d"
# Верх фигуры светлее низа. Не блик и не глянец: разница в две ступени даёт
# объём монеты, а на сорока пикселях домашнего экрана глянец превращается
# в грязное пятно.
ACCENT_TOP = "#ffe97a"
ACCENT_BOTTOM = "#f2ca00"
INK = "#0b0d10"
WHITE = "#ffffff"

# Тёплое свечение за фигурой. Единственная уступка «премиальности»:
# на ровном чёрном жёлтая фигура выглядит наклейкой, со свечением —
# лежит в поле. Едва заметно и намеренно: заметное читалось бы ореолом.
GLOW = (255, 221, 45)
GLOW_ALPHA = 30

# Кубыш в системе координат 512×512. Числа подобраны так, чтобы фигура стояла
# по центру поля и не упиралась в края: iOS кладёт иконку под свою маску,
# и всё, что ближе десятка пикселей к краю, срезается.
BODY = (256, 214, 132, 138)          # cx, cy, rx, ry
EYES = [(212, 192), (300, 192)]      # центры белков, r ниже
EYE_R = 42
# Зрачки по центру белков, а не смещены вбок. У зверька на экране они
# ездят — он смотрит на то, что происходит, — но иконка неподвижна,
# и на сорока пикселях домашнего экрана смещение читается не взглядом,
# а браком печати.
PUPILS = [(212, 192), (300, 192)]
PUPIL_R = 22
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


def vertical_gradient(size, top, bottom):
    """Полоса из двух цветов сверху вниз. У PIL градиентов нет."""
    from PIL import ImageColor
    t = ImageColor.getrgb(top)
    b = ImageColor.getrgb(bottom)
    band = Image.new("RGB", (1, size))
    for y in range(size):
        f = y / max(size - 1, 1)
        band.putpixel((0, y), tuple(round(t[i] + (b[i] - t[i]) * f) for i in range(3)))
    return band.resize((size, size))


def radial_glow(size, colour, alpha):
    """Мягкое пятно из центра. Собирается маской, а не размытием: размытие
    на четырёхкратном холсте стоит секунд, а результат тот же."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    steps = 48
    for i in range(steps, 0, -1):
        f = i / steps
        rad = size * 0.46 * f
        v = round(alpha * (1 - f) ** 1.6)
        cx = size * 0.5
        cy = size * 0.42
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=v)
    layer = Image.new("RGB", (size, size), colour)
    return layer, mask


def ground_shadow(size, scale):
    """Тень под ступнями. Она делает не «красивее», а понятнее: без неё
    фигура висит в пустоте, и иконка читается наклейкой, наложенной
    на чёрный квадрат."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    cx = size * 0.5
    cy = size * (0.845 if scale > 0.9 else 0.5 + 0.345 * scale)
    steps = 26
    for i in range(steps, 0, -1):
        f = i / steps
        rx = size * 0.20 * scale * f
        ry = size * 0.035 * scale * f
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=round(52 * (1 - f) ** 1.4))
    return Image.new("RGB", (size, size), (0, 0, 0)), mask


def draw_png(size, bg, scale, path):
    ss = 4
    n = size * ss
    k = n / 512
    img = Image.new("RGB", (n, n), bg)

    layer, mask = radial_glow(n, GLOW, GLOW_ALPHA)
    img.paste(layer, (0, 0), mask)
    sl, sm = ground_shadow(n, scale)
    img.paste(sl, (0, 0), sm)

    d = ImageDraw.Draw(img)
    p, r = scaled(scale)

    def px(pt):
        return (pt[0] * k, pt[1] * k)

    def ellipse(target, cx, cy, rx, ry, fill):
        x, y = px(p(cx, cy))
        a, b = r(rx) * k, r(ry) * k
        target.ellipse([x - a, y - b, x + a, y + b], fill=fill)

    # Фигура собирается на маске и заливается градиентом целиком: заливай
    # каждую часть по отдельности — и на стыке ноги с телом появился бы шов,
    # потому что градиент у каждой части считался бы от своей высоты.
    shape = Image.new("L", (n, n), 0)
    sd = ImageDraw.Draw(shape)
    for a, b in LEGS:
        sd.line([px(p(*a)), px(p(*b))], fill=255, width=int(r(LEG_W) * k), joint="curve")
    for cx, cy in FEET:
        ellipse(sd, cx, cy, FOOT_R, FOOT_R, 255)
    ellipse(sd, *BODY, fill=255)
    img.paste(vertical_gradient(n, ACCENT_TOP, ACCENT_BOTTOM), (0, 0), shape)

    for (cx, cy) in EYES:
        ellipse(d, cx, cy, EYE_R, EYE_R, WHITE)
    for (cx, cy) in PUPILS:
        ellipse(d, cx, cy, PUPIL_R, PUPIL_R, INK)

    d.line([px(p(*q)) for q in quad_points(*SMILE)], fill=INK,
           width=int(r(SMILE_W) * k), joint="curve")

    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    return path


def draw_svg(path, bg, scale):
    p, r = scaled(scale)
    bx, by, brx, bry = BODY
    body = p(bx, by)
    glow = f'rgba({GLOW[0]},{GLOW[1]},{GLOW[2]},{GLOW_ALPHA / 255:.3f})'
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Кубыш">',
        '  <defs>',
        '    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">',
        f'      <stop offset="0%" stop-color="{ACCENT_TOP}"/>',
        f'      <stop offset="100%" stop-color="{ACCENT_BOTTOM}"/>',
        '    </linearGradient>',
        '    <radialGradient id="glow" cx="50%" cy="42%" r="46%">',
        f'      <stop offset="0%" stop-color="{glow}"/>',
        f'      <stop offset="100%" stop-color="rgba({GLOW[0]},{GLOW[1]},{GLOW[2]},0)"/>',
        '    </radialGradient>',
        '    <radialGradient id="shadow" cx="50%" cy="50%" r="50%">',
        '      <stop offset="0%" stop-color="rgba(0,0,0,0.42)"/>',
        '      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>',
        '    </radialGradient>',
        '  </defs>',
        f'  <rect width="512" height="512" fill="{bg}"/>',
        '  <rect width="512" height="512" fill="url(#glow)"/>',
        # Тень под ступнями — та же, что в PNG. Расхождение между вектором
        # и растром означало бы две разные иконки на разных устройствах.
        f'  <ellipse cx="256" cy="{512 * (0.845 if scale > 0.9 else 0.5 + 0.345 * scale):.0f}" '
        f'rx="{512 * 0.20 * scale:.0f}" ry="{512 * 0.035 * scale:.0f}" fill="url(#shadow)"/>',
    ]
    for a, b in LEGS:
        x1, y1 = p(*a)
        x2, y2 = p(*b)
        parts.append(
            f'  <path d="M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}" stroke="url(#body)" '
            f'stroke-width="{r(LEG_W):.1f}" stroke-linecap="round" fill="none"/>'
        )
    for cx, cy in FEET:
        x, y = p(cx, cy)
        parts.append(f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="{r(FOOT_R):.1f}" fill="url(#body)"/>')
    parts.append(
        f'  <ellipse cx="{body[0]:.1f}" cy="{body[1]:.1f}" rx="{r(brx):.1f}" ry="{r(bry):.1f}" fill="url(#body)"/>'
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
