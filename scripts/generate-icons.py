#!/usr/bin/env python3
"""PWA用アイコン(public/icons/*.png)を生成する。

既存の apple-touch-icon.png と同じ「白地に硬式球」のデザインを、
Android/PWA が要求する 192px・512px と、Android のアダプティブ
アイコン用(maskable: 周囲を切り落とされても欠けない余白付き)で描く。

画像ライブラリを増やしたくないので、PNGは標準ライブラリだけで書き出す。
アイコンを作り直すときは:  python3 scripts/generate-icons.py
"""

import math
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / 'public' / 'icons'

BACKGROUND = (255, 255, 255)
BALL_LIGHT = (252, 252, 252)   # ハイライト側
BALL_DARK = (206, 206, 206)    # 陰側
SEAM = (230, 51, 41)           # 赤い縫い目

SS = 3  # 1ピクセルあたりの supersampling 数(縁のギザギザを消す)

# 縫い目の弧: ボール中心から k だけ離れた点を中心とする半径 Rs の円の一部。
# 左右対称に2本描くと、硬式球の見慣れたシルエットになる。
SEAM_CENTER_K = 0.75   # ボール半径に対する弧の中心距離
SEAM_BULGE = 0.72      # 弧が最も外へ張り出す位置(ボール半径に対する比)
SEAM_WIDTH = 0.045     # 縫い目の太さ(ボール半径に対する比)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def sample(x, y, cx, cy, r):
    """描画点の色を返す。ボールの外は背景色。"""
    dx, dy = x - cx, y - cy
    dist = math.hypot(dx, dy)
    if dist > r:
        return BACKGROUND

    # 縫い目の判定: 左右2本の弧のどちらかに乗っていれば赤
    k = SEAM_CENTER_K * r
    rs = k + SEAM_BULGE * r
    half = SEAM_WIDTH * r / 2
    for side in (1, -1):
        if abs(math.hypot(dx - side * k, dy) - rs) < half:
            return SEAM

    # 革の陰影: 左上のハイライトから離れるほど暗くする
    hx, hy = cx - 0.32 * r, cy - 0.32 * r
    t = min(1.0, math.hypot(x - hx, y - hy) / (1.75 * r))
    return lerp(BALL_LIGHT, BALL_DARK, t)


def render(size, ball_ratio):
    """size×size のRGBピクセル列を作る。ball_ratio はボール直径の割合。"""
    cx = cy = size / 2
    r = size * ball_ratio / 2
    rows = []
    step = 1.0 / SS
    offset = step / 2
    weight = 1.0 / (SS * SS)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(SS):
                y = py + offset + sy * step
                for sx in range(SS):
                    x = px + offset + sx * step
                    c = sample(x, y, cx, cy, r)
                    acc[0] += c[0]
                    acc[1] += c[1]
                    acc[2] += c[2]
            row += bytes(min(255, round(v * weight)) for v in acc)
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = b''.join(b'\x00' + row for row in rows)  # フィルタなし(0)の走査線
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    path.write_bytes(png)
    print(f'{path.name}: {size}x{size} ({len(png):,} bytes)')


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 通常アイコンはボールを大きく。maskableは外周が切られる前提で小さめに置く
    for size, ratio, name in (
        (192, 0.94, 'icon-192.png'),
        (512, 0.94, 'icon-512.png'),
        (512, 0.62, 'icon-maskable-512.png'),
    ):
        write_png(OUT_DIR / name, render(size, ratio), size)


if __name__ == '__main__':
    main()
