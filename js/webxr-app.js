// js/webxr-app.js
// WebXR-Viewer mit Hit-Test + Poster, basierend auf three.js "webxr_ar_hittest"

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { ARButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/ARButton.js';
import { initAudio, toggleAudio, pauseAudioOnHide } from './audio.js';

const state = {
  cfg: null,
  sceneId: null,
  workerBase: null,
  model: null,
  mixer: null,
  reticle: null,
  hitTestSource: null,
  hitTestSourceRequested: false,
  arSessionActive: false
};

let renderer, scene, camera;
let clock = new THREE.Clock();

let canvasEl, posterEl, loadingEl, errEl, startArBtn, arUIEl;
let posterTitleEl, posterSubtitleEl, posterTextEl, posterImageEl;

// ARButton (unsichtbar, wird vom START-Button geklickt)
let xrButton = null;

document.addEventListener('DOMContentLoaded', () => {
  canvasEl        = document.getElementById('ar-scene-element');
  posterEl        = document.getElementById('poster');
  loadingEl       = document.getElementById('loading-status');
  errEl           = document.getElementById('err');
  startArBtn      = document.getElementById('startAr');
  arUIEl          = document.getElementById('ar-ui');
  posterTitleEl   = document.getElementById('posterTitle');
  posterSubtitleEl= document.getElementById('posterSubtitle');
  posterTextEl    = document.getElementById('posterText');
  posterImageEl   = document.getElementById('posterImageEl');

  initWebXRViewer().catch((e) => {
    console.error('[WebXR] Init-Fehler:', e);
    showError('FEHLER beim Initialisieren: ' + (e.message || e));
  });
});

async function initWebXRViewer() {
  showLoading();

  const params = new URLSearchParams(window.location.search);
  state.sceneId = params.get('scene') || '';
  const baseParam = params.get('base') || '';
  state.workerBase = baseParam ? decodeURIComponent(baseParam) : '';

  if (!state.sceneId || !state.workerBase) {
    hideLoading();
    showError('FEHLENDE URL PARAMETER (scene/base)');
    return;
  }

  // Szene-Konfiguration laden
  state.cfg = await loadSceneConfig(state.sceneId, state.workerBase);
  console.log('[WebXR] SceneConfig:', state.cfg);

  // Poster aus Meta befüllen
  applyPosterFromConfig(state);

  // Three.js Szene aufsetzen
  setupThreeScene();

  // Modell laden
  await loadModel(state.cfg, state.sceneId, state.workerBase);

  // Audio initialisieren (Mute-Button etc.)
  initAudio(state);
  pauseAudioOnHide();

  // WebXR / Hit-Test aktivieren
  setupXR();

  hideLoading();
  showPoster();

  // START AR-Button mit verstecktem ARButton verknüpfen
  if (startArBtn) {
    startArBtn.addEventListener('click', () => {
      if (!xrButton) {
        showError('AR wird von diesem Browser/Gerät nicht unterstützt.');
        return;
      }
      startArBtn.disabled = true;
      console.log('[WebXR] Start AR geklickt → internen AR-Button triggern');
      xrButton.click();
    });
  }
}

/* ========== Hilfsfunktionen UI ========== */

function showLoading() {
  if (loadingEl) loadingEl.style.display = 'flex';
}

function hideLoading() {
  if (loadingEl) loadingEl.style.display = 'none';
}

function showError(msg) {
  console.error('[WebXR ERROR]', msg);
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }
}

function showPoster() {
  if (posterEl) posterEl.style.display = 'flex';
}

function hidePoster() {
  if (posterEl) posterEl.style.display = 'none';
}

function applyPosterFromConfig(st) {
  const cfg  = st.cfg || {};
  const meta = cfg.meta || {};
  const welcome = (cfg.ui && cfg.ui.welcome) || {};

  const title =
    (meta.title && meta.title.trim()) ||
    (welcome.title && welcome.title.trim()) ||
    '3D / AR Erlebnis';

  const subtitle =
    (meta.subtitle && meta.subtitle.trim()) ||
    (welcome.eyebrow && welcome.eyebrow.trim()) ||
    '';

  const body =
    (meta.body && meta.body.trim()) ||
    (meta.description && meta.description.trim()) ||
    (welcome.desc && welcome.desc.trim()) ||
    'Tippe auf START AR, um das Modell in deiner Umgebung zu sehen.';

  const posterFile =
    (meta.posterImage && String(meta.posterImage).trim()) ||
    (welcome.poster && String(welcome.poster).trim()) ||
    '';

  if (posterTitleEl) posterTitleEl.textContent = title;
  if (posterTextEl)  posterTextEl.textContent  = body;

  if (posterSubtitleEl) {
    if (subtitle) {
      posterSubtitleEl.textContent = subtitle;
      posterSubtitleEl.classList.remove('hidden');
    } else {
      posterSubtitleEl.textContent = '';
      posterSubtitleEl.classList.add('hidden');
    }
  }

  if (posterImageEl) {
    if (posterFile && state.workerBase && state.sceneId) {
      const url = `${state.workerBase}/scenes/${encodeURIComponent(
        state.sceneId
      )}/${encodeURIComponent(posterFile)}`;
      console.log('[WebXR] Posterbild URL:', url);
      posterImageEl.src = url;
      const wrapper = document.getElementById('poster-media');
      if (wrapper) {
        wrapper.classList.remove('hidden');
        wrapper.style.display = '';
      }
    } else {
      posterImageEl.removeAttribute('src');
      posterImageEl.style.display = 'none';
      const wrapper = document.getElementById('poster-media');
      if (wrapper) wrapper.classList.add('hidden');
    }
  }
}

