// Helpers exposed to every view as `h`.

export const STATUS = {
  ongoing: 'Davom etmoqda',
  completed: 'Tugallangan',
  announced: 'Eʼlon qilingan',
};

export const TYPES = {
  TV: 'TV serial',
  Movie: 'Film',
  OVA: 'OVA',
  ONA: 'ONA',
  Special: 'Maxsus',
};

export const AGE_RATINGS = ['0+', '6+', '12+', '16+', '18+'];

// Site accent colours (the CSS for each lives in style.css under [data-accent]).
export const ACCENTS = [
  { key: 'red', label: 'Qizil (logo)', color: '#d02527' },
  { key: 'orange', label: 'Toʻq sariq', color: '#f47521' },
  { key: 'yellow', label: 'Sariq', color: '#ffc21a' },
  { key: 'green', label: 'Yashil', color: '#22b14c' },
  { key: 'teal', label: 'Moviy', color: '#0aa5c2' },
  { key: 'blue', label: 'Koʻk', color: '#2f74e0' },
  { key: 'pink', label: 'Pushti', color: '#f2608e' },
  { key: 'violet', label: 'Binafsha', color: '#8b5cf6' },
];
export const DEFAULT_ACCENT = 'red';

export const GENRE_SUGGESTIONS = [
  'Jangari', 'Sarguzasht', 'Fantastika', 'Fentezi', 'Komediya', 'Drama', 'Romantika',
  'Isekai', 'Sehrgarlik', 'Mistika', 'Triller', 'Dahshat', 'Sport', 'Maktab',
  'Kundalik hayot', 'Shonen', 'Seynen', 'Mecha', 'Psixologik', 'Tarixiy',
];

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** SQLite stores UTC "YYYY-MM-DD HH:MM:SS". */
export function parseDate(value) {
  return value ? new Date(`${String(value).replace(' ', 'T')}Z`) : null;
}

export function timeAgo(value) {
  const date = parseDate(value);
  if (!date) return '';
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'hozirgina';
  const units = [[31536000, 'yil'], [2592000, 'oy'], [604800, 'hafta'], [86400, 'kun'], [3600, 'soat'], [60, 'daqiqa']];
  const [size, label] = units.find(([n]) => seconds >= n);
  return `${Math.floor(seconds / size)} ${label} oldin`;
}

export function formatDate(value) {
  const date = parseDate(value);
  return date ? `${date.getDate()}-${MONTHS[date.getMonth()]}, ${date.getFullYear()}` : '';
}

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const tashkentDay = (date) => new Date(date.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);

/** "Bugun", "Kecha" or a date — the calendar day in Tashkent time. */
export function dayLabel(value) {
  const date = parseDate(value);
  if (!date) return '';
  const day = tashkentDay(date);
  if (day === tashkentDay(new Date())) return 'Bugun';
  if (day === tashkentDay(new Date(Date.now() - 86400000))) return 'Kecha';
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return `${dayOfMonth}-${MONTHS[month - 1]}, ${year}`;
}

export function formatNumber(n) {
  return String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function posterUrl(anime) {
  return anime.poster || `/art/${encodeURIComponent(anime.slug)}/poster.svg`;
}

export function bannerUrl(anime) {
  return anime.banner || anime.poster || `/art/${encodeURIComponent(anime.slug)}/banner.svg`;
}

export function statusLabel(status) {
  return STATUS[status] || status;
}

export function typeLabel(type) {
  return TYPES[type] || type;
}

export function episodeProgress(anime) {
  return `${anime.episode_count ?? 0} / ${anime.total_episodes || '?'}`;
}

export function progressPercent(anime) {
  if (!anime.total_episodes) return anime.status === 'completed' ? 100 : 0;
  return Math.min(100, Math.round(((anime.episode_count ?? 0) / anime.total_episodes) * 100));
}

export function seasonLabel(season) {
  return `${season}-fasl`;
}

/** "5-qism", or "2-fasl, 5-qism" when the anime has more than one season. */
export function episodeLabel(episode, withSeason = false) {
  return withSeason ? `${seasonLabel(episode.season)}, ${episode.number}-qism` : `${episode.number}-qism`;
}

export function episodeUrl(slug, episode) {
  return `/anime/${encodeURIComponent(slug)}/${episode.season}/${episode.number}`;
}

export function isHls(url) {
  return /\.m3u8(\?|#|$)/i.test(url || '');
}

const ICONS = {
  play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
};

export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
