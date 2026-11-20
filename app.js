/* 国語文法 - 語句学習アプリ (ターゲット1900式・部屋構成)
 * 静的SPA: items.json を読み込み、学習記録は localStorage に保存。
 * 記録ルール: ❌のあと連続2回⭕で克服。
 * 部屋: 辞書 / クイズ / テスト / 結果 / 実力テスト
 * 単元: カテゴリごとに50件区切り(番号はカテゴリ内1始まり)
 * sdn: 実力テストの点数に応じてポイント付与
 */
"use strict";

const LS_PROGRESS = "kv_progress_v1";
const LS_OVERRIDE = "kv_item_override_v1";
const LS_RESULTS = "kv_results_v1";
const LS_SDN = "kv_sdn_v1";
const SEC_SIZE = 50;

const ROOMS = [
  { key: "jisho", label: "辞書の部屋", icon: "📖",
    desc: "語句を検索できます（実施中はロック）" },
  { key: "quiz", label: "クイズの部屋", icon: "🎯",
    desc: "番号範囲を選んでランダム4択クイズ" },
  { key: "test", label: "テストの部屋", icon: "🖊️",
    desc: "番号範囲を選んでまとめてテスト" },
  { key: "result", label: "結果の部屋", icon: "📊",
    desc: "過去の結果と間違えた語句の復習リスト" },
  { key: "power", label: "実力テストの部屋", icon: "🏆", gold: true,
    desc: "全範囲ランダム・点数に応じてsdn付与" },
];
const MODES = { m2t: "意味→語句", t2y: "語句→読み", y2t: "読み→語句" };
const KIND_JP = { quiz: "クイズ", test: "テスト", power: "実力テスト" };

let ITEMS = [];
let PROGRESS = {};   // id -> {c,w,s,last}
let RESULTS = [];    // {ts,kind,cat,range:[a,b],n,ok,wrongIds}
let OVERRIDES = {};
let SDN = 0;
let view = { name: "home" };
let quiz = null;     // {list,idx,mode,answers,judged,pool,cat,range}
let test = null;     // {list,idx,mode,answers,cur,pool,cat,range,kind}
let cardSet = { list: [], idx: 0, flipped: false };

