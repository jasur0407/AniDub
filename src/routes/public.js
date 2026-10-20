import express from 'express';
import {
  listAnime, topAnime, getAnimeBySlug, latestEpisodes, countEpisodes,
  listEpisodes, recordView,
} from '../db.js';
import * as h from '../helpers.js';

const router = express.Router();

const EPISODES_PER_PAGE = 30;

router.get('/', (req, res) => {
  const anime = listAnime();
  const featured = anime.filter((a) => a.featured);
  res.render('index', {
    anime,
    featured: featured.length ? featured : anime.slice(0, 3),
    top: topAnime(5),
  });
});

router.get('/yangi-qismlar', (req, res) => {
  const pages = Math.max(1, Math.ceil(countEpisodes() / EPISODES_PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const groups = [];
  for (const ep of latestEpisodes(EPISODES_PER_PAGE, (page - 1) * EPISODES_PER_PAGE)) {
    const label = h.dayLabel(ep.created_at);
    if (groups.at(-1)?.label !== label) groups.push({ label, episodes: [] });
    groups.at(-1).episodes.push(ep);
  }
  res.render('latest', { title: 'Yangi qismlar', groups, page, pages, top: topAnime(5) });
});

/** Groups an ordered episode list into [{ season, episodes: [...] }]. */
function groupBySeason(episodes) {
  const seasons = [];
  for (const episode of episodes) {
    if (seasons.at(-1)?.season !== episode.season) seasons.push({ season: episode.season, episodes: [] });
    seasons.at(-1).episodes.push(episode);
  }
  return seasons;
}

router.get('/anime/:slug', (req, res, next) => {
  const anime = getAnimeBySlug(req.params.slug);
  if (!anime) return next();
  const episodes = listEpisodes(anime.id);
  res.render('anime', {
    title: anime.title,
    metaDescription: anime.description,
    anime,
    episodes,
    seasons: groupBySeason(episodes),
    others: listAnime().filter((a) => a.id !== anime.id),
  });
});

// Links from before seasons existed: /anime/<slug>/<number> → first season that has that episode.
router.get('/anime/:slug/:number', (req, res, next) => {
  const number = Number(req.params.number);
  const anime = Number.isInteger(number) && getAnimeBySlug(req.params.slug);
  const episode = anime && listEpisodes(anime.id).find((e) => e.number === number);
  if (!episode) return next();
  res.redirect(301, h.episodeUrl(anime.slug, episode));
});

router.get('/anime/:slug/:season/:number', (req, res, next) => {
  const season = Number(req.params.season);
  const number = Number(req.params.number);
  if (!Number.isInteger(season) || !Number.isInteger(number)) return next();
  const anime = getAnimeBySlug(req.params.slug);
  if (!anime) return next();
  const episodes = listEpisodes(anime.id);
  const index = episodes.findIndex((e) => e.season === season && e.number === number);
  if (index < 0) return next();
  const episode = episodes[index];
  const seasons = groupBySeason(episodes);
  recordView(anime.id, episode.id);
  res.render('watch', {
    title: `${anime.title} — ${h.episodeLabel(episode, seasons.length > 1)}`,
    seasons,
    metaDescription: anime.description,
    anime,
    episode,
    episodes,
    prev: episodes[index - 1] || null,
    next: episodes[index + 1] || null,
    others: listAnime().filter((a) => a.id !== anime.id),
  });
});

// Generated artwork for anime that have no poster/banner yet.
router.get('/art/:slug/:file', (req, res, next) => {
  const kind = { 'poster.svg': 'poster', 'banner.svg': 'banner' }[req.params.file];
  const anime = kind && getAnimeBySlug(req.params.slug);
  if (!anime) return next();
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(artSvg(anime.title, kind));
});

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function wrapWords(text, maxChars) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

// Muted solid backgrounds for generated covers.
const ART_COLORS = ['#3b2f5c', '#24435e', '#5c2b3a', '#1f4d48', '#5a3a1f', '#3d3d48', '#2f4a2b', '#4b2a50'];

function artSvg(title, kind) {
  const hash = [...title].reduce((acc, c) => Math.imul(acc ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const color = ART_COLORS[hash % ART_COLORS.length];
  if (kind === 'banner') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="640" viewBox="0 0 1600 640"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  }
  // Title centred in the middle band, clear of the badges the cards place in the corners.
  const [w, h] = [400, 580];
  const fontSize = 36;
  const lines = wrapWords(title.toUpperCase(), 11);
  const top = h / 2 - ((lines.length - 1) * fontSize * 1.15) / 2;
  const text = lines.map((line, i) =>
    `<text x="${w / 2}" y="${top + i * fontSize * 1.15}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="${color}"/>
  <g font-family="Rubik, Arial, sans-serif" font-weight="800" font-size="${fontSize}" fill="#fff">${text}</g>
</svg>`;
}

export default router;
