// Converts uploaded MKV episodes to browser-friendly MP4 (H.264 + AAC) in the background.
// Jobs run one at a time; progress is stored on the episode row so the admin panel can show it.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {
  getEpisodeById, listProcessingEpisodes, setEpisodeProgress, finishEpisodeConversion, failEpisodeConversion,
} from './db.js';
import { diskPath, publicUrlFor } from './uploads.js';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic?.path;

const CONVERTIBLE_EXT = ['.mkv'];
const UZBEK_LANGUAGE_TAGS = ['uzb', 'uz', 'uzbek'];

export const conversionAvailable = Boolean(FFMPEG && FFPROBE && fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE));

export function needsConversion(filename) {
  return CONVERTIBLE_EXT.includes(path.extname(filename || '').toLowerCase());
}

function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(new Error('Faylni oʻqib boʻlmadi — u buzilgan yoki video emas'));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Fayl maʼlumotlarini oʻqib boʻlmadi'));
        }
      });
  });
}

/**
 * Chooses the streams to keep and whether each can be copied as-is.
 * Audio preference: Uzbek-tagged track, then the default track, then the first one.
 */
export function planConversion(info) {
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('Faylda video topilmadi');

  const audios = streams.filter((s) => s.codec_type === 'audio');
  const language = (s) => String(s.tags?.language || '').toLowerCase();
  const audio = audios.find((s) => UZBEK_LANGUAGE_TAGS.includes(language(s)))
    || audios.find((s) => s.disposition?.default)
    || audios[0]
    || null;

  // Browsers only reliably play 8-bit H.264; 10-bit ("Hi10P") and HEVC must be re-encoded.
  const copyVideo = video.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(video.pix_fmt);
  const copyAudio = Boolean(audio) && audio.codec_name === 'aac' && (audio.channels ?? 2) <= 2;

  const args = ['-map', `0:${video.index}`];
  if (audio) args.push('-map', `0:${audio.index}`);
  args.push(...(copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p']));
  if (audio) args.push(...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k', '-ac', '2']));
  args.push('-sn', '-dn', '-map_chapters', '-1', '-movflags', '+faststart');

  return {
    args,
    duration: Number(info.format?.duration) || Number(video.duration) || 0,
    copyVideo,
    copyAudio,
    audioLanguage: audio ? language(audio) || null : null,
  };
}

// ---------- Job queue ----------

const queue = [];
let current = null; // { episodeId, child, cancelled }

export function enqueueConversion(episodeId) {
  if ((current?.episodeId === episodeId && !current.cancelled) || queue.includes(episodeId)) return;
  queue.push(episodeId);
  runNext();
}

/** Stops (or dequeues) the conversion of an episode that was deleted or replaced. */
export function cancelConversion(episodeId) {
  const index = queue.indexOf(episodeId);
  if (index >= 0) queue.splice(index, 1);
  if (current?.episodeId === episodeId) {
    current.cancelled = true;
    current.child?.kill('SIGKILL');
  }
}

/** Kills the running ffmpeg so it doesn't outlive the server; the job resumes on next start. */
export function stopConversions() {
  queue.length = 0;
  if (current) {
    current.cancelled = true;
    current.child?.kill('SIGKILL');
  }
}

/** Re-queues conversions that were interrupted by a server restart. */
export function resumePendingConversions() {
  listProcessingEpisodes().forEach(enqueueConversion);
}

async function runNext() {
  if (current || !queue.length) return;
  const job = { episodeId: queue.shift(), child: null, cancelled: false };
  current = job;
  try {
    await convert(job);
  } catch (err) {
    if (!job.cancelled) {
      console.error(`Episode ${job.episodeId} conversion failed:`, err.message);
      const episode = getEpisodeById(job.episodeId);
      if (episode?.status === 'processing') {
        failEpisodeConversion(job.episodeId, err.message);
        const file = diskPath(episode.source);
        if (file) fs.rm(file, { force: true }, () => {});
      }
    }
  } finally {
    current = null;
    runNext();
  }
}

async function convert(job) {
  const episode = getEpisodeById(job.episodeId);
  if (!episode || episode.status !== 'processing') return;

  const input = diskPath(episode.source);
  if (!input || !fs.existsSync(input)) throw new Error('Yuklangan fayl topilmadi');

  const plan = planConversion(await probe(input));
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  const output = path.join(dir, `${base}.mp4`);
  // Leftovers from an interrupted attempt are removed; each attempt writes its own temp file
  // so a still-running orphaned ffmpeg (after a hard crash) can't collide with this one.
  fs.readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith('.part'))
    .forEach((name) => fs.rm(path.join(dir, name), { force: true }, () => {}));
  const partial = path.join(dir, `${base}.${Date.now().toString(36)}.part`);

  console.log(`Converting episode ${job.episodeId}: video ${plan.copyVideo ? 'copy' : 'H.264'}, audio ${plan.copyAudio ? 'copy' : 'AAC'}${plan.audioLanguage ? ` (${plan.audioLanguage})` : ''}`);
  try {
    await runFfmpeg(job, ['-hide_banner', '-nostdin', '-y', '-i', input, ...plan.args, '-f', 'mp4', '-progress', 'pipe:1', '-nostats', partial], plan.duration);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }

  // The episode may have been deleted or given a different file while we were converting.
  const latest = getEpisodeById(job.episodeId);
  if (job.cancelled || !latest || latest.source !== episode.source) {
    fs.rmSync(partial, { force: true });
    fs.rmSync(input, { force: true });
    return;
  }

  fs.renameSync(partial, output);
  finishEpisodeConversion(job.episodeId, publicUrlFor(output));
  fs.rmSync(input, { force: true });
  console.log(`Episode ${job.episodeId} is ready`);
}

function runFfmpeg(job, args, duration) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    job.child = child;
    let stderr = '';
    let pending = '';
    let lastPercent = -1;

    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const [key, value] = line.trim().split('=');
        // Despite the name, ffmpeg reports out_time_ms in microseconds too.
        if ((key === 'out_time_us' || key === 'out_time_ms') && duration > 0 && /^\d+$/.test(value)) {
          const percent = Math.min(99, Math.floor((Number(value) / 1e6 / duration) * 100));
          if (percent > lastPercent) {
            lastPercent = percent;
            setEpisodeProgress(job.episodeId, percent);
          }
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (job.cancelled || code === 0) return resolve();
      const reason = stderr.trim().split('\n').filter(Boolean).pop() || `ffmpeg exit code ${code}`;
      reject(new Error(`Konvertatsiya xatosi: ${reason}`));
    });
  });
}
