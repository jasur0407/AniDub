(() => {
  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(`anidub:${key}`);
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`anidub:${key}`, JSON.stringify(value));
      } catch {
        // storage unavailable (private mode etc.)
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(`anidub:${key}`);
      } catch {
        // ignore
      }
    },
  };

  // ---------- Navigation ----------
  const nav = document.querySelector('[data-nav]');
  document.querySelectorAll('[data-nav-toggle]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (event) => {
    if (nav && nav.classList.contains('is-open') && !nav.contains(event.target)) nav.classList.remove('is-open');
  });

  // ---------- Flash messages ----------
  document.querySelectorAll('[data-flash]').forEach((el) => {
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 5000);
  });

  // ---------- Hero slider ----------
  const slider = document.querySelector('[data-slider]');
  if (slider) {
    const slides = [...slider.querySelectorAll('[data-slide]')];
    const dots = [...slider.querySelectorAll('[data-slide-to]')];
    let current = 0;
    let timer = null;

    const show = (index) => {
      current = (index + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === current));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === current));
    };
    const start = () => {
      if (slides.length < 2) return;
      clearInterval(timer);
      timer = setInterval(() => show(current + 1), 7000);
    };

    dots.forEach((dot) => dot.addEventListener('click', () => { show(Number(dot.dataset.slideTo)); start(); }));
    slider.querySelector('[data-slide-prev]')?.addEventListener('click', () => { show(current - 1); start(); });
    slider.querySelector('[data-slide-next]')?.addEventListener('click', () => { show(current + 1); start(); });
    slider.addEventListener('mouseenter', () => clearInterval(timer));
    slider.addEventListener('mouseleave', start);
    start();
  }

  // ---------- Expandable description ----------
  const clamp = document.querySelector('[data-clamp]');
  const clampToggle = document.querySelector('[data-clamp-toggle]');
  if (clamp && clampToggle) {
    clamp.classList.add('is-clamped');
    const p = clamp.querySelector('p');
    if (p.scrollHeight > p.clientHeight + 4) {
      clampToggle.hidden = false;
      clampToggle.addEventListener('click', () => {
        const clamped = clamp.classList.toggle('is-clamped');
        clampToggle.textContent = clamped ? 'Batafsil' : 'Yopish';
      });
    } else {
      clamp.classList.remove('is-clamped');
    }
  }

  // ---------- Watched episodes ----------
  const watched = new Set(store.get('watched', []));
  const markWatched = (key) => {
    if (watched.has(key)) return;
    watched.add(key);
    store.set('watched', [...watched].slice(-2000));
  };
  document.querySelectorAll('[data-watch-key]:not([data-player])').forEach((el) => {
    if (watched.has(el.dataset.watchKey)) el.classList.add('is-watched');
  });

  // Last watched episode per anime, stored as { season, number }.
  const lastWatched = (slug) => {
    const last = store.get(`last:${slug}`, null);
    return last && typeof last === 'object' && last.season && last.number ? last : null;
  };

  // "Continue watching" on the anime page
  const continueBtn = document.querySelector('[data-continue]');
  if (continueBtn) {
    const slug = continueBtn.dataset.continue;
    const last = lastWatched(slug);
    if (last) {
      continueBtn.href = `/anime/${slug}/${last.season}/${last.number}`;
      const label = last.season > 1 ? `${last.season}-fasl, ${last.number}-qism` : `${last.number}-qism`;
      continueBtn.textContent = `Davom ettirish (${label})`;
      continueBtn.hidden = false;
    }
  }

  // ---------- Season dropdowns ----------
  document.querySelectorAll('[data-seasons]').forEach((container) => {
    const select = container.querySelector('[data-season-select]');
    if (!select) return;
    const panels = container.querySelectorAll('[data-season-panel]');
    const show = (season) => {
      panels.forEach((panel) => { panel.hidden = panel.dataset.seasonPanel !== String(season); });
    };
    container.classList.add('js-seasons');
    // On the anime page open the season the viewer was last watching.
    const slug = continueBtn?.dataset.continue;
    const last = slug && lastWatched(slug);
    if (last && [...select.options].some((o) => o.value === String(last.season))) select.value = String(last.season);
    show(select.value);
    select.addEventListener('change', () => show(select.value));
  });

  // ---------- Player ----------
  const player = document.querySelector('[data-player]');
  if (player) {
    const key = player.dataset.watchKey;
    const nextUrl = player.dataset.nextUrl;
    const [, season, number] = key.split(':').map(Number);
    store.set(`last:${player.dataset.slug}`, { season, number });

    document.querySelector('.episode-row.is-current')?.scrollIntoView({ block: 'nearest' });

    const video = player.querySelector('video');
    if (!video) {
      markWatched(key); // embedded players can't report progress
    } else {
      const hlsSrc = video.dataset.hlsSrc;
      if (hlsSrc) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsSrc;
        } else {
          window.addEventListener('load', () => {
            if (window.Hls && window.Hls.isSupported()) {
              const hls = new window.Hls();
              hls.loadSource(hlsSrc);
              hls.attachMedia(video);
            }
          });
        }
      }

      const timeKey = `time:${key}`;
      video.addEventListener('loadedmetadata', () => {
        const saved = store.get(timeKey, 0);
        if (saved > 5 && saved < video.duration - 10) video.currentTime = saved;
      }, { once: true });

      let lastSave = 0;
      video.addEventListener('timeupdate', () => {
        const now = Date.now();
        if (now - lastSave < 4000) return;
        lastSave = now;
        store.set(timeKey, Math.floor(video.currentTime));
        if (video.duration && video.currentTime / video.duration > 0.8) markWatched(key);
      });

      const autonext = document.querySelector('[data-autonext]');
      if (autonext) {
        autonext.checked = store.get('autonext', true);
        autonext.addEventListener('change', () => store.set('autonext', autonext.checked));
      }

      video.addEventListener('ended', () => {
        markWatched(key);
        store.remove(timeKey);
        if (nextUrl && autonext?.checked) window.location.href = nextUrl;
      });

      // Keyboard shortcuts: space / k = play-pause, f = fullscreen, ← → = seek 10s
      document.addEventListener('keydown', (event) => {
        if (event.target.closest('input, textarea, select, [contenteditable]')) return;
        if (event.key === ' ' || event.key === 'k') {
          event.preventDefault();
          if (video.paused) video.play(); else video.pause();
        } else if (event.key === 'f') {
          if (document.fullscreenElement) document.exitFullscreen(); else video.requestFullscreen?.();
        } else if (event.key === 'ArrowRight') {
          video.currentTime += 10;
        } else if (event.key === 'ArrowLeft') {
          video.currentTime -= 10;
        }
      });
    }
  }
})();
