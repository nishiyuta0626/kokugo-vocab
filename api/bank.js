// sdnBANK 連携API: 国語stdmと筋トレstdmの残高・履歴・調整
const TURSO_URL = (process.env.TURSO_DATABASE_URL || "").replace("libsql://", "https://");
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

async function tq(sql, args = []) {
  const r = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(a => ({ type: "text", value: String(a) })) } },
        { type: "close" },
      ],
    }),
  });
  const j = await r.json();
  const res = j.results && j.results[0];
  if (!res || res.type !== "ok") throw new Error(res?.error?.message || "turso error");
  return res.response.result;
}
async function getRow(user) {
  const r = await tq("SELECT data FROM kv_state WHERE user=?", [user]);
  return r.rows.length ? JSON.parse(r.rows[0][0].value) : null;
}
async function putRow(user, data) {
  const now = new Date().toISOString();
  await tq(
    "INSERT INTO kv_state(user,data,updated_at) VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
    [user, JSON.stringify(data), now]
  );
}
const sum = (arr, f) => (arr || []).reduce((a, x) => a + (f(x) || 0), 0);
const NAMES = { koharu: "こはる", admin: "管理者" };

export default async function handler(req, res) {
  const key = req.headers["x-bank-key"] || "";
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected || key !== expected) return res.status(403).json({ error: "forbidden" });
  try {
    if (req.method === "GET") {
      const users = [], history = [];
      for (const uid of Object.keys(NAMES)) {
        const d = (await getRow(uid)) || {};
        const wo = d.workout || {};
        const earn = d.earn || [], adj = d.adjusts || [];
        const earnW = wo.earnLog || [], adjW = wo.adjusts || [];
        users.push({
          id: uid, name: NAMES[uid],
          earned: sum(earn, e => e.amount > 0 && !(e.label || "").startsWith("🏦") && !(e.label || "").startsWith("手動") ? e.amount : 0),
          adjusted: sum(earn, e => ((e.label || "").startsWith("🏦") || (e.label || "").startsWith("手動")) ? e.amount : 0),
          balance: +(d.stdm || 0),
        });
        users.push({
          id: `${uid}_w`, name: `${NAMES[uid]}(筋)`,
          earned: sum(earnW, e => e.amount > 0 ? e.amount : 0),
          adjusted: sum(adjW, e => e.delta),
          balance: +(wo.stdm || 0),
        });
        for (const e of earn) if ((e.label || "").startsWith("🏦"))
          history.push({ ts: e.ts, user: uid, delta: e.amount, label: e.label.slice(1) });
        for (const e of adjW)
          history.push({ ts: e.ts, user: `${uid}_w`, delta: e.delta, label: (e.label || "").replace(/^🏦/, "") });
      }
      history.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
      return res.json({ site: "kokugo", users, history });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const userId = String(body?.userId || "");
      const delta = Math.trunc(Number(body?.delta));
      const note = String(body?.note || "").trim().slice(0, 200) || "sdnBANK";
      const isWo = userId.endsWith("_w");
      const uid = isWo ? userId.slice(0, -2) : userId;
      if (!NAMES[uid] || !delta) return res.status(400).json({ error: "bad request" });
      const d = (await getRow(uid)) || {};
      const now = new Date().toISOString();
      let balance;
      if (isWo) {
        d.workout = d.workout || {};
        d.workout.stdm = (d.workout.stdm || 0) + delta;
        d.workout.adjusts = d.workout.adjusts || [];
        d.workout.adjusts.push({ ts: now, delta, label: `🏦${note}` });
        balance = d.workout.stdm;
      } else {
        d.stdm = Math.max(0, (d.stdm || 0) + delta);
        d.earn = d.earn || [];
        d.earn.push({ ts: now, day: now.slice(0, 10), amount: delta, label: `🏦${note}` });
        balance = d.stdm;
      }
      await putRow(uid, d);
      return res.json({ ok: true, balance });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
