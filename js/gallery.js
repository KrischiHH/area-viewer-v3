// js/gallery.js
// Einfache Galerie-Verwaltung für Foto/Video-Items
// Exportiert: addMediaToGallery(item), updateGalleryUI()

// Item-Shape:
// { type: 'image'|'video', url: string, filename: string, date: Date, blob?: Blob }

const galleryItems = [];
let currentPreview = null;

function qs(id) {
  return document.getElementById(id);
}

function formatLabel(it) {
  const kind = it.type === 'image' ? 'Foto' : 'Video';
  const ext = (it.filename?.split('.').pop() || '').toUpperCase();
  return `${kind} • ${ext}`;
}

function setBtnGalleryThumbnail(latest) {
  const btn = qs('btn-gallery');
  if (!btn || !latest) return;
  if (latest.type === 'image') {
    btn.style.backgroundImage = `url("${latest.url}")`;
  } else {
    btn.style.backgroundImage = 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))';
  }
}

function bindDownloadButton() {
  const btn = qs('gallery-download');
  if (!btn) return;
  btn.onclick = () => {
    if (!currentPreview) return;
    const a = document.createElement('a');
    a.href = currentPreview.url;
    a.download = currentPreview.filename || (currentPreview.type === 'image' ? 'photo.jpg' : 'video.webm');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
}

function showPreview(it) {
  currentPreview = it;
  const mediaWrap = qs('gallery-preview-media');
  const nameEl = qs('gallery-filename');
  if (!mediaWrap) return;

  mediaWrap.innerHTML = '';
  if (nameEl) nameEl.textContent = it.filename || formatLabel(it);

  if (it.type === 'image') {
    const img = document.createElement('img');
    img.src = it.url;
    img.alt = it.filename || 'Foto';
    mediaWrap.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = it.url;
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    mediaWrap.appendChild(video);
  }

  bindDownloadButton();
}

export function addMediaToGallery(item) {
  galleryItems.push(item);
  showPreview(item);
  setBtnGalleryThumbnail(item);
  updateGalleryUI();
}

export function updateGalleryUI() {
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
    card.onclick = () => showPreview(it);

    grid.appendChild(card);
  });
}
