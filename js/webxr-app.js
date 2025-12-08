// js/webxr-app.js
// Minimaler WebXR-Viewer mit Hit-Test + Poster, basierend auf dem
// offiziellen three.js Beispiel "webxr_ar_hittest".

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { ARButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/ARButton.js';

const state = {
  cfg: null,
  sceneId: null,
  workerBase: null,

  renderer: null,
  scene: null,
  camera: null,
  light: null,

  model: null,
  mixer: null,

  reticle: null,
  controller: null,

  hitTestSource: null,
  hitTestSourceRequested: false,

  arActive: false,
  lastFrameTime: null,
  hiddenArButton: null,
};

init().catch(err => {
  console.error(err);
  showError('FEHLER beim Initialisieren: ' + (err.message || err));
  hideLoading();
});

async function init() {
  const params = new URLSearchParams(window.location.search);
  state.sceneId = params.get('scene');
  state.workerBase = params.get('base');

  if (!state.sceneId || !state.workerBase) {
    showError('FEHLENDE URL-PARAMETER (?scene=… &base=…)');
    return;
  }

  showLoading();

  // Szene-Konfiguration laden
  const cfgUrl = `${state.workerBase}/scenes/${state.sceneId}/scene.json`;
  const res = await fetch(cfgUrl);
  if (!res.ok) {
    throw new Error('scene.json nicht ladbar (' + res.status + ')');
  }
  state.cfg = await res.json();
  console.log('[WebXR] SceneConfig:', state.cfg);

  // Poster mit Meta-Daten befüllen
  applyPosterFromConfig(state.cfg, state.sceneId, state.workerBase);

  // Three.js Grundsetup
  setupThree();

  // Modell laden
  await loadModel();

  // Reticle + Controller aufsetzen
  setupReticleAndController();

  // AR-Button (unsichtbar) + XR-Events
  setupARButton();

  // Start-Button an unseren versteckten AR-Button koppeln
  setupUI();

  hideLoading();
  showPoster();

  // Resize nur, solange KEINE AR-Session läuft
  window.addEventListener('resize', () => {
    if (!state.renderer || !state.camera) return;
    if (state.renderer.xr.isPresenting) return;
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}

/* ---------- UI-Helper ---------- */

function showLoading() {
  const el = document.getElementById('loading-status');
  if (el) el.style.display = 'flex';
}
function hideLoading() {
  const el = document.getElementById('loading-status');
  if (el) el.style.display = 'none';
}
function showError(msg) {
  const el = document.getElementById('err');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    alert(msg);
  }
}
function showPoster() {
  const el = document.getElementById('poster');
  if (el) el.style.display = 'flex';
}
function hidePoster() {
  const el = document.getElementById('poster');
  if (el) el.style.display = 'none';
}

function applyPosterFromConfig(cfg, sceneId, workerBase) {
  const meta = cfg.meta || {};
  const poster = document.getElementById('poster');
  const titleEl = document.getElementById('posterTitle');
  const subtitleEl = document.getElementById('posterSubtitle');
  const textEl = document.getElementById('posterText');
  const imgEl = document.getElementById('posterImageEl');
  const mediaWrapper = document.getElementById('poster-media');

  if (titleEl) {
    titleEl.textContent = meta.title || '3D / AR Erlebnis';
  }
  if (subtitleEl) {
    if (meta.subtitle) {
      subtitleEl.textContent = meta.subtitle;
      subtitleEl.classList.remove('hidden');
    } else {
      subtitleEl.textContent = '';
      subtitleEl.classList.add('hidden');
    }
  }
  if (textEl) {
    textEl.textContent =
      meta.body ||
      meta.description ||
      'Tippe auf START AR, um das Modell in deiner Umgebung zu sehen.';
  }

  if (imgEl && mediaWrapper && meta.posterImage) {
    const url = `${workerBase}/scenes/${encodeURIComponent(
      sceneId
    )}/${encodeURIComponent(meta.posterImage)}`;
    imgEl.src = url;
    mediaWrapper.classList.remove('hidden');
  } else if (mediaWrapper) {
    mediaWrapper.classList.add('hidden');
  }

  if (poster) {
    poster.style.display = 'none'; // wird nach Laden explizit angezeigt
  }
}

/* ---------- Three.js Grundsetup ---------- */

function setupThree() {
  const canvas = document.getElementById('ar-scene-element');
  if (!canvas) throw new Error('Canvas #ar-scene-element nicht gefunden.');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.xr.enabled = true;
  renderer.setClearColor(0x000000, 0); // transparent über Kamerabild

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.0);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.light = light;
}

/* ---------- Modell laden ---------- */

function loadModel() {
  return new Promise((resolve, reject) => {
    const cfg = state.cfg;
    if (!cfg || !cfg.model || !cfg.model.url) {
      reject(new Error('Kein Modell in scene.json konfiguriert.'));
      return;
    }
    const loader = new GLTFLoader();
    const modelUrl = `${state.workerBase}/scenes/${state.sceneId}/${cfg.model.url}`;
    console.log('[WebXR] Lade GLB:', modelUrl);

    loader.load(
      modelUrl,
      (gltf) => {
        const root = gltf.scene;
        root.visible = false; // erst nach Placement sichtbar

        // optional: leichte Skalierung, falls nötig
        root.scale.setScalar(1.0);

        state.scene.add(root);
        state.model = root;

        if (gltf.animations && gltf.animations.length) {
          const mixer = new THREE.AnimationMixer(root);
          const clip = gltf.animations[0];
          const action = mixer.clipAction(clip);
          action.play();
          state.mixer = mixer;
        }

        resolve();
      },
      undefined,
      (err) => {
        reject(err);
      }
    );
  });
}

/* ---------- Reticle + Controller ---------- */

function setupReticleAndController() {
  const geometry = new THREE.RingGeometry(0.12, 0.18, 32).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const reticle = new THREE.Mesh(geometry, material);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  state.scene.add(reticle);
  state.reticle = reticle;

  const controller = state.renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  state.scene.add(controller);
  state.controller = controller;
}

function onSelect() {
  if (!state.reticle || !state.model) return;
  if (!state.reticle.visible) return;

  // Modell auf Reticle-Position setzen
  state.model.position.setFromMatrixPosition(state.reticle.matrix);

  // Rotation optional mit übernehmen
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  state.reticle.matrix.decompose(pos, quat, scale);
  state.model.quaternion.copy(quat);

  state.model.visible = true;
}

/* ---------- AR-Button + Renderloop ---------- */

function setupARButton() {
  const renderer = state.renderer;

  const btn = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay', 'local-floor'],
    domOverlay: { root: document.body },
  });

  // Button unsichtbar machen, aber im DOM behalten
  btn.style.position = 'absolute';
  btn.style.left = '-9999px';
  btn.style.bottom = 'auto';
  document.body.appendChild(btn);

  state.hiddenArButton = btn;

  renderer.xr.addEventListener('sessionstart', () => {
    console.log('[WebXR] sessionstart');
    state.arActive = true;
    hidePoster();
    // AR-UI vorerst AUS, bis AR stabil läuft:
    const arUI = document.getElementById('ar-ui');
    if (arUI) arUI.style.display = 'none';
  });

  renderer.xr.addEventListener('sessionend', () => {
    console.log('[WebXR] sessionend');
    state.arActive = false;
    state.hitTestSourceRequested = false;
    state.hitTestSource = null;
    state.reticle && (state.reticle.visible = false);
    state.lastFrameTime = null;

    showPoster();
  });

  // Drei.js kümmert sich um das XR-Frame-Handling
  renderer.setAnimationLoop(renderXRFrame);
}

