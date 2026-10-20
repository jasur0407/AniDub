(() => {
  // ---------- Delete confirmations ----------
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  // ---------- Genre suggestions ----------
  const genreInput = document.querySelector('[data-genre-input]');
  document.querySelectorAll('[data-genre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const genres = genreInput.value.split(',').map((g) => g.trim()).filter(Boolean);
      if (!genres.includes(btn.dataset.genre)) genres.push(btn.dataset.genre);
      genreInput.value = genres.join(', ');
    });
  });

  // ---------- Image previews ----------
  document.querySelectorAll('[data-preview-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files[0];
      const img = document.querySelector(`[data-preview="${input.dataset.previewInput}"]`);
      if (file && img) img.src = URL.createObjectURL(file);
    });
  });

  // ---------- Episode source tabs ----------
  const tabs = document.querySelector('[data-source-tabs]');
  if (tabs) {
    const sync = () => {
      const type = tabs.querySelector('input:checked')?.value || 'file';
      document.querySelectorAll('[data-source-panel]').forEach((panel) => {
        const active = panel.dataset.sourcePanel === type;
        panel.hidden = !active;
        panel.querySelectorAll('input, textarea').forEach((field) => { field.disabled = !active; });
      });
    };
    tabs.addEventListener('change', sync);
    sync();
  }

  // ---------- Video dropzone ----------
  document.querySelectorAll('[data-dropzone]').forEach((zone) => {
    const input = zone.querySelector('input[type=file]');
    const label = zone.querySelector('[data-dropzone-label]');
    const describe = () => {
      const file = input.files[0];
      if (!file) return;
      zone.classList.add('has-file');
      label.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    };
    ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, () => zone.classList.add('is-dragover')));
    ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, () => zone.classList.remove('is-dragover')));
    input.addEventListener('change', describe);
  });

  // ---------- Season → next free episode number ----------
  const seasonInput = document.querySelector('[data-season-input]');
  const numberInput = document.querySelector('[data-number-input]');
  if (seasonInput && numberInput && !seasonInput.hasAttribute('data-editing')) {
    const nextNumbers = JSON.parse(seasonInput.dataset.nextNumbers || '{}');
    let suggested = numberInput.value;
    seasonInput.addEventListener('change', () => {
      // Only replace the number if the admin hasn't typed their own.
      if (numberInput.value === String(suggested) && nextNumbers[seasonInput.value]) {
        suggested = nextNumbers[seasonInput.value];
        numberInput.value = suggested;
      }
    });
  }

  // ---------- Season filter in the episodes table ----------
  const seasonFilter = document.querySelector('[data-season-filter]');
  seasonFilter?.addEventListener('change', () => {
    document.querySelectorAll('[data-season-row]').forEach((row) => {
      row.hidden = Boolean(seasonFilter.value) && row.dataset.seasonRow !== seasonFilter.value;
    });
  });

  // ---------- Accent colour preview ----------
  document.querySelectorAll('[data-accent-picker] input').forEach((input) => {
    input.addEventListener('change', () => { document.documentElement.dataset.accent = input.value; });
  });

  // ---------- MKV conversion progress ----------
  const statusUrl = document.querySelector('[data-status-url]')?.dataset.statusUrl;
  if (statusUrl && document.querySelector('[data-episode-status]')) {
    const poll = async () => {
      try {
        const response = await fetch(statusUrl, { headers: { accept: 'application/json' } });
        const episodes = await response.json();
        let pending = 0;
        episodes.forEach((ep) => {
          const badge = document.querySelector(`[data-episode-status="${ep.id}"]`);
          if (!badge) return;
          if (ep.status === 'processing') {
            pending += 1;
            badge.textContent = `Konvertatsiya ${ep.progress}%`;
            return;
          }
          badge.removeAttribute('data-episode-status');
          badge.className = `badge ${ep.status === 'ready' ? 'badge-ready' : 'badge-failed'}`;
          badge.textContent = ep.status === 'ready' ? 'Tayyor ✓' : 'Xato';
          if (ep.error) badge.title = ep.error;
        });
        if (pending) setTimeout(poll, 3000);
      } catch {
        setTimeout(poll, 10000);
      }
    };
    setTimeout(poll, 3000);
  }

  // ---------- Upload with progress bar ----------
  document.querySelectorAll('form[data-upload-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.FormData || !window.XMLHttpRequest) return;
      event.preventDefault();

      const box = form.querySelector('[data-progress]');
      const bar = form.querySelector('[data-progress-bar]');
      const text = form.querySelector('[data-progress-text]');
      const buttons = form.querySelectorAll('button[type=submit]');
      buttons.forEach((b) => { b.disabled = true; });
      box.hidden = false;
      bar.style.width = '0%';
      text.textContent = 'Yuklanmoqda...';

      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        bar.style.width = `${percent}%`;
        text.textContent = percent < 100
          ? `Yuklanmoqda: ${percent}% (${(e.loaded / 1024 / 1024).toFixed(1)} / ${(e.total / 1024 / 1024).toFixed(1)} MB)`
          : 'Saqlanmoqda...';
      });
      xhr.addEventListener('load', () => {
        // Show whatever page the server answered with (redirect target or form with errors).
        history.replaceState(null, '', xhr.responseURL || form.action);
        document.open();
        document.write(xhr.responseText);
        document.close();
      });
      xhr.addEventListener('error', () => {
        buttons.forEach((b) => { b.disabled = false; });
        text.textContent = 'Tarmoq xatosi — qayta urinib koʻring.';
      });
      xhr.send(new FormData(form));
    });
  });
})();
