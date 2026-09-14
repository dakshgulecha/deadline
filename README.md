# Deadline

A lightweight, responsive deadline tracker paired with a full personal notes workspace.

## Run locally

Open `index.html` in a browser, or serve this folder with any static server.

## Deploy to Vercel

This project is a zero-build static app, so Vercel does not need Node.js, a build command, or any environment variables yet.

1. Create a Vercel account and choose **Add New → Project**.
2. Import this folder through a Git repository, or upload the project folder in the Vercel dashboard.
3. Keep the framework preset as **Other** and leave the build command empty.
4. Deploy. Vercel will give you a URL such as `https://deadline-yourname.vercel.app`.

The app uses this one main URL on every device.

## Sync layer next

Vercel hosts the interface. Supabase provides one shared dataset for every device using the main URL, with no app accounts or private workspace links.

### One-time Supabase setup

1. In the Supabase project, open **SQL Editor → New query**.
2. Paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. In **Project Settings → API**, copy the **Project URL** and the **publishable/anon key**. Do not use the `service_role` key.
4. In Vercel, open the project’s **Settings → Environment Variables**, add:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_PUBLISHABLE_KEY` = publishable/anon key
5. Redeploy the Vercel project.

The browser obtains these public connection settings from `/api/config`, then reads and writes the single shared Supabase record. Anyone with the main URL can view and edit the tracker, by design.
