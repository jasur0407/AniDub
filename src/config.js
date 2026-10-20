import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.resolve(ROOT, process.env.UPLOAD_DIR || 'uploads');
export const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB) || 4096;
export const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
