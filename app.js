/* 国語文法 - 語句学習アプリ (ターゲット1900式)
 * 静的SPA: items.json を読み込み、学習記録は localStorage に保存。
 * 記録ルール: ❌のあと連続2回⭕で克服。
 */
"use strict";

const LS_PROGRESS = "kv_progress_v1";
const LS_OVERRIDE = "kv_item_override_v1";
const SEC_SIZE = 50; // ターゲット式の区切り

let ITEMS = [];          // items.json + 上書き
let PROGRESS = {};       // id -> {c, w, s, last}
let OVERRIDES = {};      // id -> {text,yomi,meaning,example,image}
let view = { name: "home" }; // 現在の画面

// ---------- 永続化 ----------
function loadJSON(k, d) {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
}
function saveProgress() { localStorage.setItem(LS_PROGRESS, JSON.stringify(PROGRESS)); }
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
    b.classList.toggle("on", b.dataset.nav === view.name));
  const el = $("#app");
  const v = view.name;
  if (v === "home") el.innerHTML = vHome();
  else if (v === "study") el.innerHTML = vStudySetup();
  else if (v === "card") el.innerHTML = vCard();
  else if (v === "quiz") el.innerHTML = vQuizSetup();
  else if (v === "quizrun") el.innerHTML = vQuizRun();
  else if (v === "quizend") el.innerHTML = vQuizEnd();
  else if (v === "list") el.innerHTML = vList();
  else if (v === "edit") el.innerHTML = vEdit();
  else if (v === "data") el.innerHTML = vData();
}
function go(name, params = {}) { view = { name, ...params }; render(); window.scrollTo(0, 0); }

// ---------- ホーム ----------
function vHome() {
  const rows = cats().map(cat => {
    const p = byCat(cat);
    const st = { new: 0, weak: 0, master: 0, good: 0 };
    p.forEach(i => st[statusOf(i.id)]++);
    const learned = p.length - st.new;
    const pct = Math.round(learned / p.length * 100);
    return `<div class="card catcard" data-act="study" data-cat="${esc(cat)}">
      <div class="ttl">${esc(cat)} <span class="muted">${p.length}件</span></div>
      <div class="progress">${Array.from({ length: 20 }, (_, i) =>
        `<i class="${i < Math.round(pct / 5) ? "f" : ""}"></i>`).join("")}</div>
      <div class="statrow">
        <div class="stat"><b>${learned}</b><span>学習済 ${pct}%</span></div>
        <div class="stat"><b style="color:var(--ng)">${st.weak}</b><span>苦手</span></div>
        <div class="stat"><b style="color:var(--ok)">${st.master}</b><span>克服</span></div>
      </div>
      <div class="btnrow">
        <button class="primary" data-act="study" data-cat="${esc(cat)}">学習する</button>
        <button data-act="quiz" data-cat="${esc(cat)}">テストする</button>
      </div>
    </div>`;
  }).join("");
  return `<h2>語句学習</h2>
    <p class="muted">❌のあと連続2回⭕で「克服」になります。記録はこの端末に保存されます。</p>
    <div class="grid2">${rows}</div>`;
}

// ---------- 学習設定・カード ----------
function vStudySetup() {
  const cat = view.cat || cats()[0];
  const secs = sections(cat).map(i =>
    `<option value="${i}" ${view.sec == i ? "selected" : ""}>${secLabel(cat, i)}</option>`).join("");
  return `<div class="card">
    <h2>${esc(cat)}を学習</h2>
    <label class="f">範囲(セクション)</label>
    <select id="s_sec">${secs}</select>
    <label class="f">対象</label>
    <select id="s_filt">
      <option value="">すべて</option>
      <option value="new">未学習のみ</option>
      <option value="weak">苦手のみ</option>
      <option value="notmaster">克服していないもの</option>
    </select>
    <label class="f">順番</label>
    <select id="s_order"><option value="">登録順</option><option value="rand">ランダム</option></select>
    <div class="btnrow"><button class="primary big" id="s_go">カード学習を開始</button></div>
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

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
    </div>`;
  return `<div class="panes"><div>${front}${btns}</div>${side}</div>`;
}

