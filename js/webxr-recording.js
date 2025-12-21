// js/webxr-recording.js
// Recording (Foto + Video) + In-App-Galerie für den WebXR-Viewer (webxr.html)

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

// Galerie
const galleryItems = []; // { type:'image'|'video', url, format:'jpg'|'mp4'|'webm', ts:number }
let galleryGridRef = null;

// Referenzen auf WebXR-spezifische Elemente
let rendererRef = null;
let audioElRef = null;

function qs(id) {
  return document.getElementById(id);
}

function formatLabel(it) {
  const kind = it.type === 'image' ? 'Foto' : 'Video';
  const ext = (it.filename?.split('.').pop() || '').toUpperCase();
  return `${kind} • ${ext}`;
}

function setBtnGalleryThumbnail(latest) {
  const btn = qs('btn-gallery-small');
  if (!btn) return;
  btn.style.backgroundImage = '';
  btn.innerHTML = '';

  if (!latest) {
    const ph = document.createElement('div');
    ph.id = 'btn-gallery-small-placeholder';
    btn.appendChild(ph);
    return;
  }

  if (latest.type === 'image') {
    const img = document.createElement('img');
    img.src = latest.url;
    img.alt = latest.filename || 'Foto';
    btn.appendChild(img);
  } else {
    const vid = document.createElement('video');
    vid.src = latest.url;
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.autoplay = true;
    btn.appendChild(vid);
  }
}

