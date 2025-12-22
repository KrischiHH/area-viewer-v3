// js/index.js
import { initCore, loadConfig, configureModel } from './core.js';
import { initUI, showLoading, hideLoading, showPoster, hidePoster, bindARStatus } from './ui.js';
import { initAudio, toggleAudio, pauseAudioOnHide } from './audio.js';
import { initHotspots } from './hotspots.js';
import { initRecording, stopRecordingOnARSessionEnd } from './recording.js';

let state = {
  cfg: null,
  sceneId: null,
  workerBase: null,
  arSessionActive: false
};

document.addEventListener('DOMContentLoaded', async () => {
  showLoading();

  const params = new URLSearchParams(window.location.search);
  state.sceneId = params.get('scene');
  state.workerBase = params.get('base');

  if (!state.sceneId || !state.workerBase) {
    hideLoading();
    const errEl = document.getElementById('err');
    if (errEl) {
      errEl.textContent = 'FEHLENDE URL PARAMETER (scene/base)';
      errEl.style.display = 'block';
    }
    return;
  }

  initUI(state);

  try {
    // 1. Szene-Konfiguration laden
    state.cfg = await loadConfig(state.sceneId, state.workerBase);
    console.log('ARea Viewer – geladene SceneConfig:', state.cfg);

    // Meta-Block sichern
    const originalMeta = JSON.parse(JSON.stringify(state.cfg.meta || {}));

    // 2. Modell + AR-Optionen konfigurieren (model-viewer)
    configureModel(state.cfg, state.sceneId, state.workerBase);

    if (!state.cfg.meta || Object.keys(state.cfg.meta).length === 0) {
      state.cfg.meta = originalMeta;
    }

    // Dokumenttitel setzen
    if (state.cfg.meta && state.cfg.meta.title) {
      document.title = `ARea Viewer – ${state.cfg.meta.title}`;
    }

    // 3. Start-Screen mit Daten befüllen (Einheitliches WebXR Design)
    updateStartScreen(state);

    // 4. Audio + Hotspots + Recording initialisieren
    initAudio(state);
    pauseAudioOnHide();
    initHotspots(state);
    initRecording(state);

    hideLoading();
    
    // Start-Screen anzeigen
    const startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.style.display = 'flex';

  } catch (e) {
    hideLoading();
    const errEl = document.getElementById('err');
    if (errEl) {
      errEl.textContent = 'FEHLER: ' + e.message;
      errEl.style.display = 'block';
    }
    console.error(e);
    return;
  }

  // 5. AR-Status an UI / Audio / Recording koppeln
  bindARStatus(state, {
    onSessionStart() {
      state.arSessionActive = true;
      
      // UI Wechsel: Start-Screen weg, AR-UI her
      const startScreen = document.getElementById('start-screen');
      if (startScreen) startScreen.style.display = 'none';
      
      const arUi = document.getElementById('ar-ui');
      if (arUi) arUi.style.display = 'block';

      toggleAudio(true);
    },
    async onSessionEnd() {
      state.arSessionActive = false;
      
      // UI Wechsel: Zurück zum Start-Screen
      const startScreen = document.getElementById('start-screen');
      if (startScreen) startScreen.style.display = 'flex';
      
      const arUi = document.getElementById('ar-ui');
      if (arUi) arUi.style.display = 'none';

      toggleAudio(false);
      await stopRecordingOnARSessionEnd();
      
      const startBtn = document.getElementById('startAr');
      if (startBtn) startBtn.disabled = false;
    },
    onFailed(msg) {
      state.arSessionActive = false;
      const errEl = document.getElementById('err');
      if (errEl) {
        errEl.textContent = 'AR FEHLER: ' + msg;
        errEl.style.display = 'block';
      }
      const startBtn = document.getElementById('startAr');
      if (startBtn) startBtn.disabled = false;
    }
  });
});

/**
 * Befüllt die Elemente des neuen Start-Screens mit Daten aus der Scene-Config
 */
function updateStartScreen(state) {
  const meta = state.cfg.meta || {};
  const welcome = (state.cfg.ui && state.cfg.ui.welcome) || {};

  // Titel (Bangers Font via CSS)
  const titleEl = document.getElementById('start-title');
  if (titleEl) {
    titleEl.textContent = meta.title || welcome.title || '3D / AR Erlebnis';
  }

  // Subline
  const sublineEl = document.getElementById('start-subline');
  if (sublineEl) {
    sublineEl.textContent = meta.subtitle || welcome.eyebrow || '';
  }

  // Beschreibungstext
  const textEl = document.getElementById('start-text');
  if (textEl) {
    textEl.textContent = meta.description || welcome.desc || 'Tippe auf STARTE AR, um das Modell in deiner Umgebung zu sehen.';
  }

  // Vorschaubild (Poster)
  const imgEl = document.getElementById('start-image');
  const posterFile = meta.posterImage || welcome.poster;
  if (imgEl && posterFile) {
    imgEl.src = `${state.workerBase}/scenes/${state.sceneId}/${posterFile}`;
    imgEl.style.display = 'block';
  } else if (imgEl) {
    imgEl.style.display = 'none';
  }
}
