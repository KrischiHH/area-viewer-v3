// js/ui.js
// UI-Hilfsfunktionen für den Viewer, passend zu index.js

// Lade-Overlay ein/aus
export function showLoading() {
  const el = document.getElementById('loading-status');
  if (el) el.style.display = 'flex';
}

export function hideLoading() {
  const el = document.getElementById('loading-status');
  if (el) el.style.display = 'none';
}

// Poster ein/aus + Befüllen (kompatibel zu ALT & NEU)
export function showPoster(state) {
  const poster       = document.getElementById('poster');
  const titleEl      = document.getElementById('posterTitle');
  // Subline (neu)
  const subtitleEl   = document.getElementById('posterSubtitle');
  // Text: versuche zuerst posterText (neu), sonst posterDesc (alt)
  const textEl       = document.getElementById('posterText') || document.getElementById('posterDesc');
  // Image: neu = posterImageEl, alt = posterImage
  const imgEl        = document.getElementById('posterImageEl') || document.getElementById('posterImage');
  // Optionaler Wrapper – wenn nicht vorhanden, nutzen wir notfalls parentElement des Bildes
  const mediaWrapper = document.getElementById('poster-media') || (imgEl ? imgEl.parentElement : null);

  const cfg     = state?.cfg || {};
  const meta    = cfg.meta || {};
  const welcome = (cfg.ui && cfg.ui.welcome) || {};

  // 🔹 Titel: zuerst neues Schema (meta.title), sonst altes (welcome.title / meta.description)
  const title =
    (meta.title && meta.title.trim()) ||
    (welcome.title && welcome.title.trim()) ||
    '3D / AR Erlebnis';

  // 🔹 Subline: neues Feld (meta.subtitle) oder altes Eyebrow (welcome.eyebrow)
  const subtitle =
    (meta.subtitle && meta.subtitle.trim()) ||
    (welcome.eyebrow && welcome.eyebrow.trim()) ||
    '';

  // 🔹 Body-Text: neu = meta.body, alt = meta.description oder welcome.desc
  const body =
    (meta.body && meta.body.trim()) ||
    (meta.description && meta.description.trim()) ||
    (welcome.desc && welcome.desc.trim()) ||
    'Tippe auf START AR, um das Modell in deiner Umgebung zu sehen.';

  // 🔹 Posterbild-Dateiname: neu = meta.posterImage, alt = welcome.poster
  const posterFile =
    (meta.posterImage && String(meta.posterImage).trim()) ||
    (welcome.poster && String(welcome.poster).trim()) ||
    '';

  console.log('ARea Viewer – showPoster()', {
    meta,
    welcome,
    resolved: { title, subtitle, body, posterFile },
    sceneId: state?.sceneId,
    workerBase: state?.workerBase
  });

  if (titleEl) {
    titleEl.textContent = title;
  }

  if (textEl) {
    textEl.textContent = body;
  }

  // Subline nur anzeigen, wenn Element existiert
  if (subtitleEl) {
    if (subtitle) {
      subtitleEl.textContent = subtitle;
      subtitleEl.classList.remove('hidden');
    } else {
      subtitleEl.textContent = '';
      subtitleEl.classList.add('hidden');
    }
  }

  // Posterbild nur, wenn wir ein Dateiname UND sceneId/base haben
  if (imgEl) {
    if (posterFile && state?.workerBase && state?.sceneId) {
      const url = `${state.workerBase}/scenes/${encodeURIComponent(
        state.sceneId
      )}/${encodeURIComponent(posterFile)}`;
      console.log('ARea Viewer – Posterbild URL:', url);
      imgEl.src = url;

      // alt-Styling aus altem Viewer: display:block
      if (imgEl.style) {
        imgEl.style.display = 'block';
      }

      if (mediaWrapper) {
        mediaWrapper.classList.remove('hidden');
        if (mediaWrapper.style) mediaWrapper.style.display = '';
      }
    } else {
      // Kein Bild → ausblenden
      if (imgEl.style) {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
      }
      if (mediaWrapper) {
        mediaWrapper.classList.add('hidden');
      }
    }
  }

  if (poster) {
    poster.style.display = 'flex';
  }
}

export function hidePoster() {
  const poster = document.getElementById('poster');
  if (poster) poster.style.display = 'none';
}

// UI-Grundverdrahtung: Start-Button, Galerie-Buttons etc.
export function initUI(state) {
  const startBtn        = document.getElementById('startAr');
  const mvEl            = document.getElementById('ar-scene-element');
  const btnGallery      = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  const galleryPanel    = document.getElementById('gallery-panel');

  // START AR-Button
  if (startBtn && mvEl) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;

      const canActivate = ('canActivateAR' in mvEl) ? mvEl.canActivateAR : undefined;
      console.log('[ARea Viewer] canActivateAR:', canActivate);

      try {
        // Wenn canActivateAR explizit false ist → freundlicher Hinweis
        if (canActivate === false) {
          const errEl = document.getElementById('err');
          if (errEl) {
            errEl.textContent =
              'AR wird in diesem Browser nicht unterstützt.\n' +
              'Bitte öffne den Link in Chrome (Android) oder Safari (iOS).';
            errEl.style.display = 'block';
          }
          startBtn.disabled = false;
          return;
        }

        if (typeof mvEl.activateAR === 'function') {
          await mvEl.activateAR();
        } else if (typeof mvEl.enterAR === 'function') {
          await mvEl.enterAR();
        } else {
          throw new Error('AR-Funktion nicht verfügbar.');
        }
      } catch (e) {
        console.error('activateAR() fehlgeschlagen:', e);
        const errEl = document.getElementById('err');
        if (errEl) {
          errEl.textContent = 'AR konnte nicht gestartet werden: ' + (e.message || e);
          errEl.style.display = 'block';
        }
        startBtn.disabled = false;
        return;
      }

      // Fallback, falls ar-status nicht feuert (z. B. bei nativen Viewern)
      setTimeout(() => {
        if (!state.arSessionActive) {
          startBtn.disabled = false;
        }
      }, 6000);
    });
  }

  // Galerie öffnen/schließen (für Recording-Snaps/Videos)
  if (btnGallery && btnGalleryClose && galleryPanel) {
    btnGallery.addEventListener('click', () => {
      galleryPanel.style.display = 'flex';
    });
    btnGalleryClose.addEventListener('click', () => {
      galleryPanel.style.display = 'none';
    });
  }
}

// AR-Status an index.js-Callbacks durchreichen
export function bindARStatus(state, { onSessionStart, onSessionEnd, onFailed }) {
  const mvEl = document.getElementById('ar-scene-element');
  if (!mvEl) return;

  mvEl.addEventListener('ar-status', (event) => {
    const status = event.detail?.status;

    if (status === 'session-started') {
      onSessionStart && onSessionStart();
      const arUI = document.getElementById('ar-ui');
      if (arUI) arUI.style.display = 'block';

      // Hotspots im AR-Modus hervorheben
      mvEl.querySelectorAll('.Hotspot').forEach(h => h.classList.add('in-ar'));
    } else if (status === 'session-ended') {
      onSessionEnd && onSessionEnd();
      const arUI = document.getElementById('ar-ui');
      if (arUI) arUI.style.display = 'none';
      mvEl.querySelectorAll('.Hotspot').forEach(h => h.classList.remove('in-ar'));
    } else if (status === 'failed') {
      const msg = event.detail?.reason || 'AR konnte nicht gestartet werden.';
      onFailed && onFailed(msg);
    }
  });
}
