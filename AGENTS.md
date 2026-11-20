# 国語文法 - 語句学習アプリ

ターゲット1900式の語句学習PWA。ことわざ・慣用句・四字熟語・
中学受験頻出漢字を収録。ビルド不要の静的サイト(HTML/CSS/JSのみ)。

## 構成

- `index.html` / `style.css` / `app.js` — SPA本体(ビルド不要)
- `items.json` — 問題データ(tools/gen_items.py がAI生成)
- `manifest.json` / `sw.js` / `icon*` — PWA(オフライン動作)
- `tools/gen_items.py` — 問題データ生成(gekokujo_test_appのvenv + .envを借用)

## 起動(ローカル)

```powershell
cd C:\Users\nishida\kokugo_vocab
C:\Users\nishida\gekokujo_test_app\.venv\Scripts\python -m http.server 8080
# → http://localhost:8080
```

## デプロイ

GitHub Pages等の静的ホスティングにそのまま置ける。
学習記録は端末ごとのlocalStorage(kv_progress_v1)に保存。
項目修正はlocalStorage(kv_item_override_v1)に保存しitems.jsonを上書き適用。

## データ仕様

items.json: `[{id, cat, text, yomi, meaning, example, level, image?}]`
- cat: 四字熟語 / 慣用句 / ことわざ / 漢字
- level: 頻出度 S/A/B/C
- 克服ルール: ❌のあと連続2回⭕で克服(小春アプリと同じ)

## 関連プロジェクト

- 小春テスト管理アプリ: `C:\Users\nishida\gekokujo_test_app`(別プロジェクト)
- データ生成は同フォルダのvenv(gekokujo_test_app/.venv)と.env(GEMINI_API_KEY)を借りる
