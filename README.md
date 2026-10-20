# UzAniDub

A small website for publishing anime dubbed in Uzbek. The public site is in Uzbek; admins log in to a panel where they add anime and post episodes.

Design follows the Aniwave layout: dark theme, featured hero slider, poster cards with episode badges, "latest episodes" grid, top‑anime sidebar, and a watch page with an episode list.

## Features

**Public site** (`/`)
- Home page: hero slider of featured anime, all anime as Aniwave‑style poster cards, top‑anime sidebar
- "Yangi qismlar" page (`/yangi-qismlar`): every episode, newest first, grouped by day (Bugun / Kecha / date), paginated
- Anime page: info, genres, status, episode grid, "continue watching"
- Watch page (`/anime/<slug>/<episode>`): player, prev/next, episode list, auto‑next, resume from last position, watched‑episode marks, keyboard shortcuts (space, f, ←/→)
- If an anime has no poster/banner yet, a styled cover is generated automatically

**Admin panel** (`/admin`)
- Add / edit / delete anime (title, alt title, description, genres, type, status, year, planned episode count, age rating, studio, poster, banner, "show in hero")
- Post episodes three ways:
  - **Upload a file** (MP4 / WebM / M4V / MKV) with an upload progress bar. MKV files are converted to MP4 automatically (see below)
  - **Direct video link** (`.mp4`, `.webm`, or HLS `.m3u8`)
  - **Embed** — paste an `<iframe>` code or link from YouTube, OK.ru, VK Video, Google Drive, etc.
- Seasons ("fasl"): each episode belongs to a season; the episode form has a season dropdown (existing seasons + "Yangi fasl"), and the anime and watch pages get a season dropdown when an anime has more than one season. Watch URLs are `/anime/<slug>/<season>/<episode>`
- Site accent colour picker (Admin → Sozlamalar) with live preview: red, orange, yellow, green, teal, blue, pink, violet
- Multiple admin accounts, password change
- Passwords hashed with scrypt, server‑side sessions, login rate limiting, cross‑site form protection

## Requirements

- Node.js **22.13 or newer** (uses the built‑in `node:sqlite`, so no database server or native build is needed)

## Getting started

```bash
npm install
cp .env.example .env      # optional: set ADMIN_USERNAME / ADMIN_PASSWORD, PORT
npm start
```

Open http://localhost:3000. On the first start an admin account is created:
- with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`, or
- `admin` with a **random password printed once in the console**.

Then go to http://localhost:3000/admin, log in, click **Yangi anime**, and post episodes from the **Qism joylash** page.

Optional demo content (two anime with sample episodes) for previewing the design:

```bash
npm run seed
```

During development use `npm run dev` (restarts on file changes).

## MKV conversion

Browsers can't reliably play MKV, so uploaded `.mkv` episodes are converted to MP4 in the background with ffmpeg (bundled via the `ffmpeg-static` / `ffprobe-static` packages — nothing to install). While converting, the episode is hidden from the site and the admin episodes table shows live progress; it appears on the site automatically when done.

- **Audio:** the Uzbek track (`uzb`/`uz` language tag) is chosen; otherwise the default track, otherwise the first. Surround audio is mixed down to stereo AAC.
- **Video:** 8‑bit H.264 is copied as‑is (takes seconds, no quality loss). HEVC/x265, 10‑bit H.264 and other codecs are re‑encoded to H.264 — this takes roughly as long as the episode or longer and uses a lot of CPU.
- **Subtitles** are dropped (episodes are dubbed).
- One conversion runs at a time; others wait in a queue. Conversions interrupted by a restart resume automatically.
- If a file can't be converted the episode is marked **Xato** with the reason; edit it and upload another file.

To use a system ffmpeg instead of the bundled one, set `FFMPEG_PATH` and `FFPROBE_PATH`.

## Where data lives

| Path        | Contents                               |
|-------------|----------------------------------------|
| `data/`     | SQLite database (`anidub.db`)          |
| `uploads/`  | Uploaded posters, banners and videos   |

Back up both folders. Both can be relocated with `DATA_DIR` and `UPLOAD_DIR`.

## Deploying

- Run behind a reverse proxy (nginx, Caddy) with HTTPS and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- If you upload videos directly, raise the proxy's body size limit (e.g. nginx `client_max_body_size 4g;`) and make sure the server has enough disk. `MAX_VIDEO_MB` controls the app's own limit.
- Video files use a lot of bandwidth. For a cheap setup, host episodes elsewhere (OK.ru, VK Video, a CDN/object storage) and post them as **Video havola** or **Embed**.
- MP4 files should be H.264/AAC with "faststart" so they start playing immediately:
  `ffmpeg -i in.mkv -c:v libx264 -c:a aac -movflags +faststart out.mp4`

## Project structure

```
server.js              Express app setup
src/config.js          Environment settings
src/db.js              SQLite schema and queries
src/auth.js            Sessions, admin guard, flash messages
src/uploads.js         Multer upload handling
src/helpers.js         View helpers (labels, dates, icons)
src/routes/public.js   Public pages + generated cover art
src/routes/admin.js    Admin panel
views/                 EJS templates (Uzbek UI)
public/                CSS, JS, logo
scripts/seed.js        Demo content
```
