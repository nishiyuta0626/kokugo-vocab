/* 国語文法 - 語句学習アプリ (ターゲット1900式・部屋構成)
 * 静的SPA: items.json を読み込み、学習記録は localStorage に保存。
 * 記録ルール: ❌のあと連続2回⭕で克服。
 * 部屋: 辞書 / クイズ / テスト / 結果 / 実力テスト
 * 単元: カテゴリごとに50件区切り(番号はカテゴリ内1始まり)
 * stdm: 実力テストの点数に応じてポイント付与
 */
"use strict";

const LS_PROGRESS = "kv_progress_v1";
const LS_OVERRIDE = "kv_item_override_v1";
const LS_RESULTS = "kv_results_v1";
const LS_stdm = "kv_stdm_v1";
const LS_TIME = "kv_study_time_v1";
const LS_POWER = "kv_power_unlock_v1";
const LS_ADJUST = "kv_stdm_adjust_v1";
const SEC_SIZE = 50;
// 全体通し番号のカテゴリ順(1〜漢字→慣用句→四字熟語→ことわざ)
const CAT_ORDER = ["漢字", "慣用句", "四字熟語", "ことわざ"];

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
    desc: "全範囲ランダム・点数に応じてstdm付与" },
];
const MODES = { m2t: "意味→語句", t2y: "語句→読み", y2t: "読み→語句" };
const KIND_JP = { quiz: "クイズ", test: "テスト", power: "実力テスト" };

let ITEMS = [];
let PROGRESS = {};   // id -> {c,w,s,tc,tw,ts,last}
let RESULTS = [];    // {ts,kind,cat,range:[a,b],n,ok,wrongIds,pts?}
let OVERRIDES = {};
let stdm = 0;
let POWER_ON = false; // 管理者の実力テスト解放スイッチ
// 勉強時間: 問題を解いている時間のみ計測。2分無操作/離席で一時停止。
// 2分勉強 = 1stdm
let study = { day: "", sec: 0, total: 0, paidStdm: 0 };
let ADJUSTS = []; // {ts,amount,memo} stdm手動増減ログ
let runStartTotal = 0; // 実行開始時点の累計勉強秒(セッション使用時間の算出用)
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
const savestdm = () => localStorage.setItem(LS_stdm, String(stdm));
const savePower = () => localStorage.setItem(LS_POWER, POWER_ON ? "1" : "0");
const saveStudy = () => localStorage.setItem(LS_TIME, JSON.stringify(study));
function applyOverrides() {
  for (const it of ITEMS) {
    const o = OVERRIDES[it.id];
    if (o) Object.assign(it, o);
  }
}

