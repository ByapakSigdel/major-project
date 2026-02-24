/**
 * GameSceneManager - Three.js scene for the escape room game
 *
 * Features:
 *   - First-person camera with pointer-lock mouse look
 *   - WASD movement with room-bounds collision
 *   - Raycasting for object interaction
 *   - Per-room lighting presets (sci-fi themed)
 */

import * as THREE from 'three';

const MOVE_SPEED = 3.0;    // units per second
const MOUSE_SENS = 0.002;  // radians per pixel
const PITCH_LIMIT = 80 * (Math.PI / 180); // +/-80 degrees

// ---- Lighting Presets ----
// Each preset defines ambient, hemisphere (sky/ground), directional, fog, and background
const LIGHTING_PRESETS = {
  // Room 1: Clean white-blue lab
  calibration: {
    background: 0x0c1018,
    fogColor: 0x0c1018,
    fogDensity: 0.015,
    ambient: { color: 0x90a8d0, intensity: 0.7 },
    hemi: { sky: 0xa8c8f0, ground: 0x304060, intensity: 0.5 },
    dir: { color: 0xd0e0ff, intensity: 0.6, pos: [2, 5, 1] },
  },
  // Room 2: Amber/orange warning atmosphere
  cognitive: {
    background: 0x18120a,
    fogColor: 0x18120a,
    fogDensity: 0.018,
    ambient: { color: 0xc09060, intensity: 0.5 },
    hemi: { sky: 0xd0a050, ground: 0x503010, intensity: 0.4 },
    dir: { color: 0xffc070, intensity: 0.5, pos: [-2, 4, 1] },
  },
  // Room 3: Deep red dramatic
  core: {
    background: 0x140808,
    fogColor: 0x140808,
    fogDensity: 0.02,
    ambient: { color: 0xc04040, intensity: 0.4 },
    hemi: { sky: 0xff4040, ground: 0x200808, intensity: 0.35 },
    dir: { color: 0xff6040, intensity: 0.5, pos: [0, 6, 0] },
  },
  // Default / menu
  default: {
    background: 0x1a1a2e,
    fogColor: 0x1a1a2e,
    fogDensity: 0.02,
    ambient: { color: 0x8090b8, intensity: 0.8 },
    hemi: { sky: 0xb0c4e8, ground: 0x806040, intensity: 0.6 },
    dir: { color: 0xffe8d0, intensity: 0.4, pos: [3, 5, 2] },
  },
};

export class GameSceneManager {
  constructor(container) {
    this._container = container;
    this._onUpdateCallbacks = [];
    this._frameCount = 0;
    this._lastFpsTime = performance.now();
    this._fps = 0;

    this._yaw = 0;
    this._pitch = 0;
    this._keys = { w: false, a: false, s: false, d: false };
    this._moveForward = new THREE.Vector3();
    this._moveRight = new THREE.Vector3();
    this._roomBounds = { x: 2.5, z: 2.5 };

    this._initScene();
    this._initLights();
    this._initResize();
    this._initControls();

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 8;
    this._screenCenter = new THREE.Vector2(0, 0);
    this._interactables = [];
  }

  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get renderer() { return this._renderer; }
  get fps() { return this._fps; }

  onUpdate(callback) { this._onUpdateCallbacks.push(callback); }
  start() {
    this._clock = new THREE.Clock();
    this._animate();
  }

  // ---- Raycasting ----

