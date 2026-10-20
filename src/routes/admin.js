import express from 'express';
import {
  listAnime, getAnimeById, createAnime, updateAnime, deleteAnime, splitGenres,
  listEpisodes, getEpisode, getEpisodeById, createEpisode, updateEpisode, deleteEpisode,
  nextEpisodeNumber, listSeasons, latestEpisodes, siteStats, getSetting, setSetting,
  listAdmins, getAdminByUsername, getAdminById, createAdmin, deleteAdmin, setAdminPassword,
  createSession, deleteSession, deleteOtherSessions,
} from '../db.js';
import { verifyPassword } from '../passwords.js';
import { SESSION_COOKIE, requireAdmin, sameOrigin, sessionCookieOptions } from '../auth.js';
import {
  animeImagesUpload, episodeVideoUpload, publicPath, removeUpload, uploadedFiles,
  VIDEO_ACCEPT, IMAGE_ACCEPT,
} from '../uploads.js';
import { STATUS, TYPES, AGE_RATINGS, GENRE_SUGGESTIONS, ACCENTS, DEFAULT_ACCENT, episodeLabel } from '../helpers.js';
import { MAX_VIDEO_MB } from '../config.js';
import { conversionAvailable, needsConversion, enqueueConversion, cancelConversion } from '../transcode.js';

const router = express.Router();
router.use(sameOrigin);
router.use((req, res, next) => {
  res.locals.bodyClass = 'admin-body';
  next();
});

// ---------- Login / logout ----------

const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;

function safeNext(value) {
  return typeof value === 'string' && /^\/admin(\/|$|\?)/.test(value) ? value : '/admin';
}

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Kirish', error: null, username: '', next: safeNext(req.query.next) });
});

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const next = safeNext(req.body?.next);
  const render = (error) => res.status(401).render('admin/login', { title: 'Kirish', error, username, next });

  const record = loginAttempts.get(req.ip);
  if (record && record.count >= MAX_ATTEMPTS && Date.now() - record.first < LOCK_MS) {
    return render('Juda koʻp urinish. 15 daqiqadan soʻng qayta urinib koʻring.');
  }

  const admin = getAdminByUsername(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    const fresh = !record || Date.now() - record.first >= LOCK_MS;
    loginAttempts.set(req.ip, fresh ? { count: 1, first: Date.now() } : { ...record, count: record.count + 1 });
    return render('Login yoki parol notoʻgʻri');
  }

  loginAttempts.delete(req.ip);
  const { token, maxAge } = createSession(admin.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  res.redirect(next);
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) deleteSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.redirect('/');
});

// Everything below requires a logged-in admin.
router.use(requireAdmin);

const formOptions = {
  STATUS, TYPES, AGE_RATINGS, GENRE_SUGGESTIONS, VIDEO_ACCEPT, IMAGE_ACCEPT, MAX_VIDEO_MB, conversionAvailable,
};

function text(body, key, max = 500) {
  const value = String(body?.[key] ?? '').trim().slice(0, max);
  return value || null;
}

