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
const LS_HIDDEN = "kv_hidden_v1";
const LS_RESULTS = "kv_results_v1";
const LS_stdm = "kv_stdm_v1";
const LS_TIME = "kv_study_time_v1";
const LS_ADJUST = "kv_stdm_adjust_v1";
const LS_SCHED = "kv_sched_v1";
const LS_EARN = "kv_earn_v1";
const LS_USER = "kv_user_v1";
const ADMIN_PIN = "0000";
let USER = localStorage.getItem(LS_USER) || "";
// ユーザー別キー: 学習記録・結果・stdm・勉強時間・調整・50日プラン・獲得履歴は
// ユーザーごとに完全独立。項目の修正(kv_item_override)と非表示(kv_hidden)は共有。
const uk = k => `${k}__${USER}`;
const USER_SCOPED = [LS_PROGRESS, LS_RESULTS, LS_stdm, LS_TIME, LS_ADJUST, LS_SCHED, LS_EARN, "kv_stdm_recalc_v1"];
const SEC_SIZE = 50;
// 全体通し番号のカテゴリ順(1〜漢字→慣用句→四字熟語→ことわざ)
const CAT_ORDER = ["漢字", "慣用句", "四字熟語", "ことわざ"];

const ROOMS = [
  { key: "jisho", label: "辞書の部屋", icon: "📖",
    desc: "語句を検索できます（実施中はロック）" },
  { key: "prep", label: "テスト対策の部屋", icon: "📝",
    desc: "間違いストックからランダム10問・即時〇✕判定" },
  { key: "wtest", label: "週間テストの部屋", icon: "📋", gold: true,
    desc: "週間ノルマ達成で解放・25問×4点・間違い中心" },
];
const KIND_JP = { quiz: "クイズ", test: "テスト", power: "実力テスト", sched: "50日プラン", wtest: "週間テスト" };

let ITEMS = [];
let PROGRESS = {};   // id -> {c,w,s,tc,tw,ts,last}
let RESULTS = [];    // {ts,kind,cat,range:[a,b],n,ok,wrongIds,pts?}
let OVERRIDES = {};
let HIDDEN = { ids: [], items: {} }; // 辞書の部屋で✕した項目(アプリから消える)
let stdm = 0;
// 勉強時間: 問題を解いている時間のみ計測。2分無操作/離席で一時停止。
// 2分勉強 = 1stdm
let study = { day: "", sec: 0, total: 0, paidStdm: 0 };
let ADJUSTS = []; // {ts,amount,memo} stdm手動増減ログ
// 50日・4周プラン: {start:"YYYY-MM-DD", base:1日基準ノルマ,
//   items:{id:{cc,w,fast,plat}}, days:{"Y-M-D":{clears,seen:[ids]}}}
let SCHED = { start: "", base: 0, items: {}, days: {} };
let EARN = [];       // {ts,day,amount,label} stdm増減履歴
let lastStdmShown = 0; // ホーム表示のカウントアップ起点
let runStartTotal = 0; // 実行開始時点の累計勉強秒(セッション使用時間の算出用)
let view = { name: "home" };
let quiz = null;     // {list,idx,mode,answers,judged,pool,cat,range}
let test = null;     // {list,idx,mode,answers,cur,pool,cat,range,kind}
let cardSet = { list: [], idx: 0, flipped: false };

// ---------- 永続化 ----------
function loadJSON(k, d) {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
}
const saveProgress = () => localStorage.setItem(uk(LS_PROGRESS), JSON.stringify(PROGRESS));
const saveResults = () => localStorage.setItem(uk(LS_RESULTS), JSON.stringify(RESULTS));
const saveOverrides = () => localStorage.setItem(LS_OVERRIDE, JSON.stringify(OVERRIDES));
const saveHidden = () => localStorage.setItem(LS_HIDDEN, JSON.stringify(HIDDEN));
const savestdm = () => localStorage.setItem(uk(LS_stdm), String(stdm));
const saveStudy = () => localStorage.setItem(uk(LS_TIME), JSON.stringify(study));
const saveSched = () => localStorage.setItem(uk(LS_SCHED), JSON.stringify(SCHED));
const saveEarn = () => localStorage.setItem(uk(LS_EARN), JSON.stringify(EARN));
// stdm増減＋履歴記録(merge指定時は同日・同ラベルの直近行に集約)
function stdmEarn(amount, label, merge) {
  stdm = Math.max(0, stdm + amount); savestdm();
  const k = todayStr();
  if (merge) {
    const last = EARN[EARN.length - 1];
    if (last && last.day === k && last.label === label) { last.amount += amount; saveEarn(); return; }
  }
  EARN.push({ ts: new Date().toISOString(), day: k, amount, label });
  if (EARN.length > 500) EARN.splice(0, EARN.length - 500);
  saveEarn();
}
function earnToday() {
  const k = todayStr();
  return EARN.filter(x => x.day === k && x.amount > 0).reduce((a, x) => a + x.amount, 0);
}
function applyOverrides() {
  for (const it of ITEMS) {
    const o = OVERRIDES[it.id];
    if (o) Object.assign(it, o);
  }
}
const catRank = (c) => { const i = cats().indexOf(c); return i < 0 ? 99 : i; };
function resortItems() { ITEMS.sort((x, y) => catRank(x.cat) - catRank(y.cat)); }
function applyHidden() {
  const hid = new Set(HIDDEN.ids);
  ITEMS = ITEMS.filter(i => !hid.has(i.id));
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
function cats() { // データ中の出現順にカテゴリを列挙
  const seen = [];
  for (const i of ITEMS) if (i.cat && !seen.includes(i.cat)) seen.push(i.cat);
  return seen;
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
function stdmAward(pts) { // 週間テスト(100点満点)のstdm付与
  if (pts >= 100) return 1000;
  if (pts >= 80) return 500;
  if (pts >= 65) return 300;
  return 100;
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

// ---------- 50日・4周スケジュール ----------
// 各問題は clear_count(cc:0〜4)を持ち、正解ごとに+1。
// 1〜3周をすべて正解かつ各3秒以内の即答なら「完全定着(プラチナ)」=4周目を免除。
// 1日のノルマは「残りクリア数÷残り日数」で毎日自動再計算し、
// 未達や先取りは翌日以降に平準化される。
const SCHED_DAYS = 50;
function isoDay() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function schedElapsed() { // 開始日からの経過日数(開始当日=0)
  if (!SCHED.start) return 0;
  const s = new Date(SCHED.start + "T00:00:00");
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t - s) / 86400000));
}
function schedDone() { // 累計クリア数(プラチナはcc4として済)
  let n = 0;
  for (const id in SCHED.items) n += Math.min(4, SCHED.items[id].cc || 0);
  return n;
}
function schedToday() { // 当日レコード(初アクセス時にその日のノルマを確定)
  const k = todayStr();
  let d = SCHED.days[k];
  if (!d) {
    const daysLeft = Math.max(1, SCHED_DAYS - schedElapsed());
    const remain = Math.max(0, ITEMS.length * 4 - schedDone());
    d = SCHED.days[k] = { clears: 0, seen: [], quota: Math.ceil(remain / daysLeft) };
    saveSched();
  }
  return d;
}
function schedStatus() {
  const total = ITEMS.length * 4;
  const base = Math.ceil(total / SCHED_DAYS); // 常に現在の問題数から算出
  const elapsed = schedElapsed();
  const dayNo = elapsed + 1;
  const daysLeft = Math.max(1, SCHED_DAYS - elapsed);
  const done = schedDone();
  const remain = Math.max(0, total - done);
  const dq = SCHED.days[todayStr()]?.quota; // 確定済みなら当日ノルマを固定
  return {
    total, base, elapsed, dayNo, daysLeft, done, remain,
    quota: dq != null ? dq : Math.ceil(remain / daysLeft),
    todayDone: SCHED.days[todayStr()]?.clears || 0,
    ahead: done - Math.min(dayNo, SCHED_DAYS) * base,
  };
}
// 出題上の周バケツ: cc0=1周目 cc1=2周目 cc2=3周目 cc3または誤答あり=4周目
function schedBucket(id) {
  const s = SCHED.items[id];
  const cc = s ? s.cc : 0;
  if (cc >= 4) return 0;
  return (cc === 3 || (s && s.w > 0)) ? 4 : cc + 1;
}
function schedBreakdown() {
  const c = [0, 0, 0, 0, 0];
  let plat = 0;
  for (const it of ITEMS) {
    const s = SCHED.items[it.id];
    if (s && s.cc >= 4) { c[0]++; if (s.plat) plat++; continue; }
    c[schedBucket(it.id)]++;
  }
  return { c, plat };
}
function schedMark(id, ok, fast) {
  let s = SCHED.items[id];
  if (!s) s = SCHED.items[id] = { cc: 0, w: 0, fast: 0 };
  const d = schedToday();
  if (!d.seen.includes(id)) d.seen.push(id);
  if (ok) {
    const before = s.cc;
    s.cc = Math.min(4, s.cc + 1);
    if (fast) s.fast++;
    s.wok = (s.wok || 0) + 1; // 誤答後の連続正解(ストック克服判定用)
    s.last = "ok";
    // 1〜3周すべて正解かつ3秒以内 → 4周目をスキップして完全定着
    if (s.cc === 3 && s.w === 0 && s.fast >= 3) { s.cc = 4; s.plat = true; }
    d.clears += s.cc - before; // プラチナは免除された4周目分も加算
    const st = schedStatus();
    if (!d.bonus && st.quota > 0 && d.clears >= st.quota) {
      d.bonus = true;
      stdmEarn(100, "ノルマ達成ボーナス");
      toast("🎉 今日のノルマ達成！ +100 stdm");
    }
  } else {
    s.w++; s.wok = 0; s.last = "ng";
    if (SCHED.prepOk) delete SCHED.prepOk[id]; // 本編で間違え直したら確認済みを解除
  }
  saveSched();
}

