# Regenerate every brand raster from the new glowing logo (owner mandate
# 2026-11-16: "حدث اللوجو اللي بيظهر على ال side bar وخليه زي الصورة").
# Source: upload/أيقونة مالية متوهجة بنمو صاعد(1).png (1240x1240, dark tile
# with green glow, white/green E + rising bars + arrow).
from PIL import Image
import os

SRC = "/home/z/my-project/upload/أيقونة مالية متوهجة بنمو صاعد(1).png"
PUB = "/home/z/my-project/egxano/public"

im = Image.open(SRC).convert("RGBA")
print("source:", im.size, im.mode)

def save_square(size: int, path: str) -> None:
    img = im.resize((size, size), Image.LANCZOS)
    img.save(path, optimize=True)
    print(f"{path}  {size}x{size}  {os.path.getsize(path)//1024}KB")

# PWA / favicon raster set (same filenames the code already references)
save_square(64, f"{PUB}/icon-64.png")
save_square(192, f"{PUB}/icon-192.png")
save_square(512, f"{PUB}/icon-512.png")
save_square(256, f"{PUB}/logo.png")

# favicon.ico — multi-resolution
ico_sizes = [(16, 16), (32, 32), (48, 48)]
im.resize((48, 48), Image.LANCZOS).save(f"{PUB}/favicon.ico", format="ICO", sizes=ico_sizes)
print(f"{PUB}/favicon.ico regenerated")