/* ---------- UI: Start-Button an versteckten AR-Button koppeln ---------- */

function setupUI() {
  const startBtn = document.getElementById('startAr');
  if (!startBtn) return;

  startBtn.addEventListener('click', () => {
    if (!navigator.xr) {
      showError(
        'WebXR wird von diesem Browser nicht unterstützt.\n' +
          'Bitte Chrome (Android) oder Safari (iOS, mit USDZ) verwenden.'
      );
      return;
    }

    console.log('[WebXR] Start AR geklickt → internen AR-Button triggern');
    startBtn.disabled = true;

    // Programmatic click innerhalb desselben User-Events ist erlaubt
    if (state.hiddenArButton) {
      state.hiddenArButton.click();
    }

    // Falls Session doch nicht startet, Button nach Timeout wieder freigeben
    setTimeout(() => {
      if (!state.arActive) startBtn.disabled = false;
    }, 5000);
  });
}

/* ---------- Haupt-Renderfunktion ---------- */

function renderXRFrame(timestamp, frame) {
  const renderer = state.renderer;
  const scene = state.scene;
  const camera = state.camera;

  if (!renderer || !scene || !camera) return;

  // Delta-Zeit für Animationen
  let delta = 0;
  if (state.lastFrameTime != null) {
    delta = (timestamp - state.lastFrameTime) / 1000;
  }
  state.lastFrameTime = timestamp;

  if (state.mixer && delta > 0) {
    state.mixer.update(delta);
  }

  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!state.hitTestSourceRequested) {
      session
        .requestReferenceSpace('viewer')
        .then((refSpace) =>
          session.requestHitTestSource({ space: refSpace })
        )
        .then((source) => {
          state.hitTestSource = source;
        })
        .catch((err) => {
          console.warn('[WebXR] Hit-Test Source konnte nicht initialisiert werden:', err);
        });

      session.addEventListener('end', () => {
        state.hitTestSourceRequested = false;
        state.hitTestSource = null;
        if (state.reticle) state.reticle.visible = false;
      });

      state.hitTestSourceRequested = true;
    }

    if (state.hitTestSource) {
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
  }

  renderer.render(scene, camera);
}
