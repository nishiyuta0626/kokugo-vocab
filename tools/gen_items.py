# -*- coding: utf-8 -*-
"""ことわざ・慣用句・四字熟語・中受頻出漢字の問題データをAIで生成し
items.json に蓄積する。gekokujo_test_app の ai_service._chat_json を再利用。

使い方(gekokujo_test_app の venv python で実行):
  python tools/gen_items.py
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

CATEGORIES = {
    "四字熟語": {
        "target": 300,
        "desc": "中学受験・小学高学年で頻出の四字熟語",
        "fields": '"yomi"(ひらがな), "meaning"(小学生向け簡潔な意味),'
        ' "example"(例文)',
    },
    "慣用句": {
        "target": 300,
        "desc": "中学受験・小学高学年で頻出の慣用句(体の一部・動物など)",
        "fields": '"yomi"(ひらがな), "meaning"(小学生向け簡潔な意味),'
        ' "example"(例文)',
    },
    "ことわざ": {
        "target": 200,
        "desc": "中学受験・小学高学年で頻出のことわざ",
        "fields": '"yomi"(ひらがな), "meaning"(小学生向け簡潔な意味),'
        ' "example"(使い方の例)',
    },
    "漢字": {
        "target": 500,
        "desc": "中学受験頻出の漢字(漢検3-5級相当・5-6年配当+難読)",
        "fields": '"yomi"(音訓読み例:「リョ・おもんぱか(る)」形式),'
        ' "meaning"(字の意味・小学生向け),'
        ' "example"(その字を使う代表的な熟語2〜3個「考慮・配慮」形式)',
    },
}


def _load():
    if OUT.exists():
        return json.loads(OUT.read_text(encoding="utf-8"))
    return []


def _save(items):
    OUT.write_text(
        json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8"
    )


def _gen_batch(cat, desc, fields, n, existing_texts):
    avoid = "、".join(sorted(existing_texts)[:400])
    prompt = f"""{desc}を{n}個、JSON配列で出力してください。

条件:
- 有名すぎず・マイナーすぎず、テスト頻出度の高い順に
- 各項目は {{"text": "語句", {fields}, "level": "S"}} の形
- level は頻出度 S/A/B/C (Sが最頻出)
- meaning は小学生が一読で分かる一文で
- 出力はJSON配列のみ(前後の説明文・コードブロック禁止)

以下の語句は登録済みなので絶対に含めないでください:
{avoid or "(なし)"}"""
    data = ai_service._chat_json(prompt, temperature=0.5)
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                return v
        return []
    return data if isinstance(data, list) else []


def main():
    items = _load()
    by_cat = {}
    for it in items:
        by_cat.setdefault(it.get("cat"), set()).add(it.get("text"))

    for cat, cfg in CATEGORIES.items():
        have = len(by_cat.get(cat, set()))
        print(f"=== {cat}: 現在{have} / 目標{cfg['target']} ===")
        while len(by_cat.setdefault(cat, set())) < cfg["target"]:
            need = cfg["target"] - len(by_cat[cat])
            n = min(40, need)
            print(f"  生成中... (+{n})")
            try:
                got = _gen_batch(
                    cat, cfg["desc"], cfg["fields"], n, by_cat[cat]
                )
            except Exception as e:
                print(f"  エラー: {e} 30秒待機")
                time.sleep(30)
                continue
            added = 0
            for it in got:
                t = str(it.get("text") or "").strip()
                if (
                    not t
                    or t in by_cat[cat]
                    or not it.get("yomi")
                    or not it.get("meaning")
                ):
                    continue
                by_cat[cat].add(t)
                it["cat"] = cat
                it["id"] = f"{cat}-{len(items) + 1:04d}"
                items.append(it)
                added += 1
            print(f"  +{added}件 (計{len(by_cat[cat])})")
            _save(items)
            if added == 0:
                print("  追加分なし → このカテゴリを終了")
                break
            time.sleep(2)
    print(f"完了: 全{len(items)}件 -> {OUT}")


if __name__ == "__main__":
    main()
