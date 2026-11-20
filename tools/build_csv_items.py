# -*- coding: utf-8 -*-
"""CSV(中学受験漢字795語)を検証済みリストからitems.jsonに統合。意味・例文をAI生成"""
import io, json, sys, time
from pathlib import Path
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
GEKOKUJO = Path(r"C:\Users\nishida\gekokujo_test_app")
load_dotenv(GEKOKUJO / ".env")
sys.path.insert(0, str(GEKOKUJO))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import ai_service

DATA = BASE / "tools" / "data"
CACHE = DATA / "csv_meanings.json"
words = json.load(open(DATA / "csv_words_verified.json", encoding="utf-8"))
# JMdict未収録だが正当な語を追加
words.append({"語句": "優しさ", "読み": "やさしさ"})
meanings = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}

PROMPT = """以下は中学受験レベルの漢字語句と読みです(小学高学年〜中学入試頻出)。
各語句について、小学5〜6年生が理解できる簡単な日本語で
「意味」(30字以内)を作ってください。例文は不要です。
語句・読みは変更しないでください。出力はJSONオブジェクト {{"items":[{{"text":"...","meaning":"..."}}]}} のみ。"""


def gen_batch(batch):
    lines = "\n".join(f'{w["語句"]} = {w["読み"]}' for w in batch)
    for i in range(3):
        try:
            data = ai_service._chat_json(PROMPT + "\n\n" + lines, temperature=0.2)
            items = data.get("items") if isinstance(data, dict) else data
            if isinstance(items, list):
                got = {x.get("text"): x for x in items if isinstance(x, dict)}
                for w in batch:
                    g = got.get(w["語句"])
                    if g and g.get("meaning"):
                        meanings[w["語句"]] = {
                            "meaning": str(g["meaning"]).strip(),
                        }
                return
        except Exception as e:
            print(f"  APIエラー: {str(e)[:120]}", flush=True)
            time.sleep(15 * (i + 1))
    print(f"  バッチ失敗({len(batch)}件)", flush=True)


B = 15
for i in range(0, len(words), B):
    batch = [w for w in words[i:i + B] if w["語句"] not in meanings]
    if batch:
        print(f"{i + 1}-{min(i + B, len(words))}/{len(words)} 生成中...", flush=True)
        gen_batch(batch)
        CACHE.write_text(json.dumps(meanings, ensure_ascii=False, indent=1),
                         encoding="utf-8")
        time.sleep(1)

missing = [w["語句"] for w in words if w["語句"] not in meanings]
print(f"意味生成: {len(meanings)}/{len(words)}  未生成: {len(missing)}")
for t in missing:
    print("  未生成:", t)

items = json.load(open(BASE / "items.json", encoding="utf-8"))
kj_max = max(int(x["id"].split("-")[1]) for x in items if x["cat"] == "漢字")
new = []
for w in words:
    m = meanings.get(w["語句"])
    if not m:
        continue
    kj_max += 1
    new.append({
        "text": w["語句"], "yomi": w["読み"],
        "meaning": m["meaning"], "example": "",
        "level": "S", "cat": "漢字", "id": f"漢字-{kj_max:04d}",
    })
# 既存漢字の直後に挿入(カテゴリ順を維持)
pos = max(i for i, x in enumerate(items) if x["cat"] == "漢字") + 1
items[pos:pos] = new
(BASE / "items.json").write_text(
    json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"items.json: 漢字+{len(new)}件 / 合計{len(items)}件")