function positiveInt(body, key) {
  const n = Number.parseInt(body?.[key], 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// ---------- Dashboard ----------

router.get('/', (req, res) => {
  res.render('admin/dashboard', {
    title: 'Boshqaruv paneli',
    stats: siteStats(),
    anime: listAnime(),
    latest: latestEpisodes(8),
  });
});

// ---------- Anime ----------

function readAnimeForm(req, existing) {
  const b = req.body || {};
  const values = {
    title: text(b, 'title', 200),
    title_alt: text(b, 'title_alt', 200),
    description: text(b, 'description', 5000),
    genres: splitGenres(b.genres).join(', ') || null,
    type: TYPES[b.type] ? b.type : 'TV',
    year: positiveInt(b, 'year'),
    status: STATUS[b.status] ? b.status : 'ongoing',
    age_rating: AGE_RATINGS.includes(b.age_rating) ? b.age_rating : null,
    total_episodes: positiveInt(b, 'total_episodes'),
    studio: text(b, 'studio', 120),
    featured: b.featured ? 1 : 0,
    poster: existing?.poster ?? null,
    banner: existing?.banner ?? null,
  };

  const errors = [];
  const replaced = [];
  if (req.uploadError) errors.push(req.uploadError);
  if (!values.title) errors.push('Anime nomini kiriting');

  for (const field of ['poster', 'banner']) {
    const file = req.files?.[field]?.[0];
    const url = text(b, `${field}_url`, 1000);
    let next = values[field];
    if (file) next = publicPath(file);
    else if (url && url !== values[field]) {
      if (isHttpUrl(url)) next = url;
      else errors.push(`${field === 'poster' ? 'Poster' : 'Banner'} havolasi http:// yoki https:// bilan boshlanishi kerak`);
    } else if (b[`remove_${field}`]) next = null;
    if (next !== values[field]) {
      if (values[field]) replaced.push(values[field]);
      values[field] = next;
    }
  }
  return { values, errors, replaced };
}

function renderAnimeForm(res, { anime, values, errors = [] }) {
  res.status(errors.length ? 422 : 200).render('admin/anime-form', {
    title: anime ? `${anime.title} — tahrirlash` : 'Yangi anime',
    anime,
    values,
    errors,
    ...formOptions,
  });
}

router.get('/anime/new', (req, res) => {
  renderAnimeForm(res, { anime: null, values: { type: 'TV', status: 'ongoing', featured: 1, year: new Date().getFullYear() } });
});

router.post('/anime/new', animeImagesUpload, (req, res) => {
  const { values, errors } = readAnimeForm(req, null);
  if (errors.length) {
    uploadedFiles(req).forEach(removeUpload);
    return renderAnimeForm(res, { anime: null, values: { ...values, poster: null, banner: null }, errors });
  }
  const id = createAnime(values);
  res.flash('success', `“${values.title}” qoʻshildi. Endi qismlarni yuklang.`);
  res.redirect(`/admin/anime/${id}/episodes`);
});

function loadAnime(req, res, next) {
  const anime = getAnimeById(Number(req.params.id));
  if (!anime) return next('route');
  req.anime = anime;
  next();
}

router.get('/anime/:id/edit', loadAnime, (req, res) => {
  renderAnimeForm(res, { anime: req.anime, values: req.anime });
});

router.post('/anime/:id/edit', loadAnime, animeImagesUpload, (req, res) => {
  const { values, errors, replaced } = readAnimeForm(req, req.anime);
  if (errors.length) {
    uploadedFiles(req).forEach(removeUpload);
    return renderAnimeForm(res, { anime: req.anime, values: { ...values, poster: req.anime.poster, banner: req.anime.banner }, errors });
  }
  updateAnime(req.anime.id, values);
  replaced.forEach(removeUpload);
  res.flash('success', 'Oʻzgarishlar saqlandi');
  res.redirect('/admin');
});

router.post('/anime/:id/delete', loadAnime, (req, res) => {
  listEpisodes(req.anime.id, { all: true }).forEach((e) => cancelConversion(e.id));
  deleteAnime(req.anime.id).forEach(removeUpload);
  res.flash('success', `“${req.anime.title}” va uning barcha qismlari oʻchirildi`);
  res.redirect('/admin');
});

// ---------- Episodes ----------

function extractIframeSrc(value) {
  const match = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(value);
  return match ? match[1].replace(/&amp;/g, '&') : value;
}

function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
    }
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`;
  } catch {
    // validated later
  }
  return url;
}

function readEpisodeForm(req, anime, existing) {
  const b = req.body || {};
  const sourceType = ['file', 'url', 'embed'].includes(b.source_type) ? b.source_type : 'file';
  const values = {
    anime_id: anime.id,
    season: Math.min(positiveInt(b, 'season') || 1, 99),
    number: positiveInt(b, 'number'),
    title: text(b, 'title', 200),
    source_type: sourceType,
    source: null,
    status: 'ready',
  };
  const errors = [];
  const replaced = [];
  if (req.uploadError) errors.push(req.uploadError);

  if (!values.number) errors.push('Qism raqamini toʻgʻri kiriting (1, 2, 3 ...)');
  else {
    const clash = getEpisode(anime.id, values.season, values.number);
    if (clash && clash.id !== existing?.id) errors.push(`${episodeLabel(values, true)} allaqachon mavjud`);
  }

  const existingFile = existing?.source_type === 'file' ? existing.source : null;
  if (sourceType === 'file') {
    if (req.file) {
      values.source = publicPath(req.file);
      if (needsConversion(req.file.originalname)) {
        if (conversionAvailable) values.status = 'processing';
        else errors.push('MKV fayllarni konvertatsiya qilish uchun serverda ffmpeg topilmadi. MP4 fayl yuklang.');
      }
    } else if (existingFile) {
      values.source = existingFile;
      values.status = existing.status;
    } else if (!req.uploadError) {
      errors.push('Video faylni tanlang');
    }
  } else {
    let url = text(b, sourceType === 'embed' ? 'embed_code' : 'source_url', 4000) || '';
    if (sourceType === 'embed') url = toEmbedUrl(extractIframeSrc(url));
    if (isHttpUrl(url)) values.source = url;
    else errors.push('Video havolasini toʻgʻri kiriting (http:// yoki https://)');
  }
  if (existingFile && values.source !== existingFile) replaced.push(existingFile);
  return { values, errors, replaced };
}

/** Existing seasons plus the next new one, with the next free episode number in each. */
function seasonOptions(animeId) {
  const seasons = listSeasons(animeId, { all: true });
  const newSeason = (seasons.at(-1)?.season ?? 0) + 1;
  const nextNumbers = Object.fromEntries(seasons.map(({ season }) => [season, nextEpisodeNumber(animeId, season)]));
  nextNumbers[newSeason] = 1;
  return { seasons, newSeason, nextNumbers };
}

function renderEpisodesPage(res, anime, { values, errors = [] } = {}) {
  const options = seasonOptions(anime.id);
  const season = options.seasons.at(-1)?.season ?? 1;
  res.status(errors.length ? 422 : 200).render('admin/episodes', {
    title: `${anime.title} — qismlar`,
    anime,
    episodes: listEpisodes(anime.id, { all: true }),
    values: values ?? { season, number: options.nextNumbers[season], source_type: 'file' },
    errors,
    ...options,
    ...formOptions,
  });
}

router.get('/anime/:id/episodes', loadAnime, (req, res) => renderEpisodesPage(res, req.anime));

router.post('/anime/:id/episodes', loadAnime, episodeVideoUpload, (req, res) => {
  const { values, errors } = readEpisodeForm(req, req.anime, null);
  if (errors.length) {
    uploadedFiles(req).forEach(removeUpload);
    return renderEpisodesPage(res, req.anime, {
      values: { ...values, source_url: req.body?.[values.source_type === 'embed' ? 'embed_code' : 'source_url'] },
      errors,
    });
  }
  const id = createEpisode(values);
  if (values.status === 'processing') {
    enqueueConversion(id);
    res.flash('success', `${episodeLabel(values, true)} yuklandi. MKV → MP4 konvertatsiya qilinmoqda — tayyor boʻlgach saytda avtomatik koʻrinadi.`);
  } else {
    res.flash('success', `${episodeLabel(values, true)} joylandi`);
  }
  res.redirect(`/admin/anime/${req.anime.id}/episodes`);
});

function loadEpisode(req, res, next) {
  const episode = getEpisodeById(Number(req.params.id));
  if (!episode) return next('route');
  req.episode = episode;
  req.anime = getAnimeById(episode.anime_id);
  next();
}

function renderEpisodeForm(res, { anime, episode, values, errors = [] }) {
  res.status(errors.length ? 422 : 200).render('admin/episode-form', {
    title: `${anime.title} — ${episodeLabel(episode, true)}`,
    ...seasonOptions(anime.id),
    anime,
    episode,
    values,
    errors,
    ...formOptions,
  });
}

router.get('/episodes/:id/edit', loadEpisode, (req, res) => {
  const { episode } = req;
  renderEpisodeForm(res, {
    anime: req.anime,
    episode,
    values: { ...episode, source_url: episode.source_type === 'file' ? '' : episode.source },
  });
});

router.post('/episodes/:id/edit', loadEpisode, episodeVideoUpload, (req, res) => {
  const { values, errors, replaced } = readEpisodeForm(req, req.anime, req.episode);
  if (errors.length) {
    uploadedFiles(req).forEach(removeUpload);
    return renderEpisodeForm(res, {
      anime: req.anime,
      episode: req.episode,
      values: { ...values, source_url: req.body?.[values.source_type === 'embed' ? 'embed_code' : 'source_url'] },
      errors,
    });
  }
  const sourceChanged = values.source !== req.episode.source;
  if (sourceChanged) cancelConversion(req.episode.id);
  updateEpisode(req.episode.id, values);
  replaced.forEach(removeUpload);
  if (sourceChanged && values.status === 'processing') {
    enqueueConversion(req.episode.id);
    res.flash('success', `${episodeLabel(values, true)} yangilandi. MKV → MP4 konvertatsiya qilinmoqda.`);
  } else {
    res.flash('success', `${episodeLabel(values, true)} yangilandi`);
  }
  res.redirect(`/admin/anime/${req.anime.id}/episodes`);
});

// Conversion progress for the episodes table (polled by admin.js).
router.get('/anime/:id/episodes/status', loadAnime, (req, res) => {
  res.json(listEpisodes(req.anime.id, { all: true }).map(({ id, status, progress, error }) => ({ id, status, progress, error })));
});

router.post('/episodes/:id/delete', loadEpisode, (req, res) => {
  cancelConversion(req.episode.id);
  deleteEpisode(req.episode.id);
  if (req.episode.source_type === 'file') removeUpload(req.episode.source);
  res.flash('success', `${episodeLabel(req.episode, true)} oʻchirildi`);
  res.redirect(`/admin/anime/${req.anime.id}/episodes`);
});

// ---------- Settings ----------

router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Sozlamalar', accents: ACCENTS, current: getSetting('accent') || DEFAULT_ACCENT });
});

router.post('/settings', (req, res) => {
  const accent = ACCENTS.find((a) => a.key === req.body?.accent);
  if (accent) {
    setSetting('accent', accent.key);
    res.flash('success', `Asosiy rang: ${accent.label}`);
  }
  res.redirect('/admin/settings');
});

// ---------- Admin accounts ----------

function renderAdmins(res, errors = [], status = 200) {
  res.status(status).render('admin/admins', { title: 'Adminlar', admins: listAdmins(), errors });
}

router.get('/admins', (req, res) => renderAdmins(res));

router.post('/admins', (req, res) => {
  const username = text(req.body, 'username', 40);
  const password = String(req.body?.password || '');
  const errors = [];
  if (!username || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) errors.push('Login 3–40 ta lotin harf, raqam yoki _ . - belgilaridan iborat boʻlsin');
  else if (getAdminByUsername(username)) errors.push('Bu login band');
  if (password.length < 8) errors.push('Parol kamida 8 ta belgidan iborat boʻlsin');
  if (errors.length) return renderAdmins(res, errors, 422);
  createAdmin(username, password);
  res.flash('success', `“${username}” admin sifatida qoʻshildi`);
  res.redirect('/admin/admins');
});

router.post('/admins/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) {
    res.flash('error', 'Oʻzingizni oʻchira olmaysiz');
  } else if (getAdminById(id)) {
    deleteAdmin(id);
    res.flash('success', 'Admin oʻchirildi');
  }
  res.redirect('/admin/admins');
});

router.post('/password', (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  const admin = getAdminById(req.admin.id);
  const errors = [];
  if (!verifyPassword(current, admin.password_hash)) errors.push('Joriy parol notoʻgʻri');
  if (next.length < 8) errors.push('Yangi parol kamida 8 ta belgidan iborat boʻlsin');
  if (errors.length) return renderAdmins(res, errors, 422);
  setAdminPassword(admin.id, next);
  deleteOtherSessions(admin.id, req.sessionToken);
  res.flash('success', 'Parol yangilandi');
  res.redirect('/admin/admins');
});

export default router;
