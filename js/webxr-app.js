// js/webxr-app.js
// Minimaler WebXR-Viewer mit Hit-Test, Poster und Screenshot-Galerie

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const DEFAULT_WORKER_BASE = 'https://area-publish-proxy.area-webar.workers.dev';

const state = {
  config: null,
  workerBase: DEFAULT_WORKER_BASE,
  sceneId: null,

  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),

  model: null,
  mixer: null,
  reticle: null,
  controller: null,

  xrSession: null,
  hitTestSource: null,
  hitTestSourceRequested: false,

  placed: false,
  sessionStartTime: 0,
  lastHitTime: 0,

  galleryItems: [],
  ui: {}
};

// ---------- Helper: DOM ----------

function qs(id) {
  return document.getElementById(id);
}

// ---------- Init ----------

window.addEventListener('DOMContentLoaded', init);

async function init() {
  const loadingEl = qs('loading-status');
  const errEl = qs('err');

  try {
    const { sceneId, workerBase } = parseParams();
    state.sceneId = sceneId;
    state.workerBase = workerBase;

    const cfg = await loadSceneConfig();
    state.config = cfg;
    console.log('[WebXR] SceneConfig:', cfg);

    setupThree();
    await loadModel();
    setupReticle();
    setupUI();
    setupPoster();

    loadingEl.style.display = 'none';
  } catch (err) {
    console.error(err);
    errEl.textContent = 'Fehler: ' + err.message;
    errEl.style.display = 'block';
    loadingEl.style.display = 'none';
  }
}

function parseParams() {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  const sceneId = params.get('scene');
  if (!sceneId) {
    throw new Error('Es fehlt ?scene= in der URL.');
  }

  const base = params.get('base') || DEFAULT_WORKER_BASE;
  return { sceneId, workerBase: base };
}

async function loadSceneConfig() {
  const url = `${state.workerBase}/scenes/${state.sceneId}/scene.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`SceneConfig HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- Three.js / WebXR ----------

function setupThree() {
  const canvas = qs('ar-scene-element');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.xr.enabled = true;
  renderer.setClearColor(0x000000, 0); // transparent, damit Kamera durchscheint

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(0, 4, 2);
  scene.add(dir);

  const controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.controller = controller;

  // WICHTIG: Three übernimmt den XR-Loop
  renderer.setAnimationLoop(onXRFrame);

  // Keine window.resize-Events während XR, um Size-Fehler zu vermeiden
}

async function loadModel() {
  const { model } = state.config || {};
  if (!model || !model.url) {
    throw new Error('SceneConfig enthält kein model.url');
  }

  const url = `${state.workerBase}/scenes/${state.sceneId}/${model.url}`;
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        root.visible = false; // erst nach Placement anzeigen
        state.scene.add(root);
        state.model = root;

        if (gltf.animations && gltf.animations.length) {
          const mixer = new THREE.AnimationMixer(root);
          const clip = gltf.animations[0];
          mixer.clipAction(clip).play();
          state.mixer = mixer;
        }

        resolve();
      },
      undefined,
      (err) => reject(err)
    );
  });
}

function setupReticle() {
  const geometry = new THREE.RingGeometry(0.15, 0.2, 32);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffc8,
    transparent: true,
    opacity: 0.9
  });

  const reticle = new THREE.Mesh(geometry, material);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  state.scene.add(reticle);
  state.reticle = reticle;
}

function onSelect() {
  if (!state.reticle || !state.model) return;
  if (!state.reticle.visible) return;

  state.model.visible = true;
  state.model.position.setFromMatrixPosition(state.reticle.matrix);

  const quat = new THREE.Quaternion();
  quat.setFromRotationMatrix(state.reticle.matrix);
  state.model.quaternion.copy(quat);

  state.placed = true;
}

function autoPlaceModel() {
  if (!state.model || !state.renderer) return;
  if (state.placed) return;

  const threeCam = state.camera;
  const xrCam = state.renderer.xr.getCamera(threeCam);

  const pos = new THREE.Vector3();
  xrCam.getWorldPosition(pos);

  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyQuaternion(xrCam.quaternion);

  pos.add(dir.multiplyScalar(1.2));

  state.model.position.copy(pos);
  state.model.quaternion.copy(xrCam.quaternion);
  state.model.visible = true;
  state.placed = true;

  if (state.reticle) state.reticle.visible = false;
}

