# -*- coding: utf-8 -*-
"""高橋書店「頻出漢字学習ポスター」から過去問の語句+読みをAI視覚で抽出。"""
import io, json, sys, time
from pathlib import Path
import fitz
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
GEKOKUJO = Path(r"C:\Users\nishida\gekokujo_test_app")
load_dotenv(GEKKOKUJO := GEKOKUJO / ".env")
sys.path.insert(0, str(GEKKOKUJO.parent))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import ai_service

DATA = BASE / "tools" / "data"
OUT = DATA / "kanken_poster.json"

PROMPT = """これは漢検{g}級の「頻出漢字学習ポスター」です(過去問分析で頻出とされた漢字の一覧)。
各漢字について、掲載されている「よく出る問題」の語句とその読みを抽出してください。
問題が語句単体の場合はその語句、文中の一部の場合はその語句部分です。

各項目 {{"text": "漢字を含む語句", "yomi": "ひらがなの読み"}} を
JSONオブジェクト {{"items": [...]}} のみで出力。省略・抜け禁止。"""

KANA = set("ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔー")
KJ = __import__("re").compile(r"[一-龯]")


def ask(imgs, prompt, tries=3):
    for i in range(tries):
        try:
            data = ai_service._chat_json(prompt, images=imgs, temperature=0.1)
            if isinstance(data, dict):
                if isinstance(data.get("items"), list):
                    return data["items"]
                for v in data.values():
                    if isinstance(v, list):
                        return v
                return []
            return data if isinstance(data, list) else []
        except Exception as e:
            print(f"  APIエラー({i + 1}): {str(e)[:150]}", flush=True)
            time.sleep(20 * (i + 1))
    return []


def clean(xs):
    out, seen = [], set()
    for x in xs:
        t = str(x.get("text", "")).strip()
        y = str(x.get("yomi", "")).strip()
        if not t or not y or not KJ.search(t):
            continue
        if not all(c in KANA for c in y):
            continue
        if len(t) > 10 or "。" in t or " " in t or "　" in t:
            continue
        key = (t, y)
        if key in seen:
            continue
        seen.add(key)
        out.append({"text": t, "yomi": y})
    return out


def main():
    out = {}
    if OUT.exists():
        out = json.loads(OUT.read_text(encoding="utf-8"))
    files = {"5": "poster_5.pdf", "6": "poster_6.pdf", "7": "poster_7.pdf"}
    for g, fn in files.items():
        path = DATA / fn
        if not path.exists():
            continue
        d = fitz.open(str(path))
        imgs = [p.get_pixmap(dpi=150).tobytes("png") for p in d]
        print(f"=== {g}級ポスター {len(imgs)}p ===", flush=True)
        xs = ask(imgs, PROMPT.format(g=g))
        items = clean(xs)
        print(f"抽出{len(xs)}件 -> 採用{len(items)}件", flush=True)
        for x in items[:8]:
            print("  ", x["text"], "=", x["yomi"])
        out[g] = items
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                       encoding="utf-8")
    print("完了")


main()
