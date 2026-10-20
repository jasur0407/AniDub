import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { UPLOAD_DIR, MAX_VIDEO_MB } from './config.js';

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
// .mkv is accepted but converted to MP4 before it is published (see transcode.js).
const VIDEO_EXT = ['.mp4', '.webm', '.m4v', '.mkv'];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(UPLOAD_DIR, file.fieldname === 'video' ? 'videos' : 'images');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

function allowExtensions(allowed, label) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`${label}: faqat ${allowed.join(', ')} formatlari qabul qilinadi`));
  };
}

/** Runs a multer middleware but turns its errors into req.uploadError so the form can be re-rendered. */
function tolerant(middleware) {
  return (req, res, next) => middleware(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Fayl hajmi ruxsat etilganidan katta' : err.message;
    }
    next();
  });
}

export const animeImagesUpload = tolerant(multer({
  storage,
  fileFilter: allowExtensions(IMAGE_EXT, 'Rasm'),
  limits: { fileSize: 15 * 1024 * 1024 },
}).fields([{ name: 'poster', maxCount: 1 }, { name: 'banner', maxCount: 1 }]));

export const episodeVideoUpload = tolerant(multer({
  storage,
  fileFilter: allowExtensions(VIDEO_EXT, 'Video'),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
}).single('video'));

export const VIDEO_ACCEPT = VIDEO_EXT.join(',');
export const IMAGE_ACCEPT = IMAGE_EXT.join(',');

/** URL under which a file inside UPLOAD_DIR is served. */
export function publicUrlFor(diskFile) {
  return `/uploads/${path.relative(UPLOAD_DIR, diskFile).split(path.sep).join('/')}`;
}

/** URL under which an uploaded multer file is served. */
export function publicPath(file) {
  return publicUrlFor(file.path);
}

/** Absolute path of an uploaded file, or null for external URLs. */
export function diskPath(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) return null;
  const target = path.resolve(UPLOAD_DIR, publicUrl.slice('/uploads/'.length));
  return target.startsWith(UPLOAD_DIR + path.sep) ? target : null;
}

/** Deletes a previously uploaded file; external URLs are ignored. */
export function removeUpload(publicUrl) {
  const target = diskPath(publicUrl);
  if (target) fs.rm(target, { force: true }, () => {});
}

/** All files multer stored for this request (used to clean up when validation fails). */
export function uploadedFiles(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) Object.values(req.files).forEach((list) => files.push(...list));
  return files.map(publicPath);
}