// Haupt-Renderloop – wird von Three sowohl in XR als auch außerhalb aufgerufen
function onXRFrame(time, frame) {
  const renderer = state.renderer;
  const scene = state.scene;
  const camera = state.camera;

  const delta = state.clock.getDelta();
  if (state.mixer) state.mixer.update(delta);

  // Wenn keine XR-Session aktiv ist, einfach "normal" rendern (z.B. vor dem AR-Start)
  if (!state.xrSession || !frame) {
    renderer.render(scene, camera);
    return;
  }

  const session = renderer.xr.getSession();
  const referenceSpace = renderer.xr.getReferenceSpace();

  // Hit-Test Quelle anfordern
  if (!state.hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((refSpace) => {
      session
        .requestHitTestSource({ space: refSpace })
        .then((source) => {
          state.hitTestSource = source;
        })
        .catch((err) => console.warn('HitTestSource error:', err));
    });

    session.addEventListener('end', () => {
      state.hitTestSourceRequested = false;
      state.hitTestSource = null;
      state.placed = false;
    });

    state.hitTestSourceRequested = true;
  }

  // Hit-Test ausführen
  if (state.hitTestSource) {
    const hitTestResults = frame.getHitTestResults(state.hitTestSource);
    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);

      if (pose && state.reticle) {
        state.reticle.visible = true;
        state.reticle.matrix.fromArray(pose.transform.matrix);
        state.lastHitTime = performance.now();
      }
    } else {
      if (state.reticle) state.reticle.visible = false;
    }
  }

  // Fallback: wenn nach ein paar Sekunden kein Hit-Test zustande kommt
  const now = performance.now();
  if (
    !state.placed &&
    !state.lastHitTime &&
    state.sessionStartTime &&
    now - state.sessionStartTime > 4000
  ) {
    autoPlaceModel();
  }

  renderer.render(scene, camera);
}

// ---------- Poster & AR-Start ----------

function setupPoster() {
  const { meta = {} } = state.config || {};

  const poster = qs('poster');
  const posterTitle = qs('posterTitle');
  const posterSubtitle = qs('posterSubtitle');
  const posterText = qs('posterText');
  const posterMedia = qs('poster-media');
  const posterImg = qs('posterImageEl');
  const startAr = qs('startAr');

  posterTitle.textContent = meta.title || 'ARea – AR Szene';
  if (meta.subtitle) {
    posterSubtitle.textContent = meta.subtitle;
    posterSubtitle.classList.remove('hidden');
  } else {
    posterSubtitle.classList.add('hidden');
  }

  if (meta.body) {
    posterText.textContent = meta.body;
  }

  if (meta.posterImage) {
    const url = `${state.workerBase}/scenes/${state.sceneId}/${meta.posterImage}`;
    posterImg.src = url;
    posterMedia.classList.remove('hidden');
  } else {
    posterMedia.classList.add('hidden');
  }

  poster.style.display = 'flex';

  startAr.addEventListener('click', async () => {
    startAr.disabled = true;
    try {
      await startARSession();
      poster.style.display = 'none';
      if (state.ui.arUi) state.ui.arUi.style.display = 'block';
    } catch (err) {
      console.error(err);
      const errEl = qs('err');
      errEl.textContent = 'AR-Start fehlgeschlagen: ' + err.message;
      errEl.style.display = 'block';
    } finally {
      startAr.disabled = false;
    }
  });
}

async function startARSession() {
  if (!navigator.xr) {
    throw new Error('WebXR wird von diesem Browser nicht unterstützt.');
  }

  const supported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!supported) {
    throw new Error('Dieses Gerät unterstützt keine immersive AR Session.');
  }

  const sessionInit = {
    requiredFeatures: ['hit-test', 'local'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body }
  };

  const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
  state.xrSession = session;
  state.sessionStartTime = performance.now();
  state.lastHitTime = 0;
  state.placed = false;
  state.hitTestSource = null;
  state.hitTestSourceRequested = false;

  state.renderer.xr.setReferenceSpaceType('local');
  await state.renderer.xr.setSession(session);

  session.addEventListener('end', () => {
    state.xrSession = null;
    if (state.ui.arUi) state.ui.arUi.style.display = 'none';
  });
}

// ---------- UI: Screenshot + Galerie ----------

function setupUI() {
  const arUi = qs('ar-ui');
  const btnCapture = qs('btn-capture');
  const btnGallery = qs('btn-gallery');
  const btnGalleryClose = qs('btn-gallery-close');
  const galleryPanel = qs('gallery-panel');
  const galleryGrid = qs('gallery-grid');

  state.ui = {
    arUi,
    btnCapture,
    btnGallery,
    btnGalleryClose,
    galleryPanel,
    galleryGrid
  };

  btnCapture.addEventListener('click', onCaptureClick);
  btnGallery.addEventListener('click', () => {
    galleryPanel.style.display = 'flex';
  });
  btnGalleryClose.addEventListener('click', () => {
    galleryPanel.style.display = 'none';
  });
}

function onCaptureClick() {
  const btn = state.ui.btnCapture;
  if (!btn) return;

  btn.classList.add('snap');
  setTimeout(() => btn.classList.remove('snap'), 180);

  const canvas = qs('ar-scene-element');
  if (!canvas) return;

  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const item = {
        type: 'image',
        url,
        createdAt: Date.now()
      };
      state.galleryItems.push(item);
      addGalleryItem(item);
    },
    'image/png',
    0.92
  );
}

function addGalleryItem(item) {
  const grid = state.ui.galleryGrid;
  if (!grid) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'thumb';

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = 'Snapshot';
    wrapper.appendChild(img);
    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = 'Foto';
    wrapper.appendChild(label);
  }

  grid.prepend(wrapper);
}
