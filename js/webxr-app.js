// js/webxr-app.js

import { loadConfig } from './core.js';
import { initAudio, toggleAudio, pauseAudioOnHide } from './audio.js';
import { showLoading, hideLoading, showPoster, hidePoster, initUI, bindARStatus } from './ui.js';
import { initRecording, stopRecordingOnARSessionEnd } from './recording.js';

// three.js + GLTFLoader – three kommt aus der Importmap in webxr.html
import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';


let state = {
  cfg: null,
  sceneId: null,
  workerBase: null,
  arSessionActive: false,
  xrSession: null
};

let renderer, scene, camera, clock;
let mixer = null;
let model = null;

let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let referenceSpace = null;

function emitARStatus(status, extra = {}) {
  const root = document.getElementById('ar-scene-element');
  if (!root) return;
  const ev = new CustomEvent('ar-status', {
    detail: { status, ...extra }
  });
  root.dispatchEvent(ev);
}

document.addEventListener('DOMContentLoaded', async () => {
  showLoading();

  const params = new URLSearchParams(window.location.search);
  state.sceneId = params.get('scene');
  state.workerBase = params.get('base');

  if (!state.sceneId || !state.workerBase) {
    hideLoading();
    const errEl = document.getElementById('err');
    if (errEl) {
      errEl.textContent = 'FEHLENDE URL PARAMETER (scene/base)';
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    // Szene-Konfiguration laden
    state.cfg = await loadConfig(state.sceneId, state.workerBase);
    console.log('ARea WebXR Viewer – geladene SceneConfig:', state.cfg);

    if (state.cfg.meta && state.cfg.meta.title) {
      document.title = `ARea Viewer – ${state.cfg.meta.title}`;
    }

    initThreeScene();
    await loadModel();

    initAudio(state);
    pauseAudioOnHide();
    initRecording(state);

    hideLoading();
    showPoster(state);
  } catch (e) {
    hideLoading();
    const errEl = document.getElementById('err');
    if (errEl) {
      errEl.textContent = 'FEHLER: ' + e.message;
      errEl.style.display = 'block';
    }
    console.error(e);
    return;
  }

  // UI initialisieren – START AR nutzt unseren WebXR-Start
  initUI(state, { onStartAR: startWebXR });

  // AR-Status an Audio/Recording koppeln
  bindARStatus(state, {
    onSessionStart() {
      state.arSessionActive = true;
      hidePoster();
      toggleAudio(true);
    },
    async onSessionEnd() {
      state.arSessionActive = false;
      showPoster(state);
      toggleAudio(false);
      await stopRecordingOnARSessionEnd();
      const startBtn = document.getElementById('startAr');
      if (startBtn) startBtn.disabled = false;
    },
    onFailed(msg) {
      state.arSessionActive = false;
      const errEl = document.getElementById('err');
      if (errEl) {
        errEl.textContent = 'AR FEHLER: ' + msg;
        errEl.style.display = 'block';
      }
      const startBtn = document.getElementById('startAr');
      if (startBtn) startBtn.disabled = false;
    }
  });
});

function initThreeScene() {
  const canvas = document.getElementById('ar-scene-element');

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  clock = new THREE.Clock();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 1);
  scene.add(dir);

  // Reticle (erstmal Ring – später können wir ihn als Rechteck gestalten)
  const geom = new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    opacity: 0.9,
    transparent: true
  });
  reticle = new THREE.Mesh(geom, mat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Controller für Tap-Platzierung
  const controller = renderer.xr.getController(0);
  controller.addEventListener('select', () => {
    if (reticle.visible && model) {
      model.visible = true;
      model.position.setFromMatrixPosition(reticle.matrix);
      model.quaternion.setFromRotationMatrix(reticle.matrix);
    }
  });
  scene.add(controller);

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function loadModel() {
  const cfg = state.cfg;
  if (!cfg.model || !cfg.model.url) {
    throw new Error('Kein Modell in der Konfiguration.');
  }

  const modelUrl = `${state.workerBase}/scenes/${state.sceneId}/${cfg.model.url}`;
  const loader = new GLTFLoader();

  const gltf = await loader.loadAsync(modelUrl);
  model = gltf.scene;
  model.visible = false; // erst nach Platzierung zeigen
  scene.add(model);

  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    let clip = gltf.animations[0];

    if (Array.isArray(cfg.animations) && cfg.animations.length) {
      const desired = cfg.animations[0];
      const found = THREE.AnimationClip.findByName(gltf.animations, desired);
      if (found) clip = found;
    }

    const action = mixer.clipAction(clip);
    action.play();
  }
}

async function startWebXR() {
  if (!navigator.xr) {
    emitARStatus('failed', { reason: 'WebXR nicht verfügbar' });
    throw new Error('WebXR nicht verfügbar');
  }

  const supported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!supported) {
    emitARStatus('failed', { reason: 'immersive-ar nicht unterstützt' });
    throw new Error('immersive-ar nicht unterstützt');
  }

  const sessionInit = {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body }
  };

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', sessionInit);
  } catch (e) {
    emitARStatus('failed', { reason: e.message || String(e) });
    throw e;
  }

  state.xrSession = session;

  session.addEventListener('end', () => {
    state.arSessionActive = false;
    hitTestSourceRequested = false;
    hitTestSource = null;
    referenceSpace = null;
    emitARStatus('session-ended');
    renderer.setAnimationLoop(null);
  });

  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);

  referenceSpace = await session.requestReferenceSpace('local-floor');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  hitTestSourceRequested = true;

  emitARStatus('session-started');

  renderer.setAnimationLoop((timestamp, frame) => {
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);

    if (frame && hitTestSource && referenceSpace) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length) {
        const pose = hits[0].getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        reticle.visible = false;
      }
    }

    renderer.render(scene, camera);
  });
}
