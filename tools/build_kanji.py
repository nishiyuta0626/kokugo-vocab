# -*- coding: utf-8 -*-
"""KANJIDIC2(配当学年) + JMdict から漢検7級〜5級(小4〜小6)相当の
漢字読み問題データを抽出する。

条件:
- 語を構成する漢字はすべて小学校配当(grade<=6)
- うち1字以上が grade 4〜6 (漢検7級〜5級相当)
- 2〜6文字、ひらがな送り仮名可
- JMdict の常用語タグ(news/ichi/spec/gai/nf)あり
- 読みは JMdict の正式な読みを使用(AI生成ではない)

出力: tools/data/kanji_candidates.json
"""
import gzip
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

KANJI_RE = re.compile(r"[一-龯々〆ヵヶ]")
HIRA_RE = re.compile(r"^[ぁ-んゔー]+$")

PRI_MAP = {
    "news1": 1, "ichi1": 1, "spec1": 2, "gai1": 3,
    "news2": 4, "ichi2": 4, "spec2": 5, "gai2": 6,
}


def load_grades(path):
    """kanji -> grade(1-6=小, 8=中). 教育漢字のみ True"""
    grades = {}
    ctx = ET.iterparse(gzip.open(path, "rb"), events=("end",))
    for _, el in ctx:
        if el.tag != "character":
            continue
        lit = el.findtext("literal")
        g = el.findtext("misc/grade")
        if lit:
            grades[lit] = int(g) if g else 99  # 配当なし=99
        el.clear()
    return grades


def word_ok(word, grades):
    """全漢字が小6以下 & 1字以上が小4-6"""
    kanji = [c for c in word if KANJI_RE.match(c) and c not in "々〆ヵヶ"]
    if not kanji:
        return False
    gs = [grades.get(c, 99) for c in kanji]
    if any(g > 6 for g in gs):          # 中学配当・表外漢字を含む
        return False
    return any(4 <= g <= 6 for g in gs)  # 小4〜小6を最低1字含む


def kata2hira(s):
    return "".join(
        chr(ord(c) - 0x60) if "ァ" <= c <= "ン" else c for c in s
    )


def main():
    grades = load_grades(BASE / "data" / "kanjidic2.xml.gz")
    print(f"漢字{len(grades)}字読込")

    cands = {}  # keb -> (score, reb)
    ctx = ET.iterparse(gzip.open(BASE / "data" / "JMdict_e.gz", "rb"),
                       events=("end",))
    n = 0
    for _, el in ctx:
        if el.tag != "entry":
            continue
        n += 1
        kebs, rebs = [], []
        for k in el.findall("k_ele"):
            keb = k.findtext("keb")
            pris = [p.text for p in k.findall("ke_pri")]
            if keb:
                kebs.append((keb, pris))
        for r in el.findall("r_ele"):
            reb = r.findtext("reb")
            if r.find("re_nokanji") is not None or not reb:
                continue
            restr = [x.text for x in r.findall("re_restr")]
            pris = [p.text for p in r.findall("re_pri")]
            rebs.append((reb, restr, pris))
        for keb, kpri in kebs:
            if not (2 <= len(keb) <= 6):
                continue
            if not word_ok(keb, grades):
                continue
            # kebに対応する読みを選ぶ
            reb = None
            rpri = []
            for rb, restr, pri in rebs:
                if not restr or keb in restr:
                    reb, rpri = rb, pri
                    break
            if not reb:
                continue
            yomi = kata2hira(reb).replace("ゔ", "ヴ")
            if not HIRA_RE.match(yomi):
                continue
            if "ー" in yomi or "・" in yomi:
                continue
            score = min(
                [PRI_MAP.get(p, 9) for p in kpri + rpri] or [10]
            )
            prev = cands.get(keb)
            if not prev or score < prev[0]:
                cands[keb] = (score, yomi)
        el.clear()
    print(f"JMdict {n}エントリ走査 -> 候補{len(cands)}語")

    # 常用タグなし(score>=9)は捨て、読みが同じ表記ゆれは1つに絞る
    def kanji_count(w):
        return sum(1 for c in w if KANJI_RE.match(c) and c not in "々〆ヵヶ")
    by_yomi = {}
    for keb, (score, yomi) in cands.items():
        if score >= 9:
            continue
        cur = by_yomi.get(yomi)
        # 同じ読みなら漢字数が多い・scoreが良い方を採用
        if not cur or (score, -kanji_count(keb)) < (cur[0], -kanji_count(cur[1])):
            by_yomi[yomi] = (score, keb)
    out = [{"text": v[1], "yomi": y, "score": v[0], "nk": kanji_count(v[1])}
           for y, v in by_yomi.items() if len(v[1]) <= 4]
    # 常用度 → 漢字の多い語(読み問題向き)の順
    out.sort(key=lambda x: (x["score"], -x["nk"], x["text"]))
    (BASE / "data" / "kanji_candidates.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    print(Counter(x["score"] for x in out), "合計", len(out))
    print("先頭30件:", [x["text"] for x in out[:30]])


if __name__ == "__main__":
    main()
