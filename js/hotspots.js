// js/hotspots.js
// Erzeugt Hotspots aus cfg.clickableNodes mit Positionen

function slugify(label) {
  return (label || 'hotspot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}

/**
 * Initialisiert Hotspots für model-viewer basierend auf state.cfg.clickableNodes.
 * Erwartet im scene.json:
 * "clickableNodes": [
 *   { "label":"Mehr Infos", "url":"https://...", "position":{"x":0,"y":1,"z":0} }
 * ]
 */
export function initHotspots(state) {
  const mvEl = document.getElementById('ar-scene-element');
  if (!mvEl) return;

  const nodes = state?.cfg?.clickableNodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return;

  nodes.forEach((node, idx) => {
    if (!node.url) return;

    if (
      !node.position ||
      typeof node.position.x !== 'number' ||
      typeof node.position.y !== 'number' ||
      typeof node.position.z !== 'number'
    ) {
      console.warn('[ARea Viewer] Hotspot ohne gültige Position übersprungen:', node);
      return;
    }

    const slotName = `hotspot-${slugify(node.label || ('link' + idx))}`;
    const btn = document.createElement('button');
    btn.setAttribute('slot', slotName);
    btn.className = 'Hotspot';
    btn.textContent = node.label || `Link ${idx + 1}`;
    btn.setAttribute('data-position', `${node.position.x} ${node.position.y} ${node.position.z}`);
    btn.setAttribute('data-normal', '0 1 0');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(node.url, '_blank', 'noopener,noreferrer');
    });

    mvEl.appendChild(btn);
  });
}
