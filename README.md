# Deadline

A personal deadline tracker with a notes workspace. It works in any browser on any device, and every device stays in sync.
Your data is private: a device has to enter the passphrase once, and after that it stays unlocked.

## How it works

- **Vercel** hosts the page and two small API routes (`/api/unlock`, `/api/state`).
- **Supabase** stores everything in one row. The public anon/publishable key has **no** access to it. Only the server, using the secret key, can read or write it.
- **Unlocking:** the first time a browser opens the site, it asks for the passphrase. The server then sets an HttpOnly cookie that lasts 400 days (the maximum browsers allow) and is renewed on every visit, so in practice you never type it again on that device.
- **Sync:** every deadline and note carries its own `updatedAt`. When two devices edit at the same time, each item keeps its newest version, and deletions are remembered, so devices don't overwrite each other. Edits made offline are saved on the device and sent once you're back online.

## One-time setup

### 1. Supabase
1. Open **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   It's safe to run again, and it removes the old public read/write policies.
2. In **Project Settings → API Keys**, copy the **Project URL** and a **secret key** (`sb_secret_…`, or the legacy `service_role` key).
   ⚠️ The secret key only ever goes into Vercel. Never put it in the frontend code or in git.

### 2. Vercel → Settings → Environment Variables
| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key |
| `APP_PASSPHRASE` | a long passphrase, e.g. four random words |

Delete the old `SUPABASE_PUBLISHABLE_KEY` variable (it isn't used any more), then **redeploy**.

### 3. Each device
Open the URL, enter the passphrase once, and you're done.
On phones you can use **Share → Add to Home Screen** (iOS) or **Install app** (Android) to get an app icon with no browser bar. On iPhone, the home-screen app keeps its own storage separate from Safari, so it asks for the passphrase once more.

## Good to know
- **To sign out every device** (for example after a lost phone), change `APP_PASSPHRASE` and redeploy.
- **You'll be asked again only if** you clear the site's data or cookies, use a private window, or don't open the site for 400 days.
- **Local development:** run `npx vercel dev` (the API routes need it). Opening `index.html` directly from disk won't work, because the app is an ES module.
