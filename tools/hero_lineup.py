"""Compose the hero's robot lineup (desktop 2:1 and phone 6:5) from the product renders.

usage: python tools/hero_lineup.py assets/images assets/images/site <dir with vega_white.png>
Transparent renders are alpha-composited with a soft ground shadow; white-background renders
(vega_white.png, a still from the 3D viewer) are multiplied in so their white drops out.
"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter
src, out, extra = sys.argv[1], sys.argv[2], sys.argv[3]

MULTIPLY = {"vega_white.png"}

def load(n):
    if n in MULTIPLY:
        im = Image.open(f"{extra}/{n}").convert("RGB")
        bb = ImageChops.invert(im.convert("L")).point(lambda v: 255 if v > 6 else 0).getbbox()
        return im.crop(bb)
    im = Image.open(f"{src}/{n}").convert("RGBA")
    if n == "trakr2.png":
        # white studio backdrop -> transparent: flood from the corners only, so white parts of the robot stay
        mask = Image.new("L", im.size, 0)
        lum = im.convert("L")
        w, h = im.size
        seen = bytearray(w * h); stack = [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]
        px = lum.load(); mp = mask.load()
        while stack:
            x, y = stack.pop()
            i = y * w + x
            if seen[i]: continue
            seen[i] = 1
            if px[x, y] < 246: continue
            mp[x, y] = 255
            if x > 0: stack.append((x-1, y))
            if x < w-1: stack.append((x+1, y))
            if y > 0: stack.append((x, y-1))
            if y < h-1: stack.append((x, y+1))
        mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1))
        a = Image.eval(mask, lambda v: 255 - v)
        im.putalpha(a)
    bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(bb)

def compose(size, placements, path):
    W, H = size
    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    shadow = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shadow)
    items = []
    for name, cx, base, height, sw in placements:
        im = load(name)
        s = height / im.height
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        x, y = round(cx - im.width / 2), round(base - im.height)
        if sw:
            rw = im.width * sw / 2
            sd.ellipse([cx - rw, base - 14, cx + rw, base + 14], fill=70)
        items.append((im, x, y))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste((0, 0, 0, 255), (0, 0), Image.eval(shadow, lambda v: int(v * .55)))
    for im, x, y in items:
        if im.mode == "RGB":
            region = canvas.crop((x, y, x + im.width, y + im.height)).convert("RGB")
            canvas.paste(ImageChops.multiply(region, im), (x, y))
        else:
            canvas.alpha_composite(im, (x, y))
    canvas.convert("RGB").save(path, "JPEG", quality=86, optimize=True, progressive=True)

# name, center x, ground y, height, shadow width (fraction of image width; 0 = the render brings its own)
compose((2400, 1200), [
    ("vega_white.png",   420, 1010, 840, 0),
    ("syncro.webp",      980,  990, 680, .38),
    ("trakr2.png",      1530, 1005, 580, .78),
    ("zippy_40.webp",   2070,  990, 400, .80),
], f"{out}/hero_lineup.jpg")

compose((1200, 1000), [
    ("vega_white.png",   330,  880, 700, 0),
    ("trakr2.png",       850,  860, 470, .78),
], f"{out}/hero_lineup_phone.jpg")
