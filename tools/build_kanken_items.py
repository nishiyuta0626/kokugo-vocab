# -*- coding: utf-8 -*-
"""検証済み漢検語に意味・例文を付与し items.json の漢字カテゴリを置き換える"""
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
CACHE = DATA / "kanken_meanings.json"
words = json.load(open(DATA / "kanken_words_verified.json", encoding="utf-8"))
meanings = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}

PROMPT = """以下は漢検(小学生レベル)で実際に出題された語句とその読みです。
各語句について、小学4〜6年生が理解できる簡単な日本語で
「意味」(30字以内)と「例文」(ひらがな交じり15〜25字、語句を使った自然な文)を作ってください。
語句・読みは変更しないでください。出力はJSONオブジェクト {{"items":[{{"text":"...","meaning":"...","example":"..."}}]}} のみ。"""


def gen_batch(batch):
    lines = "\n".join(f'{w["text"]} = {w["yomi"]}' for w in batch)
    for i in range(3):
        try:
            data = ai_service._chat_json(PROMPT + "\n\n" + lines, temperature=0.2)
            items = data.get("items") if isinstance(data, dict) else data
            if isinstance(items, list):
                got = {x.get("text"): x for x in items if isinstance(x, dict)}
                for w in batch:
                    g = got.get(w["text"])
                    if g and g.get("meaning") and g.get("example"):
                        meanings[w["text"]] = {
                            "meaning": str(g["meaning"]).strip(),
                            "example": str(g["example"]).strip(),
                        }
                return
        except Exception as e:
            print(f"  APIエラー: {str(e)[:120]}", flush=True)
            time.sleep(15 * (i + 1))
    print(f"  バッチ失敗({len(batch)}件)", flush=True)


B = 15
for i in range(0, len(words), B):
    batch = [w for w in words[i:i + B] if w["text"] not in meanings]
    if batch:
        print(f"{i + 1}-{min(i + B, len(words))}/{len(words)} 生成中...", flush=True)
        gen_batch(batch)
        CACHE.write_text(json.dumps(meanings, ensure_ascii=False, indent=1),
                         encoding="utf-8")
        time.sleep(1)

missing = [w["text"] for w in words if w["text"] not in meanings]
print(f"意味生成: {len(meanings)}/{len(words)}  未生成: {len(missing)}")
for t in missing:
    print("  未生成:", t)

# items.json の漢字を実際の漢検問題で置き換え
items = json.load(open(BASE / "items.json", encoding="utf-8"))
items = [x for x in items if x.get("cat") != "漢字"]
new = []
for n, w in enumerate(words, 1):
    m = meanings.get(w["text"])
    if not m:
        continue
    new.append({
        "text": w["text"], "yomi": w["yomi"],
        "meaning": m["meaning"], "example": m["example"],
        "level": "S", "cat": "漢字", "id": f"漢字-{n:04d}",
    })
items.extend(new)
(BASE / "items.json").write_text(
    json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"items.json: 漢字{len(new)}件に置き換え / 合計{len(items)}件")
