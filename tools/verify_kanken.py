# -*- coding: utf-8 -*-
"""kanken_words.json の読みをJMdictで照合・修正する"""
import json, gzip, xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
JM = DATA / "JMdict_e.xml"
if not JM.exists() and (DATA / "JMdict_e.gz").exists():
    JM.write_bytes(gzip.open(DATA / "JMdict_e.gz", "rb").read())

words = json.load(open(DATA / "kanken_words.json", encoding="utf-8"))
want = {w["text"]: w for w in words}
readings = {}  # keb -> [kana]

root = ET.parse(JM).getroot()
for entry in root.findall("entry"):
    kebs = [keb.text for keb in entry.findall("k_ele/keb") if keb.text]
    if not any(k in want for k in kebs):
        continue
    rs = []
    for reb in entry.findall("r_ele/reb"):
        if reb.text:
            rs.append(reb.text)
    for k in kebs:
        if k in want:
            readings.setdefault(k, set()).update(rs)

ok, fixed, bad = [], [], []
for w in words:
    t, y = w["text"], w["yomi"]
    valid = readings.get(t)
    if valid and y in valid:
        ok.append(w)
    elif valid:
        # 抽出ミスの可能性 → JMdictの読みに修正(複数ある場合は最初)
        newy = sorted(valid)[0]
        fixed.append({"text": t, "yomi": y, "fixed_to": newy})
        w["yomi"] = newy
        ok.append(w)
    else:
        bad.append(w)

print(f"確認OK: {len(ok)}  修正: {len(fixed)}  辞書未収録/要確認: {len(bad)}")
for f in fixed:
    print("  修正", f["text"], f["yomi"], "->", f["fixed_to"])
for b in bad:
    print("  未収録", b["text"], b["yomi"])
json.dump(ok, open(DATA / "kanken_words_verified.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
