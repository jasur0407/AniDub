import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';
import { hashPassword } from './passwords.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'anidub.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS anime (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    title_alt      TEXT,
    description    TEXT,
    genres         TEXT,
    type           TEXT NOT NULL DEFAULT 'TV',
    year           INTEGER,
    status         TEXT NOT NULL DEFAULT 'ongoing',
    age_rating     TEXT,
    total_episodes INTEGER,
    studio         TEXT,
    poster         TEXT,
    banner         TEXT,
    featured       INTEGER NOT NULL DEFAULT 1,
    views          INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const episodesTableSql = (name) => `
  CREATE TABLE IF NOT EXISTS ${name} (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id    INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    season      INTEGER NOT NULL DEFAULT 1,
    number      INTEGER NOT NULL,
    title       TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('file', 'url', 'embed')),
    source      TEXT NOT NULL,
    views       INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'ready',
    progress    INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (anime_id, season, number)
  )`;

db.exec(episodesTableSql('episodes'));

const episodeColumns = () => db.prepare('PRAGMA table_info(episodes)').all().map((c) => c.name);

// Databases created before MKV conversion existed lack the episode status columns.
if (!episodeColumns().includes('status')) {
  db.exec(`
    ALTER TABLE episodes ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
    ALTER TABLE episodes ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE episodes ADD COLUMN error TEXT;
  `);
}

// Databases created before seasons existed: rebuild the table so episode numbers are unique per season.
if (!episodeColumns().includes('season')) {
  const columns = 'id, anime_id, number, title, source_type, source, views, status, progress, error, created_at';
  db.exec(`
    BEGIN;
    ${episodesTableSql('episodes_new')};
    INSERT INTO episodes_new (${columns}, season) SELECT ${columns}, 1 FROM episodes;
    DROP TABLE episodes;
    ALTER TABLE episodes_new RENAME TO episodes;
    COMMIT;
  `);
}

// ---------- Settings ----------

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---------- Anime ----------

// Only 'ready' episodes are public; 'processing' ones are still converting and 'failed' ones need attention.
const READY = `e.status = 'ready'`;

const ANIME_SELECT = `
  SELECT a.*,
    (SELECT COUNT(*)    FROM episodes e WHERE e.anime_id = a.id AND ${READY}) AS episode_count,
    (SELECT COUNT(DISTINCT e.season) FROM episodes e WHERE e.anime_id = a.id AND ${READY}) AS season_count,
    (SELECT e.season    FROM episodes e WHERE e.anime_id = a.id AND ${READY} ORDER BY e.season, e.number LIMIT 1) AS first_season,
    (SELECT e.number    FROM episodes e WHERE e.anime_id = a.id AND ${READY} ORDER BY e.season, e.number LIMIT 1) AS first_episode,
    (SELECT MAX(e.created_at) FROM episodes e WHERE e.anime_id = a.id AND ${READY}) AS last_episode_at
  FROM anime a`;

const ANIME_FIELDS = [
  'title', 'title_alt', 'description', 'genres', 'type', 'year', 'status',
  'age_rating', 'total_episodes', 'studio', 'poster', 'banner', 'featured',
];

export function splitGenres(genres) {
  return [...new Set(String(genres || '').split(',').map((g) => g.trim()).filter(Boolean))];
}

function decorate(anime) {
  return anime ? { ...anime, genreList: splitGenres(anime.genres) } : null;
}

export function listAnime() {
  return db.prepare(`${ANIME_SELECT}
    ORDER BY COALESCE(last_episode_at, a.created_at) DESC, a.id DESC`).all().map(decorate);
}

export function topAnime(limit = 5) {
  return db.prepare(`${ANIME_SELECT} ORDER BY a.views DESC, a.id ASC LIMIT ?`).all(limit).map(decorate);
}

export function getAnimeBySlug(slug) {
  return decorate(db.prepare(`${ANIME_SELECT} WHERE a.slug = ?`).get(slug));
}

export function getAnimeById(id) {
  return decorate(db.prepare(`${ANIME_SELECT} WHERE a.id = ?`).get(id));
}

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (c) => CYRILLIC[c] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'anime';
}

function uniqueSlug(title) {
  const base = slugify(title);
  const exists = db.prepare('SELECT 1 FROM anime WHERE slug = ?');
  let slug = base;
  for (let i = 2; exists.get(slug); i++) slug = `${base}-${i}`;
  return slug;
}

function pickAnimeFields(data) {
  return Object.fromEntries(ANIME_FIELDS.map((f) => [f, data[f] ?? null]));
}

export function createAnime(data) {
  const result = db.prepare(`
    INSERT INTO anime (slug, ${ANIME_FIELDS.join(', ')})
    VALUES (:slug, ${ANIME_FIELDS.map((f) => `:${f}`).join(', ')})
  `).run({ slug: uniqueSlug(data.title), ...pickAnimeFields(data) });
  return Number(result.lastInsertRowid);
}

export function updateAnime(id, data) {
  db.prepare(`
    UPDATE anime SET ${ANIME_FIELDS.map((f) => `${f} = :${f}`).join(', ')}, updated_at = datetime('now')
    WHERE id = :id
  `).run({ id, ...pickAnimeFields(data) });
}

/** Deletes the anime with its episodes and returns the uploaded file paths that are now unused. */
export function deleteAnime(id) {
  const anime = db.prepare('SELECT poster, banner FROM anime WHERE id = ?').get(id);
  if (!anime) return [];
  const videos = db.prepare(`SELECT source FROM episodes WHERE anime_id = ? AND source_type = 'file'`).all(id);
  db.prepare('DELETE FROM anime WHERE id = ?').run(id);
  return [anime.poster, anime.banner, ...videos.map((v) => v.source)].filter(Boolean);
}

