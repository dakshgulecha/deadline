import { isConfigured, isUnlocked, issueSession, readJsonBody } from "./_auth.js";
import { mergeStates, normaliseState } from "../shared/merge.js";

const TABLE = "app_state";

function supabase(path, init = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json", ...init.headers };
  // Legacy service_role keys are JWTs and also go in Authorization.
  // New-style sb_secret_ keys must only be sent as `apikey`.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return fetch(`${base}/rest/v1/${path}`, { ...init, headers });
}

async function readRow() {
  const result = await supabase(`${TABLE}?id=eq.1&select=data,updated_at`);
  if (!result.ok) throw new Error(`Supabase read failed (${result.status}): ${await result.text()}`);
  const [row] = await result.json();
  if (!row) throw new Error("app_state row 1 is missing. Run supabase/schema.sql.");
  return row;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return response.status(503).json({ error: "not-configured" });
  if (!isUnlocked(request)) return response.status(401).json({ error: "locked" });

  issueSession(response); // keep this device's 400-day window rolling

  try {
    if (request.method === "GET") {
      const row = await readRow();
      return response.status(200).json({ data: normaliseState(row.data), updatedAt: row.updated_at });
    }

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const incoming = normaliseState(body?.data);

      // Optimistic concurrency: only write if nobody else wrote since we read.
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await readRow();
        const merged = mergeStates(row.data, incoming);
        const result = await supabase(`${TABLE}?id=eq.1&updated_at=eq.${encodeURIComponent(row.updated_at)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ data: merged, updated_at: new Date().toISOString() }),
        });
        if (!result.ok) throw new Error(`Supabase write failed (${result.status}): ${await result.text()}`);
        const [saved] = await result.json();
        if (saved) return response.status(200).json({ data: normaliseState(saved.data), updatedAt: saved.updated_at });
      }
      return response.status(409).json({ error: "busy" });
    }

    response.setHeader("Allow", "GET, PUT");
    return response.status(405).json({ error: "method-not-allowed" });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: "storage-unavailable" });
  }
}