// 10問セット生成: 今日出た問題(および同一問題文)は原則出さず、
// 未出題プールが尽きた場合のみ最終手段として再利用する
function schedPick(n) {
  const seen = new Set(schedToday().seen);
  const seenText = new Set();
  for (const it of ITEMS) if (seen.has(it.id)) seenText.add(it.question.trim());
  const pools = [[], [], [], [], []], last = [[], [], [], [], []];
  for (const it of ITEMS) {
    const b = schedBucket(it.id);
    if (!b) continue;
    (seen.has(it.id) || seenText.has(it.question.trim()) ? last : pools)[b].push(it);
  }
  for (let b = 1; b <= 4; b++) { shuffle(pools[b]); shuffle(last[b]); }
  const out = [], pickedText = new Set();
  const take = pool => {
    while (out.length < n) {
      let took = false;
      for (let b = 1; b <= 4 && out.length < n; b++)
        if (pool[b].length) {
          const it = pool[b].shift();
          if (!pickedText.has(it.question.trim())) {
            out.push(it); pickedText.add(it.question.trim());
          }
          took = true;
        }
      if (!took) break;
    }
  };
  take(pools);
  if (out.length < n) take(last);
  return shuffle(out);
}
function schedStart(mission, n) {
  const p = schedPick(n);
  if (p.length < 4) { toast("出題できる問題が残っていません"); return; }
  quiz = { list: p, idx: 0, mode: "q4", answers: [], judged: null, sched: true,
    mission, pool: ITEMS, cat: "50日プラン", range: [1, p.length] };
  go("quizrun");
}
// 週間テスト: 1週間分のノルマ(基準ノルマ×7)達成ごとに1回解放
function weeklyStatus() {
  const per = 7 * Math.ceil(ITEMS.length * 4 / SCHED_DAYS);
  const completed = SCHED.start ? Math.floor(schedDone() / per) : 0;
  const taken = SCHED.wcount || 0;
  const avail = Math.max(0, completed - taken);
  return { per, avail, need: avail ? 0 : (completed + 1) * per - schedDone() };
}
// 直近7日(今日含む)に出題した問題id集合(週間テスト・対策部屋の範囲)
function seen7Set() {
  const s7 = new Set();
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    (SCHED.days[k]?.seen || []).forEach(id => s7.add(id));
  }
  return s7;
}
// 25問×4点: 間違えた問題を中心に、直近7日の出題済み+周回プールで補充
function weeklyTestStart() {
  const st = weeklyStatus();
  if (!st.avail) { toast(`🔒 週間ノルマ達成で解放されます（あと${st.need}クリア）`); return; }
  const seen7 = seen7Set();
  const wrongs = shuffle(ITEMS.filter(it => {
    const s = SCHED.items[it.id];
    return s && s.w > 0 && (s.cc || 0) < 4;
  })).slice(0, 15);
  const wrongIds = new Set(wrongs.map(i => i.id));
  const rest = shuffle(ITEMS.filter(it => seen7.has(it.id) && !wrongIds.has(it.id)))
    .slice(0, 25 - wrongs.length);
  let p = wrongs.concat(rest);
  if (p.length < 25) p = p.concat(schedPick(25 - p.length));
  if (p.length < 4) { toast("まだ出題できる問題がありません"); return; }
  test = { list: shuffle(p.slice(0, 25)), idx: 0, mode: "q4", answers: [], pool: ITEMS,
    cat: "週間テスト", range: [1, 25], kind: "wtest" };
  go("testrun");
}
// ---------- テスト対策の部屋 ----------
// 週間テスト範囲(直近7日の出題)の間違いを中心に10問練習・即時〇✕判定。
// プランの周回記録(cc)には影響せず、通常の学習記録のみ更新。
// 間違いストック: 誤答のあと連続2回正解(克服)するまで蓄積
function prepWrongs() {
  return ITEMS.filter(it => {
    const s = SCHED.items[it.id];
    return s && s.w > 0 && (s.wok || 0) < 2 && !(SCHED.prepOk || {})[it.id];
  });
}
// 対策テストの記録は「確認済みフラグ」と直近正誤マークのみ(学習記録には影響しない)
function prepMark(id, ok) {
  if (!SCHED.prepOk) SCHED.prepOk = {};
  if (ok) SCHED.prepOk[id] = 1; else delete SCHED.prepOk[id];
  const s = SCHED.items[id] || (SCHED.items[id] = { cc: 0, w: 0, fast: 0 });
  s.last = ok ? "ok" : "ng";
  saveSched();
}
// 直近の正誤マーク(プラン・週テスト・対策のどれで解いても更新される)
function lastMark(id) {
  const l = (SCHED.items[id] || {}).last;
  return l === "ok" ? '<span class="lmark ok">◯</span>'
       : l === "ng" ? '<span class="lmark ng">✕</span>' : "";
}
function prepStart() { // 今週の範囲の間違い問題から10問
  const s7 = seen7Set();
  const w7 = prepWrongs().filter(it => s7.has(it.id));
  const p = shuffle(w7).slice(0, 10);
  if (!p.length) { toast("確認が必要な問題はありません"); return; }
  quiz = { list: shuffle(p), idx: 0, mode: "q4", answers: [], judged: null, prep: true,
    prepMode: "wrong", pool: ITEMS, cat: "テスト対策", range: [1, p.length] };
  go("quizrun");
}
function vPrep() {
  const s7 = seen7Set();
  const weekItems = ITEMS.filter(it => s7.has(it.id));
  const w7 = prepWrongs().filter(it => s7.has(it.id));
  return `<div class="card">
    <h2>📝 テスト対策の部屋</h2>
    <p class="muted"><b>今週のテスト範囲</b>（直近7日に出題した問題）の中で
    <b>間違えた問題</b>から10問を出題します。正解した問題は「確認済み」になり、
    解答した時点で〇✕判定と正解・解説が表示されます。</p>
    <p class="muted">${w7.length
      ? `あと <b>${w7.length}問</b> 確認が必要です（間違えた問題を中心に出題）。`
      : `今週の範囲で確認が必要な問題はありません。`}</p>
    <div class="wkmarks">${weekItems.slice(0, 200).map(it => {
      const s = SCHED.items[it.id] || {};
      const bad = s.last === "ng" || (s.last !== "ok" && s.w > 0 && !(s.wok > 0));
      return `<span class="${bad ? "ng" : "ok"}">${bad ? "✕" : "◯"}</span>`;
    }).join("")}${weekItems.length > 200 ? `<span class="muted small">…他${weekItems.length - 200}問</span>` : ""}</div>
    <button class="bigbtn" data-act="prepset" ${w7.length ? "" : "disabled"}>10問テストを開始 ▶</button>
    <div class="btnrow"><button class="ghost" data-nav="result">📊 過去の結果・進捗を見る →</button></div>
  </div>`;
}

