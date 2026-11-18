import { isConfigured, issueSession, passphraseMatches, readJsonBody } from "./_auth.js";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method-not-allowed" });
  }
  if (!isConfigured()) return response.status(503).json({ error: "not-configured" });

  const body = await readJsonBody(request);
  if (!passphraseMatches(body?.passphrase)) {
    await wait(1000); // slows down guessing
    return response.status(401).json({ error: "wrong-passphrase" });
  }

  issueSession(response);
  return response.status(200).json({ ok: true });
}