// ---------- テスト設定・実行 ----------
function vQuizSetup() {
  const cat = view.cat || cats()[0];
  const secs = ["<option value=\"\">全範囲</option>",
    ...sections(cat).map(i => `<option value="${i}">${secLabel(cat, i)}</option>`)].join("");
  return `<div class="card">
    <h2>${esc(cat)}のテスト</h2>
    <label class="f">範囲</label><select id="q_sec">${secs}</select>
    <label class="f">対象</label>
    <select id="q_filt">
      <option value="">すべて</option>
      <option value="weak">苦手のみ</option>
      <option value="new">未学習のみ</option>
    </select>
    <label class="f">出題形式</label>
    <select id="q_mode">
      <option value="m2t">意味 → 語句を選ぶ(4択)</option>
      <option value="t2y">語句 → 読みを選ぶ(4択)</option>
      <option value="y2t">読み → 語句を選ぶ(4択)</option>
    </select>
    <label class="f">問数</label>
    <select id="q_n"><option>10</option><option selected>20</option><option>30</option><option value="all">全部</option></select>
    <div class="btnrow"><button class="primary big" id="q_go">テスト開始</button></div>
    <div class="btnrow"><button class="ghost" data-nav="home">← ホームへ</button></div>
  </div>`;
}

let quiz = null; // {list, idx, mode, answers:[{id,ok}], judged}

function makeChoices(it, mode, poolAll) {
  const key = mode === "t2y" ? "yomi" : "text";
  const cand = shuffle(poolAll.filter(x => x.id !== it.id && x[key] && x[key] !== it[key]));
  const picks = [it[key]];
  for (const c of cand) { if (picks.length >= 4) break; if (!picks.includes(c[key])) picks.push(c[key]); }
  return { options: shuffle(picks.slice(0, 4)), answer: it[key] };
}

function vQuizRun() {
  const { list, idx, mode } = quiz;
  const it = list[idx];
  const { options, answer } = makeChoices(it, mode, quiz.pool);
  quiz.cur = { answer, options };
  const promptHtml = mode === "m2t"
    ? `<div class="q-prompt"><b>意味:</b> ${esc(it.meaning)}</div>`
    : mode === "t2y"
      ? `<div class="q-surface">${esc(it.text)}</div><div class="center muted">読み方を選んでください</div>`
      : `<div class="q-surface">${esc(it.yomi)}</div><div class="center muted">この読みの語句を選んでください</div>`;
  const opts = options.map((o, i) =>
    `<button class="choice" data-act="answer" data-i="${i}">${esc(o)}</button>`).join("");
  const judged = quiz.judged;
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
        ? `<div class="judge ${quiz.judged.ok ? "ok" : "ng"}">${quiz.judged.ok ? "⭕" : "❌"}</div>
           <p class="center"><b>${esc(it.text)}</b>（${esc(it.yomi)}）</p>
           ${promptHtml}
           <div class="btnrow"><button class="primary big" data-act="nextq">${idx + 1 < list.length ? "次へ" : "結果を見る"}</button></div>`
        : `${promptHtml}<div class="choices">${opts}</div>`}
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
      <button data-act="quiz" data-cat="${esc(quiz.cat)}">もう一度テスト</button>
      <button data-nav="home">ホームへ</button>
    </div>
  </div>`;
}

// ---------- 一覧・編集 ----------
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
    <div class="btnrow" style="margin-top:0">
      <select id="l_cat"><option value="">全カテゴリ</option>
        ${cats().map(c => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="l_filt"><option value="">全状態</option>
        ${["new", "weak", "master", "good"].map(s =>
          `<option value="${s}" ${s === filt ? "selected" : ""}>${STATUS_JP[s]}</option>`).join("")}</select>
      <input type="text" id="l_kw" placeholder="検索(語句・読み・意味)" value="${esc(view.kw || "")}">
    </div>
    <p class="muted">${p.length}件${p.length > 500 ? " (先頭500件表示)" : ""} — タップで編集</p>
    ${rows || "<p>該当なし</p>"}
  </div>`;
}

