import { COOKIE_SECURE } from './config.js';
import { getSessionAdmin } from './db.js';

export const SESSION_COOKIE = 'anidub_sid';
const FLASH_COOKIE = 'anidub_flash';

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return cookies;
}

export function sessionCookieOptions(maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/', maxAge };
}

/** Reads cookies, resolves the logged-in admin and exposes it to views. */
export function loadAdmin(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const token = req.cookies[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.admin = token ? getSessionAdmin(token) : null;
  res.locals.admin = req.admin;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/** Rejects cross-site form posts (defence in depth on top of SameSite cookies). */
export function sameOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch {
    // "null" or malformed origin
  }
  res.status(403).send('Forbidden');
}

/** One-shot messages that survive a redirect. */
export function flash(req, res, next) {
  res.flash = (type, text) => {
    res.cookie(FLASH_COOKIE, JSON.stringify({ type, text }), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60_000 });
  };
  if (req.cookies[FLASH_COOKIE]) {
    try {
      res.locals.flash = JSON.parse(req.cookies[FLASH_COOKIE]);
    } catch {
      // ignore
    }
    res.clearCookie(FLASH_COOKIE, { path: '/' });
  }
  next();
}
