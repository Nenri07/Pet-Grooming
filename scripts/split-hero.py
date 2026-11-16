"""
split-hero.py - builds the landing-page hero layers from the master artwork.

    python3 scripts/split-hero.py

Input:  public/images/marketing/pawxis-hero-pets.png  (lossless master, 1600x1200, transparent)
Output: public/images/marketing/pawxis-hero-{window,phone}.{webp,png}

Two steps:
1. Feather the drop shadow where the canvas clips it at the left and right
   edges, so the composition never shows a hard rectangular edge on the page.
   Only shadow pixels (dark and mostly transparent) are touched; the artwork
   itself is left exactly as drawn.
2. Cut the art at the phone's right edge into two full-size layers (window and
   phone). Stacked, they reproduce step 1's image exactly, which lets the hero
   animate the phone separately. Re-run this whenever the artwork changes, and
   update SPLIT_X if the phone moves.
"""
from pathlib import Path
from PIL import Image

DIR = Path(__file__).resolve().parent.parent / 'public' / 'images' / 'marketing'
SRC = DIR / 'pawxis-hero-pets.png'
SPLIT_X = 450   # first column of the window; the phone (bezel + highlight) ends at 449
FEATHER = 64    # px over which the clipped shadow fades out at each side

img = Image.open(SRC).convert('RGBA')
W, H = img.size
px = img.load()

def is_shadow(p):
    r, g, b, a = p
    return a < 120 and max(r, g, b) < 80

for x in list(range(FEATHER)) + list(range(W - FEATHER, W)):
    k = (x + 0.5) / FEATHER if x < FEATHER else (W - x - 0.5) / FEATHER
    for y in range(H):
        p = px[x, y]
        if p[3] and is_shadow(p):
            px[x, y] = (p[0], p[1], p[2], round(p[3] * k))

phone = Image.new('RGBA', (W, H), (0, 0, 0, 0))
phone.paste(img.crop((0, 0, SPLIT_X, H)), (0, 0))
window = Image.new('RGBA', (W, H), (0, 0, 0, 0))
window.paste(img.crop((SPLIT_X, 0, W, H)), (SPLIT_X, 0))

assert Image.alpha_composite(window, phone).tobytes() == img.tobytes(), 'layers do not recombine'

for name, layer in (('window', window), ('phone', phone)):
    layer.save(DIR / f'pawxis-hero-{name}.webp', 'WEBP', quality=90, method=6)
    layer.save(DIR / f'pawxis-hero-{name}.png', optimize=True)

edge = max(img.getchannel('A').getpixel((x, y)) for x in (0, W - 1) for y in range(H))
print(f'layers written to {DIR} (max alpha at canvas side edges: {edge})')