// ホームのプランパネル(前半6セット/後半の2分割表示＋先取り)
function vSchedCard() {
  if (!ITEMS.length) return "";
  const total = ITEMS.length * 4;
  const baseN = Math.ceil(total / SCHED_DAYS);
  if (!SCHED.start) {
    return `<div class="card schedcard">
      <h2>📅 50日・4周プラン</h2>
      <p class="muted">全${ITEMS.length}問 × 4周 ＝ ${total}クリアを${SCHED_DAYS}日で完走。
      1日のノルマ(基準${baseN}問＝10問×${Math.ceil(baseN / 10)}セット)は残りクリア数÷残り日数で毎日自動計算。
      1〜3周すべて3秒以内に正解した問題は💎完全定着となり4周目を免除されます。</p>
      <button class="bigbtn" data-act="schedstart">プランを開始（今日が1日目）</button>
    </div>`;
  }
  const st = schedStatus();
  const bd = schedBreakdown();
  const amT = Math.min(60, st.quota), pmT = st.quota - amT;
  const amDone = Math.min(st.todayDone, amT);
  const pmDone = Math.min(Math.max(0, st.todayDone - amT), pmT);
  const quotaDone = st.quota > 0 && st.todayDone >= st.quota;
  const pct = Math.min(100, Math.round(st.done / st.total * 100));
  const todayPct = st.quota ? Math.min(100, Math.round(st.todayDone / st.quota * 100)) : 100;
  const pace = st.ahead > 0
    ? `<p class="sched-ahead">🚀 現在 ${(st.ahead / st.base).toFixed(1)}日分 先取り中！（＋${st.ahead}問貯金）</p>`
    : st.ahead < 0
      ? `<p class="muted">📈 予定ペースまであと ${-st.ahead}問</p>`
      : `<p class="muted">📈 ちょうど予定どおりのペースです</p>`;
  const mission = (label, done, t, m) => t <= 0 ? "" : `
    <div class="mission">
      <div class="mission-l"><b>${label}</b><span class="muted small">${t}問・${Math.ceil(t / 10)}セット</span></div>
      <div class="mission-m"><div class="bar"><i style="width:${Math.round(done / t * 100)}%"></i></div>
        <span class="muted small">${done}/${t}</span></div>
      ${done >= t
        ? `<span class="mdone">✓ 完了</span>`
        : `<button class="primary" data-act="schedset" data-mission="${m}" data-n="10">10問セット ▶</button>`}
    </div>`;
  const wk = weeklyStatus();
  const wRow = `<div class="mission wtest">
      <div class="mission-l"><b>📋 週間テスト</b><span class="muted small">週間ノルマ(${wk.per}クリア)達成ごとに解放</span></div>
      <div class="mission-m"></div>
      ${wk.avail
        ? `<button class="primary" data-act="wtest">受験可能 ${wk.avail}回 ▶</button>`
        : `<span class="muted small">🔒 あと${wk.need}クリア</span>`}
    </div>`;
  return `<div class="card schedcard">
    <h2>📅 50日・4周プラン <span class="muted small">${st.dayNo}日目/${SCHED_DAYS}日・残り${st.daysLeft}日</span></h2>
    <div class="muted small">全体 ${st.done}/${st.total}クリア（${pct}%）
      　1周目${bd.c[1]}・2周目${bd.c[2]}・3周目${bd.c[3]}・4周目${bd.c[4]}・完了${bd.c[0]}（💎${bd.plat}）</div>
    <div class="bar big"><i style="width:${pct}%"></i></div>
    ${pace}
    ${wRow}
    ${st.remain <= 0
      ? `<p class="sched-ahead">🎊 全${st.total}クリア完了！お疲れさまでした！</p>`
      : `<h3>今日のノルマ: ${st.todayDone}/${st.quota}問（${todayPct}%）</h3>
         <div class="bar"><i style="width:${todayPct}%"></i></div>
         ${quotaDone
           ? `<p class="sched-ahead">🎉 今日のノルマ達成！</p>
              <button class="bigbtn" data-act="schedset" data-mission="extra" data-n="10">明日以降の分を先取りする（10問セット）</button>`
           : `${mission("☀️ 前半ミッション", amDone, amT, "am")}
              ${mission("🌙 後半ミッション", pmDone, pmT, "pm")}`}`}
  </div>`;
}

