// js/webxr-app.js
// WebXR-Viewer mit Hit-Test, Poster und Screenshot-Galerie (ohne Videoaufnahme)

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const state = {
  sceneId: null,
  workerBase: null,
  cfg: null,

  renderer: null,
  scene: null,
  camera: null,
  clock: null,

  model: null,
  mixer: null,
  reticle: null,
  placed: false,

  hitTestSource: null,
  hitTestSourceRequested: false,

  xrSession: null,

  galleryItems: []
};

window.addEventListener('DOMContentLoaded', init);

async function init() {
  const params = new URLSearchParams(location.search);
  state.sceneId    = params.get('scene');
  state.workerBase = params.get('base');

  const loadingEl = document.getElementById('loading-status');

  if (!state.sceneId || !state.workerBase) {
    showError('FEHLENDE URL PARAMETER (scene/base)');
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  }

  try {
    if (loadingEl) loadingEl.style.display = 'flex';

    // Szene-Konfiguration laden
    state.cfg = await loadConfig(state.sceneId, state.workerBase);
    console.log('[WebXR] SceneConfig:', state.cfg);

    // Three.js-Grundsetup
    setupThree();

    // GLB-Modell laden
    await loadModel();

    // Reticle (Platzierungsring)
    setupReticle();

    // Poster aus Meta-Daten befüllen
    showPosterFromMeta();

    // UI verdrahten (Start AR, Galerie, Screenshot)
    setupUI();

    if (loadingEl) loadingEl.style.display = 'none';
  } catch (e) {
    console.error(e);
    showError('FEHLER: ' + e.message);
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

/* ------------------ Konfiguration laden ------------------ */

async function loadConfig(sceneId, workerBase) {
  const url = `${workerBase}/scenes/${sceneId}/scene.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Konfiguration nicht ladbar (${res.status})`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout beim Laden der Konfiguration.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------ Three.js-Grundsetup ------------------ */

function setupThree() {
  const canvas = document.getElementById('ar-scene-element');
  if (!canvas) throw new Error('Canvas #ar-scene-element nicht gefunden.');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false); // nur einmal vor der Session
  renderer.xr.enabled = true;
  renderer.setClearColor(0x000000, 0); // transparent, Kamera soll sichtbar sein

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  hemi.position.set(0.5, 1, 0.25);
  scene.add(hemi);

  state.renderer = renderer;
  state.scene    = scene;
  state.camera   = camera;
  state.clock    = new THREE.Clock();

  // Kein window.resize-Listener, um "Can't change size while VR device is presenting"
  // und ähnliche Fehler zu vermeiden.
}

/* ------------------ Modell laden & Animation ------------------ */

async function loadModel() {
  const cfg = state.cfg;
  if (!cfg?.model?.url) throw new Error('Kein Modell in der Konfiguration.');

  const loader = new GLTFLoader();
  const url = `${state.workerBase}/scenes/${state.sceneId}/${cfg.model.url}`;

  await new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) {
          reject(new Error('GLTF enthält keine Szene.'));
          return;
        }

        root.visible = false; // erst sichtbar nach Platzierung
        state.scene.add(root);
        state.model = root;

        if (gltf.animations && gltf.animations.length) {
          state.mixer = new THREE.AnimationMixer(root);
          const clip = gltf.animations[0];
          const action = state.mixer.clipAction(clip);
          action.play();
        }

        resolve();
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/* ------------------ Reticle (Hit-Test-Ring) ------------------ */

function setupReticle() {
  const geometry = new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const reticle = new THREE.Mesh(geometry, material);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  state.scene.add(reticle);
  state.reticle = reticle;
}

/* ------------------ Poster aus Meta befüllen ------------------ */

function showPosterFromMeta() {
  const cfg     = state.cfg || {};
  const meta    = cfg.meta || {};
  const poster  = document.getElementById('poster');
  const titleEl = document.getElementById('posterTitle');
  const subtitleEl = document.getElementById('posterSubtitle');
  const textEl  = document.getElementById('posterText');
  const imgEl   = document.getElementById('posterImageEl');
  const mediaWrapper = document.getElementById('poster-media');

  const title =
    (meta.title && meta.title.trim()) ||
    '3D / AR Erlebnis';

  const subtitle =
    (meta.subtitle && meta.subtitle.trim()) ||
    '';

  const body =
    (meta.body && meta.body.trim()) ||
    (meta.description && meta.description.trim()) ||
    'Tippe auf START AR, um das Modell in deiner Umgebung zu sehen.';

  if (titleEl) titleEl.textContent = title;

  if (subtitleEl) {
    if (subtitle) {
      subtitleEl.textContent = subtitle;
      subtitleEl.classList.remove('hidden');
    } else {
      subtitleEl.textContent = '';
      subtitleEl.classList.add('hidden');
    }
  }

  if (textEl) textEl.textContent = body;

  const posterFile = meta.posterImage && String(meta.posterImage).trim();
  if (imgEl && posterFile && state.workerBase && state.sceneId) {
    const url = `${state.workerBase}/scenes/${encodeURIComponent(
      state.sceneId
    )}/${encodeURIComponent(posterFile)}`;
    imgEl.src = url;
    if (mediaWrapper) {
      mediaWrapper.classList.remove('hidden');
      if (mediaWrapper.style) mediaWrapper.style.display = '';
    }
  } else if (imgEl && mediaWrapper) {
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
    mediaWrapper.classList.add('hidden');
  }

  if (poster) poster.style.display = 'flex';
}

/* ------------------ UI verdrahten ------------------ */

function setupUI() {
  const startBtn        = document.getElementById('startAr');
  const btnGallery      = document.getElementById('btn-gallery');
  const btnGalleryClose = document.getElementById('btn-gallery-close');
  const btnCapture      = document.getElementById('btn-capture');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try {
        await startARSession();
      } catch (e) {
        console.error(e);
        showError('AR konnte nicht gestartet werden: ' + (e.message || e));
      } finally {
        // im Fehlerfall nicht dauerhaft disabled lassen
        startBtn.disabled = false;
      }
    });
  }

  if (btnGallery && btnGalleryClose) {
    btnGallery.addEventListener('click', () => {
      const panel = document.getElementById('gallery-panel');
      if (panel) {
        panel.style.display = 'flex';
        refreshGalleryGrid();
      }
    });

    btnGalleryClose.addEventListener('click', () => {
      const panel = document.getElementById('gallery-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  if (btnCapture) {
    btnCapture.addEventListener('click', () => {
      takeScreenshot();
    });
  }
}

/* ------------------ AR-Session starten ------------------ */

async function startARSession() {
  if (!navigator.xr) {
    showError('WebXR wird in diesem Browser nicht unterstützt.');
    return;
  }

  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn(e);
    showError('WebXR-Check fehlgeschlagen: ' + e.message);
    return;
  }

  if (!supported) {
    showError('Dieses Gerät unterstützt kein "immersive-ar".');
    return;
  }

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body }
  });

  state.xrSession = session;

  const renderer = state.renderer;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  // Modell-Platzierung per Tap
  session.addEventListener('select', onSelect);

  session.addEventListener('end', () => {
    state.hitTestSourceRequested = false;
    state.hitTestSource = null;
    state.placed = false;
    state.xrSession = null;

    const arUI   = document.getElementById('ar-ui');
    const poster = document.getElementById('poster');
    if (arUI) arUI.style.display = 'none';
    if (poster) poster.style.display = 'flex';
  });

  // UI im AR-Modus anzeigen, Poster ausblenden
  const arUI   = document.getElementById('ar-ui');
  const poster = document.getElementById('poster');
  if (arUI) arUI.style.display = 'block';
  if (poster) poster.style.display = 'none';

  // Eigene XR-Renderloop nur über session.requestAnimationFrame
  const onXRFrame = (time, frame) => {
    if (session !== state.xrSession) return; // Session wurde beendet
    renderXRFrame(time, frame);
    session.requestAnimationFrame(onXRFrame);
  };

  session.requestAnimationFrame(onXRFrame);
}

