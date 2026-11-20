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
- cat: 四字熟語 / 慣用句 / ことわざ / 漢字 / 国語文法
- level: 頻出度 S/A/B/C
- 克服ルール: ❌のあと連続2回⭕で克服(小春アプリと同じ)

## 50日・4周プラン / stdm

- `kv_sched_v1`: {start, base, items:{id:{cc,w,fast,plat}}, days:{date:{clears,seen,quota,bonus}}}
  - cc 0〜4で周管理。1〜3周を全て正解かつ各3秒以内 → 💎プラチナ(4周目免除)
  - 1日ノルマ=その日初アクセス時に 残りクリア数÷残り日数 で確定。先取りで翌日以降が軽くなる
- `kv_earn_v1`: stdm増減履歴 {ts,day,amount,label}。10問セット+10 / ノルマ達成+100
- ホーム最上部のstdmカード: 残高カウントアップ表示・タップで獲得履歴(earnlog画面)

## 関連プロジェクト

- 小春テスト管理アプリ: `C:\Users\nishida\gekokujo_test_app`(別プロジェクト)
- データ生成は同フォルダのvenv(gekokujo_test_app/.venv)と.env(GEMINI_API_KEY)を借りる
