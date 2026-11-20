/* 国語文法 - 語句学習アプリ (ターゲット1900式・部屋構成)
 * 静的SPA: items.json を読み込み、学習記録は localStorage に保存。
 * 記録ルール: ❌のあと連続2回⭕で克服。
 * 部屋: 辞書 / クイズ / テスト / 結果 / 実力テスト
 *   (各部屋に入ってからカテゴリを選択)
 */
"use strict";

const LS_PROGRESS = "kv_progress_v1";
const LS_OVERRIDE = "kv_item_override_v1";
const LS_RESULTS = "kv_results_v1";
const SEC_SIZE = 50; // ターゲット式の区切り

const ROOMS = [
  { key: "jisho", label: "辞書の部屋", icon: "📖",
    desc: "語句を引く・検索・定着度の確認" },
  { key: "quiz", label: "クイズの部屋", icon: "🃏",
    desc: "カードめくり・4択クイズで練習" },
  { key: "test", label: "テストの部屋", icon: "📝",
    desc: "本番形式・途中採点なしで実施" },
  { key: "result", label: "結果の部屋", icon: "📊",
    desc: "テストの履歴と間違いの確認" },
  { key: "power", label: "実力テストの部屋", icon: "🏆",
    desc: "全範囲からランダム出題" },
];

let ITEMS = [];          // items.json + 上書き
let PROGRESS = {};       // id -> {c, w, s, last}
let RESULTS = [];        // [{ts, cat, kind, n, ok, wrongIds}]
let OVERRIDES = {};      // id -> {text,yomi,meaning,example,image}
let view = { name: "home" };

// ---------- 永続化 ----------
function loadJSON(k, d) {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
}
function saveProgress() { localStorage.setItem(LS_PROGRESS, JSON.stringify(PROGRESS)); }
function saveResults() { localStorage.setItem(LS_RESULTS, JSON.stringify(RESULTS)); }
function saveOverrides() { localStorage.setItem(LS_OVERRIDE, JSON.stringify(OVERRIDES)); }

function applyOverrides() {
  for (const it of ITEMS) {
    const o = OVERRIDES[it.id];
    if (o) Object.assign(it, o);
  }
}

// ---------- 記録 ----------
function rec(id) { return PROGRESS[id] || { c: 0, w: 0, s: 0, last: "" }; }
function mark(id, ok) {
  const r = rec(id);
  if (ok) { r.c++; r.s++; } else { r.w++; r.s = 0; }
  r.last = new Date().toISOString();
  PROGRESS[id] = r; saveProgress();
}
function statusOf(id) {
  const r = rec(id);
  if (r.c === 0 && r.w === 0) return "new";
  if (r.w > 0 && r.s < 2) return "weak";   // ❌のあと連続2回⭕未満
  if (r.w > 0) return "master";
  return "good";
}
const STATUS_JP = { new: "未", weak: "苦手", master: "克服", good: "順調" };
const STATUS_BADGE = {
  new: '<span class="badge new">未</span>',
  weak: '<span class="badge ng">苦手</span>',
  master: '<span class="badge ok">克服</span>',
  good: '<span class="badge ok">順調</span>',
};

// ---------- ユーティリティ ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }
function cats() { return [...new Set(ITEMS.map(i => i.cat))]; }
function byCat(cat) { return ITEMS.filter(i => !cat || i.cat === cat); }
function sections(cat) {
  const n = byCat(cat).length;
  return Array.from({ length: Math.max(1, Math.ceil(n / SEC_SIZE)) }, (_, i) => i);
}
function pool(cat, sec, filt) {
  let p = byCat(cat);
  if (sec != null) p = p.slice(sec * SEC_SIZE, (sec + 1) * SEC_SIZE);
  if (filt === "weak") p = p.filter(i => statusOf(i.id) === "weak");
  else if (filt === "new") p = p.filter(i => statusOf(i.id) === "new");
  else if (filt === "notmaster") p = p.filter(i => statusOf(i.id) !== "master");
  return p;
}
function secLabel(cat, i) {
  const p = byCat(cat);
  const a = i * SEC_SIZE + 1, b = Math.min((i + 1) * SEC_SIZE, p.length);
  return `${a}〜${b}番`;
}

