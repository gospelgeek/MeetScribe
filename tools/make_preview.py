# Genera tools/preview.jpg (1200x630): la imagen que se ve al compartir el enlace de la pagina
# (WhatsApp, redes, etc.). Uso: python tools/make_preview.py
from PIL import Image, ImageDraw, ImageFont
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 630
F = 'C:/Windows/Fonts/'
font = lambda name, size: ImageFont.truetype(F + name, size)

# Fondo en degradado diagonal (azul noche -> azul)
bg = Image.new('RGB', (W, H))
px = bg.load()
c1, c2 = (11, 27, 66), (26, 94, 200)
for y in range(H):
    for x in range(W):
        t = (x / W * 0.6 + y / H * 0.4)
        px[x, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
img = bg.convert('RGBA')
d = ImageDraw.Draw(img)

# Tarjeta blanca con el icono
card = 300
cx, cy = 90, (H - card) // 2
d.rounded_rectangle((cx, cy, cx + card, cy + card), radius=56, fill=(255, 255, 255, 255))
icon = Image.open(os.path.join(root, 'icons', 'icon-128.png')).convert('RGBA').resize((236, 236), Image.LANCZOS)
img.alpha_composite(icon, (cx + (card - 236) // 2, cy + (card - 236) // 2))

# Texto
x0 = cx + card + 64
d.text((x0, 150), 'MeetScribe', font=font('segoeuib.ttf', 100), fill='white')
d.text((x0, 276), 'Transcribe tus reuniones de', font=font('segoeui.ttf', 40), fill=(219, 232, 255))
d.text((x0, 328), 'Google Meet con el nombre', font=font('segoeui.ttf', 40), fill=(219, 232, 255))
d.text((x0, 380), 'de quien habla.', font=font('segoeui.ttf', 40), fill=(219, 232, 255))

# Etiquetas (sobre una capa aparte para que la transparencia se mezcle con el fondo)
chip_font = font('segoeuib.ttf', 26)
overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay)
x = x0
chips = []
for label in ('Chat', 'Screenshots', 'PDF'):
    w = d.textlength(label, font=chip_font)
    od.rounded_rectangle((x, 462, x + w + 44, 462 + 54), radius=27, fill=(255, 255, 255, 40), outline=(255, 255, 255, 140), width=2)
    chips.append((x + 22, label))
    x += w + 44 + 14
img.alpha_composite(overlay)
d = ImageDraw.Draw(img)
for tx, label in chips:
    d.text((tx, 462 + 9), label, font=chip_font, fill='white')

d.text((x0, 560), 'Extensión de Chrome · Gospel Geek', font=font('segoeui.ttf', 26), fill=(170, 200, 245))

img.convert('RGB').save(os.path.join(root, 'tools', 'preview.jpg'), quality=88, optimize=True)
print('tools/preview.jpg listo', os.path.getsize(os.path.join(root, 'tools', 'preview.jpg')), 'bytes')
