// js/DeviceOrientationControls.js
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

const zee = new Vector3(0, 0, 1);
const euler = new Euler();
const q0 = new Quaternion();
const q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 um X

function setObjectQuaternion(quaternion, alpha, beta, gamma, orient) {
  // Reihenfolge wie im originalen three-DeviceOrientationControls
  euler.set(beta, alpha, -gamma, 'YXZ');
  quaternion.setFromEuler(euler);
  quaternion.multiply(q1);
  quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
}

export class DeviceOrientationControls {
  constructor(object) {
    this.object = object;
    this.object.rotation.reorder('YXZ');

    this.enabled = false;
    this.deviceOrientation = {};
    this.screenOrientation = 0;
    this.alphaOffset = 0;

    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
    this._onScreenOrientation = this._onScreenOrientation.bind(this);
  }

  _onDeviceOrientation(event) {
    this.deviceOrientation = event || {};
  }

  _onScreenOrientation() {
    const screen = window.screen && window.screen.orientation;
    const angle =
      (screen && typeof screen.angle === 'number')
        ? screen.angle
        : (window.orientation || 0);
    this.screenOrientation = angle;
  }

  connect() {
    this._onScreenOrientation();

    const hasDeviceOrientation = typeof window.DeviceOrientationEvent !== 'undefined';
    const hasPermissionApi =
      hasDeviceOrientation &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function';

    if (!hasDeviceOrientation) {
      console.warn('[ARea] DeviceOrientation wird nicht unterstützt.');
      return;
    }

    if (hasPermissionApi) {
      // iOS 13+: MUSS aus einem User-Gesture (Button-Klick) aufgerufen werden
      window.DeviceOrientationEvent.requestPermission()
        .then((response) => {
          if (response === 'granted') {
            window.addEventListener('orientationchange', this._onScreenOrientation);
            window.addEventListener('deviceorientation', this._onDeviceOrientation);
            this.enabled = true;
          } else {
            console.warn('[ARea] DeviceOrientation Permission abgelehnt.');
          }
        })
        .catch((err) => {
          console.error('[ARea] DeviceOrientation Permission-Fehler:', err);
        });
    } else {
      window.addEventListener('orientationchange', this._onScreenOrientation);
      window.addEventListener('deviceorientation', this._onDeviceOrientation);
      this.enabled = true;
    }
  }

  disconnect() {
    window.removeEventListener('orientationchange', this._onScreenOrientation);
    window.removeEventListener('deviceorientation', this._onDeviceOrientation);
    this.enabled = false;
  }

  update() {
    if (!this.enabled) return;

    const { alpha, beta, gamma } = this.deviceOrientation;

    const alphaRad = ((alpha ?? 0) * MathUtils.DEG2RAD) + this.alphaOffset;
    const betaRad  =  (beta  ?? 0) * MathUtils.DEG2RAD;
    const gammaRad =  (gamma ?? 0) * MathUtils.DEG2RAD;
    const orientRad = (this.screenOrientation || 0) * MathUtils.DEG2RAD;

    setObjectQuaternion(this.object.quaternion, alphaRad, betaRad, gammaRad, orientRad);
  }

  dispose() {
    this.disconnect();
  }
}
