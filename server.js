import path from 'node:path';
import express from 'express';
import { ROOT, UPLOAD_DIR, TRUST_PROXY } from './src/config.js';
import { ensureInitialAdmin, getSetting } from './src/db.js';
import { loadAdmin, flash } from './src/auth.js';
import { conversionAvailable, resumePendingConversions, stopConversions } from './src/transcode.js';
import * as helpers from './src/helpers.js';
import publicRoutes from './src/routes/public.js';
import adminRoutes from './src/routes/admin.js';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);

app.locals.h = helpers;
// Changes on every start so browsers fetch fresh CSS/JS after an update.
app.locals.assetVersion = Date.now().toString(36);

app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(loadAdmin);
app.use(flash);
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.accent = getSetting('accent') || helpers.DEFAULT_ACCENT;
  next();
});

app.use(publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Sahifa topilmadi',
    code: 404,
    message: 'Siz qidirgan sahifa mavjud emas yoki oʻchirilgan.',
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Xatolik',
    code: 500,
    message: 'Serverda kutilmagan xatolik yuz berdi. Birozdan soʻng qayta urinib koʻring.',
  });
});

ensureInitialAdmin();
if (conversionAvailable) resumePendingConversions();
else console.warn('ffmpeg topilmadi — MKV fayllarni konvertatsiya qilish oʻchirilgan (ffmpeg not found, MKV conversion disabled)');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopConversions();
    process.exit(0);
  });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`UzAniDub ishga tushdi: http://localhost:${port}`);
  console.log(`Admin panel:        http://localhost:${port}/admin`);
});
