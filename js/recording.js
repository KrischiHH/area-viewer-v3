// js/recording.js
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
let galleryPanelRef = null;
let galleryPreviewRef = null;
let galleryPreviewMediaRef = null;
let galleryDownloadRef = null;
let galleryFilenameRef = null;
let btnGalleryRef = null;

// Aktuelles Preview-Item
let currentPreview = null;

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

// Hilfsfunktionen: Quelle für Screenshot/Recording finden
function getCaptureSourceElement() {
  return document.getElementById('ar-scene-element') || null;
}

function getCaptureCanvas() {
  const src = getCaptureSourceElement();
  if (!src) return null;

  // Canvas direkt
  if (src instanceof HTMLCanvasElement) return src;

  // model-viewer: Canvas im Shadow DOM
  if (src.shadowRoot) {
    const c = src.shadowRoot.querySelector('canvas');
    if (c) return c;
  }

  // Fallback: normales DOM
  if (typeof src.querySelector === 'function') {
    const c = src.querySelector('canvas');
    if (c) return c;
  }

  return null;
}

/* ---------- Datei-Namen ---------- */
function tsToName(ts, kind, ext) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const name = `ARea_${kind}_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
  return name;
}

export function initRecording() {
  const btnCapture = document.getElementById('btn-capture');
  btnGalleryRef = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  galleryPanelRef = document.getElementById('gallery-panel');
  galleryGridRef = document.getElementById('gallery-grid');
  galleryPreviewRef = document.getElementById('gallery-preview');
  galleryPreviewMediaRef = document.getElementById('gallery-preview-media');
  galleryDownloadRef = document.getElementById('gallery-download');
  galleryFilenameRef = document.getElementById('gallery-filename');
  const recInfo = document.getElementById('rec-info');

  // Galerie öffnen
  btnGalleryRef?.addEventListener('click', () => openGallery());
  btnGalleryClose?.addEventListener('click', () => closeGallery());

  // Download im Preview
  galleryDownloadRef?.addEventListener('click', () => {
    if (!currentPreview) return;
    const filename = tsToName(currentPreview.ts, currentPreview.type === 'image' ? 'Foto' : 'Video', currentPreview.format);
    triggerDownload(currentPreview.url, filename);
  });

  // Capture Button Interaktion (Foto / Video)
  const onPressStart = (e) => {
    e.preventDefault();
    if (isPressing) return;
    isPressing = true;
    longPressActive = false;
    pressTimerId = setTimeout(() => {
      longPressActive = true;
      if (canRecordReal()) {
        startRealRecording(recInfo, btnCapture);
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
      takeScreenshot(btnCapture);
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
function takeScreenshot(btnCapture) {
  const src = getCaptureSourceElement();
  const canvas = getCaptureCanvas();

  if (!src && !canvas) {
    console.warn('Keine Quelle für Screenshot gefunden.');
    return;
  }

  // Snap Animation
  btnCapture?.classList.add('snap');
  setTimeout(() => btnCapture?.classList.remove('snap'), 200);

  const handleBlob = (blob) => {
    if (!blob) {
      console.warn('Screenshot-Blob ist leer.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const item = { type:'image', url, format:'jpg', ts:Date.now() };

    // Sofort-Download optional: hier nicht automatisch; Nutzer lädt in Galerie
    addToGallery(item);
  };

  // model-viewer hat eine eigene toBlob()-Methode
  if (src && typeof src.toBlob === 'function') {
    try {
      src.toBlob({ mimeType: 'image/jpeg', quality: SCREENSHOT_QUALITY })
        .then(handleBlob)
        .catch(e => console.error('Screenshot (model-viewer) fehlgeschlagen:', e));
      return;
    } catch (e) {
      console.warn('model-viewer toBlob fehlgeschlagen, versuche Canvas:', e);
    }
  }

  // Fallback: Canvas
  if (canvas && typeof canvas.toBlob === 'function') {
    canvas.toBlob(handleBlob, 'image/jpeg', SCREENSHOT_QUALITY);
  } else {
    console.warn('Canvas toBlob() nicht verfügbar.');
  }
}

/* ---------- Feature Detection ---------- */
function canRecordReal() {
  const canvas = getCaptureCanvas();
  return !!window.MediaRecorder && !!canvas;
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
function startRealRecording(recInfo, btnCapture) {
  const canvas = getCaptureCanvas();
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

  // Kandidaten inkl. MP4 (für Safari/iOS)
  const mimeTypeCandidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  chosenMimeType = '';
  for (const c of mimeTypeCandidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
      chosenMimeType = c; break;
    }
  }
  if (!chosenMimeType) {
    console.warn('Kein unterstützter Codec → Simulation.');
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
    const blob = new Blob(recordedChunks, { type: (chosenMimeType || 'video/webm') });

    // Wenn WebM und FFmpeg verfügbar → zu MP4 konvertieren (bessere Kompatibilität)
    let finalBlob = blob;
    let fmt = /mp4/.test(chosenMimeType) ? 'mp4' : 'webm';
    if (fmt === 'webm') {
      const mp4Blob = await convertWebMToMP4(blob);
      if (mp4Blob) {
        finalBlob = mp4Blob;
        fmt = 'mp4';
      }
    }

    const url = URL.createObjectURL(finalBlob);
    addToGallery({ type:'video', url, format: fmt, ts: Date.now() });
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
function setPreviewButton(item) {
  if (!btnGalleryRef) return;
  btnGalleryRef.style.backgroundImage = `url(${item.url})`;
}

function openGallery() {
  if (!galleryPanelRef) return;
  galleryPanelRef.style.display = 'flex';
  if (galleryItems.length > 0) {
    showPreview(galleryItems[galleryItems.length - 1]);
  } else {
    galleryPreviewMediaRef.innerHTML = '';
    if (galleryFilenameRef) galleryFilenameRef.textContent = '';
  }
  refreshGalleryGrid();
}

function closeGallery() {
  if (!galleryPanelRef) return;
  // stop videos in preview
  const v = galleryPreviewMediaRef?.querySelector('video');
  try { v?.pause(); } catch(_) {}
  galleryPanelRef.style.display = 'none';
}

function showPreview(item) {
  currentPreview = item;
  if (!galleryPreviewMediaRef) return;

  galleryPreviewMediaRef.innerHTML = '';
  let el;
  if (item.type === 'image') {
    el = document.createElement('img');
    el.src = item.url;
    el.alt = 'Aufnahme';
  } else {
    el = document.createElement('video');
    el.src = item.url;
    el.controls = true;
    el.playsInline = true;
  }
  galleryPreviewMediaRef.appendChild(el);
  if (galleryFilenameRef) {
    const name = tsToName(item.ts, item.type === 'image' ? 'Foto' : 'Video', item.format);
    galleryFilenameRef.textContent = name;
  }
}

function addToGallery(item) {
  galleryItems.push(item);
  setPreviewButton(item);
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
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      mediaEl.loop = true;
      mediaEl.autoplay = false;
      mediaEl.addEventListener('mouseenter', () => { try { mediaEl.play(); } catch(_) {} });
      mediaEl.addEventListener('mouseleave', () => { try { mediaEl.pause(); } catch(_) {} });
    }

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = (it.type === 'image' ? 'Foto' : 'Video') + ' • ' + it.format;

    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    const btn = document.createElement('button');
    btn.className = 'btn-dl';
    btn.textContent = 'Download';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filename = tsToName(it.ts, it.type === 'image' ? 'Foto' : 'Video', it.format);
      triggerDownload(it.url, filename);
    });
    actions.appendChild(btn);

    wrapper.appendChild(mediaEl);
    wrapper.appendChild(label);
    wrapper.appendChild(actions);

    wrapper.addEventListener('click', () => {
      showPreview(it);
      // Scroll zu Preview-Anfang bleibt wie ist
    });

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