// ---------- 永続化 ----------
function loadJSON(k, d) {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
}
const saveProgress = () => localStorage.setItem(LS_PROGRESS, JSON.stringify(PROGRESS));
const saveResults = () => localStorage.setItem(LS_RESULTS, JSON.stringify(RESULTS));
const saveOverrides = () => localStorage.setItem(LS_OVERRIDE, JSON.stringify(OVERRIDES));
const saveSdn = () => localStorage.setItem(LS_SDN, String(SDN));
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
  if (r.w > 0 && r.s < 2) return "weak";
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
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }
function cats() { return [...new Set(ITEMS.map(i => i.cat))]; }
function byCat(cat) { return ITEMS.filter(i => !cat || i.cat === cat); }
function fmtTs(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sdnAward(pct) { // 実力テストのsdn付与
  if (pct >= 100) return 1000;
  if (pct >= 90) return 500;
  if (pct >= 80) return 400;
  if (pct >= 70) return 300;
  if (pct >= 50) return 100;
  return 10;
}
// 単元(50件)ブロックの状態: gray未着手 / green習得 / blue普通 / orange要復習
function blockStat(blk) {
  const st = { new: 0, weak: 0, master: 0, good: 0 };
  blk.forEach(it => st[statusOf(it.id)]++);
  const done = st.master + st.good;
  if (st.new === blk.length) return { cls: "gray", label: "未着手", done, weak: st.weak };
  if (st.weak > 0) return { cls: "orange", label: "要復習", done, weak: st.weak };
  if (done === blk.length) return { cls: "green", label: "習得", done, weak: 0 };
  return { cls: "blue", label: "普通", done, weak: st.weak };
}

// ---------- 描画 ----------
function render() {
  const inRoom = view.name !== "home" && view.name !== "data";
  const room = ROOMS.find(r => r.key === view.room);
  $("#backbtn").style.display = inRoom ? "" : "none";
  $("#headtitle").textContent = inRoom && room ? `${room.icon} ${room.label}` : "";
  const el = $("#app");
  const v = view.name;
  if (v === "home") el.innerHTML = vHome();
  else if (v === "catpick") el.innerHTML = vCatPick();
  else if (v === "quizsetup") el.innerHTML = vQuizSetup();
  else if (v === "quizrun") el.innerHTML = vQuizRun();
  else if (v === "quizend") el.innerHTML = vQuizEnd();
  else if (v === "card") el.innerHTML = vCard();
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

// ---------- ホーム ----------
function vHome() {
  const rooms = ROOMS.map(r =>
    `<div class="roomcard ${r.gold ? "gold" : ""}" data-nav="${r.key}">
      <div class="room-ttl">${r.icon} ${r.label}${r.gold ? " 🔒" : ""}</div>
      <div class="muted">${r.desc}</div>
      ${r.gold ? `<div class="muted small">(100点/1000sdn　90〜99点/500sdn　80〜89点/400sdn　70〜79点/300sdn　50〜69点/100sdn　49点以下/10sdn)</div>` : ""}
    </div>`).join("");
  const total = ITEMS.length;
  const learned = ITEMS.filter(i => statusOf(i.id) !== "new").length;
  const mastered = ITEMS.filter(i => statusOf(i.id) === "master").length;
  const correct = Object.values(PROGRESS).reduce((a, r) => a + r.c, 0);
  return `<div class="roomlist">${rooms}</div>
    <p class="muted mt">累計◯${correct}件 / 挑戦済み${learned}件 / 克服${mastered}件（全${total}件）</p>
    <p class="muted">所有：<b class="sdn">${SDN} sdn</b>　<button class="ghost" data-nav="data">データ管理 →</button></p>`;
}

// ---------- カテゴリ選択 ----------
function vCatPick() {
  const room = ROOMS.find(r => r.key === view.room);
  return `<div class="card">
    <h2>${room.label}</h2>
    <p class="muted">${room.desc}。カテゴリを選んでください。</p>
    <div class="choices">
      ${cats().map(c =>
        `<button class="choice" data-act="cat" data-cat="${esc(c)}">${esc(c)}<span class="muted small">（${byCat(c).length}件）</span></button>`).join("")}
      ${view.allowAll ? `<button class="choice" data-act="cat" data-cat="">全カテゴリ（${ITEMS.length}件）</button>` : ""}
    </div>
  </div>`;
}

// ---------- 共通: 番号範囲セットアップ ----------
// preset chips: 50件単元 + 全範囲
function presetChips(cat) {
  const n = byCat(cat).length;
  const chips = [];
  for (let a = 1; a <= n; a += SEC_SIZE) {
    const b = Math.min(a + SEC_SIZE - 1, n);
    chips.push(`<button class="chip" data-act="preset" data-a="${a}" data-b="${b}">${a}〜${b}</button>`);
  }
  chips.push(`<button class="chip" data-act="preset" data-a="1" data-b="${n}">全範囲</button>`);
  return `<div class="chips">${chips.join("")}</div>`;
}
function recentRows(kind, cat) {
  const rows = RESULTS.filter(r => r.kind === kind && r.cat === cat).slice(-5).reverse()
    .map((r) => `<div class="rescard" data-act="rdetail" data-i="${RESULTS.indexOf(r)}">
      <span>No.${r.range[0]}-${r.range[1]}</span><b>${r.ok}/${r.n}</b>
      <span class="muted small">${fmtTs(r.ts)}</span></div>`).join("");
  return rows ? `<h3 class="mt">最近の${KIND_JP[kind]}結果</h3>${rows}` : "";
}
function masteryGrid(cat) {
  const p = byCat(cat);
  const tiles = [];
  for (let a = 0; a < p.length; a += SEC_SIZE) {
    const blk = p.slice(a, a + SEC_SIZE);
    const s = blockStat(blk);
    tiles.push(`<div class="tile ${s.cls}" data-act="tile" data-cat="${esc(cat)}" data-a="${a}">
      <div class="muted small">${a + 1}-${a + blk.length}</div>
      <div class="tile-n">${s.done}<span class="muted">/${blk.length}</span></div>
      <div class="tile-l">${s.label}${s.weak ? ` / ✕${s.weak}` : ""}</div>
    </div>`);
  }
  return `<h3 class="mt">習得状況</h3><p class="muted small">タップで残りの語句を確認できます</p><div class="tiles">${tiles.join("")}</div>`;
}

// ---------- クイズの部屋 ----------
function vQuizSetup() {
  const cat = view.cat;
  const n = byCat(cat).length;
  return `<div class="card">
    <h2>4択クイズを作る</h2>
    <p class="muted">解答は4択。テストと同じく実施中は辞書・結果はロックされます。</p>
    <label class="f">出題対象</label>
    <select id="q_filt">
      <option value="">番号範囲からランダム</option>
      <option value="new">未学習のみ</option>
      <option value="weak">苦手のみ</option>
    </select>
    <div class="numrow">
      <div><label class="f">開始番号</label><input type="number" id="q_a" value="1" min="1"></div>
      <div><label class="f">終了番号</label><input type="number" id="q_b" value="${n}" min="1"></div>
      <div><label class="f">問題数</label><input type="number" id="q_n" value="20" min="4"></div>
    </div>
    <label class="f">出題形式</label>
    <select id="q_mode">
      <option value="m2t">意味 → 語句を選ぶ</option>
      <option value="t2y">語句 → 読みを選ぶ</option>
      <option value="y2t">読み → 語句を選ぶ</option>
      <option value="card">カードめくり(自学習)</option>
    </select>
    <button class="bigbtn" id="q_go">クイズを開始</button>
    ${presetChips(cat)}
  </div>
  ${recentRows("quiz", cat)}`;
}

// ---------- テストの部屋 ----------
function vTestSetup() {
  const cat = view.cat;
  const n = byCat(cat).length;
  const power = view.room === "power";
  return `<div class="card">
    <h2>${power ? "実力テスト" : "テストを始める"}</h2>
    <p class="muted">${power
      ? "全範囲からランダム出題。点数に応じてsdnを獲得できます。"
      : "選択範囲から出題されます。苦手の語句は復習として出ます。"}</p>
    <div class="numrow">
      <div><label class="f">開始番号</label><input type="number" id="t_a" value="1" min="1"></div>
      <div><label class="f">終了番号</label><input type="number" id="t_b" value="${power ? "" : n}" min="1" ${power ? "disabled" : ""}></div>
      <div><label class="f">問題数</label><input type="number" id="t_n" value="${power ? 30 : 50}" min="4"></div>
    </div>
    <label class="f">出題形式</label>
    <select id="t_mode">
      <option value="m2t">意味 → 語句を選ぶ</option>
      <option value="t2y">語句 → 読みを選ぶ</option>
      <option value="y2t">読み → 語句を選ぶ</option>
    </select>
    <button class="bigbtn" id="t_go">テストを開始</button>
    ${power ? "" : presetChips(cat)}
  </div>
  ${power ? "" : masteryGrid(cat)}
  ${recentRows(power ? "power" : "test", cat)}`;
}

// ---------- 4択クイズ実行 ----------
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
  return `<div class="panes"><div class="card">
      <div class="muted">${idx + 1} / ${list.length}　${esc(quiz.cat)}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${judged
        ? `<div class="judge ${judged.ok ? "ok" : "ng"}">${judged.ok ? "⭕" : "❌"}</div>
           <p class="center"><b>${esc(it.text)}</b>（${esc(it.yomi)}）</p>
           ${qPrompt(it, mode)}
           <button class="bigbtn" data-act="nextq">${idx + 1 < list.length ? "次へ" : "結果を見る"}</button>`
        : `${qPrompt(it, mode)}<div class="choices">${opts}</div>
           <div class="btnrow"><button class="ghost" data-act="quit">やめる</button></div>`}
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
      <div class="btnrow"><button class="primary" data-act="retry" data-src="quiz">間違えた問題だけやり直す</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow">
      <button data-act="tosetup">クイズの部屋へ</button>
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- カード ----------
function vCard() {
  const { list, idx, flipped } = cardSet;
  if (!list.length || idx >= list.length)
    return `<div class="card"><h2>このセットは完了です</h2>
      <div class="btnrow"><button data-act="tosetup">クイズの部屋へ</button>
      <button data-nav="home">ホームへ</button></div></div>`;
  const it = list[idx];
  const front = `<div class="card flash" data-act="flip">
      <div class="muted">${idx + 1} / ${list.length}　${esc(it.cat)} ${STATUS_BADGE[statusOf(it.id)]}</div>
      <div class="surface">${esc(it.text)}</div>
      <div class="hint">${flipped ? "" : "タップで答えを表示"}</div>
    </div>`;
  const side = `<div class="card side">
      ${it.image ? `<img class="imgbox" src="${esc(it.image)}" alt="">` : ""}
      ${flipped ? `
        <div class="yomi" style="font-size:20px;color:var(--acc)">${esc(it.yomi)}</div>
        <p><b>意味:</b> ${esc(it.meaning)}</p>
        ${it.example ? `<p class="muted"><b>例:</b> ${esc(it.example)}</p>` : ""}
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
      <button class="ghost" data-act="quit">やめる</button>
    </div>`;
  return `<div class="panes"><div>${front}${btns}</div>${side}</div>`;
}

// ---------- テスト実行(途中採点なし) ----------
function vTestRun() {
  const { list, idx, mode } = test;
  const it = list[idx];
  const { options, answer } = makeChoices(it, mode, test.pool);
  test.cur = { answer, options };
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="tanswer" data-i="${i}">${esc(o)}</button>`).join("");
  return `<div class="panes"><div class="card">
      <div class="muted">${test.kind === "power" ? "🏆 実力テスト" : "🖊️ テスト"}　${idx + 1} / ${list.length}　${esc(test.cat)}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${qPrompt(it, mode)}
      <div class="choices">${opts}</div>
      <div class="btnrow"><button class="ghost" data-act="quit">やめる</button></div>
    </div>
    <div class="card side"><p class="muted">本番形式: 答えはテスト終了後にまとめて表示されます。</p></div>
  </div>`;
}

function vTestEnd() {
  const ok = test.answers.filter(a => a.ok).length;
  const pct = Math.round(ok / test.answers.length * 100);
  const got = test.kind === "power" ? sdnAward(pct) : 0;
  const wrongs = test.answers.filter(a => !a.ok)
    .map(a => ITEMS.find(i => i.id === a.id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(it.text)}</span>
     <span class="y">${esc(it.yomi)}</span><span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <h2>${test.kind === "power" ? "実力テスト" : "テスト"}結果: ${ok} / ${test.answers.length} 問正解(${pct}点)</h2>
    ${got ? `<p class="sdn">+${got} sdn 獲得！(所有: ${SDN} sdn)</p>` : ""}
    ${wrongs.length ? `<h3>間違えた問題 (${wrongs.length})</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="retry" data-src="test">間違えた問題だけクイズで練習</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow">
      <button data-act="tosetup">もう一度</button>
      <button data-nav="result">結果の部屋へ</button>
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- 結果の部屋 ----------
function vResult() {
  const cat = view.cat || cats()[0];
  const total = ITEMS.length;
  const learned = ITEMS.filter(i => statusOf(i.id) !== "new").length;
  const mastered = ITEMS.filter(i => statusOf(i.id) === "master").length;
  const correct = Object.values(PROGRESS).reduce((a, r) => a + r.c, 0);
  const chips = cats().map(c =>
    `<button class="chip ${c === cat ? "on" : ""}" data-act="rcat" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  const rows = RESULTS.slice().reverse().map((r, ri) => {
    const idx = RESULTS.length - 1 - ri;
    return `<div class="rescard" data-act="rdetail" data-i="${idx}">
      <span>${KIND_JP[r.kind]} ${esc(r.cat)} No.${r.range[0]}-${r.range[1]}</span>
      <b>${r.ok}/${r.n}</b>
      <span class="muted small">${fmtTs(r.ts)}</span></div>`;
  }).join("");
  return `<div class="card">
      <div class="btnrow" style="margin:0 0 6px">${chips}</div>
      <h3>進捗票（${SEC_SIZE}件ブロック）</h3>
      <p class="muted">累計◯${correct}件 / 挑戦済み${learned}件（全${total}件）</p>
      <p class="muted">所有：<b class="sdn">${SDN} sdn</b></p>
      ${masteryGrid(cat)}
    </div>
    <h3>履歴</h3>${rows || "<div class='card muted'>まだ記録がありません。</div>"}`;
}

function vResultDetail() {
  const r = RESULTS[view.idx];
  if (!r) return `<div class="card">記録がありません</div>`;
  const wrongs = r.wrongIds.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(it.text)}</span>
     <span class="y">${esc(it.yomi)}</span><span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <h2>${KIND_JP[r.kind]}: ${r.ok}/${r.n} 問正解</h2>
    <p class="muted">${fmtTs(r.ts)}・${esc(r.cat)} No.${r.range[0]}-${r.range[1]}</p>
    ${wrongs.length ? `<h3>間違えた問題</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="rretry" data-i="${view.idx}">間違えた問題だけクイズで練習</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow"><button data-act="rdel" data-i="${view.idx}">この記録を削除</button>
    <button data-nav="result">戻る</button></div>
  </div>`;
}

// ---------- 辞書の部屋 ----------
function vList() {
  const cat = view.cat || "";
  const kw = (view.kw || "").toLowerCase();
  const filt = view.filt || "";
  let p = byCat(cat || null);
  if (view.sec != null) { // 単元タイルから: 残り(未習得)の語句
    const blk = p.slice(view.sec * SEC_SIZE, (view.sec + 1) * SEC_SIZE);
    p = blk.filter(i => ["new", "weak"].includes(statusOf(i.id)));
  }
  if (kw) p = p.filter(i =>
    `${i.text}${i.yomi}${i.meaning}${i.example || ""}`.toLowerCase().includes(kw));
  if (filt) p = p.filter(i => statusOf(i.id) === filt);
  const rows = p.slice(0, 500).map(it =>
    `<div class="listrow" data-act="edit" data-id="${it.id}" style="cursor:pointer">
      <span class="t">${esc(it.text)}${STATUS_BADGE[statusOf(it.id)]}</span>
      <span class="y">${esc(it.yomi)}</span>
      <span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <div class="btnrow" style="margin-top:0">
      <select id="l_cat"><option value="">全カテゴリ</option>
        ${cats().map(c => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="l_filt"><option value="">全状態</option>
        ${["new", "weak", "master", "good"].map(s =>
          `<option value="${s}" ${s === filt ? "selected" : ""}>${STATUS_JP[s]}</option>`).join("")}</select>
      <input type="text" id="l_kw" placeholder="検索(語句・読み・意味)" value="${esc(view.kw || "")}">
    </div>
    ${view.sec != null ? `<p class="muted">未習得の残り（タイルから）</p>` : ""}
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
    <p class="muted">問題データ ${ITEMS.length}件 / 記録のある項目 ${total}件 / 履歴 ${RESULTS.length}件</p>
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

// ---------- 範囲から問題を取り出す ----------
function rangePool(cat, a, b, filt) {
  let p = byCat(cat).slice(a - 1, b);
  if (filt === "weak") p = p.filter(i => statusOf(i.id) === "weak");
  else if (filt === "new") p = p.filter(i => statusOf(i.id) === "new");
  return p;
}

// ---------- イベント ----------
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    const k = nav.dataset.nav;
    if (k === "home") go("home");
    else if (k === "data") go("data");
    else if (k === "jisho") go("list", { room: "jisho" });
    else if (k === "result") go("result", { room: "result", cat: view.cat });
    else go("catpick", { room: k, allowAll: k === "power" });
    return;
  }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "cat") {
      const room = view.room;
      if (room === "quiz") go("quizsetup", { cat: a.dataset.cat, room });
      else go("testsetup", { cat: a.dataset.cat || cats()[0], room });
    }
    else if (act === "preset") {
      const sfx = view.name === "quizsetup" ? "q" : "t";
      $(`#${sfx}_a`).value = a.dataset.a;
      $(`#${sfx}_b`).value = a.dataset.b;
    }
    else if (act === "tile") {
      go("list", { room: "jisho", cat: a.dataset.cat, sec: Math.floor(+a.dataset.a / SEC_SIZE), kw: "", filt: "" });
    }
    else if (act === "rcat") { view.cat = a.dataset.cat; render(); }
    else if (act === "quit") {
      const room = view.room;
      if (room === "quiz") go("quizsetup", { cat: (quiz || cardSet || {}).cat || cats()[0], room });
      else go("catpick", { room, allowAll: room === "power" });
    }
    else if (act === "tosetup") {
      const room = view.room === "power" ? "power" : (test ? test.kind === "power" ? "power" : view.room : view.room);
      if (room === "quiz" || view.name === "quizend" || view.name === "card") {
        go("quizsetup", { cat: quiz ? quiz.cat : cats()[0], room: "quiz" });
      } else {
        go("testsetup", { cat: test ? test.cat : cats()[0], room: test && test.kind === "power" ? "power" : "test" });
      }
    }
    else if (act === "flip") { cardSet.flipped = !cardSet.flipped; render(); }
    else if (act === "skip") { cardSet.flipped = false; cardSet.idx++; render(); }
    else if (act === "mark") {
      mark(cardSet.list[cardSet.idx].id, a.dataset.ok === "1");
      cardSet.flipped = false; cardSet.idx++;
      if (cardSet.idx >= cardSet.list.length) go("card"); else render();
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
      if (quiz.idx >= quiz.list.length) {
        RESULTS.push({
          ts: new Date().toISOString(), kind: "quiz", cat: quiz.cat,
          range: quiz.range, n: quiz.answers.length,
          ok: quiz.answers.filter(x => x.ok).length,
          wrongIds: quiz.answers.filter(x => !x.ok).map(x => x.id),
        });
        saveResults();
        go("quizend");
      } else render();
    }
    else if (act === "tanswer") {
      const pick = test.cur.options[+a.dataset.i];
      const ok = pick === test.cur.answer;
      test.answers.push({ id: test.list[test.idx].id, ok });
      mark(test.list[test.idx].id, ok);
      test.idx++;
      if (test.idx >= test.list.length) {
        const nOk = test.answers.filter(x => x.ok).length;
        if (test.kind === "power") { SDN += sdnAward(Math.round(nOk / test.answers.length * 100)); saveSdn(); }
        RESULTS.push({
          ts: new Date().toISOString(), kind: test.kind, cat: test.cat,
          range: test.range, n: test.answers.length, ok: nOk,
          wrongIds: test.answers.filter(x => !x.ok).map(x => x.id),
        });
        saveResults();
        go("testend");
      } else render();
    }
    else if (act === "retry" || act === "rretry") {
      let ids;
      if (act === "rretry") ids = (RESULTS[+a.dataset.i] || { wrongIds: [] }).wrongIds;
      else ids = (a.dataset.src === "test" ? test : quiz).answers.filter(x => !x.ok).map(x => x.id);
      const wrongs = ids.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);
      if (!wrongs.length) { toast("対象がありません"); return; }
      quiz = { list: wrongs, idx: 0, mode: "m2t", answers: [], judged: null,
        pool: ITEMS, cat: wrongs[0].cat, range: [1, wrongs.length] };
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
    const mode = $("#q_mode").value;
    const a1 = Math.max(1, +$("#q_a").value || 1);
    const b1 = Math.min(byCat(view.cat).length, +$("#q_b").value || byCat(view.cat).length);
    const filt = $("#q_filt").value;
    const nQ = +$("#q_n").value || 20;
    let p = rangePool(view.cat, a1, b1, filt);
    if (mode === "card") {
      p = shuffle([...p]);
      cardSet = { list: p, idx: 0, flipped: false, cat: view.cat };
      if (!p.length) { toast("対象の項目がありません"); return; }
      go("card"); return;
    }
    p = shuffle([...p]).slice(0, nQ);
    if (p.length < 4) { toast("4件以上必要です"); return; }
    quiz = { list: p, idx: 0, mode, answers: [], judged: null,
      pool: byCat(view.cat), cat: view.cat, range: [a1, b1] };
    go("quizrun");
  }
  if (e.target.id === "t_go") {
    const mode = $("#t_mode").value;
    const power = view.room === "power";
    const a1 = power ? 1 : Math.max(1, +$("#t_a").value || 1);
    const b1 = power ? byCat(view.cat).length
      : Math.min(byCat(view.cat).length, +$("#t_b").value || byCat(view.cat).length);
    const nQ = +$("#t_n").value || 50;
    let p = shuffle([...rangePool(view.cat, a1, b1, "")]).slice(0, nQ);
    if (p.length < 4) { toast("4件以上必要です"); return; }
    test = { list: p, idx: 0, mode, answers: [],
      pool: byCat(view.cat), cat: view.cat, range: [a1, b1],
      kind: power ? "power" : "test" };
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
    const blob = new Blob([JSON.stringify({ progress: PROGRESS, results: RESULTS, overrides: OVERRIDES, sdn: SDN }, null, 1)],
      { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "kokugo_progress.json"; a2.click();
  }
  if (e.target.id === "d_import") $("#d_file").click();
  if (e.target.id === "d_reset") {
    if (confirm("学習記録・履歴・sdnをすべて消去しますか？")) {
      PROGRESS = {}; RESULTS = []; SDN = 0;
      saveProgress(); saveResults(); saveSdn();
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
  if (e.target.id === "l_cat") { view.cat = e.target.value; view.sec = null; render(); }
  if (e.target.id === "l_filt") { view.filt = e.target.value; render(); }
  if (e.target.id === "d_file" && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.progress) PROGRESS = d.progress;
        if (d.results) RESULTS = d.results;
        if (d.overrides) { OVERRIDES = d.overrides; applyOverrides(); saveOverrides(); }
        if (typeof d.sdn === "number") { SDN = d.sdn; saveSdn(); }
        saveProgress(); saveResults(); toast("インポートしました"); render();
      } catch { toast("読み込めませんでした"); }
    };
    r.readAsText(e.target.files[0]);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "l_kw") { view.kw = e.target.value; render(); }
});
$("#backbtn").addEventListener("click", () => go("home"));
$("#brand").addEventListener("click", () => go("home"));

// ---------- 起動 ----------
async function boot() {
  PROGRESS = loadJSON(LS_PROGRESS, {});
  RESULTS = loadJSON(LS_RESULTS, []);
  OVERRIDES = loadJSON(LS_OVERRIDE, {});
  SDN = +(localStorage.getItem(LS_SDN) || 0);
  try {
    ITEMS = await (await fetch("items.json")).json();
  } catch {
    ITEMS = [];
    $("#app").innerHTML =
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
