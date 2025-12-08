// js/webxr-basic.js
// Minimaler WebXR-AR-Viewer mit three.js + ARButton
// - START AR-Button in der Seite
// - AR-Szene mit Würfel
// - Optional: GLB aus deiner scene.json, wenn ?scene=…&base=… gesetzt ist

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js?module';
import { ARButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/ARButton.js?module';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?module';

let camera, scene, renderer;
let controller;
let placedObject = null;
let arButton = null;
let hasSessionStarted = false;
let modelUrl = null;

// URL-Parameter (falls vorhanden)
const params = new URLSearchParams(window.location.search);
const sceneId   = params.get('scene');
const workerBase = params.get('base');

function showError(msg) {
  const el = document.getElementById('err');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
  console.error('[WebXR Basic]', msg);
}

async function loadConfigAndPrepareModel() {
  if (!sceneId || !workerBase) {
    console.log('[WebXR Basic] Keine scene/base URL-Parameter – verwende Demo-Würfel.');
    return;
  }
  const url = `${workerBase}/scenes/${sceneId}/scene.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const cfg = await res.json();
    console.log('[WebXR Basic] SceneConfig:', cfg);
    if (cfg && cfg.model && cfg.model.url) {
      modelUrl = `${workerBase}/scenes/${sceneId}/${cfg.model.url}`;
    }
  } catch (e) {
    showError('Szene konnte nicht geladen werden: ' + e.message);
  }
}

async function init() {
  const canvas = document.getElementById('xr-canvas');
  if (!canvas) {
    showError('Canvas #xr-canvas nicht gefunden.');
    return;
  }

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  scene.background = null; // AR-Passthrough

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );
  scene.add(camera);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.0);
  scene.add(light);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(1, 3, 2);
  scene.add(dirLight);

  if (!('xr' in navigator)) {
    showError('WebXR wird in diesem Browser nicht unterstützt.\nBitte Chrome auf einem AR-fähigen Android-Gerät verwenden.');
  }

  // ARButton erzeugen, aber nicht sichtbar anzeigen
  arButton = ARButton.createButton(renderer, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: []
  });
  arButton.style.display = 'none';
  document.body.appendChild(arButton);

  // XR-Session Events
  renderer.xr.addEventListener('sessionstart', () => {
    hasSessionStarted = true;
    console.log('[WebXR Basic] sessionstart');
  });

  renderer.xr.addEventListener('sessionend', () => {
    hasSessionStarted = false;
    console.log('[WebXR Basic] sessionend');
    const startBtn = document.getElementById('start-ar');
    if (startBtn) {
      startBtn.style.display = 'block';
    }
  });

  // Controller für "select"-Event (Tap)
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  window.addEventListener('resize', onWindowResize);

  await loadConfigAndPrepareModel();
}

function onWindowResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function createFallbackCube() {
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

/**
 * Modell (GLB oder Fallback-Würfel) ca. 1.5m vor der Kamera platzieren.
 */
function placeObjectInFrontOfCamera() {
  const cam = camera;
  if (!cam) return;

  const positionObject = () => {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    dir.multiplyScalar(1.5);
    pos.add(dir);

    placedObject.position.copy(pos);
    placedObject.quaternion.copy(cam.quaternion);
  };

  if (!placedObject) {
    if (modelUrl) {
      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          placedObject = gltf.scene || gltf.scenes?.[0];
          if (!placedObject) {
            console.warn('[WebXR Basic] GLB hat keine Scene – nutze Würfel.');
            placedObject = createFallbackCube();
          }
          placedObject.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          scene.add(placedObject);
          positionObject();
        },
        undefined,
        (err) => {
          console.error('[WebXR Basic] GLB Laden fehlgeschlagen:', err);
          placedObject = createFallbackCube();
          scene.add(placedObject);
          positionObject();
        }
      );
      return;
    } else {
      // Kein modelUrl → Demo-Würfel
      placedObject = createFallbackCube();
      scene.add(placedObject);
    }
  }

  positionObject();
}

function onSelect() {
  if (!hasSessionStarted) return;
  placeObjectInFrontOfCamera();
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  renderer.render(scene, camera);
}

// Bootstrapping
init().then(() => {
  animate();

  const startBtn = document.getElementById('start-ar');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (!arButton) {
        showError('ARButton nicht initialisiert.');
        return;
      }
      const errEl = document.getElementById('err');
      if (errEl) errEl.style.display = 'none';

      // Klick auf den versteckten ARButton → startet XR-Session
      arButton.click();
      startBtn.style.display = 'none';
    });
  }
});
