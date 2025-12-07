// Audio-Modul: Persistentes Audio-Element + Steuerung + Autoplay-Handling
let audioEl = null;
let isAudioMuted = false;
let audioReady = false;
let audioCfgRef = null;

export function initAudio(state) {
  const cfg = state.cfg;
  audioCfgRef = cfg?.audio || null;
  const sceneId = state.sceneId;
  const workerBase = state.workerBase;
  const btnMute = document.getElementById('btn-mute');

  if (!cfg?.audio?.url || !btnMute) {
    if (btnMute) btnMute.style.display = 'none';
    return;
  }

  const audioUrl = `${workerBase}/scenes/${sceneId}/${cfg.audio.url}`;

  // Persistentes Audio-Element – für MediaRecorder und verlässliche Wiedergabe
  audioEl = document.getElementById('scene-audio');
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = 'scene-audio';
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
  }

  audioEl.src = audioUrl;
  audioEl.loop = !!cfg.audio.loop;
  audioEl.volume = cfg.audio.volume !== undefined ? cfg.audio.volume : 0.8;
  audioEl.preload = 'auto';

  // Vorsichtiges Preload – manche Browser blockieren bis zur Geste
  audioEl.addEventListener('canplay', () => {
    audioReady = true;
  }, { once: true });

  btnMute.style.display = 'flex';
  updateMuteButtonUI(btnMute);

  btnMute.onclick = () => {
    isAudioMuted = !isAudioMuted;
    if (audioEl) audioEl.muted = isAudioMuted;
    updateMuteButtonUI(btnMute);
    // Falls nach Entstummen noch nicht gestartet wurde und AR aktiv ist
    if (!isAudioMuted && state.arSessionActive) {
      safePlay();
    }
  };

  // Sicherheit: Falls bereits eine Geste durch Start AR kam, bereite playback vor
  document.addEventListener('pointerdown', primeAudioOnce, { once: true });
}

function updateMuteButtonUI(btn) {
  btn.textContent = isAudioMuted ? '🔇' : '🔊';
}

function primeAudioOnce() {
  // Versuch eine sehr kurze Wiedergabe zum Freischalten (wird gleich wieder pausiert)
  if (!audioEl) return;
  audioEl.play().then(() => {
    audioEl.pause();
    audioEl.currentTime = 0;
    audioReady = true;
  }).catch(() => {
    // Ignorieren – wird später bei AR Start erneut versucht
  });
}

function safePlay() {
  if (!audioEl || isAudioMuted) return;
  audioEl.play().catch(err => {
    console.warn('Audio konnte nicht automatisch starten (Autoplay-Policy).', err);
    // Optional: UI Hinweis anzeigen
    const errEl = document.getElementById('err');
    if (errEl && !errEl.textContent.includes('Audio')) {
      errEl.textContent += '\nHinweis: Audio musste manuell aktiviert werden.';
      errEl.style.display = 'block';
    }
  });
}

export function toggleAudio(play) {
  if (!audioEl) return;
  if (play) {
    if (!isAudioMuted) {
      const delay = audioCfgRef?.delaySeconds || 0;
      if (delay > 0) {
        setTimeout(() => safePlay(), delay * 1000);
      } else {
        safePlay();
      }
    }
  } else {
    audioEl.pause();
    audioEl.currentTime = 0;
  }
}

// Wird vom Recording-Modul verwendet
export function getPersistentAudioElement() {
  return audioEl && audioEl.id === 'scene-audio' ? audioEl : null;
}

// Cleanup bei Seitenwechsel (optional)
export function pauseAudioOnHide() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && audioEl && !isAudioMuted) {
      audioEl.pause();
    }
  });
}
