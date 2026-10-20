// Adds two demo anime with sample episodes so the site can be previewed.
// Usage: npm run seed   (safe to run again — existing titles are skipped)

import { listAnime, createAnime, getAnimeById, createEpisode, ensureInitialAdmin } from '../src/db.js';

// Public-domain sample video (Big Buck Bunny, © Blender Foundation, CC BY 3.0) used as a stand-in for real episodes.
const SAMPLE_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

const demo = [
  {
    title: 'Frieren: Sayohat ortidan',
    title_alt: 'Sousou no Frieren',
    description:
      'Qahramon Himmel va uning jamoasi Iblislar qirolini magʻlub etganidan soʻng, ming yildan ortiq umr koʻradigan elf-sehrgar Frieren yana yolgʻiz sayohatga chiqadi. '
      + 'Yillar oʻtib, safdoshlari birin-ketin hayotdan koʻz yumgach, u insonlarni tushunishga va ular bilan oʻtkazgan qisqa, ammo qadrli vaqtning maʼnosini anglashga harakat qiladi.',
    genres: 'Fentezi, Sarguzasht, Drama',
    type: 'TV',
    year: 2023,
    status: 'ongoing',
    age_rating: '12+',
    total_episodes: 28,
    studio: 'Madhouse',
    featured: 1,
    episodes: ['Sayohat yakuni', 'Sehrgar boʻlish shart emas', 'Odamlarni oʻldiruvchi sehr'],
  },
  {
    title: 'Solo Leveling',
    title_alt: 'Ore dake Level Up na Ken',
    description:
      'Odamlar dunyosini maxluqlar yashaydigan zindonlar bilan bogʻlovchi darvozalar paydo boʻlganiga oʻn yil boʻldi. '
      + 'Eng kuchsiz ovchi Sung Jinvu xavfli ikki qavatli zindonda oʻlimdan qolgach, faqat oʻzi koʻra oladigan sirli «Tizim»ga ega boʻladi va kuchini cheksiz oshirish imkoniyatini qoʻlga kiritadi.',
    genres: 'Jangari, Fentezi, Sarguzasht',
    type: 'TV',
    year: 2024,
    status: 'ongoing',
    age_rating: '16+',
    total_episodes: 12,
    studio: 'A-1 Pictures',
    featured: 1,
    episodes: ['Men koʻnikib qolganman', 'Agar menga yana bir imkon berilsa'],
    season2: ['Sen E-darajali ovchimisan?', 'Hali ham ancha uzoq'],
  },
];

ensureInitialAdmin();
const existing = new Set(listAnime().map((a) => a.title));

for (const { episodes, season2 = [], ...anime } of demo) {
  if (existing.has(anime.title)) {
    console.log(`• "${anime.title}" allaqachon mavjud — oʻtkazib yuborildi`);
    continue;
  }
  const id = createAnime(anime);
  [episodes, season2].forEach((titles, s) => titles.forEach((title, i) => createEpisode({
    anime_id: id, season: s + 1, number: i + 1, title, source_type: 'url', source: SAMPLE_VIDEO,
  })));
  console.log(`✓ "${getAnimeById(id).title}" qoʻshildi (${episodes.length + season2.length} ta namuna qism)`);
}

console.log('\nTayyor. Namuna qismlar haqiqiy video bilan almashtirilishi kerak (Admin → Qismlar → Tahrirlash).');
