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
    // Szene-Konfiguration laden
    state.cfg = await loadConfig(state.sceneId, state.workerBase);
    console.log('ARea Viewer – geladene SceneConfig:', state.cfg);

    // Meta-Block sichern, falls configureModel ihn ändern sollte
    const originalMeta = JSON.parse(JSON.stringify(state.cfg.meta || {}));

    // Modell + AR-Optionen konfigurieren
    configureModel(state.cfg, state.sceneId, state.workerBase);

    // falls core.js meta "leergeputzt" hätte, ursprüngliche Meta wieder herstellen
    if (!state.cfg.meta || Object.keys(state.cfg.meta).length === 0) {
      state.cfg.meta = originalMeta;
    }

    // Titel auch in den Dokumenttitel schreiben (nice to have)
    if (state.cfg.meta && state.cfg.meta.title) {
      document.title = `ARea Viewer – ${state.cfg.meta.title}`;
    }

    // Audio + Hotspots + Recording initialisieren
    initAudio(state);
    pauseAudioOnHide();
    initHotspots(state);
    initRecording(state);

    hideLoading();
    // Poster mit Meta-Daten anzeigen (inkl. Fallbacks)
    showPoster(state);
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

  // AR-Status an UI / Audio / Recording koppeln
  bindARStatus(state, {
    onSessionStart() {
      state.arSessionActive = true;
      hidePoster();
      toggleAudio(true);
    },
    async onSessionEnd() {
      state.arSessionActive = false;
      showPoster(state);
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