// ---------- 描画ルート ----------
function render() {
  document.querySelectorAll(".navbtn").forEach(b =>
    b.classList.toggle("on", b.dataset.nav === view.room));
  const el = $("#app");
  const v = view.name;
  if (v === "home") el.innerHTML = vHome();
  else if (v === "catpick") el.innerHTML = vCatPick();
  else if (v === "unitpick") el.innerHTML = vUnitPick();
  else if (v === "quizsetup") el.innerHTML = vQuizSetup();
  else if (v === "card") el.innerHTML = vCard();
  else if (v === "quizrun") el.innerHTML = vQuizRun();
  else if (v === "quizend") el.innerHTML = vQuizEnd();
  else if (v === "testsetup") el.innerHTML = vTestSetup();
  else if (v === "testrun") el.innerHTML = vTestRun();
  else if (v === "testend") el.innerHTML = vTestEnd();
  else if (v === "result") el.innerHTML = vResult();
  else if (v === "resultdetail") el.innerHTML = vResultDetail();
  else if (v === "list") el.innerHTML = vList();
  else if (v === "edit") el.innerHTML = vEdit();
  else if (v === "data") el.innerHTML = vData();
}
function go(name, params = {}) { view = { name, ...params }; render(); window.scrollTo(0, 0); }

// ---------- ホーム(部屋の入口) ----------
function vHome() {
  const rooms = ROOMS.map((r, i) =>
    `<div class="card catcard" data-nav="${r.key}">
      <div class="roomico r${i}">${r.icon}</div>
      <div class="ttl">${r.label}</div>
      <p class="muted">${r.desc}</p>
    </div>`).join("");
  const stats = cats().map(cat => {
    const p = byCat(cat);
    const st = { new: 0, weak: 0, master: 0, good: 0 };
    p.forEach(i => st[statusOf(i.id)]++);
    const learned = p.length - st.new;
    const pct = Math.round(learned / p.length * 100);
    return `<div class="card">
      <div class="ttl">${esc(cat)} <span class="muted">${p.length}件</span></div>
      <div class="progress">${Array.from({ length: 20 }, (_, i) =>
        `<i class="${i < Math.round(pct / 5) ? "f" : ""}"></i>`).join("")}</div>
      <div class="statrow">
        <div class="stat"><b>${learned}</b><span>学習済 ${pct}%</span></div>
        <div class="stat"><b style="color:var(--ng)">${st.weak}</b><span>苦手</span></div>
        <div class="stat"><b style="color:var(--ok)">${st.master}</b><span>克服</span></div>
      </div>
    </div>`;
  }).join("");
  return `<h2>語句学習</h2>
    <p class="muted">❌のあと連続2回⭕で「克服」になります。記録はこの端末に保存されます。</p>
    <div class="grid2">${rooms}</div>
    <hr><h2>学習状況</h2><div class="grid2">${stats}</div>
    <p class="right"><button class="ghost" data-nav="data">データ管理 →</button></p>`;
}

