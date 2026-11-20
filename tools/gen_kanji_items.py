# -*- coding: utf-8 -*-
"""kanji_candidates.json(JMdict由来・読み正確)の上位候補に対し、
AIで小学生向けの意味と例文を生成して items.json に「漢字」として追加する。

語句(text)と読み(yomi)は辞書由来で固定。AIは意味・例文・適否判定のみ担当。

実行: python tools/gen_kanji_items.py
"""
import io
import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
GEKOKUJO = Path(r"C:\Users\nishida\gekokujo_test_app")
load_dotenv(GEKOKUJO / ".env")
sys.path.insert(0, str(GEKOKUJO))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import ai_service  # noqa: E402

OUT = BASE / "items.json"
CANDS = BASE / "tools" / "data" / "kanji_candidates.json"
TARGET = 500
BATCH = 40

LEVEL = {1: "S", 2: "A", 3: "A", 4: "B", 5: "B", 6: "C"}


def _gen(batch):
    """batch: [{text,yomi}] -> [{text,meaning,example,ok}]"""
    words = "、".join(f"{c['text']}({c['yomi']})" for c in batch)
    prompt = f"""以下の日本語の語句について、それぞれ小学生向けの意味と例文をJSON配列で出力してください。

語句: {words}

条件:
- 各項目は {{"text": "語句", "meaning": "...", "example": "...", "ok": true}} の形
- meaning はその語の意味を小学生が一読で分かる一文(20〜40字)
- example はその語を使った自然な短い例文(ひらがな多め)
- ok は「小学4〜6年生の読み問題として適切か」: 難しすぎる専門用語・固有名詞・不適切な語は false
- text は入力の語句をそのまま返す
- 出力はJSON配列のみ(前後の説明文・コードブロック禁止)"""
    data = ai_service._chat_json(prompt, temperature=0.3)
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                return v
        return []
    return data if isinstance(data, list) else []


def main():
    items = json.loads(OUT.read_text(encoding="utf-8"))
    cands = json.loads(CANDS.read_text(encoding="utf-8"))
    have = {it["text"] for it in items}
    got_cat = sum(1 for it in items if it.get("cat") == "漢字")
    print(f"現在 漢字{got_cat}件 / 目標{TARGET}")

    i = 0
    while got_cat < TARGET and i < len(cands):
        batch = [c for c in cands[i:i + BATCH] if c["text"] not in have]
        i += BATCH
        if not batch:
            continue
        print(f"生成中... {len(batch)}語 "
              f"({batch[0]['text']}〜{batch[-1]['text']})")
        try:
            got = _gen(batch)
        except Exception as e:
            print(f"  エラー: {e} 30秒待機")
            i -= BATCH
            time.sleep(30)
            continue
        by_text = {str(g.get("text", "")).strip(): g for g in got}
        added = 0
        for c in batch:
            g = by_text.get(c["text"])
            if not g or g.get("ok") is False:
                continue
            if not g.get("meaning") or not g.get("example"):
                continue
            items.append({
                "text": c["text"],
                "yomi": c["yomi"],
                "meaning": str(g["meaning"]).strip(),
                "example": str(g["example"]).strip(),
                "level": LEVEL.get(c["score"], "C"),
                "cat": "漢字",
                "id": f"漢字-{len(items) + 1:04d}",
            })
            have.add(c["text"])
            got_cat += 1
            added += 1
            if got_cat >= TARGET:
                break
        print(f"  +{added}件 (計{got_cat})")
        OUT.write_text(json.dumps(items, ensure_ascii=False, indent=1),
                       encoding="utf-8")
        if added == 0:
            time.sleep(1)
        else:
            time.sleep(2)
    print(f"完了: 漢字{got_cat}件 / 全{len(items)}件")


if __name__ == "__main__":
    main()