function bindDownloadButton(currentPreviewRef) {
  const btn = qs('gallery-download');
  if (!btn) return;
  btn.onclick = () => {
    const it = currentPreviewRef.current;
    if (!it) return;
    const a = document.createElement('a');
    a.href = it.url;
    a.download = it.filename || (it.type === 'image' ? 'photo.jpg' : 'video.webm');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
}

function showPreview(it, currentPreviewRef) {
  currentPreviewRef.current = it;
  const mediaWrap = qs('gallery-preview-media');
  const nameEl = qs('gallery-filename');
  if (!mediaWrap) return;

  mediaWrap.innerHTML = '';
  if (nameEl) nameEl.textContent = it.filename || formatLabel(it);

  let mediaEl;
  if (it.type === 'image') {
    mediaEl = document.createElement('img');
    mediaEl.src = it.url;
    mediaEl.alt = it.filename || 'Foto';
  } else {
    mediaEl = document.createElement('video');
    mediaEl.src = it.url;
    mediaEl.controls = true;
    mediaEl.autoplay = true;
    mediaEl.loop = true;
    mediaEl.playsInline = true;
  }
  mediaWrap.appendChild(mediaEl);

  bindDownloadButton(currentPreviewRef);
}

function refreshGalleryGrid(currentPreviewRef) {
  const grid = galleryGridRef;
  if (!grid) return;

  grid.innerHTML = '';
  if (galleryItems.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '.7';
    empty.style.color = '#fff';
    empty.textContent = 'Noch keine Medien aufgenommen.';
    grid.appendChild(empty);
    return;
  }

  [...galleryItems].reverse().forEach((it) => {
    const card = document.createElement('div');
    card.className = 'thumb';

    let mediaEl;
    if (it.type === 'image') {
      mediaEl = document.createElement('img');
      mediaEl.src = it.url;
      mediaEl.alt = it.filename || 'Foto';
    } else {
      mediaEl = document.createElement('video');
      mediaEl.src = it.url;
      mediaEl.loop = true;
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      mediaEl.autoplay = true;
    }

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = formatLabel(it);

    card.appendChild(mediaEl);
    card.appendChild(label);
    card.onclick = () => showPreview(it, currentPreviewRef);

    grid.appendChild(card);
  });

  showPreview(galleryItems[galleryItems.length - 1], currentPreviewRef);
}

function openGallery(currentPreviewRef) {
  const panel = qs('gallery-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  refreshGalleryGrid(currentPreviewRef);
}

function closeGallery() {
  const panel = qs('gallery-panel');
  if (!panel) return;
  panel.style.display = 'none';
}

/* ---------- Screenshot ---------- */
function takeScreenshot(btnCapture) {
  const canvas = rendererRef?.domElement || null;

  if (!canvas) {
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
    galleryItems.push(item);
    setBtnGalleryThumbnail(item);
    refreshGalleryGrid(currentPreviewRef);
  };

  const currentPreviewRef = { current: null };

  if (canvas.toBlob) {
    canvas.toBlob(handleBlob, 'image/jpeg', SCREENSHOT_QUALITY);
  } else {
    console.warn('Canvas toBlob() nicht verfügbar.');
  }
}

/* ---------- Feature Detection ---------- */
function canRecordReal() {
  const canvas = rendererRef?.domElement || null;
  return !!window.MediaRecorder && !!canvas?.captureStream;
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
  const canvas = rendererRef?.domElement || null;
  if (!canvas) {
    console.warn('Kein Canvas für Aufnahme gefunden → Fallback.');
    startSimulatedRecording(recInfo, btnCapture);
    return;
  }

  const stream = canvas.captureStream(30);
  let finalStream = stream;

  // Für WebXR: Audio von audioElRef oder persistentem Audioelement
  const persistentAudio = getPersistentAudioElement() || audioElRef;
  if (persistentAudio && persistentAudio.captureStream) {
    try {
      audioCtxRef = new AudioContext();
      const srcNode = audioCtxRef.createMediaElementSource(persistentAudio);
      const dest = audioCtxRef.createMediaStreamDestination();
      srcNode.connect(dest);
      srcNode.connect(audioCtxRef.destination);
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
    // Für WebXR reicht WebM, Konvertierung zu MP4 ist optional
    const url = URL.createObjectURL(webmBlob);
    addToGallery({ type:'video', url, format:'webm', ts:Date.now() });
  }

  recordedChunks = [];
  mediaRecorder = null;
}

/* ---------- Galerie Funktionen ---------- */
function addToGallery(item) {
  galleryItems.push(item);
  refreshGalleryGrid({ current: galleryItems[galleryItems.length - 1] });
}

/* ---------- Öffentliche Initialisierung ---------- */
export function initWebXRRecording({ renderer, audioEl }) {
  rendererRef = renderer;
  audioElRef = audioEl;

  const btnCapture = qs('btn-capture');
  const btnGallery = qs('btn-gallery-small');
  const btnGalleryClose = qs('btn-gallery-close');
  const galleryPanel = qs('gallery-panel');
  galleryGridRef = qs('gallery-grid');
  const recInfo = qs('rec-info'); // optional, wenn du später eine Recording-Anzeige möchtest

  const currentPreviewRef = { current: null };

  if (!btnCapture || !galleryPanel || !galleryGridRef) {
    console.warn('[WebXR-Recording] UI-Elemente nicht vollständig vorhanden.');
    return;
  }

  // Galerie öffnen
  btnGallery?.addEventListener('click', () => {
    openGallery(currentPreviewRef);
  });
  btnGalleryClose?.addEventListener('click', () => {
    closeGallery();
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
        startRealRecording(recInfo || { textContent:'', style:{display:''} }, btnCapture);
      } else {
        console.warn('MediaRecorder nicht verfügbar → Fallback Simulation.');
        startSimulatedRecording(recInfo || { textContent:'', style:{display:''} }, btnCapture);
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
      takeScreenshot(btnCapture);
    } else {
      if (isRecordingReal || simulatedRecordingId) {
        await stopAllRecording(recInfo || { style:{display:'none'} }, btnCapture);
      }
    }
  };

  // Touch Events
  btnCapture.addEventListener('touchstart', onPressStart, { passive: false });
  btnCapture.addEventListener('touchend', onPressEnd, { passive: false });
  btnCapture.addEventListener('touchcancel', onPressEnd, { passive: false });

  // Maus Events
  btnCapture.addEventListener('mousedown', onPressStart);
  btnCapture.addEventListener('mouseup', onPressEnd);
  btnCapture.addEventListener('mouseleave', (e) => {
    if (isPressing) onPressEnd(e);
  });

  // Cleanup beim Verlassen
  window.addEventListener('beforeunload', async () => {
    if (isRecordingReal || simulatedRecordingId) {
      try { await stopAllRecording(recInfo || { style:{display:'none'} }, btnCapture); } catch(_) {}
    }
  });

  // Initialer Thumbnail-Status
  setBtnGalleryThumbnail(null);
}
