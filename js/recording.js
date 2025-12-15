// js/recording.js
import { getPersistentAudioElement } from './audio.js';

// Konfiguration
const MAX_RECORD_TIME_SECONDS = 600;
const LONG_PRESS_THRESHOLD_MS = 300;
const SCREENSHOT_QUALITY = 0.92;

let recTimer = 0;
let simulatedRecordingId = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecordingReal = false;
let realTimerId = null;
let audioCtxRef = null;
let chosenMimeType = 'video/webm';

let pressTimerId = null;
let isPressing = false;
let longPressActive = false;

let ffmpegInstance = null;
let ffmpegLoaded = false;

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
    if (!ffmpegInstance) ffmpegInstance = FF.createFFmpeg({ log: false });
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

function getCaptureSourceElement() {
  return document.getElementById('ar-scene-element') || null;
}

function getCaptureCanvas() {
  const src = getCaptureSourceElement();
  if (!src) return null;
  if (src instanceof HTMLCanvasElement) return src;

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

function tsToName(ts, kind, ext) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `ARea_${kind}_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

export function initRecording() {
  btnCaptureRef       = document.getElementById('btn-capture');
  btnGalleryRef       = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  galleryPanelRef     = document.getElementById('gallery-panel');
  galleryGridRef      = document.getElementById('gallery-grid');
  galleryPreviewMediaRef = document.getElementById('gallery-preview-media');
  galleryDownloadRef  = document.getElementById('gallery-download');
  galleryFilenameRef  = document.getElementById('gallery-filename');
  recInfoRef          = document.getElementById('rec-info');

  btnGalleryRef?.addEventListener('click', () => openGallery());
  btnGalleryClose?.addEventListener('click', () => closeGallery());

  galleryDownloadRef?.addEventListener('click', async () => {
    if (!currentPreview) return;
    const filename = tsToName(currentPreview.ts, currentPreview.type === 'image' ? 'Foto' : 'Video', currentPreview.format);
    if (currentPreview.type === 'video' && currentPreview.format === 'webm') {
      const mp4Blob = await convertWebMToMP4ByUrl(currentPreview.url);
      if (mp4Blob) {
        const mp4Url = URL.createObjectURL(mp4Blob);
        triggerDownload(mp4Url, filename.replace('.webm','.mp4'));
        return;
      }
    }
    triggerDownload(currentPreview.url, filename);
  });

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
        startSimulatedRecording(recInfoRef, btnCaptureRef);
      }
    }, LONG_PRESS_THRESHOLD_MS);
  };

  const onPressEnd = async (e) => {
    e.preventDefault();
    if (!isPressing) return;
    isPressing = false;
    if (pressTimerId) { clearTimeout(pressTimerId); pressTimerId = null; }

    if (!longPressActive) {
      takeScreenshot(btnCaptureRef);
    } else {
      if (isRecordingReal || simulatedRecordingId) {
        await stopAllRecording(recInfoRef, btnCaptureRef);
      }
    }
  };

  btnCaptureRef?.addEventListener('touchstart', onPressStart, { passive: false });
  btnCaptureRef?.addEventListener('touchend', onPressEnd, { passive: false });
  btnCaptureRef?.addEventListener('touchcancel', onPressEnd, { passive: false });
  btnCaptureRef?.addEventListener('mousedown', onPressStart);
  btnCaptureRef?.addEventListener('mouseup', onPressEnd);
  btnCaptureRef?.addEventListener('mouseleave', (e) => { if (isPressing) onPressEnd(e); });

  window.addEventListener('beforeunload', async () => {
    if (isRecordingReal || simulatedRecordingId) {
      try { await stopAllRecording(recInfoRef, btnCaptureRef); } catch(_) {}
    }
  });
}

function takeScreenshot(btnCapture) {
  const src = getCaptureSourceElement();
  const canvas = getCaptureCanvas();
  if (!src && !canvas) return;

  btnCapture?.classList.add('snap');
  setTimeout(() => btnCapture?.classList.remove('snap'), 200);

  const handleBlob = (blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const item = { type:'image', url, format:'jpg', ts:Date.now() };
    addToGallery(item);
  };

  if (src && typeof src.toBlob === 'function') {
    try {
      src.toBlob({ mimeType: 'image/jpeg', quality: SCREENSHOT_QUALITY })
        .then(handleBlob)
        .catch(() => {});
      return;
    } catch(_) {}
  }

  if (canvas && typeof canvas.toBlob === 'function') {
    canvas.toBlob(handleBlob, 'image/jpeg', SCREENSHOT_QUALITY);
  }
}

function canRecordReal() {
  const canvas = getCaptureCanvas();
  return !!window.MediaRecorder && !!canvas;
}

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

function startRealRecording(recInfo, btnCapture) {
  const canvas = getCaptureCanvas();
  if (!canvas) {
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
    } catch (_) {}
  }

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
    startSimulatedRecording(recInfo, btnCapture);
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(finalStream, { mimeType: chosenMimeType });
  } catch (_) {
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

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.start();
}

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

async function convertWebMToMP4ByUrl(webmUrl) {
  try {
    const res = await fetch(webmUrl);
    const blob = await res.blob();
    return await convertWebMToMP4(blob);
  } catch(e) {
    return null;
  }
}

async function stopAllRecording(recInfo, btnCapture) {
  if (simulatedRecordingId) { clearInterval(simulatedRecordingId); simulatedRecordingId = null; }
  if (realTimerId) { clearInterval(realTimerId); realTimerId = null; }

  let hadRealRecording = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    hadRealRecording = true;
    const stopPromise = new Promise(resolve => {
      const onStop = () => { mediaRecorder.removeEventListener('stop', onStop); resolve(); };
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

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function setPreviewButton(item) {
  if (!btnGalleryRef) return;
  if (item.type === 'image') {
    btnGalleryRef.style.backgroundImage = `url(${item.url})`;
  } else {
    // Für Video ein Standbild erzeugen ist komplex; zeige neutrale Fläche
    btnGalleryRef.style.backgroundImage = '';
    btnGalleryRef.style.backgroundColor = 'rgba(255,255,255,0.08)';
  }
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
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filename = tsToName(it.ts, it.type === 'image' ? 'Foto' : 'Video', it.format);
      if (it.type === 'video' && it.format === 'webm') {
        const mp4Blob = await convertWebMToMP4ByUrl(it.url);
        if (mp4Blob) {
          const mp4Url = URL.createObjectURL(mp4Blob);
          triggerDownload(mp4Url, filename.replace('.webm','.mp4'));
          return;
        }
      }
      triggerDownload(it.url, filename);
    });
    actions.appendChild(btn);

    wrapper.appendChild(mediaEl);
    wrapper.appendChild(label);
    wrapper.appendChild(actions);

    wrapper.addEventListener('click', () => {
      showPreview(it);
    });

    galleryGridRef.appendChild(wrapper);
  });
}

export async function stopRecordingOnARSessionEnd() {
  const btnCapture = document.getElementById('btn-capture');
  const recInfo = document.getElementById('rec-info');
  if (btnCapture && recInfo) {
    if (simulatedRecordingId || isRecordingReal) {
      await stopAllRecording(recInfo, btnCapture);
    }
  }
}
