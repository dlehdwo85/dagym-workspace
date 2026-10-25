# 147차: PDF(pdf-lib) 용 한글 글꼴 만들기 — assets/fonts/NotoSansKR-*.otf(CFF) → NotoSansKR-*.ttf(TrueType glyf)
#   pip install fonttools
#   python3 scripts/fonts/otf2ttf.py assets/fonts/NotoSansKR-Regular.otf assets/fonts/NotoSansKR-Regular.ttf
#   python3 scripts/fonts/otf2ttf.py assets/fonts/NotoSansKR-Bold.otf assets/fonts/NotoSansKR-Bold.ttf
# 왜: fontkit(pdf-lib) 의 CFF 부분 글꼴은 CID 글꼴에서 깨지고(크롬·pdf.js 에서 한글 안 보임), TrueType 부분 글꼴은
#     짧은 loca(오프셋 ÷2)를 쓸 때 홀수 길이 글리프가 어긋난다 → 곡선은 fontTools cu2qu(최대 오차 1 단위)로 바꾸고 글리프를 4바이트로 맞춘다.
# 글리프 순서·cmap·글자 폭(hmtx)·GSUB/GPOS 는 원본 그대로(글자 배치가 예전과 같음). SIL OFL 1.1(assets/fonts/LICENSE-NotoSansKR.txt).
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen


def otf_to_ttf(src, dst, max_err=1.0):
    font = TTFont(src)
    assert font.sfntVersion == "OTTO", "CFF 글꼴이 아님"
    order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, max_err, reverse_direction=True))
        glyf[name] = pen.glyph()
    font["loca"] = newTable("loca")
    glyf.padding = 4  # 글리프 길이를 4의 배수로 — 부분 글꼴의 짧은 loca 에서도 오프셋이 정확
    font["glyf"] = glyf
    maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    for k in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, k, 0)
    maxp.maxZones = 1
    maxp.numGlyphs = len(order)
    font["maxp"] = maxp  # 점·윤곽 수는 저장할 때 다시 셈
    for t in ("CFF ", "VORG"):
        if t in font:
            del font[t]
    font["head"].glyphDataFormat = 0
    font["post"].formatType = 3.0  # 글리프 이름 없음
    font.sfntVersion = "\x00\x01\x00\x00"
    font.save(dst)


if __name__ == "__main__":
    otf_to_ttf(sys.argv[1], sys.argv[2])
