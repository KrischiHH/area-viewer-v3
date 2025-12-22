// js/ui.js
// UI-Hilfsfunktionen für den Viewer, passend zu index.js und webxr-app.js

// Lade-Overlay ein/aus
export function showLoading() {
  const el = document.getElementById('loading-status');
  if (el) el.style.display = 'flex';
}

export function hideLoading() {
  const el = document.getElementById('loading-status');
  if (el) el.style.display = 'none';
}

// --------------
// Willkommenskarte (Startscreen/Card) statt Poster
// --------------

// Die eigentliche Befüllung und Anzeige passiert direkt in index.js (updateStartScreen/andere Methoden)
// Hier ist KEINE Funktion für einen Poster/Legacy-Poster mehr nötig!

// UI-Grundverdrahtung: Start-Button, Galerie-Buttons etc.
// optionales options.onStartAR für WebXR-Viewer
export function initUI(state, options = {}) {
  const startBtn        = document.getElementById('btn-enter-ar'); // NEUE ID!
  const mvEl            = document.getElementById('ar-scene-element');
  const btnGallery      = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  const galleryPanel    = document.getElementById('gallery-panel');

  const onStartARCustom = typeof options.onStartAR === 'function'
    ? options.onStartAR
    : null;

  // START AR-Button
  if (startBtn && mvEl) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;

      // 🔹 WebXR-Viewer oder andere Custom-Implementierung
      if (onStartARCustom) {
        try {
          await onStartARCustom();
        } catch (e) {
          console.error('Custom AR Start fehlgeschlagen:', e);
          const errEl = document.getElementById('err');
          if (errEl) {
            errEl.textContent = 'AR konnte nicht gestartet werden: ' + (e.message || e);
            errEl.style.display = 'block';
          }
          startBtn.disabled = false;
        }
        return;
      }

      // 🔹 Standard: model-viewer AR
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
      mvEl.querySelectorAll?.('.Hotspot').forEach(h => h.classList.add('in-ar'));
    } else if (status === 'session-ended') {
      onSessionEnd && onSessionEnd();
      const arUI = document.getElementById('ar-ui');
      if (arUI) arUI.style.display = 'none';
      mvEl.querySelectorAll?.('.Hotspot').forEach(h => h.classList.remove('in-ar'));
    } else if (status === 'failed') {
      const msg = event.detail?.reason || 'AR konnte nicht gestartet werden.';
      onFailed && onFailed(msg);
    }
  });
}
