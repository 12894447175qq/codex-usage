"""绘制工具栏统计图标；标准库生成多尺寸 PNG，无额外依赖。"""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
ROOT.mkdir(exist_ok=True)
ROOT.joinpath('icon.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<rect x="4" y="4" width="120" height="120" rx="28" fill="#1565c0"/>
<rect x="26" y="74" width="17" height="28" rx="4" fill="#b9ddff"/>
<rect x="55" y="54" width="17" height="48" rx="4" fill="#ffffff"/>
<rect x="84" y="34" width="17" height="68" rx="4" fill="#ffffff"/>
<path d="M33 22L36 31L45 34L36 37L33 46L30 37L21 34L30 31Z" fill="#80e5ee"/>
</svg>\n''')
SHAPES = [(4, 4, 120, 120, 28, (21, 101, 192)), (26, 74, 17, 28, 4, (185, 221, 255)), (55, 54, 17, 48, 4, (255, 255, 255)), (84, 34, 17, 68, 4, (255, 255, 255))]
STAR = [(33,22),(36,31),(45,34),(36,37),(33,46),(30,37),(21,34),(30,31)]
def inside_polygon(x, y):
    inside = False
    for i, (a,b) in enumerate(STAR):
        c,d = STAR[i-1]
        if (b > y) != (d > y) and x < (c-a)*(y-b)/(d-b)+a:
            inside = not inside
    return inside

def pixel(x,y):
    color = (0,0,0,0)
    for a,b,w,h,r,rgb in SHAPES:
        if a <= x <= a+w and b <= y <= b+h:
            dx = max(a+r-x, 0, x-(a+w-r)); dy = max(b+r-y, 0, y-(b+h-r))
            if dx*dx+dy*dy <= r*r: color = (*rgb,255)
    if inside_polygon(x,y): color = (128,229,238,255)
    return color

def chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
for size in (16,32,48,128):
    data=bytearray()
    for y in range(size):
        data.append(0)
        for x in range(size):
            samples=[pixel((x+(sx+.5)/4)*128/size,(y+(sy+.5)/4)*128/size) for sy in range(4) for sx in range(4)]
            alpha=sum(p[3] for p in samples)
            data.extend([round(sum(p[c]*p[3] for p in samples)/alpha) if alpha else 0 for c in range(3)]+[round(alpha/16)])
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(data))+chunk(b'IEND',b'')
    ROOT.joinpath(f'icon-{size}.png').write_bytes(png)
print('已生成 SVG 及 16/32/48/128 像素图标。')