// ---------- 記録 ----------
function rec(id) { return PROGRESS[id] || { c: 0, w: 0, s: 0, tc: 0, tw: 0, tlast: "", last: "" }; }
function mark(id, ok, kind) {
  const r = rec(id);
  if (ok) { r.c++; r.s++; } else { r.w++; r.s = 0; }
  // テスト系(テスト・実力テスト)の状態は別管理: 直近のテスト結果が✕なら✕、⭕なら〇に戻る。
  // クイズ・カードの結果はここに反映されない。
  if (kind === "test" || kind === "power") {
    if (ok) r.tc++; else r.tw++;
    r.tlast = ok ? "ok" : "ng";
  }
  r.last = new Date().toISOString();
  PROGRESS[id] = r; saveProgress();
}
// テスト系で直近が✕かどうか(次のテストに混入する復習対象)
function testWeak(id) { return rec(id).tlast === "ng"; }
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
function cats() { // CAT_ORDERの順(存在するもののみ)
  const have = new Set(ITEMS.map(i => i.cat));
  return CAT_ORDER.filter(c => have.has(c))
    .concat([...have].filter(c => !CAT_ORDER.includes(c)));
}
function byCat(cat) { return ITEMS.filter(i => !cat || i.cat === cat); }
// 全体通し番号で50件ブロックを列挙(カテゴリをまたがない)
function globalBlocks() {
  const out = [];
  let g = 1;
  for (const c of cats()) {
    const p = byCat(c);
    for (let a = 0; a < p.length; a += SEC_SIZE) {
      const blk = p.slice(a, a + SEC_SIZE);
      out.push({ cat: c, sec: Math.floor(a / SEC_SIZE), gs: g, ge: g + blk.length - 1, blk });
      g += blk.length;
    }
  }
  return out;
}
function fmtTs(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function stdmAward(pts) { // 実力テスト(100点満点)のstdm付与
  if (pts >= 100) return 500;
  if (pts >= 85) return 200;
  if (pts >= 70) return 100;
  return 10;
}
// 実力テストの構成: [カテゴリ, 問数, 配点] 空のカテゴリは自動的に除外
const POWER_SPEC = [["漢字", 40, 1], ["慣用句", 10, 2], ["四字熟語", 10, 2], ["ことわざ", 10, 2]];
function powerSpec() { return POWER_SPEC.filter(([c]) => byCat(c).length > 0); }
function powerWeight(it) { const sp = POWER_SPEC.find(s => s[0] === it.cat); return sp ? sp[2] : 0; }
function powerScore(ansList) { // 加重得点を100点満点に換算
  let earned = 0, max = 0;
  for (const x of ansList) {
    const it = ITEMS.find(i => i.id === x.id);
    if (!it) continue;
    const w = powerWeight(it);
    max += w; if (x.ok) earned += w;
  }
  return max ? Math.round(earned / max * 100) : 0;
}
const RUN_VIEWS = new Set(["quizrun", "testrun", "card"]);
const IDLE_MS = 120000; // 2分無操作でタイムロック
let lastActivity = Date.now();
let winFocused = true;
let lastTickAt = Date.now();
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function studyTick() {
  const now = Date.now();
  const dt = now - lastTickAt;
  lastTickAt = now;
  if (dt <= 0 || dt > 60000) return;
  const active = RUN_VIEWS.has(view.name) && !document.hidden && winFocused &&
    (now - lastActivity) < IDLE_MS;
  if (!active) return;
  if (study.day !== todayStr()) { study.day = todayStr(); study.sec = 0; }
  study.sec += dt / 1000; study.total += dt / 1000;
  const earned = Math.floor(study.total / 120); // 2分=1stdm
  if (earned > study.paidStdm) { stdm += earned - study.paidStdm; study.paidStdm = earned; savestdm(); }
  saveStudy();
}
function fmtStudy() {
  const m = Math.floor(study.sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`;
}
// 単元(50件)ブロックの状態: 習得数で段階評価
//   0(未着手)=gray / 〜25いまいち=orange / 26〜35まあまあ=blue / 36〜45すごい=green / 46〜合格=gold
function blockStat(blk) {
  const st = { new: 0, weak: 0, master: 0, good: 0 };
  blk.forEach(it => st[statusOf(it.id)]++);
  const done = st.master + st.good;
  const weak = st.weak;
  if (done >= 46) return { cls: "gold", label: "合格", done, weak };
  if (done >= 36) return { cls: "green", label: "すごい", done, weak };
  if (done >= 26) return { cls: "blue", label: "まあまあ", done, weak };
  if (done === 0 && st.new === blk.length) return { cls: "gray", label: "未着手", done, weak };
  return { cls: "orange", label: "いまいち", done, weak };
}

// ---------- 描画 ----------
function render() {
  const inRoom = view.name !== "home" && view.name !== "data";
  const room = ROOMS.find(r => r.key === view.room);
  $("#backbtn").style.display = inRoom ? "" : "none";
  $("#headtitle").textContent = inRoom
    ? (room ? `${room.icon} ${room.label}` : (view.name === "admin" ? "管理者" : ""))
    : "";
  const el = $("#app");
  const v = view.name;
  if (v === "home") el.innerHTML = vHome();
  else if (v === "catpick") el.innerHTML = vCatPick();
  else if (v === "quizsetup") el.innerHTML = vQuizSetup();
  else if (v === "quizrun") el.innerHTML = vQuizRun();
  else if (v === "quizend") el.innerHTML = vQuizEnd();
  else if (v === "card") el.innerHTML = vCard();
  else if (v === "testpick") el.innerHTML = vTestPick();
  else if (v === "testsetup") el.innerHTML = vTestSetup();
  else if (v === "testrun") el.innerHTML = vTestRun();
  else if (v === "testend") el.innerHTML = vTestEnd();
  else if (v === "result") el.innerHTML = vResult();
  else if (v === "resultdetail") el.innerHTML = vResultDetail();
  else if (v === "list") el.innerHTML = vList();
  else if (v === "edit") el.innerHTML = vEdit();
  else if (v === "data") el.innerHTML = vData();
  else if (v === "admin") el.innerHTML = vAdmin();
}
function go(name, params = {}) {
  const wasRun = RUN_VIEWS.has(view.name);
  const isRun = RUN_VIEWS.has(name);
  if (isRun && !wasRun) runStartTotal = study.total;
  view = { name, ...params }; render(); window.scrollTo(0, 0);
}
const fmtDur = (s) => `${Math.floor(s / 60)}分${Math.round(s % 60)}秒`;

// ---------- ホーム ----------
function powerProgress() { // 実力テスト解放状況: 全単元が「合格」(46件以上習得)
  let total = 0, cleared = 0;
  for (const b of globalBlocks()) {
    total++;
    if (blockStat(b.blk).done >= b.blk.length - 4) cleared++;
  }
  return { total, cleared };
}
function powerUnlocked() {
  if (POWER_ON) return true;
  const pw = powerProgress();
  return pw.total > 0 && pw.cleared === pw.total;
}
function vHome() {
  const pw = powerProgress();
  const unlocked = powerUnlocked();
  const rooms = ROOMS.map(r =>
    `<div class="roomcard ${r.gold ? "gold" : ""}" data-nav="${r.key}">
      <div class="room-ttl">${r.icon} ${r.label}${r.gold && !unlocked ? " 🔒" : ""}</div>
      <div class="muted">${r.desc}</div>
      ${r.gold ? `<div class="muted small">${powerSpec().map(([c, n, p]) => `${c}${Math.min(n, byCat(c).length)}問(${p}点/問)`).join("・")}・100点満点換算</div>
        <div class="muted small">(100点/500stdm　85〜99点/200stdm　70〜84点/100stdm　69点以下/10stdm)</div>
        <div class="muted small">${unlocked
          ? (POWER_ON ? "🔓 解放中(管理者設定)" : "🔓 解放済み！")
          : `🔒 全単元を「合格」(46件以上習得)すると解放されます　合格 ${pw.cleared}/${pw.total} 単元`}</div>` : ""}
    </div>`).join("");
  const total = ITEMS.length;
  const learned = ITEMS.filter(i => statusOf(i.id) !== "new").length;
  const mastered = ITEMS.filter(i => statusOf(i.id) === "master").length;
  const correct = Object.values(PROGRESS).reduce((a, r) => a + r.c, 0);
  return `<div class="stdmbar">所有 stdm <b>${stdm}</b></div>
    <div class="roomlist">${rooms}</div>
    <p class="muted mt">累計◯${correct}件 / 挑戦済み${learned}件 / 克服${mastered}件（全${total}件）</p>
    <p class="muted">所有：<b class="stdm">${stdm} stdm</b>　<button class="ghost" data-nav="data">データ管理 →</button>
    <button class="ghost adminbtn" data-nav="admin">管理者</button></p>`;
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

// ---------- 共通 ----------
function recentRows(kind, cat) {
  const rows = RESULTS.filter(r => r.kind === kind && (!cat || r.cat === cat)).slice(-5).reverse()
    .map((r) => `<div class="rescard" data-act="rdetail" data-i="${RESULTS.indexOf(r)}">
      <span>No.${r.range[0]}-${r.range[1]}</span><b>${r.ok}/${r.n}</b>
      <span class="muted small">${fmtTs(r.ts)}</span></div>`).join("");
  return rows ? `<h3 class="mt">最近の${KIND_JP[kind]}結果</h3>${rows}` : "";
}
// 全カテゴリの50件ブロックタイル(1ページ表示・全体通し番号)
// act: タップ時の動作("tile"=残り確認 / "tblk"=テスト設定 / "selblk"=クイズ選択)
function allBlockTiles(act, selSet) {
  const blks = globalBlocks();
  const parts = [];
  let cur = "";
  for (const b of blks) {
    if (b.cat !== cur) { cur = b.cat; parts.push(`<h4 class="cathead">${esc(b.cat)}</h4><div class="tiles">`); }
    const s = blockStat(b.blk);
    const on = selSet && selSet.has(b.gs) ? " sel" : "";
    parts.push(`<div class="tile ${s.cls}${on}" data-act="${act}"
      data-cat="${esc(b.cat)}" data-sec="${b.sec}" data-gs="${b.gs}" data-ge="${b.ge}">
      <div class="muted small">No.${b.gs}-${b.ge}</div>
      <div class="tile-n">${s.done}<span class="muted">/${b.blk.length}</span></div>
      <div class="tile-l">${s.label}${s.weak ? ` / ✕${s.weak}` : ""}</div>
    </div>`);
    const next = blks[blks.indexOf(b) + 1];
    if (!next || next.cat !== cur) parts.push(`</div>`);
  }
  return parts.join("");
}

// ---------- クイズの部屋 ----------
// 50問を自動生成: 各単元からラウンドロビンでバランスよく、
// 単元内では出題回数の少ない語句を優先(ランキング精度のため)・ただしランダム性あり
function stratifiedSample(blocks, n, filt) {
  const pools = blocks.map(b => {
    let q = b;
    if (filt === "weak") q = q.filter(i => statusOf(i.id) === "weak");
    else if (filt === "new") q = q.filter(i => statusOf(i.id) === "new");
    return [...q].sort((x, y) =>
      (rec(x.id).c + rec(x.id).w + Math.random() * 4) -
      (rec(y.id).c + rec(y.id).w + Math.random() * 4));
  });
  const out = [];
  while (out.length < n) {
    const nonempty = pools.filter(p => p.length);
    if (!nonempty.length) break;
    for (const p of nonempty) {
      if (out.length >= n) break;
      out.push(p.shift());
    }
  }
  return shuffle(out);
}
function vQuizSetup() {
  const scope = view.qscope ?? "";
  const scopeChips = [`<button class="chip ${scope === "" ? "on" : ""}" data-act="qscope" data-cat="">全カテゴリ</button>`,
    ...cats().map(c => `<button class="chip ${scope === c ? "on" : ""}" data-act="qscope" data-cat="${esc(c)}">${esc(c)}</button>`)].join("");
  const nBlocks = globalBlocks().filter(b => !scope || b.cat === scope).length;
  return `<div class="card">
    <h2>4択クイズを作る</h2>
    <p class="muted">自動で50問を生成します。ランダムですが各単元からバランスよく・出題回数の少ない語句を優先して出題します。</p>
    <label class="f">カテゴリ</label>
    <div class="chips">${scopeChips}</div>
    <label class="f">出題対象</label>
    <select id="q_filt">
      <option value="">すべて（ランダム・各単元バランス）</option>
      <option value="new">未学習のみ</option>
      <option value="weak">苦手のみ</option>
    </select>
    <p class="muted small">出題形式: 漢字は読み・その他は意味から語句を4択で選ぶ（選択肢は毎回シャッフル）</p>
    <button class="bigbtn" id="q_go">クイズを開始（50問・${nBlocks}単元から）</button>
    <button class="ghost" id="q_card" style="margin-top:8px">🃏 カードめくりで学習</button>
  </div>
  ${recentRows("quiz")}
  ${vRanking()}`;
}

// ---------- よく間違える問題ランキング(30件/ページ・最大300位) ----------
function vRanking() {
  const page = view.rpage || 0;
  const ranked = ITEMS
    .map(it => ({ it, w: rec(it.id).w }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.w - a.w || a.it.text.localeCompare(b.it.text, "ja"))
    .slice(0, 300);
  const tabs = Array.from({ length: 10 }, (_, i) =>
    `<button class="chip ${i === page ? "on" : ""}" data-act="rpage" data-p="${i}">${i * 30 + 1}〜${i * 30 + 30}</button>`).join("");
  const rows = ranked.slice(page * 30, page * 30 + 30).map((x, i) =>
    `<div class="listrow">
      <span class="rank">${page * 30 + i + 1}位</span>
      <span class="t">${esc(x.it.text)}</span>
      <span class="y">${esc(x.it.yomi)}</span>
      <span class="m">✕${x.w}回　${esc(x.it.meaning)}</span>
    </div>`).join("");
  return `<div class="card">
    <h3>よく間違える問題ランキング</h3>
    ${ranked.length ? `<div class="chips" style="overflow-x:auto;flex-wrap:nowrap">${tabs}</div>${rows || "<p class='muted'>このページはありません</p>"}`
      : `<p class="muted">まだ間違えた問題がありません。</p>`}
  </div>`;
}

// ---------- テストの部屋 ----------
const TEST_PASS = 0.9; // 90%以上で合格
function passedBlock(b) {
  return RESULTS.some(r => r.kind === "test" &&
    r.range[0] === b.gs && r.range[1] === b.ge && r.ok / r.n >= TEST_PASS);
}
function vTestPick() { // 結果の部屋と同じ1ページ全タイル(合格で次へ進む)
  const blks = globalBlocks();
  const parts = [];
  let cur = "";
  blks.forEach((b, i) => {
    if (b.cat !== cur) { cur = b.cat; parts.push(`<h4 class="cathead">${esc(b.cat)}</h4><div class="tiles">`); }
    const s = blockStat(b.blk);
    const unlocked = i === 0 || passedBlock(blks[i - 1]);
    const pass = passedBlock(b);
    parts.push(`<div class="tile ${pass ? "gold" : s.cls}${unlocked ? "" : " locked"}"
      data-act="${unlocked ? "tblk" : "locked"}"
      data-cat="${esc(b.cat)}" data-sec="${b.sec}" data-gs="${b.gs}" data-ge="${b.ge}">
      <div class="muted small">No.${b.gs}-${b.ge}${unlocked ? "" : " 🔒"}</div>
      <div class="tile-n">${s.done}<span class="muted">/${b.blk.length}</span></div>
      <div class="tile-l">${pass ? "テスト合格✓" : s.label}${s.weak ? ` / ✕${s.weak}` : ""}</div>
    </div>`);
    const next = blks[i + 1];
    if (!next || next.cat !== cur) parts.push(`</div>`);
  });
  return `<div class="card">
    <h2>テストを始める</h2>
    <p class="muted">テストは50問構成(範囲45問以上＋前の枠の✕を5問以内)。<b>90%以上で合格</b>、合格すると次の枠が開きます。</p>
    ${parts.join("")}
  </div>
  ${recentRows("test")}`;
}
function vTestSetup() {
  const power = view.room === "power";
  const blk = power ? null : ITEMS.slice(view.gs - 1, view.ge);
  return `<div class="card">
    <h2>${power ? "実力テスト" : `テストを始める — No.${view.gs}-${view.ge}`}</h2>
    ${power ? `<p class="muted">全範囲からランダム出題・100点満点換算。</p>
      <table class="awardtbl"><tr><th>カテゴリ</th><th>問数</th><th>配点</th><th>stdm付与</th></tr>
      ${powerSpec().map(([c, n, p], i) =>
        `<tr><td>${esc(c)}</td><td>${Math.min(n, byCat(c).length)}問</td><td>${p}点/問</td>${i === 0 ? `<td rowspan="${powerSpec().length}">100点:500<br>85〜99点:200<br>70〜84点:100<br>69点以下:10</td>` : ""}</tr>`).join("")}</table>`
      : `<p class="muted">${esc(view.cat)} No.${view.gs}-${view.ge} から45問以上＋前の枠の✕を5問以内の計50問。90%以上で合格です。</p>`}
    <p class="muted small">出題形式: 漢字は読み・その他は意味から語句を4択で選ぶ（選択肢は毎回シャッフル）</p>
    <button class="bigbtn" id="t_go">テストを開始</button>
    <div class="btnrow"><button class="ghost" data-act="quit">${power ? "← ホームへ" : "← 範囲選択へ"}</button></div>
  </div>
  ${recentRows(power ? "power" : "test", view.cat)}`;
}

// ---------- 4択クイズ実行 ----------
function makeChoices(it, mode, poolAll) {
  const key = mode === "t2y" ? "yomi" : "text";
  const cand = shuffle(poolAll.filter(x => x.id !== it.id && x.cat === it.cat && x[key] && x[key] !== it[key]));
  const seen = new Set([it[key]]);
  const picks = [it];
  for (const c of cand) { if (picks.length >= 4) break; if (!seen.has(c[key])) { seen.add(c[key]); picks.push(c); } }
  const options = shuffle(picks.slice(0, 4)).map(x => ({ v: x[key], yomi: x.yomi }));
  return { options, answer: it[key] };
}
function qPrompt(it, mode) {
  if (mode === "m2t") return `<div class="q-prompt"><b>意味:</b> ${esc(it.meaning)}</div>`;
  if (mode === "t2y") return `<div class="q-surface">${esc(it.text)}</div><div class="center muted">読み方を選んでください</div>`;
  if (mode === "tyin") return `<div class="q-surface">${esc(it.text)}</div><div class="center muted">読み方をひらがなで入力してください</div>`;
  return `<div class="q-surface">${esc(it.yomi)}</div><div class="center muted">この読みの語句を選んでください</div>`;
}
// 入力した読みを正規化(カタカナ→ひらがな・空白/括弧除去)
function normYomi(s) {
  return (s || "")
    .replace(/[ァ-ヴ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s　]/g, "");
}

// 漢字カテゴリは「漢字→読み入力」の記述式に自動切替
function itemMode(it, mode) { return it.cat === "漢字" ? "tyin" : mode; }
function vQuizRun() {
  const { list, idx, mode } = quiz;
  const it = list[idx];
  const imode = itemMode(it, mode);
  const { options, answer } = imode === "tyin"
    ? { options: [], answer: it.yomi }
    : makeChoices(it, imode, quiz.pool);
  quiz.cur = { answer, options, userAns: null };
  const judged = quiz.judged;
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="answer" data-i="${i}">${esc(o.v)}${o.yomi !== o.v ? `<span class="fyomi">${esc(o.yomi)}</span>` : ""}</button>`).join("");
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
           ${imode === "tyin"
             ? `<div class="center muted">あなたの答え: ${esc(quiz.cur.userAns || "（未入力）")}</div>`
             : qPrompt(it, imode)}
           <button class="bigbtn" data-act="nextq">${idx + 1 < list.length ? "次へ" : "結果を見る"}</button>`
        : `${qPrompt(it, imode)}${imode === "tyin"
            ? `<input id="ans_in" class="textin" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="ひらがなで入力" autofocus>
               <button class="bigbtn" data-act="answer_in">こたえる</button>`
            : `<div class="choices">${opts}</div>`}
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
  const imode = itemMode(it, mode);
  const { options, answer } = imode === "tyin"
    ? { options: [], answer: it.yomi }
    : makeChoices(it, imode, test.pool);
  test.cur = { answer, options };
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="tanswer" data-i="${i}">${esc(o.v)}${o.yomi !== o.v ? `<span class="fyomi">${esc(o.yomi)}</span>` : ""}</button>`).join("");
  return `<div class="panes"><div class="card">
      <div class="muted">${test.kind === "power" ? "🏆 実力テスト" : "🖊️ テスト"}　${idx + 1} / ${list.length}　${esc(test.cat)}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${qPrompt(it, imode)}
      ${imode === "tyin"
        ? `<input id="ans_in" class="textin" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="ひらがなで入力" autofocus>
           <button class="bigbtn" data-act="tanswer_in">こたえる</button>`
        : `<div class="choices">${opts}</div>`}
      <div class="btnrow"><button class="ghost" data-act="quit">やめる</button></div>
    </div>
    <div class="card side"><p class="muted">本番形式: 答えはテスト終了後にまとめて表示されます。</p></div>
  </div>`;
}

function vTestEnd() {
  const ok = test.answers.filter(a => a.ok).length;
  const pct = Math.round(ok / test.answers.length * 100);
  const pts = test.kind === "power" ? powerScore(test.answers) : null;
  const got = test.kind === "power" ? stdmAward(pts) : 0;
  const passed = test.kind === "test" && pct >= TEST_PASS * 100;
  // 次の枠(合格していれば解放されている)
  const blks = globalBlocks();
  const curIdx = blks.findIndex(b => b.gs === test.range[0] && b.ge === test.range[1]);
  const next = curIdx >= 0 ? blks[curIdx + 1] : null;
  const wrongs = test.answers.filter(a => !a.ok)
    .map(a => ITEMS.find(i => i.id === a.id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(it.text)}</span>
     <span class="y">${esc(it.yomi)}</span><span class="m">${esc(it.meaning)}</span></div>`).join("");
  return `<div class="card">
    <h2>${test.kind === "power"
      ? `実力テスト結果: ${pts}点 / 100点満点 (${ok}/${test.answers.length}問正解)`
      : `テスト結果: ${ok} / ${test.answers.length} 問正解(${pct}点)`}</h2>
    ${test.kind === "test" ? `<p style="font-size:20px;font-weight:700;color:${passed ? "#16a34a" : "var(--ng)"}">${passed ? "合格！次の枠が解放されました" : `不合格(合格は${TEST_PASS * 100}%以上)`}</p>` : ""}
    ${got ? `<p class="stdm">+${got} stdm 獲得！(所有: ${stdm} stdm)</p>` : ""}
    ${wrongs.length ? `<h3>間違えた問題 (${wrongs.length})</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="retry" data-src="test">間違えた問題だけクイズで練習</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow">
      ${passed && next ? `<button class="primary" data-act="nexttest" data-gs="${next.gs}" data-ge="${next.ge}" data-cat="${esc(next.cat)}" data-sec="${next.sec}">次のテストへ →</button>` : ""}
      <button data-act="tosetup">${test.kind === "power" ? "もう一度" : "枠の選択へ"}</button>
      <button data-nav="result">結果の部屋へ</button>
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- 結果の部屋 ----------
function vResult() {
  const total = ITEMS.length;
  const learned = ITEMS.filter(i => statusOf(i.id) !== "new").length;
  const mastered = ITEMS.filter(i => statusOf(i.id) === "master").length;
  const correct = Object.values(PROGRESS).reduce((a, r) => a + r.c, 0);
  const rows = RESULTS.slice().reverse().map((r, ri) => {
    const idx = RESULTS.length - 1 - ri;
    return `<div class="rescard" data-act="rdetail" data-i="${idx}">
      <span>${KIND_JP[r.kind]} ${esc(r.cat)} No.${r.range[0]}-${r.range[1]}</span>
      <b>${r.ok}/${r.n}</b>
      <span class="muted small">${fmtTs(r.ts)}</span></div>`;
  }).join("");
  return `<p class="muted">今日の勉強時間合計: <b>${fmtStudy()}</b></p>
    <div class="card">
      <h3>進捗票（${SEC_SIZE}件ブロック）</h3>
      <p class="muted">累計◯${correct}件 / 挑戦済み${learned}件 / 克服${mastered}件（全${total}件）</p>
      <p class="muted">所有：<b class="stdm">${stdm} stdm</b></p>
      <h3>習得状況</h3><p class="muted small">タップで残りの語句を確認できます</p>
      ${allBlockTiles("tile")}
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

// ---------- 管理者 ----------
const ATABS = [["quiz", "クイズ管理"], ["test", "テスト管理"], ["power", "実力テスト管理"]];
function vAdmin() {
  const pw = powerProgress();
  const m = Math.floor(study.sec / 60);
  const totalH = Math.floor(study.total / 3600), totalM = Math.floor(study.total / 60) % 60;
  // stdm手動増減ログ(直近10件)
  const adjRows = ADJUSTS.slice(-10).reverse().map(x =>
    `<div class="listrow"><span class="t" style="color:${x.amount >= 0 ? "#16a34a" : "var(--ng)"}">${x.amount >= 0 ? "+" : ""}${x.amount}</span>
     <span class="m">${esc(x.memo || "")}　${fmtTs(x.ts)}</span></div>`).join("");
  // 使用時間ログタブ
  const tab = view.atab || "quiz";
  const tabBtns = ATABS.map(([k, l]) =>
    `<button class="chip ${tab === k ? "on" : ""}" data-act="atab" data-k="${k}">${l}</button>`).join("");
  const logs = RESULTS.filter(r => r.kind === tab).slice().reverse();
  const logRows = logs.map(r =>
    `<div class="listrow">
      <span class="t">No.${r.range[0]}-${r.range[1]}</span>
      <span class="y">${r.ok}/${r.n}${r.pts != null ? `・${r.pts}点` : ""}</span>
      <span class="m">${fmtTs(r.ts)}${r.secs != null ? `・使用時間 ${fmtDur(r.secs)}` : ""}</span>
    </div>`).join("");
  const totalSecs = logs.reduce((s2, r) => s2 + (r.secs || 0), 0);
  return `<div class="card">
    <h2>管理者</h2>
    <div class="statrow">
      <div class="stat"><b class="stdm" style="font-size:30px">${stdm}</b><span>所有 stdm</span></div>
      <div class="stat"><b>${m}</b><span>今日の勉強(分)</span></div>
      <div class="stat"><b>${totalH}h${totalM}m</b><span>累計勉強時間</span></div>
    </div>
    <h3>stdm 手動増減</h3>
    <div class="btnrow" style="align-items:flex-end">
      <div><label class="f">stdm数</label><input type="number" id="a_amt" value="10" min="1"></div>
      <div style="flex:2"><label class="f">メモ(任意)</label><input type="text" id="a_memo" placeholder="理由など"></div>
      <button class="primary" data-act="adj" data-v="1">付与(+)</button>
      <button data-act="adj" data-v="0" style="border-color:var(--ng);color:var(--ng)">使用(-)</button>
    </div>
    ${adjRows}
  </div>
  <div class="card">
    <h3>進捗票（${SEC_SIZE}件ブロック）</h3>
    <p class="muted small">タップで残りの語句を確認できます</p>
    ${allBlockTiles("tile")}
    <hr>
    <h3>実力テスト</h3>
    <p class="muted">ONにすると、全単元合格を待たずに実力テストの部屋が解放されます。現在: 合格 ${pw.cleared}/${pw.total} 単元。</p>
    <div class="chips">
      <button class="chip ${POWER_ON ? "on" : ""}" data-act="power" data-v="1">実力テスト ON</button>
      <button class="chip ${POWER_ON ? "" : "on"}" data-act="power" data-v="0">実力テスト OFF</button>
    </div>
  </div>
  <div class="card">
    <h3>使用時間ログ</h3>
    <p class="muted small">問題を解いている時間のみ(2分無操作・離席で停止)</p>
    <div class="chips">${tabBtns}</div>
    <p class="muted small mt">${logs.length}件・合計 ${fmtDur(totalSecs)}</p>
    ${logRows || `<p class="muted">まだ記録がありません。</p>`}
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
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

// ---------- イベント ----------
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    const k = nav.dataset.nav;
    if (k === "power") {
      if (!powerUnlocked()) {
        const pw = powerProgress();
        toast(`🔒 まだ入れません（合格 ${pw.cleared}/${pw.total} 単元）`);
        return;
      }
    }
    if (k === "home") go("home");
    else if (k === "data") go("data");
    else if (k === "admin") go("admin");
    else if (k === "jisho") go("list", { room: "jisho" });
    else if (k === "result") go("result", { room: "result", cat: view.cat });
    else if (k === "quiz") go("quizsetup", { room: "quiz" });
    else if (k === "test") go("testpick", { room: "test" });
    else if (k === "power") go("testsetup", { room: "power" });
    else go("catpick", { room: k });
    return;
  }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "cat") { // 実力テストのカテゴリ選択のみで使用
      go("testsetup", { cat: a.dataset.cat || null, room: "power" });
    }
    else if (act === "qscope") { view.qscope = a.dataset.cat; render(); }
    else if (act === "tblk") {
      go("testsetup", { room: "test", cat: a.dataset.cat,
        sec: +a.dataset.sec, gs: +a.dataset.gs, ge: +a.dataset.ge });
    }
    else if (act === "nexttest") {
      go("testsetup", { room: "test", cat: a.dataset.cat,
        sec: +a.dataset.sec, gs: +a.dataset.gs, ge: +a.dataset.ge });
    }
    else if (act === "locked") {
      toast("🔒 前の枠のテストに合格(90%以上)すると開きます");
    }
    else if (act === "tile") {
      go("list", { room: "jisho", cat: a.dataset.cat, sec: +a.dataset.sec, kw: "", filt: "" });
    }
    else if (act === "power") {
      POWER_ON = a.dataset.v === "1"; savePower();
      toast(POWER_ON ? "実力テストを解放しました" : "実力テストをロックしました");
      render();
    }
    else if (act === "atab") { view.atab = a.dataset.k; render(); }
    else if (act === "adj") {
      const amt = Math.abs(+($("#a_amt")?.value) || 0);
      if (!amt) { toast("stdm数を入力してください"); return; }
      const signed = a.dataset.v === "1" ? amt : -amt;
      stdm = Math.max(0, stdm + signed);
      ADJUSTS.push({ ts: new Date().toISOString(), amount: signed, memo: ($("#a_memo")?.value || "").trim() });
      localStorage.setItem(LS_ADJUST, JSON.stringify(ADJUSTS));
      savestdm(); toast(`${signed > 0 ? "+" : ""}${signed} stdm`); render();
    }
    else if (act === "quit") {
      if (view.name === "testsetup") {
        if (view.room === "power") go("home");
        else go("testpick", { room: "test" });
      }
      else if (view.room === "quiz" || view.name === "card") go("quizsetup", { room: "quiz" });
      else if (view.room === "power") go("home");
      else go("testpick", { room: "test" });
    }
    else if (act === "tosetup") {
      if (view.name === "quizend" || view.name === "card" || view.room === "quiz") {
        go("quizsetup", { room: "quiz" });
      } else if (test && test.kind === "power") {
        go("testsetup", { room: "power" });
      } else go("testpick", { room: "test" });
    }
    else if (act === "flip") { cardSet.flipped = !cardSet.flipped; render(); }
    else if (act === "skip") { cardSet.flipped = false; cardSet.idx++; render(); }
    else if (act === "mark") {
      mark(cardSet.list[cardSet.idx].id, a.dataset.ok === "1", "card");
      cardSet.flipped = false; cardSet.idx++;
      if (cardSet.idx >= cardSet.list.length) go("card"); else render();
    }
    else if (act === "answer") {
      const pick = quiz.cur.options[+a.dataset.i];
      const ok = pick.v === quiz.cur.answer;
      quiz.judged = { ok };
      quiz.answers.push({ id: quiz.list[quiz.idx].id, ok });
      mark(quiz.list[quiz.idx].id, ok, "quiz");
      document.querySelectorAll(".choice").forEach((b, i) => {
        const v = quiz.cur.options[i];
        if (v.v === quiz.cur.answer) b.classList.add("hit");
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
          secs: Math.round(study.total - runStartTotal),
          wrongIds: quiz.answers.filter(x => !x.ok).map(x => x.id),
        });
        saveResults();
        go("quizend");
      } else render();
    }
    else if (act === "answer_in") {
      const raw = $("#ans_in")?.value || "";
      const ok = normYomi(raw) === normYomi(quiz.cur.answer);
      quiz.cur.userAns = raw.trim();
      quiz.judged = { ok };
      quiz.answers.push({ id: quiz.list[quiz.idx].id, ok });
      mark(quiz.list[quiz.idx].id, ok, "quiz");
      render();
    }
    else if (act === "tanswer" || act === "tanswer_in") {
      const ok = act === "tanswer"
        ? test.cur.options[+a.dataset.i].v === test.cur.answer
        : normYomi($("#ans_in")?.value || "") === normYomi(test.cur.answer);
      test.answers.push({ id: test.list[test.idx].id, ok });
      mark(test.list[test.idx].id, ok, test.kind);
      test.idx++;
      if (test.idx >= test.list.length) {
        const nOk = test.answers.filter(x => x.ok).length;
        // 実力テスト: 加重得点を100点満点に換算してstdm付与
        const pts = test.kind === "power" ? powerScore(test.answers) : null;
        if (test.kind === "power") { stdm += stdmAward(pts); savestdm(); }
        RESULTS.push({
          ts: new Date().toISOString(), kind: test.kind, cat: test.cat,
          range: test.range, n: test.answers.length, ok: nOk, pts,
          secs: Math.round(study.total - runStartTotal),
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
    else if (act === "rpage") { view.rpage = +a.dataset.p; render(); }
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
  if (e.target.id === "q_go" || e.target.id === "q_card") {
    const mode = e.target.id === "q_card" ? "card" : "m2t";
    const filt = $("#q_filt").value;
    const scope = view.qscope ?? "";
    const blks = globalBlocks().filter(b => !scope || b.cat === scope);
    let p = stratifiedSample(blks.map(b => b.blk), 50, filt);
    if (mode === "card") {
      cardSet = { list: p, idx: 0, flipped: false };
      if (!p.length) { toast("対象の項目がありません"); return; }
      go("card"); return;
    }
    if (p.length < 4) { toast("4件以上必要です"); return; }
    quiz = { list: p, idx: 0, mode, answers: [], judged: null,
      pool: ITEMS, cat: scope || "全カテゴリ",
      range: [blks[0]?.gs ?? 1, blks[blks.length - 1]?.ge ?? ITEMS.length] };
    go("quizrun");
  }
  if (e.target.id === "t_go") {
    const mode = "m2t";
    const power = view.room === "power";
    let p;
    if (power) {
      // 固定構成: POWER_SPEC(漢字40・他各10)に従い、存在するカテゴリから出題
      const take = (cat, n) => shuffle([...byCat(cat)]).slice(0, n);
      p = shuffle(POWER_SPEC.flatMap(([c, n]) => take(c, n)));
    } else {
      // 50問構成: 範囲から45問以上 + 前の枠の✕を5問以内(先の問題は出ない)
      const blockItems = ITEMS.slice(view.gs - 1, view.ge);
      const earlierWrongs = ITEMS.slice(0, view.gs - 1)
        .filter(i => testWeak(i.id)); // クイズ・カードの✕は混入しない
      const review = shuffle([...earlierWrongs]).slice(0, 5);
      const nRange = Math.min(blockItems.length, 50 - review.length);
      p = shuffle(shuffle([...blockItems]).slice(0, nRange).concat(review));
    }
    if (p.length < 4) { toast("4件以上必要です"); return; }
    test = { list: p, idx: 0, mode, answers: [],
      pool: ITEMS,
      cat: power ? "全カテゴリ" : view.cat,
      range: power ? [1, ITEMS.length] : [view.gs, view.ge],
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
    const blob = new Blob([JSON.stringify({ progress: PROGRESS, results: RESULTS, overrides: OVERRIDES, stdm: stdm }, null, 1)],
      { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "kokugo_progress.json"; a2.click();
  }
  if (e.target.id === "d_import") $("#d_file").click();
  if (e.target.id === "d_reset") {
    if (confirm("学習記録・履歴・stdmをすべて消去しますか？")) {
      PROGRESS = {}; RESULTS = []; stdm = 0;
      saveProgress(); saveResults(); savestdm();
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
        if (typeof d.stdm === "number") { stdm = d.stdm; savestdm(); }
        saveProgress(); saveResults(); toast("インポートしました"); render();
      } catch { toast("読み込めませんでした"); }
    };
    r.readAsText(e.target.files[0]);
  }
});
document.addEventListener("input", (e) => {
});
document.addEventListener("keydown", (e) => { // 入力式でEnter=回答
  if (e.key !== "Enter" || e.target.id !== "ans_in") return;
  const btn = document.querySelector('[data-act="answer_in"],[data-act="tanswer_in"]');
  if (btn) { e.preventDefault(); btn.click(); }
});
$("#backbtn").addEventListener("click", () => go("home"));
$("#brand").addEventListener("click", () => go("home"));

// ---------- 起動 ----------
async function boot() {
  PROGRESS = loadJSON(LS_PROGRESS, {});
  RESULTS = loadJSON(LS_RESULTS, []);
  OVERRIDES = loadJSON(LS_OVERRIDE, {});
  stdm = +(localStorage.getItem(LS_stdm) || 0);
  POWER_ON = localStorage.getItem(LS_POWER) === "1";
  study = Object.assign({ day: todayStr(), sec: 0, total: 0, paidStdm: 0 }, loadJSON(LS_TIME, {}));
  ADJUSTS = loadJSON(LS_ADJUST, []);
  if (study.day !== todayStr()) { study.day = todayStr(); study.sec = 0; }
  setInterval(studyTick, 1000);
  document.addEventListener("pointerdown", () => { lastActivity = Date.now(); }, { passive: true });
  document.addEventListener("keydown", () => { lastActivity = Date.now(); });
  window.addEventListener("blur", () => { winFocused = false; });
  window.addEventListener("focus", () => { winFocused = true; lastActivity = Date.now(); });
  window.addEventListener("pagehide", () => saveStudy());
  try {
    ITEMS = await (await fetch("items.json")).json();
  } catch {
    ITEMS = [];
    $("#app").innerHTML =
      '<div class="card"><p>items.json を読み込めません。データ生成後に再読み込みしてください。</p></div>';
    return;
  }
  applyOverrides();
  // 全体通し番号用にカテゴリ順で並べ替え
  const rank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  ITEMS.sort((x, y) => rank(x.cat) - rank(y.cat));
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
