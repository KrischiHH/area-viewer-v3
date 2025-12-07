import { getPersistentAudioElement } from './audio.js';

// Konfiguration
const MAX_RECORD_TIME_SECONDS = 600;          // 10 Minuten
const LONG_PRESS_THRESHOLD_MS = 300;          // Ab hier: Video statt Foto
const SCREENSHOT_QUALITY = 0.92;              // JPEG Qualität

// State für Aufnahme
let recTimer = 0;
let simulatedRecordingId = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecordingReal = false;
let realTimerId = null;
let audioCtxRef = null;
let chosenMimeType = 'video/webm';

// Press-Erkennung
let pressTimerId = null;
let isPressing = false;
let longPressActive = false;

// FFmpeg
let ffmpegInstance = null;
let ffmpegLoaded = false;

// Galerie
const galleryItems = []; // { type:'image'|'video', url, format:'jpg'|'mp4'|'webm', ts:number }
let galleryGridRef = null;

async function ensureFFmpeg() {
  try {
    const FF = window.FFmpeg;
    if (!FF || !FF.createFFmpeg) return null;
    if (!ffmpegInstance) {
      ffmpegInstance = FF.createFFmpeg({ log: false });
    }
    if (!ffmpegLoaded) {
      await ffmpegInstance.load();
      ffmpegLoaded = true;
    }
    return FF;
  } catch (e) {
    console.warn('FFmpeg.js Laden fehlgeschlagen:', e);
    return null;
  }
}

export function initRecording() {
  const btnCapture = document.getElementById('btn-capture');
  const btnGallery = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  const galleryPanel = document.getElementById('gallery-panel');
  galleryGridRef = document.getElementById('gallery-grid');
  const recInfo = document.getElementById('rec-info');
  const mvEl = document.getElementById('ar-scene-element');

  // Galerie öffnen
  btnGallery?.addEventListener('click', () => {
    galleryPanel.style.display = 'flex';
    refreshGalleryGrid();
  });
  // Galerie schließen
  btnGalleryClose?.addEventListener('click', () => {
    galleryPanel.style.display = 'none';
  });

  // Capture Button Interaktion (Foto / Video)
  const onPressStart = (e) => {
    e.preventDefault();
    if (isPressing) return;
    isPressing = true;
    longPressActive = false;
    pressTimerId = setTimeout(() => {
      longPressActive = true;
      if (canRecordReal(mvEl)) {
        startRealRecording(mvEl, recInfo, btnCapture);
      } else {
        console.warn('MediaRecorder nicht verfügbar → Fallback Simulation.');
        startSimulatedRecording(recInfo, btnCapture);
      }
    }, LONG_PRESS_THRESHOLD_MS);
  };

  const onPressEnd = async (e) => {
    e.preventDefault();
    if (!isPressing) return;
    isPressing = false;

    if (pressTimerId) {
      clearTimeout(pressTimerId);
      pressTimerId = null;
    }

    if (!longPressActive) {
      // Kurztipp → Foto
      takeScreenshot(mvEl, btnCapture);
    } else {
      // Aufnahme lief → Stop
      if (isRecordingReal || simulatedRecordingId) {
        await stopAllRecording(recInfo, btnCapture);
      }
    }
  };

  // Touch Events
  btnCapture?.addEventListener('touchstart', onPressStart, { passive: false });
  btnCapture?.addEventListener('touchend', onPressEnd, { passive: false });
  btnCapture?.addEventListener('touchcancel', onPressEnd, { passive: false });

  // Maus Events
  btnCapture?.addEventListener('mousedown', onPressStart);
  btnCapture?.addEventListener('mouseup', onPressEnd);
  btnCapture?.addEventListener('mouseleave', (e) => {
    if (isPressing) onPressEnd(e);
  });

  // Cleanup beim Verlassen
  window.addEventListener('beforeunload', async () => {
    if (isRecordingReal || simulatedRecordingId) {
      try { await stopAllRecording(recInfo, btnCapture); } catch(_) {}
    }
  });
}

