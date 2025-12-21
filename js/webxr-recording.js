// js/webxr-recording.js
// Recording (Foto + Video) + In-App-Galerie für den Three.js-WebXR-Viewer (webxr.html)

let rendererRef = null;
let audioElRef = null;

const LONG_PRESS_MS = 450;

let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let pressTimer = null;
let pressStart = 0;

// Galerie-State
const galleryItems = []; // { type:'image'|'video', url, filename, blob?, date }

function qs(id) {
  return document.getElementById(id);
}

function formatItemLabel(it) {
  const kind = it.type === 'image' ? 'Foto' : 'Video';
  const ext = (it.filename?.split('.').pop() || '').toUpperCase();
  return `${kind} • ${ext}`;
}

function setGalleryButtonThumbnail(latest) {
  const btn = qs('btn-gallery-small');
  if (!btn) return;
  btn.innerHTML = '';

  if (!latest) {
    const ph = document.createElement('div');
    ph.id = 'btn-gallery-small-placeholder';
    btn.appendChild(ph);
    return;
  }

  let media;
  if (latest.type === 'image') {
    media = document.createElement('img');
    media.src = latest.url;
  } else {
    media = document.createElement('video');
    media.src = latest.url;
    media.muted = true;
    media.loop = true;
    media.playsInline = true;
    media.autoplay = true;
  }
  btn.appendChild(media);
}

function showGalleryPreview(it) {
  const wrap = qs('gallery-preview-media');
  const nameEl = qs('gallery-filename');
  const btnDownload = qs('gallery-download');
  if (!wrap) return;

  wrap.innerHTML = '';
  if (nameEl) nameEl.textContent = it.filename || formatItemLabel(it);

  let media;
  if (it.type === 'image') {
    media = document.createElement('img');
    media.src = it.url;
    media.alt = it.filename || 'Foto';
  } else {
    media = document.createElement('video');
    media.src = it.url;
    media.controls = true;
    media.autoplay = true;
    media.loop = true;
    media.playsInline = true;
  }
  wrap.appendChild(media);

  if (btnDownload) {
    btnDownload.onclick = () => {
      const a = document.createElement('a');
      a.href = it.url;
      a.download = it.filename || (it.type === 'image' ? 'photo.jpg' : 'video.webm');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
  }
}

function refreshGalleryGrid() {
  const grid = qs('gallery-grid');
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

    let media;
    if (it.type === 'image') {
      media = document.createElement('img');
      media.src = it.url;
      media.alt = it.filename || 'Foto';
    } else {
      media = document.createElement('video');
      media.src = it.url;
      media.loop = true;
      media.muted = true;
      media.playsInline = true;
      media.autoplay = true;
    }

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = formatItemLabel(it);

    card.appendChild(media);
    card.appendChild(label);
    card.onclick = () => showGalleryPreview(it);

    grid.appendChild(card);
  });

  showGalleryPreview(galleryItems[galleryItems.length - 1]);
}

function openGallery() {
  const panel = qs('gallery-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  refreshGalleryGrid();
}

function closeGallery() {
  const panel = qs('gallery-panel');
  if (!panel) return;
  panel.style.display = 'none';
}

// Screenshot
async function takeScreenshot() {
  if (!rendererRef) return;
  const canvas = rendererRef.domElement;
  if (!canvas || !canvas.toBlob) return;

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
  });
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const filename = 'ar-photo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpg';
  const item = { type: 'image', url, blob, filename, date: new Date() };
  galleryItems.push(item);
  setGalleryButtonThumbnail(item);
  refreshGalleryGrid();
}

// Video
function canRecordVideo() {
  return !!window.MediaRecorder && !!rendererRef?.domElement?.captureStream;
}

function startVideoRecording(captureBtn) {
  if (!rendererRef) return;
  if (!canRecordVideo()) {
    console.warn('[WebXR-Recording] MediaRecorder nicht verfügbar.');
    return;
  }

  const canvas = rendererRef.domElement;
  const stream = canvas.captureStream(30);

  if (audioElRef && audioElRef.captureStream) {
    try {
      const audioStream = audioElRef.captureStream();
      audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (e) {
      console.warn('[WebXR-Recording] audioEl.captureStream fehlgeschlagen:', e);
    }
  }

  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  } catch (e) {
    console.warn('[WebXR-Recording] MediaRecorder init fehlgeschlagen:', e);
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    recordedChunks = [];
    const url = URL.createObjectURL(blob);
    const filename = 'ar-video-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm';
    const item = { type: 'video', url, blob, filename, date: new Date() };
    galleryItems.push(item);
    setGalleryButtonThumbnail(item);
    refreshGalleryGrid();
  };

  mediaRecorder.start();
  isRecording = true;
  if (captureBtn) captureBtn.classList.add('recording');
}

function stopVideoRecording(captureBtn) {
  if (!mediaRecorder || !isRecording) return;
  mediaRecorder.stop();
  isRecording = false;
  if (captureBtn) captureBtn.classList.remove('recording');
}

export function initWebXRRecording({ renderer, audioEl }) {
  rendererRef = renderer;
  audioElRef = audioEl;

  const captureBtn = qs('btn-capture');
  const galleryBtn = qs('btn-gallery-small');
  const galleryClose = qs('btn-gallery-close');

  if (!captureBtn) {
    console.warn('[WebXR-Recording] btn-capture nicht gefunden.');
    return;
  }

  // Initial Galerie-Thumbnail
  setGalleryButtonThumbnail(null);

  // Capture Button: kurz = Foto, lang = Video
  const onDown = () => {
    if (isRecording) return;
    pressStart = performance.now();
    pressTimer = setTimeout(() => {
      if (!isRecording) {
        startVideoRecording(captureBtn);
      }
    }, LONG_PRESS_MS);
  };

  const onUp = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    const duration = performance.now() - pressStart;

    if (isRecording) {
      stopVideoRecording(captureBtn);
    } else if (duration < LONG_PRESS_MS) {
      takeScreenshot();
    }
  };

  captureBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onDown();
  });
  captureBtn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    onUp();
  });
  captureBtn.addEventListener('pointerleave', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });

  // Galerie-Button
  if (galleryBtn) {
    galleryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openGallery();
    });
  }
  if (galleryClose) {
    galleryClose.addEventListener('click', (e) => {
      e.preventDefault();
      closeGallery();
    });
  }

  // Beim Verlassen der Seite laufende Aufnahme stoppen
  window.addEventListener('beforeunload', () => {
    if (isRecording) {
      try { stopVideoRecording(captureBtn); } catch {}
    }
  });
}