/* ------------------ XR-Frame-Renderloop ------------------ */

function renderXRFrame(timestamp, frame) {
  const renderer = state.renderer;
  const scene    = state.scene;
  const camera   = state.camera;

  if (!frame) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const session        = renderer.xr.getSession();

  // Hit-Test-Source einmalig anfordern
  if (!state.hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((viewerRef) => {
      session.requestHitTestSource({ space: viewerRef }).then((source) => {
        state.hitTestSource = source;
      });
    });

    session.addEventListener('end', () => {
      state.hitTestSourceRequested = false;
      state.hitTestSource = null;
    });

    state.hitTestSourceRequested = true;
  }

  // Reticle-Position mit Hit-Test aktualisieren, solange nicht platziert
  if (state.hitTestSource && !state.placed) {
    const hitTestResults = frame.getHitTestResults(state.hitTestSource);
    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);
      if (pose && state.reticle) {
        state.reticle.visible = true;
        state.reticle.matrix.fromArray(pose.transform.matrix);
      }
    } else if (state.reticle) {
      state.reticle.visible = false;
    }
  }

  // Animation updaten
  if (state.mixer && state.clock) {
    const delta = state.clock.getDelta();
    state.mixer.update(delta);
  }

  // Rendern – wir sind hier IM XR-Frame-Callback
  renderer.render(scene, camera);
}

/* ------------------ Platzierung bei Tap ------------------ */

function onSelect() {
  if (!state.reticle || !state.reticle.visible || !state.model) return;

  state.model.visible = true;
  state.model.position.setFromMatrixPosition(state.reticle.matrix);
  state.model.quaternion.setFromRotationMatrix(state.reticle.matrix);
  state.placed = true;
}

/* ------------------ Screenshot + Galerie ------------------ */

function takeScreenshot() {
  const canvas = document.getElementById('ar-scene-element');
  if (!canvas || typeof canvas.toBlob !== 'function') {
    console.warn('Canvas oder toBlob() nicht verfügbar.');
    return;
  }

  const btnCapture = document.getElementById('btn-capture');
  if (btnCapture) {
    btnCapture.classList.add('snap');
    setTimeout(() => btnCapture.classList.remove('snap'), 200);
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'ARea_Screenshot.jpg');
    addToGallery({ type: 'image', url, format: 'jpg', ts: Date.now() });
  }, 'image/jpeg', 0.92);
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function addToGallery(item) {
  state.galleryItems.push(item);
  refreshGalleryGrid();
}

function refreshGalleryGrid() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const items = state.galleryItems;
  if (!items.length) {
    const empty = document.createElement('div');
    empty.style.opacity = '.7';
    empty.style.color = '#fff';
    empty.textContent = 'Noch keine Medien aufgenommen.';
    grid.appendChild(empty);
    return;
  }

  items.slice().reverse().forEach((it) => {
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
    grid.appendChild(wrapper);
  });
}

/* ------------------ Fehleranzeige ------------------ */

function showError(msg) {
  const errEl = document.getElementById('err');
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }
}
