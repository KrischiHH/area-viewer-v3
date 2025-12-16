// js/recording.js
import { getPersistentAudioElement } from './audio.js';

// Konfiguration
const MAX_RECORD_TIME_SECONDS = 600;          // 10 Minuten
const LONG_PRESS_THRESHOLD_MS = 300;          // Ab hier: Video statt Foto
const SCREENSHOT_QUALITY = 0.92;              // JPEG Qualität

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
let galleryPreviewMediaRef = null;
let galleryDownloadRef = null;
let galleryFilenameRef = null;
let btnGalleryRef = null;
let recInfoRef = null;
let btnCaptureRef = null;

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
  // Holt das Element, dem wir in webxr.html die ID 'ar-scene-element' gegeben haben
  return document.getElementById('ar-scene-element') || null;
}

function getCaptureCanvas() {
  const src = getCaptureSourceElement();
  if (!src) return null;

  // WICHTIG: Das Three.js Canvas ist das Element mit der ID.
  if (src instanceof HTMLCanvasElement) return src;

  // Fallback: Wenn die ID an einem Container hängt (z.B. model-viewer)
  if (src.shadowRoot) {
    const c = src.shadowRoot.querySelector('canvas');
    if (c) return c;
  }
  if (typeof src.querySelector === 'function') {
    const c = src.querySelector('canvas');
    if (c) return c;
  }

  return null;
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

function tsToName(ts, kind, ext) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `ARea_${kind}_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

export function initRecording() {
  btnCaptureRef       = document.getElementById('btn-capture');
  btnGalleryRef       = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  galleryPanelRef     = document.getElementById('gallery-panel');
  galleryGridRef      = document.getElementById('gallery-grid');
  galleryPreviewMediaRef = document.getElementById('gallery-preview-media');
  galleryDownloadRef  = document.getElementById('gallery-download');
  galleryFilenameRef  = document.getElementById('gallery-filename');
  recInfoRef          = document.getElementById('rec-info');
  
  // Galerie öffnen
  btnGalleryRef?.addEventListener('click', () => {
    galleryPanelRef.style.display = 'flex';
    refreshGalleryGrid();
    // Zeigt immer das neueste Element an
    if (galleryItems.length > 0) {
      showPreview(galleryItems[galleryItems.length - 1]);
    } else {
      galleryPreviewMediaRef.innerHTML = '';
      galleryFilenameRef.textContent = 'Keine Vorschau verfügbar';
      currentPreview = null;
    }
  });
  // Galerie schließen
  btnGalleryClose?.addEventListener('click', () => {
    galleryPanelRef.style.display = 'none';
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
        startRealRecording(recInfoRef, btnCaptureRef);
      } else {
        console.warn('MediaRecorder nicht verfügbar → Fallback Simulation.');
        startSimulatedRecording(recInfoRef, btnCaptureRef);
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
      takeScreenshot(btnCaptureRef);
    } else {
      // Aufnahme lief → Stop
      if (isRecordingReal || simulatedRecordingId) {
        await stopAllRecording(recInfoRef, btnCaptureRef);
      }
    }
  };

  // Touch Events
  btnCaptureRef?.addEventListener('touchstart', onPressStart, { passive: false });
  btnCaptureRef?.addEventListener('touchend', onPressEnd, { passive: false });
  btnCaptureRef?.addEventListener('touchcancel', onPressEnd, { passive: false });

  // Maus Events
  btnCaptureRef?.addEventListener('mousedown', onPressStart);
  btnCaptureRef?.addEventListener('mouseup', onPressEnd);
  btnCaptureRef?.addEventListener('mouseleave', (e) => {
    if (isPressing && !isRecordingReal) onPressEnd(e);
  });

  // Cleanup beim Verlassen
  window.addEventListener('beforeunload', async () => {
    if (isRecordingReal || simulatedRecordingId) {
      try { await stopAllRecording(recInfoRef, btnCaptureRef); } catch(_) {}
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
    
    // In Galerie übernehmen und Download triggern
    addToGallery(item);
    showPreview(item);
    triggerDownload(url, tsToName(item.ts, 'Foto', 'jpg'));
  };

  // model-viewer: Canvas im Shadow DOM oder direkt
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
      audioCtxRef = new (window.AudioContext || window.webkitAudioContext)();
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
async function convertWebMToMP4ByUrl(url) {
  const FF = await ensureFFmpeg();
  if (!FF) return null;

  const filename = `input_${Date.now()}.webm`;
  
  try {
    const response = await fetch(url);
    const data = new Uint8Array(await response.arrayBuffer());
    ffmpegInstance.FS('writeFile', filename, data);

    await ffmpegInstance.run(
      '-i', filename,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      'output.mp4'
    );

    const out = ffmpegInstance.FS('readFile', 'output.mp4');
    try { ffmpegInstance.FS('unlink', filename); } catch(_) {}
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
    const ts = Date.now();
    let item;

    // Versuche Konvertierung und Download
    let mp4Blob = await convertWebMToMP4ByUrl(URL.createObjectURL(webmBlob));
    
    if (mp4Blob) {
      const url = URL.createObjectURL(mp4Blob);
      item = { type:'video', url, format:'mp4', ts:ts };
      triggerDownload(url, tsToName(ts, 'Recording', 'mp4'));
    } else {
      // Fallback: WebM downloaden
      const fallbackUrl = URL.createObjectURL(webmBlob);
      item = { type:'video', url:fallbackUrl, format:'webm', ts:ts };
      triggerDownload(fallbackUrl, tsToName(ts, 'Recording', 'webm'));
    }

    addToGallery(item);
    showPreview(item);
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

function showPreview(item) {
  currentPreview = item;
  galleryPreviewMediaRef.innerHTML = '';
  galleryFilenameRef.textContent = tsToName(item.ts, item.type === 'image' ? 'Foto' : 'Video', item.format);

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = 'Vorschau';
    galleryPreviewMediaRef.appendChild(img);
    galleryDownloadRef.textContent = 'Foto speichern';
  } else {
    const video = document.createElement('video');
    video.src = item.url;
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    galleryPreviewMediaRef.appendChild(video);
    galleryDownloadRef.textContent = item.format === 'mp4' ? 'Video speichern (MP4)' : 'Video konvertieren & speichern (MP4)';
  }
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
    wrapper.onclick = () => showPreview(it);
    
    let mediaEl;
    if (it.type === 'image') {
      mediaEl = document.createElement('img');
      mediaEl.src = it.url;
      mediaEl.alt = 'Screenshot';
    } else {
      mediaEl = document.createElement('video');
      mediaEl.src = it.url;
      mediaEl.loop = true;
      mediaEl.muted = true;
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
      // Stoppt die Aufnahme, ohne einen Download auszulösen
      if (simulatedRecordingId) {
        clearInterval(simulatedRecordingId);
        simulatedRecordingId = null;
      }
      if (realTimerId) {
        clearInterval(realTimerId);
        realTimerId = null;
      }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const stopPromise = new Promise(resolve => {
          mediaRecorder.addEventListener('stop', resolve, { once: true });
        });
        mediaRecorder.stop();
        await stopPromise;
      }
      
      recInfo.style.display = 'none';
      btnCapture?.classList.remove('recording');
      isRecordingReal = false;
      try { audioCtxRef?.close(); } catch(_) {}
      
      // Löscht die aufgezeichneten Chunks, da die Sitzung beendet wurde
      recordedChunks = [];
      mediaRecorder = null;
      audioCtxRef = null;
    }
  }
}
