# -*- coding: utf-8 -*-
"""漢検公式の過去問PDF(画像)から 読み+書き の語句と読みをAI視覚で抽出。
大問(読み/書き)ごとに分けて呼び出し、省略を防ぐ。"""
import io, json, sys, time
from pathlib import Path
import fitz
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
GEKOKUJO = Path(r"C:\Users\nishida\gekokujo_test_app")
load_dotenv(GEKOKUJO / ".env")
sys.path.insert(0, str(GEKOKUJO))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import ai_service

DATA = BASE / "tools" / "data"
OUT = DATA / "kanken_real.json"

SEC_DESC = {
    "yomi": ("漢字・熟語の読み方を答える大問(問題は文の中に下線や太字の"
             "対象語句があり、解答にはひらがなの読みがある)",
             "問題中の対象語句(下線・太字の部分だけ。助詞・文脈の語は含めない)を text に、"
             "解答のひらがなを yomi に"),
    "kaki": ("ひらがなの読みを見て漢字を書く大問(問題にはひらがな、"
             "解答には漢字がある)",
             "問題のひらがなを yomi に、解答の漢字語句を text に"),
}

PROMPT = """最初の画像は漢検{g}級の検定問題、後の画像はその標準解答です。
「{desc}」の問題を**すべて**抽出してください(通常この大問には15〜30問あります。省略・抜けは厳禁。1問も残さず全部出してください)。

各項目 {{"text": "...", "yomi": "..."}} を JSONオブジェクト {{"items": [...]}} のみで出力。
- {rule}
- 語句・読みは送り仮名・助詞の扱いを問題通りに
- text は必ず2〜8文字程度の語句であり、文や長い句ではないこと
- 問題と解答は順序と内容で慎重に対応づけること"""


def pdf_pngs(path):
    d = fitz.open(str(path))
    return [p.get_pixmap(dpi=120).tobytes("png") for p in d]


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


KANA = set("ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔー")
KJ = __import__("re").compile(r"[一-龯]")


PART = set("をにがはへとのでもやか")
def clean(xs, sec):
    out, seen = [], set()
    for x in xs:
        t = str(x.get("text", "")).strip()
        y = str(x.get("yomi", "")).strip()
        if not t or not y or not KJ.search(t):
            continue
        if not all(c in KANA for c in y):
            continue
        # 文・助詞付きの断片を除外
        if len(t) > 10 or "。" in t or " " in t or "　" in t:
            continue
        if t[-1] in PART and len(t) > 3:
            continue
        key = (t, y)
        if key in seen:
            continue
        seen.add(key)
        out.append({"text": t, "yomi": y, "src": sec})
    return out


def main():
    out = {}
    if OUT.exists():
        out = json.loads(OUT.read_text(encoding="utf-8"))
    for g in (4,):
        imgs = pdf_pngs(DATA / f"kanken_{g}m_3.pdf") + \
               pdf_pngs(DATA / f"kanken_{g}k_3.pdf")
        for sec in ("yomi", "kaki"):
            desc, rule = SEC_DESC[sec]
            print(f"=== {g}級 {sec} ===", flush=True)
            xs = ask(imgs, PROMPT.format(g=g, desc=desc, rule=rule))
            items = clean(xs, sec)
            print(f"抽出{len(xs)}件 -> 採用{len(items)}件", flush=True)
            for x in items[:6]:
                print("  ", x["text"], "=", x["yomi"])
            key = f"{g}-{sec}"
            out[key] = items
            OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                           encoding="utf-8")
    print("完了")


main()