/* ========== Szene & Modell ========== */

async function loadSceneConfig(sceneId, workerBase) {
  const url = `${workerBase}/scenes/${encodeURIComponent(
    sceneId
  )}/scene.json`;

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

function setupThreeScene() {
  if (!canvasEl) {
    throw new Error('Canvas-Element #ar-scene-element fehlt.');
  }

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );
  scene.add(camera);

  // Licht
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemiLight.position.set(0, 1, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(1, 2, 1);
  scene.add(dirLight);

  // Renderer mit vorhandenem Canvas
  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.xr.enabled = true;
  renderer.setClearColor(0x000000, 0); // transparenter Hintergrund → Kamera sichtbar

  // Reticle (Trefferanzeige)
  const ringGeo = new THREE.RingGeometry(0.15, 0.2, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00ff00
  });
  const reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  state.reticle = reticle;

  // Basis-Renderloop (wird von WebXR genutzt)
  renderer.setAnimationLoop(onXRFrame);
}

async function loadModel(cfg, sceneId, workerBase) {
  if (!cfg.model || !cfg.model.url) {
    throw new Error('Kein Modell in scene.json (model.url fehlt).');
  }

  const modelUrl = `${workerBase}/scenes/${encodeURIComponent(
    sceneId
  )}/${encodeURIComponent(cfg.model.url)}`;
  console.log('[WebXR] Lade GLB:', modelUrl);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(modelUrl);

  const root = gltf.scene || gltf.scenes[0];
  if (!root) throw new Error('GLB enthält keine Scene.');

  root.visible = false; // erst nach Platzierung
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  scene.add(root);
  state.model = root;

  // Animation, falls vorhanden
  if (gltf.animations && gltf.animations.length > 0) {
    state.mixer = new THREE.AnimationMixer(root);
    const cfgAnimName = Array.isArray(cfg.animations) && cfg.animations[0];
    let clip = null;

    if (cfgAnimName) {
      clip = THREE.AnimationClip.findByName(gltf.animations, cfgAnimName);
    }
    if (!clip) {
      clip = gltf.animations[0];
    }

    const action = state.mixer.clipAction(clip);
    action.play();
  }
}

/* ========== WebXR + Hit-Test ========== */

function setupXR() {
  if (!navigator.xr) {
    showError(
      'WebXR wird von diesem Browser/Gerät nicht unterstützt.\n' +
      'Bitte Chrome (Android) auf einem AR-fähigen Gerät verwenden.'
    );
    if (startArBtn) startArBtn.disabled = true;
    return;
  }

  // Unsichtbarer ARButton – wird vom START AR-Button getriggert
  xrButton = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body }
  });
  xrButton.style.display = 'none'; // nicht im UI zeigen
  document.body.appendChild(xrButton);

  // Controller für "select" (Tap zum Platzieren)
  const controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // Session-Start/-Ende → UI + Audio
  renderer.xr.addEventListener('sessionstart', () => {
    console.log('[WebXR] sessionstart');
    state.arSessionActive = true;
    state.hitTestSourceRequested = false;
    state.hitTestSource = null;

    hidePoster();
    if (arUIEl) arUIEl.style.display = 'block';

    toggleAudio(true);
  });

  renderer.xr.addEventListener('sessionend', () => {
    console.log('[WebXR] sessionend');
    state.arSessionActive = false;
    state.hitTestSourceRequested = false;
    state.hitTestSource = null;

    if (arUIEl) arUIEl.style.display = 'none';
    showPoster();

    toggleAudio(false);
    if (startArBtn) startArBtn.disabled = false;
  });
}

function onSelect() {
  if (!state.model || !state.reticle) return;
  if (!state.reticle.visible) return;

  // Modell an Reticle-Position setzen
  const poseMatrix = new THREE.Matrix4();
  poseMatrix.copy(state.reticle.matrix);

  state.model.position.setFromMatrixPosition(poseMatrix);
  state.model.quaternion.setFromRotationMatrix(poseMatrix);
  state.model.visible = true;

  console.log('[WebXR] Modell platziert.');
}

function onXRFrame(time, frame) {
  const session = renderer.xr.getSession();

  if (state.mixer) {
    const delta = clock.getDelta();
    state.mixer.update(delta);
  }

  if (frame && session) {
    const referenceSpace = renderer.xr.getReferenceSpace();

    // Hit-Test Source einmalig anfordern
    if (!state.hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          state.hitTestSource = source;
        });
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