/* ---------- Screenshot ---------- */
function takeScreenshot(mvEl, btnCapture) {
  if (!mvEl || typeof mvEl.toBlob !== 'function') {
    console.warn('toBlob() nicht verfügbar.');
    return;
  }
  // Snap Animation
  btnCapture?.classList.add('snap');
  setTimeout(() => btnCapture?.classList.remove('snap'), 200);

  mvEl.toBlob({ mimeType: 'image/jpeg', quality: SCREENSHOT_QUALITY })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      // Download
      triggerDownload(url, 'ARea_Screenshot.jpg');
      // In Galerie übernehmen
      addToGallery({ type:'image', url, format:'jpg', ts:Date.now() });
    })
    .catch(e => console.error('Screenshot fehlgeschlagen:', e));
}

/* ---------- Feature Detection ---------- */
function canRecordReal(mvEl) {
  return !!window.MediaRecorder && !!mvEl?.shadowRoot?.querySelector('canvas');
}

/* ---------- Simulierte Aufnahme ---------- */
function startSimulatedRecording(recInfo, btnCapture) {
  recTimer = 0;
  recInfo.textContent = '00:00';
  recInfo.style.display = 'flex';
  btnCapture?.classList.add('recording');

  simulatedRecordingId = setInterval(() => {
    recTimer++;
    recInfo.textContent = formatTime(recTimer);
    if (recTimer >= MAX_RECORD_TIME_SECONDS) {
      stopAllRecording(recInfo, btnCapture);
    }
  }, 1000);
}

function formatTime(seconds) {
  if (seconds >= 3600) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  } else {
    const m = String(Math.floor(seconds / 60)).padStart(2,'0');
    const s = String(seconds % 60).padStart(2,'0');
    return `${m}:${s}`;
  }
}

/* ---------- Echte Aufnahme ---------- */
function startRealRecording(mvEl, recInfo, btnCapture) {
  const canvas = mvEl.shadowRoot.querySelector('canvas');
  if (!canvas) {
    console.warn('Kein Canvas für Aufnahme gefunden → Fallback.');
    startSimulatedRecording(recInfo, btnCapture);
    return;
  }

  const stream = canvas.captureStream(30);
  let finalStream = stream;

  const persistentAudio = getPersistentAudioElement();
  if (persistentAudio) {
    try {
      audioCtxRef = new AudioContext();
      const source = audioCtxRef.createMediaElementSource(persistentAudio);
      const dest = audioCtxRef.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtxRef.destination);
      finalStream = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } catch (e) {
      console.warn('Audiomixing fehlgeschlagen:', e);
    }
  }

  const mimeTypeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  chosenMimeType = '';
  for (const c of mimeTypeCandidates) {
    if (MediaRecorder.isTypeSupported(c)) { chosenMimeType = c; break; }
  }
  if (!chosenMimeType) {
    console.warn('Kein unterstützter WebM Codec → Simulation.');
    startSimulatedRecording(recInfo, btnCapture);
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(finalStream, { mimeType: chosenMimeType });
  } catch (e) {
    console.warn('MediaRecorder fehlgeschlagen → Simulation.', e);
    startSimulatedRecording(recInfo, btnCapture);
    return;
  }

  recordedChunks = [];
  isRecordingReal = true;
  recTimer = 0;
  recInfo.textContent = '00:00';
  recInfo.style.display = 'flex';
  btnCapture?.classList.add('recording');

  realTimerId = setInterval(() => {
    recTimer++;
    recInfo.textContent = formatTime(recTimer);
    if (recTimer >= MAX_RECORD_TIME_SECONDS) {
      stopAllRecording(recInfo, btnCapture);
    }
  }, 1000);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.start();
}