  getTargetObject() {
    this._raycaster.setFromCamera(this._screenCenter, this._camera);
    const hits = this._raycaster.intersectObjects(this._interactables, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj.parent && !obj.userData.interactable) obj = obj.parent;
      if (obj.userData.interactable) {
        return { object: obj, distance: hits[0].distance, point: hits[0].point };
      }
    }
    return null;
  }

  addInteractable(obj) {
    obj.userData.interactable = true;
    this._interactables.push(obj);
  }

  removeInteractable(obj) {
    const idx = this._interactables.indexOf(obj);
    if (idx !== -1) this._interactables.splice(idx, 1);
  }

  clearInteractables() { this._interactables = []; }

  clearRoom() {
    const toRemove = [];
    this._scene.children.forEach((child) => {
      if (child.userData.roomObject === true) toRemove.push(child);
    });
    toRemove.forEach(obj => {
      this._scene.remove(obj);
      obj.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
          else node.material.dispose();
        }
      });
    });
    this._interactables = [];
  }

  // ---- Per-Room Lighting ----

  /**
   * Switch the scene lighting to a named preset.
   * @param {'calibration'|'cognitive'|'core'|'default'} presetName
   */
  setRoomLighting(presetName) {
    const p = LIGHTING_PRESETS[presetName] || LIGHTING_PRESETS.default;

    // Background & fog
    this._scene.background.set(p.background);
    this._scene.fog.color.set(p.fogColor);
    this._scene.fog.density = p.fogDensity;

    // Ambient
    this._ambientLight.color.set(p.ambient.color);
    this._ambientLight.intensity = p.ambient.intensity;

    // Hemisphere
    this._hemiLight.color.set(p.hemi.sky);
    this._hemiLight.groundColor.set(p.hemi.ground);
    this._hemiLight.intensity = p.hemi.intensity;

    // Directional
    this._dirLight.color.set(p.dir.color);
    this._dirLight.intensity = p.dir.intensity;
    this._dirLight.position.set(...p.dir.pos);
  }

  // ---- Camera / Movement ----

  _initControls() {
    const canvas = this._renderer.domElement;
    const prompt = document.getElementById('pointer-lock-prompt');

    canvas.addEventListener('click', () => canvas.requestPointerLock());

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (prompt) {
        locked ? prompt.classList.add('hidden') : prompt.classList.remove('hidden');
      }
      if (!locked) {
        this._keys.w = false; this._keys.a = false;
        this._keys.s = false; this._keys.d = false;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this._yaw   -= e.movementX * MOUSE_SENS;
      this._pitch -= e.movementY * MOUSE_SENS;
      this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._pitch));
    });

    const onKey = (e, down) => {
      const key = e.key.toLowerCase();
      if (key in this._keys) this._keys[key] = down;
    };
    document.addEventListener('keydown', (e) => onKey(e, true));
    document.addEventListener('keyup',   (e) => onKey(e, false));
  }

  resetCamera() {
    this._camera.position.set(0, 1.6, 0);
    this._yaw = 0;
    this._pitch = 0;
  }

  moveCamera(dt) {
    this._camera.rotation.order = 'YXZ';
    this._camera.rotation.set(this._pitch, this._yaw, 0);

    const { w, a, s, d } = this._keys;
    if (!(w || a || s || d)) return;

    this._camera.getWorldDirection(this._moveForward);
    this._moveForward.y = 0;
    this._moveForward.normalize();
    this._moveRight.crossVectors(this._moveForward, this._camera.up).normalize();

    const speed = MOVE_SPEED * dt;
    if (w) this._camera.position.addScaledVector(this._moveForward,  speed);
    if (s) this._camera.position.addScaledVector(this._moveForward, -speed);
    if (d) this._camera.position.addScaledVector(this._moveRight,    speed);
    if (a) this._camera.position.addScaledVector(this._moveRight,   -speed);

    const b = this._roomBounds;
    this._camera.position.x = Math.max(-b.x, Math.min(b.x, this._camera.position.x));
    this._camera.position.z = Math.max(-b.z, Math.min(b.z, this._camera.position.z));
  }

  setRoomBounds(halfWidth, halfDepth) {
    this._roomBounds.x = halfWidth;
    this._roomBounds.z = halfDepth;
  }

  // ---- Init ----

  _initScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);
    this._scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);

    this._camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 30);
    this._camera.position.set(0, 1.6, 0);

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this._renderer.shadowMap.enabled = false;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.6;

    this._container.appendChild(this._renderer.domElement);
  }

  _initLights() {
    this._ambientLight = new THREE.AmbientLight(0x8090b8, 0.8);
    this._scene.add(this._ambientLight);

    this._hemiLight = new THREE.HemisphereLight(0xb0c4e8, 0x806040, 0.6);
    this._scene.add(this._hemiLight);

    this._dirLight = new THREE.DirectionalLight(0xffe8d0, 0.4);
    this._dirLight.position.set(3, 5, 2);
    this._scene.add(this._dirLight);
  }

  _initResize() {
    window.addEventListener('resize', () => {
      this._camera.aspect = window.innerWidth / window.innerHeight;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const deltaTime = this._clock.getDelta();

    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
    }

    for (const cb of this._onUpdateCallbacks) cb(deltaTime);
    this._renderer.render(this._scene, this._camera);
  }
}
