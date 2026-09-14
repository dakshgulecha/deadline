export default function handler(_request, response) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return response.status(503).json({ configured: false });
  }

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ configured: true, url, key });
}