/* ---------- Konvertierung WebM -> MP4 ---------- */
async function convertWebMToMP4(webmBlob) {
  const FF = await ensureFFmpeg();
  if (!FF) return null;
  try {
    const data = new Uint8Array(await webmBlob.arrayBuffer());
    ffmpegInstance.FS('writeFile', 'input.webm', data);

    await ffmpegInstance.run(
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      'output.mp4'
    );

    const out = ffmpegInstance.FS('readFile', 'output.mp4');
    try { ffmpegInstance.FS('unlink', 'input.webm'); } catch(_) {}
    try { ffmpegInstance.FS('unlink', 'output.mp4'); } catch(_) {}

    return new Blob([out.buffer], { type: 'video/mp4' });
  } catch (e) {
    console.warn('FFmpeg Konvertierung fehlgeschlagen:', e);
    return null;
  }
}

/* ---------- Aufnahme stoppen ---------- */
async function stopAllRecording(recInfo, btnCapture) {
  if (simulatedRecordingId) {
    clearInterval(simulatedRecordingId);
    simulatedRecordingId = null;
  }
  if (realTimerId) {
    clearInterval(realTimerId);
    realTimerId = null;
  }

  let hadRealRecording = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    hadRealRecording = true;
    const stopPromise = new Promise(resolve => {
      const onStop = () => {
        mediaRecorder.removeEventListener('stop', onStop);
        resolve();
      };
      mediaRecorder.addEventListener('stop', onStop);
    });
    mediaRecorder.stop();
    await stopPromise;
  }

  recInfo.style.display = 'none';
  btnCapture?.classList.remove('recording');
  isRecordingReal = false;

  try { audioCtxRef?.close(); } catch(_) {}
  audioCtxRef = null;

  if (hadRealRecording && recordedChunks.length > 0) {
    const webmBlob = new Blob(recordedChunks, { type: (chosenMimeType || 'video/webm') });
    let mp4Blob = await convertWebMToMP4(webmBlob);
    if (mp4Blob) {
      const url = URL.createObjectURL(mp4Blob);
      triggerDownload(url, 'ARea_Recording.mp4');
      addToGallery({ type:'video', url, format:'mp4', ts:Date.now() });
    } else {
      const fallbackUrl = URL.createObjectURL(webmBlob);
      triggerDownload(fallbackUrl, 'ARea_Recording.webm');
      addToGallery({ type:'video', url:fallbackUrl, format:'webm', ts:Date.now() });
    }
  }

  recordedChunks = [];
  mediaRecorder = null;
}

/* ---------- Download Helper ---------- */
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ---------- Galerie Funktionen ---------- */
function addToGallery(item) {
  galleryItems.push(item);
  refreshGalleryGrid();
}

function refreshGalleryGrid() {
  if (!galleryGridRef) return;
  galleryGridRef.innerHTML = '';
  if (galleryItems.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '.7';
    empty.style.color = '#fff';
    empty.textContent = 'Noch keine Medien aufgenommen.';
    galleryGridRef.appendChild(empty);
    return;
  }
  galleryItems.slice().reverse().forEach(it => {
    const wrapper = document.createElement('div');
    wrapper.className = 'thumb';
    let mediaEl;
    if (it.type === 'image') {
      mediaEl = document.createElement('img');
      mediaEl.src = it.url;
      mediaEl.alt = 'Screenshot';
    } else {
      mediaEl = document.createElement('video');
      mediaEl.src = it.url;
      mediaEl.controls = true;
    }
    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = (it.type === 'image' ? 'Foto' : 'Video') + ' • ' + it.format;
    wrapper.appendChild(mediaEl);
    wrapper.appendChild(label);
    galleryGridRef.appendChild(wrapper);
  });
}

/* ---------- AR Session Ende Cleanup ---------- */
export async function stopRecordingOnARSessionEnd() {
  const btnCapture = document.getElementById('btn-capture');
  const recInfo = document.getElementById('rec-info');
  if (btnCapture && recInfo) {
    if (simulatedRecordingId || isRecordingReal) {
      await stopAllRecording(recInfo, btnCapture);
    }
  }
}