// ---------- 描画 ----------
function render() {
  const inRoom = view.name !== "home" && view.name !== "data" && view.name !== "userselect";
  const room = ROOMS.find(r => r.key === view.room);
  $("#backbtn").style.display = inRoom ? "" : "none";
  const lb = $("#logoutbtn");
  lb.style.display = (USER && view.name !== "userselect") ? "" : "none";
  lb.textContent = `${USER === "admin" ? "🛠 管理者" : "🌸 こはる"} ▸ ログアウト`;
  $("#headtitle").textContent = inRoom
    ? (room ? `${room.icon} ${room.label}` : (view.name === "admin" ? "管理者"
      : view.name === "earnlog" ? "🪙 stdm履歴"
      : (view.name === "result" || view.name === "resultdetail") ? "📊 結果・進捗" : ""))
    : "";
  const el = $("#app");
  const v = view.name;
  if (v === "home") el.innerHTML = vHome();
  else if (v === "catpick") el.innerHTML = vCatPick();
  else if (v === "quizsetup") el.innerHTML = vQuizSetup();
  else if (v === "quizrun") el.innerHTML = vQuizRun();
  else if (v === "quizend") el.innerHTML = vQuizEnd();
  else if (v === "card") el.innerHTML = vCard();
  else if (v === "testrun") el.innerHTML = vTestRun();
  else if (v === "testend") el.innerHTML = vTestEnd();
  else if (v === "prep") el.innerHTML = vPrep();
  else if (v === "result") el.innerHTML = vResult();
  else if (v === "resultdetail") el.innerHTML = vResultDetail();
  else if (v === "list") el.innerHTML = vList();
  else if (v === "edit") el.innerHTML = vEdit();
  else if (v === "data") el.innerHTML = vData();
  else if (v === "admin") el.innerHTML = vAdmin();
  else if (v === "earnlog") el.innerHTML = vEarnLog();
  else if (v === "userselect") el.innerHTML = vUserSelect();
  animateStdm();
}
const ADMIN_ONLY = new Set(["admin", "data"]);
function go(name, params = {}) {
  if (!USER && name !== "userselect") name = "userselect";
  if (USER === "koharu" && ADMIN_ONLY.has(name)) { toast("管理者のみ使えます"); return; }
  const wasRun = RUN_VIEWS.has(view.name);
  const isRun = RUN_VIEWS.has(name);
  if (isRun && !wasRun) runStartTotal = study.total;
  view = { name, ...params }; render(); window.scrollTo(0, 0);
}
const fmtDur = (s) => `${Math.floor(s / 60)}分${Math.round(s % 60)}秒`;
// ホーム表示時に所有stdmをカウントアップさせる(前回表示値→現在値)
function animateStdm() {
  const el = $("#stdmnum");
  if (!el || !el.dataset) return;
  const to = +el.dataset.to, from = +el.dataset.from || 0;
  lastStdmShown = to;
  if (to <= from || to - from > 5000) { el.textContent = to.toLocaleString(); return; }
  const t0 = performance.now(), dur = Math.min(1200, 300 + (to - from) * 15);
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- stdm獲得履歴 ----------
function vEarnLog() {
  const rows = EARN.slice().reverse().map(x =>
    `<div class="listrow">
      <span class="t" style="color:${x.amount >= 0 ? "#16a34a" : "var(--ng)"}">${x.amount >= 0 ? "+" : ""}${x.amount} stdm</span>
      <span class="m">${esc(x.label || "")}</span>
      <span class="muted small">${fmtTs(x.ts)}</span>
    </div>`).join("");
  return `<div class="card">
    <h2>🪙 stdm 獲得履歴</h2>
    <p class="muted">所有 ${stdm.toLocaleString()} stdm ・ 本日 ＋${earnToday()} stdm</p>
    ${rows || `<p class="muted">まだ履歴がありません。セットをクリアすると記録されます。</p>`}
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

// ---------- ホーム ----------
// ---------- トップページ(ユーザー選択) ----------
function vUserSelect() {
  return `<div class="card" style="text-align:center">
    <h2>だれがあそびますか？</h2>
    <div class="choices">
      <button class="choice" data-act="usel" data-u="koharu" style="font-size:20px">🌸 こはる
        <span class="muted small">パスワードなしでロビーへ</span></button>
      <button class="choice" data-act="usel" data-u="admin" style="font-size:20px">🛠 管理者
        <span class="muted small">PIN入力が必要です</span></button>
    </div>
    ${view.pin ? `<div class="btnrow" style="justify-content:center">
      <input id="pin_in" type="password" inputmode="numeric" maxlength="4" placeholder="PIN(4桁)"
        onkeydown="if(event.key==='Enter')this.nextElementSibling.click()"
        style="width:8em;text-align:center;font-size:20px;padding:6px">
      <button class="primary" data-act="pinok">入る</button></div>` : ""}
  </div>`;
}
async function selectUser(u) {
  USER = u; localStorage.setItem(LS_USER, u);
  await startSession(); go("home");
}
function vHome() {
  const wk = weeklyStatus();
  const rooms = `<div class="card roombox"><div class="roombox-ttl">🏠 学習ルーム</div>` +
    ROOMS.map(r => {
      const lock = r.gold && !wk.avail;
      const sub = r.gold
        ? (wk.avail ? `受験可能 ${wk.avail}回・間違い中心 🔓` : `🔒 週間ノルマ達成で解放（あと${wk.need}クリア）`)
        : r.desc;
      return `<div class="roomrow ${r.gold ? "gold" : ""}" data-nav="${r.key}">
        <span class="ri">${r.icon}</span><span class="rt">${r.label}${lock ? " 🔒" : ""}</span>
        <span class="rs muted small">${esc(sub)}</span><span class="rgo">›</span></div>`;
    }).join("") + `</div>`;
  const total = ITEMS.length;
  const learned = ITEMS.filter(i => statusOf(i.id) !== "new").length;
  const mastered = ITEMS.filter(i => statusOf(i.id) === "master").length;
  const correct = Object.values(PROGRESS).reduce((a, r) => a + r.c, 0);
  const st2 = SCHED.start ? schedStatus() : null;
  const aheadTxt = st2 && st2.ahead > 0 ? `｜ 🚀 先取り ＋${(st2.ahead / st2.base).toFixed(1)}日分` : "";
  return `<div class="stdmbar bigstdm" data-nav="earnlog" title="タップで獲得履歴">
    <div class="coin">🪙</div>
    <div class="stdmmain">
      <div><span id="stdmnum" data-from="${lastStdmShown}" data-to="${stdm}">${stdm.toLocaleString()}</span><span class="stdmunit">stdm</span></div>
      <div class="stdmsub">本日 ＋${earnToday()} stdm${aheadTxt}</div>
    </div>
    <div class="stdmgo">履歴 ›</div>
  </div>
    ${vSchedCard()}
    ${rooms}
    <p class="muted mt">累計◯${correct}件 / 挑戦済み${learned}件 / 克服${mastered}件（全${total}件）</p>
    <p class="muted">${USER === "admin" ? `<button class="ghost" data-nav="data">データ管理 →</button>
    <button class="ghost adminbtn" data-nav="admin">管理者</button>` : ""}
    <button class="ghost" data-act="logout">ユーザーを切り替え</button></p>`;
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
    <p class="muted small">出題形式: 4択問題（選択肢は問題ごとに固定）</p>
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
    .sort((a, b) => b.w - a.w || qt(a.it).localeCompare(qt(b.it), "ja"))
    .slice(0, 300);
  const tabs = Array.from({ length: 10 }, (_, i) =>
    `<button class="chip ${i === page ? "on" : ""}" data-act="rpage" data-p="${i}">${i * 30 + 1}〜${i * 30 + 30}</button>`).join("");
  const rows = ranked.slice(page * 30, page * 30 + 30).map((x, i) =>
    `<div class="listrow">
      <span class="rank">${page * 30 + i + 1}位</span>
      <span class="t">${esc(qt(x.it))}</span>
      <span class="y">${esc(x.it.sub || x.it.cat)}</span>
      <span class="m">✕${x.w}回</span>
    </div>`).join("");
  return `<div class="card">
    <h3>よく間違える問題ランキング</h3>
    ${ranked.length ? `<div class="chips" style="overflow-x:auto;flex-wrap:nowrap">${tabs}</div>${rows || "<p class='muted'>このページはありません</p>"}`
      : `<p class="muted">まだ間違えた問題がありません。</p>`}
  </div>`;
}

// ---------- 4択クイズ実行 ----------
// 新形式: 問題は固定の選択肢(options)とanswerIndexを持つ。
// 正解が先頭に偏るデータのため表示時にシャッフル(同じ問題はセッション内で順序固定)
const _optCache = new WeakMap();
function fixedQ(it) {
  let options = _optCache.get(it);
  if (!options) {
    options = shuffle(it.options.map(v => ({ v, yomi: v })));
    _optCache.set(it, options);
  }
  return { options, answer: it.options[it.answerIndex] };
}
// 一覧・結果表示用の短いタイトル(問題文の最終行=実際の設問文)
function qt(it) { return (it.question || it.text || "").split("\n").slice(-1)[0].slice(0, 60); }
function qPrompt(it) {
  return `<div class="q-prompt">${esc(it.question).replace(/\n/g, "<br>")}</div>`;
}
// 入力した読みを正規化(カタカナ→ひらがな・空白/括弧除去)
function normYomi(s) {
  return (s || "")
    .replace(/[ァ-ヴ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s　]/g, "");
}

function pickModes(list) { return list.map(() => "q4"); }
function vQuizRun() {
  const { list, idx } = quiz;
  const it = list[idx];
  const { options, answer } = fixedQ(it);
  quiz.cur = { answer, options, userAns: null };
  const judged = quiz.judged;
  if (!judged) quiz.qStart = Date.now(); // 即答判定(3秒)用の提示時刻
  const roundTag = quiz.sched
    ? `　${["", "1周目", "2周目", "3周目", "4周目"][schedBucket(it.id)] || ""}` : "";
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="answer" data-i="${i}">${esc(o.v)}</button>`).join("");
  const side = `<div class="card side">
      ${judged ? `
        <p><b>正解:</b> ${esc(it.options[it.answerIndex])}</p>
        ${it.explanation ? `<p class="muted"><b>解説:</b> ${esc(it.explanation)}</p>` : ""}
      ` : `<p class="muted">答えると、正解と解説がここに表示されます。</p>`}
    </div>`;
  return `<div class="panes"><div class="card">
      <div class="muted">${idx + 1} / ${list.length}　${esc(quiz.cat)}${roundTag}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${judged
        ? `<div class="judge ${judged.ok ? "ok" : "ng"}">${judged.ok ? "⭕" : "❌"}</div>
           ${qPrompt(it)}
           <p class="center"><b>正解: ${esc(it.options[it.answerIndex])}</b></p>
           <button class="bigbtn" data-act="nextq">${idx + 1 < list.length ? "次へ" : "結果を見る"}</button>`
        : `${qPrompt(it)}<div class="choices">${opts}</div>
           <div class="btnrow"><button class="ghost" data-act="quit">やめる</button></div>`}
    </div>${side}</div>`;
}

