// js/core.js
// Vollständige Datei mit Animation-Handling (autoplay + animation-name + Fallback)
// Nichts entfernt, nur gezielt ergänzt.

export function initCore() {
  const mvEl = document.getElementById('ar-scene-element');
  if (!mvEl || mvEl.tagName !== 'MODEL-VIEWER') {
    throw new Error('model-viewer Element fehlt oder ist ungültig.');
  }
  return mvEl;
}

export async function loadConfig(sceneId, workerBase) {
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

export function configureModel(cfg, sceneId, workerBase) {
  const mvEl = initCore();
  if (!cfg.model || !cfg.model.url) {
    throw new Error('Kein Modell in der Konfiguration.');
  }

  const modelUrl = `${workerBase}/scenes/${sceneId}/${cfg.model.url}`;
  mvEl.setAttribute('src', modelUrl);
  mvEl.setAttribute('alt', cfg.meta?.title || '3D Modell');
  mvEl.setAttribute('shadow-intensity', '1');
  mvEl.setAttribute('auto-rotate', '');          // wird nach load entfernt
  mvEl.setAttribute('interaction-prompt', 'none');
  mvEl.setAttribute('auto-rotate-delay', '1000');
  mvEl.setAttribute('disable-tap', '');

  // 🔹 AR-Modus je nach Plattform: Android = WebXR, iOS = Quick Look
  const ua = (navigator.userAgent || navigator.vendor || window.opera || '');
  const isIOS     = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/i.test(ua);

  mvEl.setAttribute('ar', '');

  if (isIOS) {
    // iOS → Quick Look
    mvEl.setAttribute('ar-modes', 'quick-look');

    // Optional: USDZ aus Config verwenden, falls vorhanden
    if (cfg.model.usdzUrl) {
      const usdzUrl = cfg.model.usdzUrl.startsWith('http')
        ? cfg.model.usdzUrl
        : `${workerBase}/scenes/${sceneId}/${cfg.model.usdzUrl}`;
      mvEl.setAttribute('ios-src', usdzUrl);
    } else {
      // Kein USDZ → Quick Look kann nichts anzeigen
      mvEl.removeAttribute('ios-src');
      console.warn('[ARea Viewer] iOS erkannt, aber keine model.usdzUrl in scene.json – Quick Look ohne Asset.');
    }
  } else if (isAndroid) {
    // Android → WebXR ERZWINGEN (kein scene-viewer!)
    mvEl.setAttribute('ar-modes', 'webxr');
    mvEl.removeAttribute('ios-src');
  } else {
    // Desktop / sonstige Plattformen → WebXR für Tests
    mvEl.setAttribute('ar-modes', 'webxr');
    mvEl.removeAttribute('ios-src');
  }

  console.log('[ARea Viewer] AR-Konfiguration:', {
    platform: isIOS ? 'iOS' : (isAndroid ? 'Android' : 'Other'),
    arModes: mvEl.getAttribute('ar-modes'),
    hasUsdz: !!cfg.model.usdzUrl
  });

  // 🔹 Animation automatisch starten
  mvEl.setAttribute('autoplay', '');
  if (Array.isArray(cfg.animations) && cfg.animations.length > 0) {
    // Ersten Clip aus Szene-Config setzen
    mvEl.setAttribute('animation-name', cfg.animations[0]);
  }

  if (cfg.environmentImage) {
    mvEl.setAttribute('environment-image', cfg.environmentImage);
  }
  if (typeof cfg.exposure === 'number') {
    mvEl.setAttribute('exposure', String(cfg.exposure));
  }
  if (typeof cfg.model.yOffset === 'number') {
    const px = (-cfg.model.yOffset * 100).toFixed(0) + 'px';
    document.documentElement.style.setProperty('--model-vertical-offset', px);
  }

  mvEl.addEventListener('load', () => {
    // auto-rotate entfernen
    mvEl.removeAttribute('auto-rotate');

    // Fallback: wenn keine animations[] im JSON gesetzt wurde, aber der GLB Clips hat
    if ((!cfg.animations || !cfg.animations.length) && mvEl.availableAnimations?.length) {
      mvEl.animationName = mvEl.availableAnimations[0];
    }

    // Falls animation-name gesetzt ist aber nicht im GLB existiert, trotzdem Fallback:
    const requested = mvEl.getAttribute('animation-name');
    if (requested && mvEl.availableAnimations && !mvEl.availableAnimations.includes(requested)) {
      mvEl.animationName = mvEl.availableAnimations[0];
    }

    console.log('Modell geladen. Verfügbare Animationen:', mvEl.availableAnimations);
  });
}