// ---------- カテゴリ選択(全部屋共通) ----------
function vCatPick() {
  const room = ROOMS.find(r => r.key === view.room);
  const opts = view.allowAll ? '<option value="">全カテゴリ</option>' : "";
  return `<div class="card">
    <h2>${room.icon} ${room.label}</h2>
    <p class="muted">${room.desc}。カテゴリを選んでください。</p>
    <div class="choices">
      ${cats().map(c =>
        `<button class="choice" data-act="cat" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      ${view.allowAll ? '<button class="choice" data-act="cat" data-cat="">全カテゴリ</button>' : ""}
    </div>
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

// ---------- 単元選択(50件区切り・達成度つき) ----------
function vUnitPick() {
  const room = ROOMS.find(r => r.key === view.room);
  const cat = view.cat;
  const p = byCat(cat);
  // 最初に「習得途中/未習得」がある単元をおすすめにする
  let recommend = -1;
  const rows = sections(cat).map(i => {
    const blk = p.slice(i * SEC_SIZE, (i + 1) * SEC_SIZE);
    const st = { new: 0, weak: 0, master: 0, good: 0 };
    blk.forEach(it => st[statusOf(it.id)]++);
    const learned = blk.length - st.new;
    const done = st.master + st.good;
    const pct = Math.round(done / blk.length * 100);
    const cleared = learned === blk.length && st.weak === 0;
    if (recommend < 0 && !cleared) recommend = i;
    return { i, blk, st, learned, done, pct, cleared };
  }).map(({ i, st, learned, done, pct, cleared }) => `
    <div class="unit ${cleared ? "cleared" : ""}" data-act="unit" data-sec="${i}">
      <div class="unit-head">
        <b>単元 ${i + 1}</b>
        <span class="muted">${i * SEC_SIZE + 1}〜${Math.min((i + 1) * SEC_SIZE, p.length)}番</span>
        ${i === recommend ? '<span class="badge new">おすすめ</span>' : ""}
        ${cleared ? '<span class="badge ok">クリア</span>' : ""}
      </div>
      <div class="progress">${Array.from({ length: 20 }, (_, k) =>
        `<i class="${k < Math.round(pct / 5) ? "f" : ""}"></i>`).join("")}</div>
      <div class="muted small">習得 ${pct}%(克服${st.master}+順調${st.good}/${p.slice(i * SEC_SIZE, (i + 1) * SEC_SIZE).length})
        ${st.weak ? `・<span style="color:var(--ng)">苦手${st.weak}</span>` : ""}${st.new ? `・未${st.new}` : ""}</div>
    </div>`).join("");
  return `<div class="card">
    <h2>${room.icon} ${room.label} — ${esc(cat)}</h2>
    <p class="muted">50件ごとの単元を選んでください。順番に習得していくのがおすすめです。</p>
    ${rows}
    <div class="btnrow"><button class="ghost" data-act="back">← カテゴリ選択へ</button></div>
  </div>`;
}

// ---------- クイズの部屋(設定 → カード/4択) ----------
function vQuizSetup() {
  const cat = view.cat;
  return `<div class="card">
    <h2>🃏 クイズの部屋 — ${esc(cat)} 単元${view.sec + 1}</h2>
    <p class="muted">範囲: ${secLabel(cat, view.sec)}</p>
    <input type="hidden" id="q_sec" value="${view.sec}">
    <label class="f">形式</label>
    <select id="q_mode">
      <option value="card">カードめくり(自学習)</option>
      <option value="m2t">意味 → 語句を選ぶ(4択)</option>
      <option value="t2y">語句 → 読みを選ぶ(4択)</option>
      <option value="y2t">読み → 語句を選ぶ(4択)</option>
    </select>
    <label class="f">対象</label>
    <select id="q_filt">
      <option value="">すべて</option>
      <option value="new">未学習のみ</option>
      <option value="weak">苦手のみ</option>
      <option value="notmaster">克服していないもの</option>
    </select>
    <label class="f">問数(4択の場合)</label>
    <select id="q_n"><option>10</option><option selected>20</option><option>30</option><option value="all">全部</option></select>
    <label class="f">順番(カードの場合)</label>
    <select id="q_order"><option value="">登録順</option><option value="rand">ランダム</option></select>
    <div class="btnrow"><button class="primary big" id="q_go">開始</button></div>
    <div class="btnrow"><button class="ghost" data-act="back">← 単元選択へ</button></div>
  </div>`;
}

// ---------- カード ----------
let cardSet = { list: [], idx: 0, flipped: false };

function vCard() {
  const { list, idx, flipped } = cardSet;
  if (!list.length) return `<div class="card"><p>対象の項目がありません。</p>
    <button data-nav="home">ホームへ</button></div>`;
  const it = list[idx];
  const st = statusOf(it.id);
  const front = `<div class="flash" data-act="flip">
      <div class="muted">${idx + 1} / ${list.length}　${esc(it.cat)} ${STATUS_BADGE[st]}</div>
      <div class="surface">${esc(it.text)}</div>
      <div class="hint">${flipped ? "" : "タップで答えを表示"}</div>
    </div>`;
  const side = `<div class="card side">
      ${it.image ? `<img class="imgbox" src="${esc(it.image)}" alt="">` : ""}
      ${flipped ? `
        <div class="yomi" style="font-size:20px;color:var(--acc)">${esc(it.yomi)}</div>
        <p><b>意味:</b> ${esc(it.meaning)}</p>
        ${it.example ? `<p class="muted"><b>例:</b> ${esc(it.example)}</p>` : ""}
        ${it.level ? `<span class="badge new">頻出度 ${esc(it.level)}</span>` : ""}
      ` : `<p class="muted">カードをめくると、読み・意味・例文がここに表示されます。</p>`}
    </div>`;
  const btns = flipped ? `
    <div class="btnrow">
      <button data-act="mark" data-ok="0" style="border-color:var(--ng);color:var(--ng)">✕ まだ</button>
      <button data-act="mark" data-ok="1" class="primary" style="background:#16a34a;border-color:#16a34a">◯ 覚えた</button>
    </div>` : `
    <div class="btnrow">
      <button data-act="flip" class="primary">答えを見る</button>
      <button data-act="skip">スキップ →</button>
      <button class="ghost" data-act="back">やめる</button>
    </div>`;
  return `<div class="panes"><div>${front}${btns}</div>${side}</div>`;
}

// ---------- 4択クイズ ----------
let quiz = null; // {list, idx, mode, answers:[{id,ok}], judged, pool, cat}

function makeChoices(it, mode, poolAll) {
  const key = mode === "t2y" ? "yomi" : "text";
  const cand = shuffle(poolAll.filter(x => x.id !== it.id && x[key] && x[key] !== it[key]));
  const picks = [it[key]];
  for (const c of cand) { if (picks.length >= 4) break; if (!picks.includes(c[key])) picks.push(c[key]); }
  return { options: shuffle(picks.slice(0, 4)), answer: it[key] };
}

function qPrompt(it, mode) {
  if (mode === "m2t") return `<div class="q-prompt"><b>意味:</b> ${esc(it.meaning)}</div>`;
  if (mode === "t2y") return `<div class="q-surface">${esc(it.text)}</div><div class="center muted">読み方を選んでください</div>`;
  return `<div class="q-surface">${esc(it.yomi)}</div><div class="center muted">この読みの語句を選んでください</div>`;
}

function vQuizRun() {
  const { list, idx, mode } = quiz;
  const it = list[idx];
  const { options, answer } = makeChoices(it, mode, quiz.pool);
  quiz.cur = { answer, options };
  const judged = quiz.judged;
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="answer" data-i="${i}">${esc(o)}</button>`).join("");
  const side = `<div class="card side">
      ${it.image ? `<img class="imgbox" src="${esc(it.image)}" alt="">` : ""}
      ${judged ? `
        <div class="yomi" style="font-size:20px;color:var(--acc)">${esc(it.yomi)}</div>
        <p><b>${esc(it.text)}</b> — ${esc(it.meaning)}</p>
        ${it.example ? `<p class="muted"><b>例:</b> ${esc(it.example)}</p>` : ""}
      ` : `<p class="muted">答えると、語句の詳細がここに表示されます。</p>`}
    </div>`;
  return `<div class="panes"><div>
      <div class="muted">${idx + 1} / ${list.length}　${esc(it.cat)}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${judged
        ? `<div class="judge ${judged.ok ? "ok" : "ng"}">${judged.ok ? "⭕" : "❌"}</div>
           <p class="center"><b>${esc(it.text)}</b>（${esc(it.yomi)}）</p>
           ${qPrompt(it, mode)}
           <div class="btnrow"><button class="primary big" data-act="nextq">${idx + 1 < list.length ? "次へ" : "結果を見る"}</button></div>`
        : `${qPrompt(it, mode)}<div class="choices">${opts}</div>
           <div class="btnrow"><button class="ghost" data-act="back">やめる</button></div>`}
    </div>${side}</div>`;
}

function vQuizEnd() {
  const ok = quiz.answers.filter(a => a.ok).length;
  const wrongs = quiz.answers.filter(a => !a.ok)
    .map(a => ITEMS.find(i => i.id === a.id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(it.text)}</span>
     <span class="y">${esc(it.yomi)}</span><span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <h2>結果: ${ok} / ${quiz.answers.length} 問正解</h2>
    ${wrongs.length ? `<h3>間違えた問題 (${wrongs.length})</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="retry">間違えた問題だけやり直す</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow">
      <button data-act="room" data-room="quiz" data-cat="${esc(quiz.cat)}">クイズの部屋へ</button>
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- テストの部屋(本番形式・途中採点なし) ----------
function vTestSetup() {
  const cat = view.cat;
  const power = view.room === "power";
  return `<div class="card">
    <h2>${power ? "🏆 実力テストの部屋" : "📝 テストの部屋"} — ${esc(cat || "全カテゴリ")}${power ? "" : ` 単元${view.sec + 1}`}</h2>
    ${power ? '<p class="muted">全範囲からランダム出題します。実力判定用です。</p>' : `<p class="muted">範囲: ${secLabel(cat, view.sec)}</p>`}
    <input type="hidden" id="t_sec" value="${power ? "" : view.sec}">
    <label class="f">出題形式</label>
    <select id="t_mode">
      <option value="m2t">意味 → 語句を選ぶ(4択)</option>
      <option value="t2y">語句 → 読みを選ぶ(4択)</option>
      <option value="y2t">読み → 語句を選ぶ(4択)</option>
    </select>
    ${power ? "" : `<label class="f">対象</label>
    <select id="t_filt">
      <option value="">すべて</option>
      <option value="weak">苦手のみ</option>
      <option value="new">未学習のみ</option>
    </select>`}
    <label class="f">問数</label>
    <select id="t_n">
      <option>10</option><option ${power ? "selected" : ""}>20</option>
      <option ${power ? "" : "selected"}>30</option><option>50</option>
      ${power ? '<option value="all">全部</option>' : ""}
    </select>
    <div class="btnrow"><button class="primary big" id="t_go">テスト開始</button></div>
    <div class="btnrow"><button class="ghost" data-act="back">${power ? "← カテゴリ選択へ" : "← 単元選択へ"}</button></div>
  </div>`;
}

let test = null; // {list, idx, mode, answers, cur, cat, kind}

function vTestRun() {
  const { list, idx, mode } = test;
  const it = list[idx];
  const { options, answer } = makeChoices(it, mode, test.pool);
  test.cur = { answer, options };
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="tanswer" data-i="${i}">${esc(o)}</button>`).join("");
  return `<div class="panes"><div>
      <div class="muted">${test.kind === "power" ? "🏆 実力テスト" : "📝 テスト"}　${idx + 1} / ${list.length}　${esc(it.cat)}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${qPrompt(it, mode)}
      <div class="choices">${opts}</div>
      <div class="btnrow"><button class="ghost" data-act="back">やめる</button></div>
    </div>
    <div class="card side"><p class="muted">本番形式: 答えはテスト終了後にまとめて表示されます。</p></div>
  </div>`;
}

function vTestEnd() {
  const ok = test.answers.filter(a => a.ok).length;
  const wrongs = test.answers.filter(a => !a.ok)
    .map(a => ITEMS.find(i => i.id === a.id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(it.text)}</span>
     <span class="y">${esc(it.yomi)}</span><span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <h2>${test.kind === "power" ? "実力テスト" : "テスト"}結果: ${ok} / ${test.answers.length} 問正解</h2>
    ${wrongs.length ? `<h3>間違えた問題 (${wrongs.length})</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="tretry">間違えた問題だけクイズで練習</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow">
      <button data-act="room" data-room="${test.kind}">もう一度</button>
      <button data-nav="result">結果の部屋へ</button>
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- 結果の部屋 ----------
const KIND_JP = { test: "テスト", power: "実力テスト" };
function vResult() {
  const rows = RESULTS.slice().reverse().map((r, ri) => {
    const idx = RESULTS.length - 1 - ri;
    const d = new Date(r.ts);
    const dt = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const pct = Math.round(r.ok / r.n * 100);
    return `<div class="listrow" data-act="rdetail" data-i="${idx}" style="cursor:pointer">
      <span class="t">${r.ok}/${r.n}</span>
      <span class="y">${KIND_JP[r.kind] || r.kind} ${esc(r.cat)}</span>
      <span class="m">${dt}・${pct}%・間違い${r.wrongIds.length}問</span>
    </div>`;
  }).join("");
  return `<div class="card">
    <h2>📊 結果の部屋</h2>
    <p class="muted">テストの部屋・実力テストの部屋で実施した記録です。</p>
    ${rows || "<p>まだ記録がありません。</p>"}
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

function vResultDetail() {
  const r = RESULTS[view.idx];
  if (!r) return `<div class="card">記録がありません</div>`;
  const d = new Date(r.ts);
  const dt = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const wrongs = r.wrongIds.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(it.text)}</span>
     <span class="y">${esc(it.yomi)}</span><span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <h2>${KIND_JP[r.kind] || r.kind}: ${r.ok}/${r.n} 問正解</h2>
    <p class="muted">${dt}・${esc(r.cat)}</p>
    ${wrongs.length ? `<h3>間違えた問題</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="rretry" data-i="${view.idx}">間違えた問題だけクイズで練習</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow"><button data-act="rdel" data-i="${view.idx}">この記録を削除</button>
    <button data-nav="result">戻る</button></div>
  </div>`;
}

// ---------- 辞書の部屋(一覧・検索) ----------
function vList() {
  const cat = view.cat || "";
  const kw = (view.kw || "").toLowerCase();
  const filt = view.filt || "";
  let p = byCat(cat || null);
  if (kw) p = p.filter(i =>
    `${i.text}${i.yomi}${i.meaning}${i.example || ""}`.toLowerCase().includes(kw));
  if (filt) p = p.filter(i => statusOf(i.id) === filt);
  const rows = p.slice(0, 500).map(it =>
    `<div class="listrow" data-act="edit" data-id="${it.id}" style="cursor:pointer">
      <span class="t">${esc(it.text)}${STATUS_BADGE[statusOf(it.id)]}</span>
      <span class="y">${esc(it.yomi)}</span>
      <span class="m">${esc(it.meaning)}</span>
    </div>`).join("");
  return `<div class="card">
    <h2>📖 辞書の部屋</h2>
    <div class="btnrow" style="margin-top:0">
      <select id="l_cat"><option value="">全カテゴリ</option>
        ${cats().map(c => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="l_filt"><option value="">全状態</option>
        ${["new", "weak", "master", "good"].map(s =>
          `<option value="${s}" ${s === filt ? "selected" : ""}>${STATUS_JP[s]}</option>`).join("")}</select>
      <input type="text" id="l_kw" placeholder="検索(語句・読み・意味)" value="${esc(view.kw || "")}">
    </div>
    <p class="muted">${p.length}件${p.length > 500 ? " (先頭500件表示)" : ""} — タップで詳細・編集</p>
    ${rows || "<p>該当なし</p>"}
  </div>`;
}

function vEdit() {
  const it = ITEMS.find(i => i.id === view.id);
  if (!it) return `<div class="card">見つかりません</div>`;
  return `<div class="panes"><div class="card">
    <h2>項目の編集 ${STATUS_BADGE[statusOf(it.id)]}</h2>
    <label class="f">語句(表記)</label><input type="text" id="e_text" value="${esc(it.text)}">
    <label class="f">読み</label><input type="text" id="e_yomi" value="${esc(it.yomi)}">
    <label class="f">意味</label><textarea id="e_meaning" rows="2">${esc(it.meaning)}</textarea>
    <label class="f">例文・例</label><textarea id="e_example" rows="2">${esc(it.example || "")}</textarea>
    <label class="f">頻出度</label><input type="text" id="e_level" value="${esc(it.level || "")}">
    <div class="btnrow">
      <button class="primary" id="e_save">保存</button>
      <button data-act="delprog">学習記録をリセット</button>
      <button data-nav="jisho">戻る</button>
    </div>
  </div>
  <div class="card side">
    ${it.image ? `<img class="imgbox" src="${esc(it.image)}" alt="">` : ""}
    <p><b>${esc(it.text)}</b>（${esc(it.yomi)}）</p>
    <p><b>意味:</b> ${esc(it.meaning)}</p>
    ${it.example ? `<p class="muted"><b>例:</b> ${esc(it.example)}</p>` : ""}
  </div></div>`;
}

// ---------- データ管理 ----------
function vData() {
  const total = Object.keys(PROGRESS).length;
  return `<div class="card">
    <h2>データ管理</h2>
    <p class="muted">問題データ ${ITEMS.length}件 / 記録のある項目 ${total}件 / テスト履歴 ${RESULTS.length}件</p>
    <h3>学習記録</h3>
    <div class="btnrow">
      <button id="d_export">記録をエクスポート(JSON)</button>
      <button id="d_import">記録をインポート</button>
      <input type="file" id="d_file" accept=".json" style="display:none">
      <button id="d_reset" style="border-color:var(--ng);color:var(--ng)">記録を全消去</button>
    </div>
    <hr>
    <h3>項目の修正内容</h3>
    <p class="muted">辞書で編集した項目: ${Object.keys(OVERRIDES).length}件
      <button class="ghost" id="d_ovexport">修正をエクスポート</button></p>
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

// ---------- イベント ----------
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    const k = nav.dataset.nav;
    if (k === "home" || k === "data") go(k === "data" ? "data" : "home", { room: k });
    else if (k === "jisho") go("list", { room: "jisho" });
    else if (k === "result") go("result", { room: "result" });
    else go("catpick", { room: k, allowAll: k === "power" });
    return;
  }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "cat") {
      const room = view.room;
      if (room === "power") go("testsetup", { cat: a.dataset.cat || null, room });
      else go("unitpick", { cat: a.dataset.cat, room });
    }
    else if (act === "unit") {
      const room = view.room;
      if (room === "quiz") go("quizsetup", { cat: view.cat, room, sec: +a.dataset.sec });
      else go("testsetup", { cat: view.cat, room, sec: +a.dataset.sec });
    }
    else if (act === "back") {
      if (view.name === "quizsetup" || view.name === "testsetup") {
        if (view.room === "power") go("catpick", { room: "power", allowAll: true });
        else go("unitpick", { cat: view.cat, room: view.room });
      } else if (view.name === "unitpick") {
        go("catpick", { room: view.room, allowAll: false });
      } else go("home");
    }
    else if (act === "room") {
      const room = a.dataset.room;
      go("catpick", { room, allowAll: room === "power" });
    }
    else if (act === "flip") { cardSet.flipped = !cardSet.flipped; render(); }
    else if (act === "skip") { cardSet.flipped = false; cardSet.idx++; render(); }
    else if (act === "mark") {
      mark(cardSet.list[cardSet.idx].id, a.dataset.ok === "1");
      cardSet.flipped = false; cardSet.idx++; render();
      if (cardSet.idx >= cardSet.list.length) toast("このセットは完了です");
    }
    else if (act === "answer") {
      const pick = quiz.cur.options[+a.dataset.i];
      const ok = pick === quiz.cur.answer;
      quiz.judged = { ok };
      quiz.answers.push({ id: quiz.list[quiz.idx].id, ok });
      mark(quiz.list[quiz.idx].id, ok);
      document.querySelectorAll(".choice").forEach((b, i) => {
        const v = quiz.cur.options[i];
        if (v === quiz.cur.answer) b.classList.add("hit");
        else if (i === +a.dataset.i) b.classList.add("miss");
        b.disabled = true;
      });
      setTimeout(render, 10);
    }
    else if (act === "nextq") {
      quiz.judged = null; quiz.idx++;
      if (quiz.idx >= quiz.list.length) go("quizend"); else render();
    }
    else if (act === "retry") {
      const wrongs = quiz.answers.filter(x => !x.ok)
        .map(x => ITEMS.find(i => i.id === x.id)).filter(Boolean);
      quiz = { ...quiz, list: wrongs, idx: 0, answers: [], judged: null };
      render();
    }
    else if (act === "tanswer") {
      const pick = test.cur.options[+a.dataset.i];
      const ok = pick === test.cur.answer;
      test.answers.push({ id: test.list[test.idx].id, ok });
      mark(test.list[test.idx].id, ok);
      test.idx++;
      if (test.idx >= test.list.length) {
        RESULTS.push({
          ts: new Date().toISOString(), cat: test.cat || "全カテゴリ",
          kind: test.kind, n: test.answers.length,
          ok: test.answers.filter(x => x.ok).length,
          wrongIds: test.answers.filter(x => !x.ok).map(x => x.id),
        });
        saveResults();
        go("testend");
      } else render();
    }
    else if (act === "tretry" || act === "rretry") {
      let ids;
      if (act === "tretry") ids = test.answers.filter(x => !x.ok).map(x => x.id);
      else ids = (RESULTS[+a.dataset.i] || { wrongIds: [] }).wrongIds;
      const wrongs = ids.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);
      if (!wrongs.length) { toast("対象がありません"); return; }
      quiz = { list: wrongs, idx: 0, mode: "m2t", answers: [], judged: null,
        pool: ITEMS, cat: wrongs[0].cat };
      go("quizrun");
    }
    else if (act === "rdetail") go("resultdetail", { idx: +a.dataset.i, room: "result" });
    else if (act === "rdel") {
      if (confirm("この記録を削除しますか？")) {
        RESULTS.splice(+a.dataset.i, 1); saveResults(); go("result");
      }
    }
    else if (act === "edit") go("edit", { id: a.dataset.id, room: "jisho" });
    else if (act === "delprog") {
      if (confirm("この項目の学習記録をリセットしますか？")) {
        delete PROGRESS[view.id]; saveProgress(); toast("リセットしました"); render();
      }
    }
  }
  if (e.target.id === "q_go") {
    const mode = $("#q_mode").value,
      sec = $("#q_sec").value,
      filt = $("#q_filt").value,
      n = $("#q_n").value,
      order = $("#q_order").value;
    let p = pool(view.cat || null, sec === "" ? null : +sec, filt);
    if (mode === "card") {
      if (order === "rand") p = shuffle([...p]);
      cardSet = { list: p, idx: 0, flipped: false };
      if (!p.length) { toast("対象の項目がありません"); return; }
      go("card"); return;
    }
    p = shuffle([...p]);
    if (n !== "all") p = p.slice(0, +n);
    if (p.length < 4) { toast("4件以上必要です"); return; }
    quiz = { list: p, idx: 0, mode, answers: [], judged: null,
      pool: byCat(view.cat || null).length >= 4 ? byCat(view.cat || null) : ITEMS,
      cat: view.cat || "全カテゴリ" };
    go("quizrun");
  }
  if (e.target.id === "t_go") {
    const mode = $("#t_mode").value, n = $("#t_n").value;
    const power = view.room === "power";
    let p;
    if (power) p = shuffle([...byCat(view.cat || null)]);
    else {
      const sec = $("#t_sec").value, filt = $("#t_filt").value;
      p = shuffle([...pool(view.cat, sec === "" ? null : +sec, filt)]);
    }
    if (n !== "all") p = p.slice(0, +n);
    if (p.length < 4) { toast("4件以上必要です"); return; }
    test = { list: p, idx: 0, mode, answers: [],
      pool: byCat(view.cat || null).length >= 4 ? byCat(view.cat || null) : ITEMS,
      cat: view.cat || "全カテゴリ", kind: power ? "power" : "test" };
    go("testrun");
  }
  if (e.target.id === "e_save") {
    const it = ITEMS.find(i => i.id === view.id);
    OVERRIDES[view.id] = {
      text: $("#e_text").value.trim(), yomi: $("#e_yomi").value.trim(),
      meaning: $("#e_meaning").value.trim(), example: $("#e_example").value.trim(),
      level: $("#e_level").value.trim(),
    };
    Object.assign(it, OVERRIDES[view.id]);
    saveOverrides(); toast("保存しました"); go("list", { room: "jisho" });
  }
  if (e.target.id === "d_export") {
    const blob = new Blob([JSON.stringify({ progress: PROGRESS, results: RESULTS, overrides: OVERRIDES }, null, 1)],
      { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "kokugo_progress.json"; a2.click();
  }
  if (e.target.id === "d_import") $("#d_file").click();
  if (e.target.id === "d_reset") {
    if (confirm("学習記録・テスト履歴をすべて消去しますか？")) {
      PROGRESS = {}; RESULTS = []; saveProgress(); saveResults();
      toast("消去しました"); render();
    }
  }
  if (e.target.id === "d_ovexport") {
    const blob = new Blob([JSON.stringify(OVERRIDES, null, 1)], { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "kokugo_item_overrides.json"; a2.click();
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "l_cat") { view.cat = e.target.value; render(); }
  if (e.target.id === "l_filt") { view.filt = e.target.value; render(); }
  if (e.target.id === "d_file" && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.progress) PROGRESS = d.progress;
        if (d.results) RESULTS = d.results;
        if (d.overrides) { OVERRIDES = d.overrides; applyOverrides(); saveOverrides(); }
        saveProgress(); saveResults(); toast("インポートしました"); render();
      } catch { toast("読み込めませんでした"); }
    };
    r.readAsText(e.target.files[0]);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "l_kw") { view.kw = e.target.value; render(); }
});
document.getElementById("brand").addEventListener("click", () => go("home"));

// ---------- 起動 ----------
async function boot() {
  PROGRESS = loadJSON(LS_PROGRESS, {});
  RESULTS = loadJSON(LS_RESULTS, []);
  OVERRIDES = loadJSON(LS_OVERRIDE, {});
  try {
    ITEMS = await (await fetch("items.json")).json();
  } catch {
    ITEMS = [];
    document.querySelector("#app").innerHTML =
      '<div class="card"><p>items.json を読み込めません。データ生成後に再読み込みしてください。</p></div>';
    return;
  }
  applyOverrides();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