function vEdit() {
  const it = ITEMS.find(i => i.id === view.id);
  if (!it) return `<div class="card">見つかりません</div>`;
  return `<div class="card">
    <h2>項目の編集 ${STATUS_BADGE[statusOf(it.id)]}</h2>
    <label class="f">語句(表記)</label><input type="text" id="e_text" value="${esc(it.text)}">
    <label class="f">読み</label><input type="text" id="e_yomi" value="${esc(it.yomi)}">
    <label class="f">意味</label><textarea id="e_meaning" rows="2">${esc(it.meaning)}</textarea>
    <label class="f">例文・例</label><textarea id="e_example" rows="2">${esc(it.example || "")}</textarea>
    <label class="f">頻出度</label><input type="text" id="e_level" value="${esc(it.level || "")}">
    <div class="btnrow">
      <button class="primary" id="e_save">保存</button>
      <button data-act="delprog">学習記録をリセット</button>
      <button data-nav="list">戻る</button>
    </div>
  </div>`;
}

// ---------- データ管理 ----------
function vData() {
  const total = Object.keys(PROGRESS).length;
  return `<div class="card">
    <h2>データ管理</h2>
    <p class="muted">問題データ ${ITEMS.length}件 / 記録のある項目 ${total}件</p>
    <h3>学習記録</h3>
    <div class="btnrow">
      <button id="d_export">記録をエクスポート(JSON)</button>
      <button id="d_import">記録をインポート</button>
      <input type="file" id="d_file" accept=".json" style="display:none">
      <button id="d_reset" style="border-color:var(--ng);color:var(--ng)">記録を全消去</button>
    </div>
    <hr>
    <h3>項目の修正内容</h3>
    <p class="muted">一覧画面で編集した項目: ${Object.keys(OVERRIDES).length}件
      <button class="ghost" id="d_ovexport">修正をエクスポート</button></p>
  </div>`;
}

// ---------- イベント ----------
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) { go(nav.dataset.nav); return; }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "study") go("study", { cat: a.dataset.cat });
    else if (act === "quiz") go("quiz", { cat: a.dataset.cat });
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
      // 選択肢に色を付ける
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
    else if (act === "edit") go("edit", { id: a.dataset.id });
    else if (act === "delprog") {
      if (confirm("この項目の学習記録をリセットしますか？")) {
        delete PROGRESS[view.id]; saveProgress(); toast("リセットしました"); render();
      }
    }
  }
  if (e.target.id === "s_go") {
    const sec = +$("#s_sec").value, filt = $("#s_filt").value,
      order = $("#s_order").value;
    let p = pool(view.cat, sec, filt);
    if (order === "rand") p = shuffle([...p]);
    cardSet = { list: p, idx: 0, flipped: false };
    if (!p.length) toast("対象の項目がありません");
    else go("card");
  }
  if (e.target.id === "q_go") {
    const sec = $("#q_sec").value, filt = $("#q_filt").value,
      mode = $("#q_mode").value, n = $("#q_n").value;
    let p = shuffle([...pool(view.cat, sec === "" ? null : +sec, filt)]);
    if (n !== "all") p = p.slice(0, +n);
    if (p.length < 4) { toast("4件以上必要です"); return; }
    quiz = { list: p, idx: 0, mode, answers: [], judged: null,
      pool: byCat(view.cat), cat: view.cat };
    go("quizrun");
  }
  if (e.target.id === "e_save") {
    const it = ITEMS.find(i => i.id === view.id);
    OVERRIDES[view.id] = {
      text: $("#e_text").value.trim(), yomi: $("#e_yomi").value.trim(),
      meaning: $("#e_meaning").value.trim(), example: $("#e_example").value.trim(),
      level: $("#e_level").value.trim(),
    };
    Object.assign(it, OVERRIDES[view.id]);
    saveOverrides(); toast("保存しました"); go("list");
  }
  if (e.target.id === "d_export") {
    const blob = new Blob([JSON.stringify({ progress: PROGRESS, overrides: OVERRIDES }, null, 1)],
      { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "kokugo_progress.json"; a2.click();
  }
  if (e.target.id === "d_import") $("#d_file").click();
  if (e.target.id === "d_reset") {
    if (confirm("学習記録をすべて消去しますか？")) {
      PROGRESS = {}; saveProgress(); toast("消去しました"); render();
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
        if (d.overrides) { OVERRIDES = d.overrides; applyOverrides(); saveOverrides(); }
        saveProgress(); toast("インポートしました"); render();
      } catch { toast("読み込めませんでした"); }
    };
    r.readAsText(e.target.files[0]);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "l_kw") { view.kw = e.target.value; render(); }
});

// ---------- 起動 ----------
async function boot() {
  PROGRESS = loadJSON(LS_PROGRESS, {});
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