function vQuizEnd() {
  const ok = quiz.answers.filter(a => a.ok).length;
  const wrongs = quiz.answers.filter(a => !a.ok)
    .map(a => ITEMS.find(i => i.id === a.id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(qt(it))}</span>
     <span class="y">${esc(it.sub || it.cat)}</span><span class="m"></span></div>`).join("");
  const schedInfo = quiz.sched ? (() => {
    const st = schedStatus();
    return `<hr><h3>📅 50日プラン</h3>
      <p class="muted">今日 ${st.todayDone}/${st.quota}問・累計 ${st.done}/${st.total}クリア</p>
      ${st.todayDone >= st.quota
        ? `<p class="sched-ahead">🎉 今日のノルマ達成！</p>
           <button class="bigbtn" data-act="schedset" data-mission="extra" data-n="10">明日以降の分を先取りする（10問セット）</button>`
        : `<button class="bigbtn" data-act="schedset" data-mission="extra" data-n="10">続けて10問セット ▶</button>`}`;
  })() : "";
  const prepInfo = quiz.prep ? `<hr>
    <button class="bigbtn" data-act="prepset" data-mode="${esc(quiz.prepMode || "wrong")}">続けて10問練習 ▶</button>
    <div class="btnrow"><button data-nav="prep">テスト対策の部屋へ</button></div>` : "";
  return `<div class="card">
    <h2>結果: ${ok} / ${quiz.answers.length} 問正解</h2>
    ${wrongs.length ? `<h3>間違えた問題 (${wrongs.length})</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="retry" data-src="quiz">間違えた問題だけやり直す</button></div>` : `<p>全問正解！</p>`}
    ${schedInfo}
    ${prepInfo}
    <div class="btnrow">
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- カード ----------
function vCard() {
  const { list, idx, flipped } = cardSet;
  if (!list.length || idx >= list.length)
    return `<div class="card"><h2>このセットは完了です</h2>
      <div class="btnrow"><button data-nav="home">ホームへ</button></div></div>`;
  const it = list[idx];
  const front = `<div class="card flash" data-act="flip">
      <div class="muted">${idx + 1} / ${list.length}　${esc(it.cat)} ${STATUS_BADGE[statusOf(it.id)]}</div>
      <div class="q-prompt">${esc(it.question).replace(/\n/g, "<br>")}</div>
      <div class="hint">${flipped ? "" : "タップで答えを表示"}</div>
    </div>`;
  const side = `<div class="card side">
      ${flipped ? `
        <p><b>正解:</b> ${esc(it.options[it.answerIndex])}</p>
        ${it.explanation ? `<p class="muted"><b>解説:</b> ${esc(it.explanation)}</p>` : ""}
      ` : `<p class="muted">カードをめくると、正解と解説がここに表示されます。</p>`}
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
  const { list, idx } = test;
  const it = list[idx];
  const { options, answer } = fixedQ(it);
  test.cur = { answer, options };
  if (test.qIdx !== test.idx) { test.qIdx = test.idx; test.qStart = Date.now(); }
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="tanswer" data-i="${i}">${esc(o.v)}</button>`).join("");
  return `<div class="panes"><div class="card">
      <div class="muted">📋 週間テスト　${idx + 1} / ${list.length}　${esc(test.cat)}</div>
      <div class="progress">${list.map((_, i) =>
        `<i class="${i < idx ? "f" : ""}"></i>`).join("")}</div>
      ${qPrompt(it)}
      <div class="choices">${opts}</div>
      <div class="btnrow"><button class="ghost" data-act="quit">やめる</button></div>
    </div>
    <div class="card side"><p class="muted">本番形式: 答えはテスト終了後にまとめて表示されます。</p></div>
  </div>`;
}

function vTestEnd() {
  const ok = test.answers.filter(a => a.ok).length;
  const pts = ok * 4; // 25問×4点=100点満点
  const got = stdmAward(pts);
  const wrongs = test.answers.filter(a => !a.ok)
    .map(a => ITEMS.find(i => i.id === a.id)).filter(Boolean);
  const rows = wrongs.map(it =>
    `<div class="listrow"><span class="t">${esc(qt(it))}</span>
     <span class="y">${esc(it.sub || it.cat)}</span><span class="m"></span></div>`).join("");
  return `<div class="card">
    <h2>週間テスト結果: ${pts}点 / 100点満点 (${ok}/${test.answers.length}問正解)</h2>
    <p class="stdm">+${got} stdm 獲得！(所有: ${stdm} stdm)</p>
    ${wrongs.length ? `<h3>間違えた問題 (${wrongs.length})</h3>${rows}
      <div class="btnrow"><button class="primary" data-act="retry" data-src="test">間違えた問題だけクイズで練習</button></div>` : `<p>全問正解！</p>`}
    <div class="btnrow">
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
    `<div class="listrow"><span class="t">${esc(qt(it))}</span>
     <span class="y">${esc(it.sub || it.cat)}</span><span class="m"></span></div>`).join("");
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
    `${i.question}${i.explanation || ""}`.toLowerCase().includes(kw));
  if (filt === "ng") p = p.filter(i => (SCHED.items[i.id] || {}).last === "ng");
  else if (filt) p = p.filter(i => statusOf(i.id) === filt);
  const rows = p.slice(0, 500).map(it =>
    `<div class="listrow" data-act="edit" data-id="${it.id}" style="cursor:pointer">
      <span class="t">${esc(qt(it))}${STATUS_BADGE[statusOf(it.id)]}</span>
      <span class="y">${esc(it.sub || it.cat)}</span>
      <span class="m">${lastMark(it.id)}</span></div>`).join("");
  return `<div class="card">
    <div class="btnrow" style="margin-top:0">
      <select id="l_cat"><option value="">全カテゴリ</option>
        ${cats().map(c => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="l_filt"><option value="">全状態</option>
        ${["new", "weak", "master", "good"].map(s =>
          `<option value="${s}" ${s === filt ? "selected" : ""}>${STATUS_JP[s]}</option>`).join("")}</select>
      <button class="chip ${filt === "ng" ? "on" : ""}" data-act="filtx">✕だけ表示</button>

    </div>
    ${view.sec != null ? `<p class="muted">未習得の残り（タイルから）</p>` : ""}
    <p class="muted">${p.length}件${p.length > 500 ? " (先頭500件表示)" : ""} — タップで詳細・編集</p>
    ${rows || "<p>該当なし</p>"}
  </div>`;
}

function vEdit() {
  const it = ITEMS.find(i => i.id === view.id);
  if (!it) return `<div class="card">見つかりません</div>`;
  const opts = (it.options || []).map((o, i) =>
    `<div class="listrow"><span class="t">${i === it.answerIndex ? "⭕ " : "　 "}${esc(o)}</span></div>`).join("");
  return `<div class="panes"><div class="card">
    <h2>問題の詳細 ${STATUS_BADGE[statusOf(it.id)]} ${lastMark(it.id)}</h2>
    <p class="muted small">${esc(it.cat || "")}${it.sub ? ` / ${esc(it.sub)}` : ""}</p>
    ${qPrompt(it)}
    <h3>選択肢</h3>
    ${opts}
    ${it.explanation ? `<h3>解説</h3><p class="muted">${esc(it.explanation)}</p>` : ""}
    <div class="btnrow">
      ${USER === "admin" ? `<button data-act="delprog">学習記録をリセット</button>` : ""}
      <button data-nav="jisho">戻る</button>
    </div>
  </div>
  <div class="card side">
    <p><b>正解:</b> ${esc(it.options?.[it.answerIndex] ?? "")}</p>
    ${it.explanation ? `<p class="muted">${esc(it.explanation)}</p>` : ""}
  </div></div>`;
}

// ---------- 管理者 ----------
const ATABS = [["quiz", "クイズ管理"], ["test", "テスト管理"], ["wtest", "週間テスト"], ["sched", "50日プラン"]];
function vAdmin() {
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
    <h3>📅 50日・4周プラン</h3>
    <p class="muted">${SCHED.start
      ? `開始日 ${SCHED.start}（${schedStatus().dayNo}日目/${SCHED_DAYS}日・累計${schedDone()}クリア）`
      : "未開始（ホーム画面から開始できます）"}</p>
    <div class="btnrow" style="align-items:flex-end">
      <div><label class="f">開始日</label><input type="date" id="s_start" value="${SCHED.start || isoDay()}"></div>
      <button data-act="scheddate">開始日を設定</button>
      <button data-act="schedreset" style="border-color:var(--ng);color:var(--ng)">プランをリセット</button>
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
    <hr>
    <h3>削除した項目</h3>
    <p class="muted">辞書で✕した項目: ${HIDDEN.ids.length}件（アプリ上から非表示）
      ${HIDDEN.ids.length ? `<button class="ghost" data-act="unhide_all">すべて復元</button>` : ""}</p>
    ${HIDDEN.ids.slice(0, 500).map(id => {
      const it = HIDDEN.items[id];
      return it ? `<div class="listrow"><span class="t">${esc(qt(it))}</span>
        <span class="y">${esc(it.sub || it.cat)}</span><span class="m"></span>
        <button class="ghost" data-act="unhide" data-id="${id}" style="padding:2px 10px">復元</button></div>` : "";
    }).join("")}
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

// ---------- イベント ----------
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    const k = nav.dataset.nav;
    if (k === "wtest") { weeklyTestStart(); return; }
    if (k === "home") go("home");
    else if (k === "data") go("data");
    else if (k === "admin") go("admin");
    else if (k === "earnlog") go("earnlog", { room: "earnlog" });
    else if (k === "jisho") go("list", { room: "jisho" });
    else if (k === "prep") go("prep", { room: "prep" });
    else if (k === "result") go("result", { room: "result", cat: view.cat });
    else go("catpick", { room: k });
    return;
  }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "qscope") { view.qscope = a.dataset.cat; render(); }
    else if (act === "usel") {
      const u = a.dataset.u;
      if (u === "admin" && !view.pin) { view = { name: "userselect", pin: true }; render(); }
      else selectUser(u);
    }
    else if (act === "pinok") {
      const pv = ($("#pin_in")?.value || "").trim();
      if (pv === ADMIN_PIN) selectUser("admin");
      else toast("パスワードが違います");
    }
    else if (act === "logout") {
      localStorage.removeItem(LS_USER); USER = "";
      view = { name: "userselect" }; render();
    }
    else if (act === "tile") {
      go("list", { room: "jisho", cat: a.dataset.cat, sec: +a.dataset.sec, kw: "", filt: "" });
    }
    else if (act === "hide") {
      const it = ITEMS.find(i => i.id === a.dataset.id);
      if (it) {
        HIDDEN.ids.push(it.id);
        HIDDEN.items[it.id] = it;
        ITEMS = ITEMS.filter(i => i.id !== it.id);
        saveHidden(); toast(`「${qt(it)}」を削除しました`);
        if (view.name === "edit") go("list", { room: "jisho" }); else render();
      }
    }
    else if (act === "unhide") {
      const id = a.dataset.id;
      const it = HIDDEN.items[id];
      HIDDEN.ids = HIDDEN.ids.filter(x => x !== id);
      delete HIDDEN.items[id];
      if (it && !ITEMS.find(i => i.id === id)) { ITEMS.push(it); resortItems(); }
      saveHidden(); render();
    }
    else if (act === "unhide_all") {
      for (const id of HIDDEN.ids) {
        const it = HIDDEN.items[id];
        if (it && !ITEMS.find(i => i.id === id)) ITEMS.push(it);
      }
      HIDDEN = { ids: [], items: {} };
      resortItems(); saveHidden(); toast("すべて復元しました"); render();
    }
    else if (act === "atab") { view.atab = a.dataset.k; render(); }
    else if (act === "adj") {
      const amt = Math.abs(+($("#a_amt")?.value) || 0);
      if (!amt) { toast("stdm数を入力してください"); return; }
      const signed = a.dataset.v === "1" ? amt : -amt;
      const memo = ($("#a_memo")?.value || "").trim();
      stdmEarn(signed, memo ? `手動:${memo}` : "手動調整");
      ADJUSTS.push({ ts: new Date().toISOString(), amount: signed, memo });
      localStorage.setItem(uk(LS_ADJUST), JSON.stringify(ADJUSTS));
      toast(`${signed > 0 ? "+" : ""}${signed} stdm`); render();
    }
    else if (act === "schedstart") {
      SCHED.start = isoDay();
      SCHED.base = Math.ceil(ITEMS.length * 4 / SCHED_DAYS);
      saveSched(); toast("50日プランを開始しました"); render();
    }
    else if (act === "schedset") schedStart(a.dataset.mission, +(a.dataset.n || 10));
    else if (act === "wtest") weeklyTestStart();
    else if (act === "prepset") prepStart(a.dataset.mode);
    else if (act === "scheddate") {
      const v2 = $("#s_start")?.value;
      if (!v2) { toast("開始日を入力してください"); return; }
      SCHED.start = v2;
      SCHED.base = Math.ceil(ITEMS.length * 4 / SCHED_DAYS);
      saveSched(); toast(`開始日を ${v2} に設定しました`); render();
    }
    else if (act === "schedreset") {
      if (confirm("50日プランの記録（クリア数・先取り・開始日）をすべて消去しますか？")) {
        SCHED = { start: "", base: 0, items: {}, days: {} };
        saveSched(); toast("プランをリセットしました"); render();
      }
    }
    else if (act === "filtx") { view.filt = view.filt === "ng" ? "" : "ng"; render(); }
    else if (act === "quit") go("home");
    else if (act === "tosetup") go("home");
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
      if (quiz.sched)
        schedMark(quiz.list[quiz.idx].id, ok, Date.now() - (quiz.qStart || Date.now()) <= 3000);
      else if (quiz.prep) prepMark(quiz.list[quiz.idx].id, ok);
      else mark(quiz.list[quiz.idx].id, ok, "quiz");
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
          ts: new Date().toISOString(), kind: quiz.sched ? "sched" : quiz.prep ? "prep" : "quiz", cat: quiz.cat,
          range: quiz.range, n: quiz.answers.length, mission: quiz.mission,
          ok: quiz.answers.filter(x => x.ok).length,
          secs: Math.round(study.total - runStartTotal),
          wrongIds: quiz.answers.filter(x => !x.ok).map(x => x.id),
        });
        saveResults();
        if (quiz.sched) stdmEarn(quiz.mission === "extra" ? 5 : 3,
          quiz.mission === "extra" ? "先取り10問セット" : "10問セット");
        go("quizend");
      } else render();
    }
    else if (act === "answer_in") {
      const raw = $("#ans_in")?.value || "";
      const ok = normYomi(raw) === normYomi(quiz.cur.answer);
      quiz.cur.userAns = raw.trim();
      quiz.judged = { ok };
      quiz.answers.push({ id: quiz.list[quiz.idx].id, ok });
      if (quiz.sched)
        schedMark(quiz.list[quiz.idx].id, ok, Date.now() - (quiz.qStart || Date.now()) <= 3000);
      else if (quiz.prep) prepMark(quiz.list[quiz.idx].id, ok);
      else mark(quiz.list[quiz.idx].id, ok, "quiz");
      render();
    }
    else if (act === "tanswer" || act === "tanswer_in") {
      const ok = act === "tanswer"
        ? test.cur.options[+a.dataset.i].v === test.cur.answer
        : normYomi($("#ans_in")?.value || "") === normYomi(test.cur.answer);
      const id0 = test.list[test.idx].id;
      test.answers.push({ id: id0, ok });
      mark(id0, ok, test.kind);
      // 週間テストの正誤はプランの周回記録にも反映(即答ならプラチナ対象)
      if (test.kind === "wtest")
        schedMark(id0, ok, Date.now() - (test.qStart || Date.now()) <= 3000);
      test.idx++;
      if (test.idx >= test.list.length) {
        const nOk = test.answers.filter(x => x.ok).length;
        const pts = nOk * 4;
        SCHED.wcount = (SCHED.wcount || 0) + 1; saveSched();
        stdmEarn(stdmAward(pts), "週間テスト");
        RESULTS.push({
          ts: new Date().toISOString(), kind: "wtest", cat: "週間テスト",
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
        modes: pickModes(wrongs),
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
      if (USER !== "admin") { toast("管理者のみ使えます"); return; }
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
      modes: pickModes(p),
      pool: ITEMS, cat: scope || "全カテゴリ",
      range: [blks[0]?.gs ?? 1, blks[blks.length - 1]?.ge ?? ITEMS.length] };
    go("quizrun");
  }
  if (e.target.id === "d_export") {
    const blob = new Blob([JSON.stringify({ progress: PROGRESS, results: RESULTS, overrides: OVERRIDES, stdm: stdm, hidden: HIDDEN, sched: SCHED, earn: EARN }, null, 1)],
      { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "kokugo_progress.json"; a2.click();
  }
  if (e.target.id === "d_import") $("#d_file").click();
  if (e.target.id === "d_reset") {
    if (confirm("学習記録・履歴・stdm・50日プランをすべて消去しますか？")) {
      PROGRESS = {}; RESULTS = []; stdm = 0;
      SCHED = { start: "", base: 0, items: {}, days: {} }; EARN = [];
      saveProgress(); saveResults(); savestdm(); saveSched(); saveEarn();
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
        if (d.hidden && d.hidden.ids) { HIDDEN = d.hidden; saveHidden(); applyHidden(); resortItems(); }
        if (d.sched && d.sched.items) { SCHED = d.sched; saveSched(); }
        if (Array.isArray(d.earn)) { EARN = d.earn; saveEarn(); }
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
$("#logoutbtn").addEventListener("click", () => {
  if (confirm("ログアウトしますか？")) {
    localStorage.removeItem(LS_USER); USER = "";
    view = { name: "userselect" }; render();
  }
});
$("#brand").addEventListener("click", () => go("home"));

// ---------- 起動 ----------
async function boot() {
  if (new URLSearchParams(location.search).has("reset")) {
    for (const u of ["koharu", "admin"])
      for (const k of USER_SCOPED) localStorage.removeItem(`${k}__${u}`);
    location.replace("./");
    return;
  }
  // 旧単一ユーザーデータを「こはる」側へ移行(1回限り)
  for (const k of USER_SCOPED) {
    const v = localStorage.getItem(k);
    if (v !== null) {
      if (localStorage.getItem(`${k}__koharu`) === null) localStorage.setItem(`${k}__koharu`, v);
      localStorage.removeItem(k);
    }
  }
  USER = localStorage.getItem(LS_USER) || "";
  if (!USER) { view = { name: "userselect" }; render(); return; }
  await startSession();
}
let wiredOnce = false;
async function startSession() {
  PROGRESS = loadJSON(uk(LS_PROGRESS), {});
  RESULTS = loadJSON(uk(LS_RESULTS), []);
  OVERRIDES = loadJSON(LS_OVERRIDE, {});
  HIDDEN = loadJSON(LS_HIDDEN, { ids: [], items: {} });
  stdm = +(localStorage.getItem(uk(LS_stdm)) || 0);
  study = Object.assign({ day: todayStr(), sec: 0, total: 0, paidStdm: 0 }, loadJSON(uk(LS_TIME), {}));
  ADJUSTS = loadJSON(uk(LS_ADJUST), []);
  SCHED = loadJSON(uk(LS_SCHED), { start: "", base: 0, items: {}, days: {} });
  SCHED.items = SCHED.items || {}; SCHED.days = SCHED.days || {}; SCHED.prepOk = SCHED.prepOk || {};
  EARN = loadJSON(uk(LS_EARN), []);
  // stdm報酬改訂(セット3/先取り5)に伴う残高・履歴の1回限りの再計算
  if (!localStorage.getItem(uk("kv_stdm_recalc_v1"))) {
    const dayOf = ts => { const d = ts ? new Date(ts) : new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
    const earn2 = [];
    for (const r of RESULTS) {
      if (r.kind === "sched") earn2.push({ ts: r.ts, day: dayOf(r.ts),
        amount: r.mission === "extra" ? 5 : 3,
        label: r.mission === "extra" ? "先取り10問セット" : "10問セット" });
      else if (r.kind === "wtest") earn2.push({ ts: r.ts, day: dayOf(r.ts),
        amount: stdmAward(r.pts || 0), label: "週間テスト" });
    }
    for (const k in SCHED.days)
      if (SCHED.days[k].bonus) earn2.push({ ts: k, day: k, amount: 100, label: "ノルマ達成ボーナス" });
    for (const e of EARN) if ((e.label || "").startsWith("手動")) earn2.push(e);
    EARN = earn2.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    stdm = Math.max(0, EARN.reduce((a, x) => a + x.amount, 0));
    saveEarn(); savestdm();
    localStorage.setItem(uk("kv_stdm_recalc_v1"), "1");
  }
  lastStdmShown = stdm; // 初回表示はアニメなし
  if (study.day !== todayStr()) { study.day = todayStr(); study.sec = 0; }
  if (!wiredOnce) {
    wiredOnce = true;
    setInterval(studyTick, 1000);
    document.addEventListener("pointerdown", () => { lastActivity = Date.now(); }, { passive: true });
    document.addEventListener("keydown", () => { lastActivity = Date.now(); });
    window.addEventListener("blur", () => { winFocused = false; });
    window.addEventListener("focus", () => { winFocused = true; lastActivity = Date.now(); });
    window.addEventListener("pagehide", () => saveStudy());
  }
  try {
    ITEMS = await (await fetch("items.json")).json();
  } catch {
    ITEMS = [];
    $("#app").innerHTML =
      '<div class="card"><p>items.json を読み込めません。データ生成後に再読み込みしてください。</p></div>';
    return;
  }
  // 項目の正規化(問題データ: categoryName/subCategory を内部名に)
  for (const it of ITEMS) {
    it.cat = it.categoryName || it.cat || "";
    it.sub = it.subCategory || it.sub || "";
    it.yomi = it.yomi || "";
    it.meaning = it.meaning || "";
    it.example = it.example || "";
  }
  applyOverrides();
  applyHidden();
  // 全体通し番号用にカテゴリ順で並べ替え
  resortItems();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