// ---------- Episodes ----------

/** Public episode list; pass { all: true } to include episodes that are converting or failed. */
export function listEpisodes(animeId, { all = false } = {}) {
  return db.prepare(`
    SELECT * FROM episodes e WHERE anime_id = ? ${all ? '' : `AND ${READY}`} ORDER BY season, number
  `).all(animeId);
}

/** Seasons with their episode counts, e.g. [{ season: 1, episodes: 12 }, { season: 2, episodes: 3 }]. */
export function listSeasons(animeId, { all = false } = {}) {
  return db.prepare(`
    SELECT season, COUNT(*) AS episodes FROM episodes e
    WHERE anime_id = ? ${all ? '' : `AND ${READY}`}
    GROUP BY season ORDER BY season
  `).all(animeId);
}

export function getEpisode(animeId, season, number) {
  return db.prepare('SELECT * FROM episodes WHERE anime_id = ? AND season = ? AND number = ?')
    .get(animeId, season, number) ?? null;
}

export function getEpisodeById(id) {
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) ?? null;
}

export function nextEpisodeNumber(animeId, season) {
  return (db.prepare('SELECT MAX(number) AS n FROM episodes WHERE anime_id = ? AND season = ?').get(animeId, season).n ?? 0) + 1;
}

export function createEpisode({ anime_id, season = 1, number, title, source_type, source, status = 'ready' }) {
  const result = db.prepare(`
    INSERT INTO episodes (anime_id, season, number, title, source_type, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(anime_id, season, number, title ?? null, source_type, source, status);
  db.prepare(`UPDATE anime SET updated_at = datetime('now') WHERE id = ?`).run(anime_id);
  return Number(result.lastInsertRowid);
}

export function updateEpisode(id, { season = 1, number, title, source_type, source, status = 'ready' }) {
  db.prepare(`
    UPDATE episodes SET season = ?, number = ?, title = ?, source_type = ?, source = ?, status = ?,
      progress = CASE WHEN source = ? AND status = ? THEN progress ELSE 0 END,
      error = CASE WHEN source = ? AND status = ? THEN error ELSE NULL END
    WHERE id = ?
  `).run(season, number, title ?? null, source_type, source, status, source, status, source, status, id);
}

export function deleteEpisode(id) {
  db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
}

export function listProcessingEpisodes() {
  return db.prepare(`SELECT id FROM episodes WHERE status = 'processing' ORDER BY id`).all().map((e) => e.id);
}

export function setEpisodeProgress(id, progress) {
  db.prepare('UPDATE episodes SET progress = ? WHERE id = ?').run(progress, id);
}

/** Publishes a converted episode; created_at becomes the publish time so it shows up as new. */
export function finishEpisodeConversion(id, source) {
  db.prepare(`
    UPDATE episodes SET source = ?, status = 'ready', progress = 100, error = NULL, created_at = datetime('now')
    WHERE id = ?
  `).run(source, id);
}

export function failEpisodeConversion(id, error) {
  db.prepare(`UPDATE episodes SET status = 'failed', error = ? WHERE id = ?`).run(String(error).slice(0, 500), id);
}

export function countEpisodes() {
  return db.prepare(`SELECT COUNT(*) AS n FROM episodes e WHERE ${READY}`).get().n;
}

export function latestEpisodes(limit = 12, offset = 0) {
  return db.prepare(`
    SELECT e.id, e.season, e.number, e.title, e.created_at, e.views,
           a.slug, a.title AS anime_title, a.poster, a.banner, a.type, a.age_rating, a.total_episodes,
           (SELECT COUNT(DISTINCT s.season) FROM episodes s WHERE s.anime_id = a.id AND s.status = 'ready') AS season_count
    FROM episodes e
    JOIN anime a ON a.id = e.anime_id
    WHERE ${READY}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

export function recordView(animeId, episodeId) {
  db.prepare('UPDATE anime SET views = views + 1 WHERE id = ?').run(animeId);
  db.prepare('UPDATE episodes SET views = views + 1 WHERE id = ?').run(episodeId);
}

export function siteStats() {
  return db.prepare(`
    SELECT (SELECT COUNT(*) FROM anime)                 AS anime,
           (SELECT COUNT(*) FROM episodes)              AS episodes,
           (SELECT COALESCE(SUM(views), 0) FROM anime)  AS views,
           (SELECT COUNT(*) FROM admins)                AS admins
  `).get();
}

// ---------- Admins & sessions ----------

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function listAdmins() {
  return db.prepare('SELECT id, username, created_at FROM admins ORDER BY id').all();
}

export function getAdminByUsername(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username) ?? null;
}

export function getAdminById(id) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id) ?? null;
}

export function createAdmin(username, password) {
  return Number(db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .run(username, hashPassword(password)).lastInsertRowid);
}

export function deleteAdmin(id) {
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
}

export function setAdminPassword(id, password) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
}

export function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), adminId, Date.now() + SESSION_TTL_MS);
  return { token, maxAge: SESSION_TTL_MS };
}

export function getSessionAdmin(token) {
  return db.prepare(`
    SELECT a.id, a.username FROM sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(sha256(token), Date.now()) ?? null;
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteOtherSessions(adminId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').run(adminId, sha256(keepToken));
}

/** Creates the first admin account when none exists yet. */
export function ensureInitialAdmin() {
  if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  createAdmin(username, password);
  console.log('\n  Birinchi admin yaratildi / First admin account created:');
  console.log(`    login:  ${username}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`    parol:  ${password}   (save it — it is shown only once)`);
  console.log('');
}
