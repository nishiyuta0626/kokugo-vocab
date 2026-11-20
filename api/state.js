// 学習データ同期API (Vercel serverless function)
// Turso(libSQL)の kv_state テーブルを使ったユーザー別JSONストア
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const url = new URL(req.url, "https://x");
    if (req.method === "GET") {
      // ?meta=1 → 全ユーザーの updated_at 一覧(ポーリング用軽量)
      if (url.searchParams.get("meta")) {
        const r = await tq("SELECT user, updated_at FROM kv_state");
        const out = {};
        for (const row of r.rows) out[row[0].value] = row[1].value;
        return res.json(out);
      }
      const user = url.searchParams.get("user") || "";
      const r = await tq("SELECT data, updated_at FROM kv_state WHERE user=?", [user]);
      if (!r.rows.length) return res.json({ data: null, updated_at: null });
      return res.json({ data: JSON.parse(r.rows[0][0].value), updated_at: r.rows[0][1].value });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const now = new Date().toISOString();
      await tq(
        "INSERT INTO kv_state(user,data,updated_at) VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
        [body.user, JSON.stringify(body.data), now]
      );
      return res.json({ ok: true, updated_at: now });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
