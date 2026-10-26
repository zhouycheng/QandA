"""
一次性脚本：把生成的封面图裁成首页倒计时卡的比例，并压成 JPEG。

为什么必须裁：原图 1536x1024（3:2），右下角带生成服务的水印；
卡片是宽幅（约 2.4:1），直接用 aspectFill 会让水印时隐时现，而且原图近 1MB，
小程序主包只剩 300KB 余量，必须转成 JPEG。

裁剪窗口取「全宽 + 上下留白」：物体集中在 x 800~1320、y 420~740，
上下各留 ~160px 余量后，卡片比例在 2.2~2.6 之间浮动都不会切到物体。
"""
from PIL import Image, ImageEnhance
import os

SRC = r"E:\curry\github_projects\QandA\apps\miniapp\_generated\Remove_the_large_translucent_d_2026-10-25T15-39-23.png"
OUT = r"E:\curry\github_projects\QandA\apps\miniapp\miniprogram\assets\home\exam-cover.jpg"

# ⚠️ 必须与 .exam-card 的比例完全一致（宽 686rpx / 高 320rpx = 2.14375）。
# 不一致的话 aspectFill 会裁边，右边缘的时钟会被切掉半个。
CARD_RATIO = 686 / 320

CROP_TOP = 250
CROP_HEIGHT = round(1536 / CARD_RATIO)   # 1536 / 2.14375 ≈ 717
OUT_WIDTH = 1280
QUALITY = 82

# 生成图的蓝偏深偏灰（采样约 #3F5EAF），和首页头部的亮蓝（#4a7bfb）差太远，
# 直接放上去卡片会比头部沉一大截。整体提亮 + 提饱和，往品牌蓝靠。
BRIGHTNESS = 1.16
SATURATION = 1.14

os.makedirs(os.path.dirname(OUT), exist_ok=True)

image = Image.open(SRC).convert("RGB")
width, height = image.size
print("原图", width, "x", height)

box = (0, CROP_TOP, width, min(CROP_TOP + CROP_HEIGHT, height))
cropped = image.crop(box)
print("裁剪", box, "→", cropped.size)

out_height = round(OUT_WIDTH * cropped.size[1] / cropped.size[0])
resized = cropped.resize((OUT_WIDTH, out_height), Image.LANCZOS)
resized = ImageEnhance.Brightness(resized).enhance(BRIGHTNESS)
resized = ImageEnhance.Color(resized).enhance(SATURATION)
resized.save(OUT, "JPEG", quality=QUALITY, optimize=True, progressive=True)
print("输出", resized.size, os.path.getsize(OUT) // 1024, "KB")

# 采样左侧中部（文字区）与右侧，用于让卡片渐变/蒙层跟图对得上
for label, point in [
    ("左上", (40, 40)),
    ("左中（文字区）", (60, cropped.size[1] // 2)),
    ("右下", (cropped.size[0] - 60, cropped.size[1] - 40)),
]:
    print(label, "#%02X%02X%02X" % cropped.getpixel(point))
