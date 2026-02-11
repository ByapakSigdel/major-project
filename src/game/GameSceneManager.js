/**
 * GameSceneManager - Three.js scene for the escape room game
 * 
 * Unlike the hand simulation SceneManager, this one:
 *   - Uses a first-person camera (no orbit controls)
 *   - Mouse look via pointer lock for camera rotation
 *   - WASD movement relative to camera direction
 *   - Supports raycasting for object interaction
 *   - Manages room-specific scenes
 */

import * as THREE from 'three';

const MOVE_SPEED = 3.0;    // units per second
const MOUSE_SENS = 0.002;  // radians per pixel
const PITCH_LIMIT = 80 * (Math.PI / 180); // ±80 degrees

export class GameSceneManager {
  constructor(container) {
    this._container = container;
    this._onUpdateCallbacks = [];
    this._frameCount = 0;
    this._lastFpsTime = performance.now();
    this._fps = 0;

    // Camera Euler state (yaw = Y rotation, pitch = X rotation)
    this._yaw = 0;
    this._pitch = 0;

    // Movement key state
    this._keys = { w: false, a: false, s: false, d: false };

    // Reusable vectors for movement
    this._moveForward = new THREE.Vector3();
    this._moveRight = new THREE.Vector3();

    this._initScene();
    this._initLights();
    this._initResize();
    this._initControls();

    // Raycaster for object picking
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 8;
    this._screenCenter = new THREE.Vector2(0, 0);

    // Interactive objects registry
    this._interactables = [];
  }

  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get renderer() { return this._renderer; }
  get fps() { return this._fps; }

  onUpdate(callback) {
    this._onUpdateCallbacks.push(callback);
  }

  start() {
    this._clock = new THREE.Clock();
    this._animate();
  }

  // ---- Raycasting ----

  /** Get the object the camera is looking at (center of screen) */
  getTargetObject() {
    this._raycaster.setFromCamera(this._screenCenter, this._camera);
    const hits = this._raycaster.intersectObjects(this._interactables, true);
    if (hits.length > 0) {
      // Walk up to find the root interactable
      let obj = hits[0].object;
      while (obj.parent && !obj.userData.interactable) {
        obj = obj.parent;
      }
      if (obj.userData.interactable) {
        return { object: obj, distance: hits[0].distance, point: hits[0].point };
      }
    }
    return null;
  }

  /** Register an object as interactable */
  addInteractable(obj) {
    obj.userData.interactable = true;
    this._interactables.push(obj);
  }

  /** Remove an interactable */
  removeInteractable(obj) {
    const idx = this._interactables.indexOf(obj);
    if (idx !== -1) this._interactables.splice(idx, 1);
  }

  /** Clear all interactables */
  clearInteractables() {
    this._interactables = [];
  }

  /** Clear the scene for room transition */
  clearRoom() {
    // Remove all children except camera and lights
    const toRemove = [];
    this._scene.traverse((child) => {
      if (child.userData.roomObject) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(obj => {
      this._scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this._interactables = [];
  }

  // ---- Camera / Movement Control ----

  /** Initialize pointer lock + keyboard listeners */
  _initControls() {
    const canvas = this._renderer.domElement;

    // Click to lock pointer
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock();
    });

    // Mouse look
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this._yaw   -= e.movementX * MOUSE_SENS;
      this._pitch -= e.movementY * MOUSE_SENS;
      this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._pitch));
    });

    // WASD
    const onKey = (e, down) => {
      const key = e.key.toLowerCase();
      if (key in this._keys) this._keys[key] = down;
    };
    document.addEventListener('keydown', (e) => onKey(e, true));
    document.addEventListener('keyup',   (e) => onKey(e, false));
  }

  /**
   * Call once per frame (from render loop) to apply mouse look rotation
   * and WASD movement to the camera.
   */
  moveCamera(dt) {
    // Apply look rotation (order: Y then X, no roll)
    this._camera.rotation.set(0, 0, 0, 'YXZ');
    this._camera.rotation.order = 'YXZ';
    this._camera.rotation.y = this._yaw;
    this._camera.rotation.x = this._pitch;

    // WASD movement relative to camera direction (Y locked — no flying)
    const { w, a, s, d } = this._keys;
    if (!(w || a || s || d)) return;

    // Forward/back along camera's horizontal look direction
    this._camera.getWorldDirection(this._moveForward);
    this._moveForward.y = 0;
    this._moveForward.normalize();

    // Right = forward × world up
    this._moveRight.crossVectors(this._moveForward, this._camera.up).normalize();

    const speed = MOVE_SPEED * dt;
    if (w) this._camera.position.addScaledVector(this._moveForward,  speed);
    if (s) this._camera.position.addScaledVector(this._moveForward, -speed);
    if (d) this._camera.position.addScaledVector(this._moveRight,    speed);
    if (a) this._camera.position.addScaledVector(this._moveRight,   -speed);
  }

  // ---- Init ----

  _initScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);

    // Subtle fog for depth
    this._scene.fog = new THREE.FogExp2(0x1a1a2e, 0.035);

    // Camera - first person
    this._camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.05,
      50
    );
    this._camera.position.set(0, 1.6, 0); // eye height
    this._camera.lookAt(0, 1.6, -2);

    // Renderer
    this._renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.6;

    this._container.appendChild(this._renderer.domElement);
  }

  _initLights() {
    // Strong ambient for baseline visibility - no pitch-black areas
    const ambient = new THREE.AmbientLight(0x8090b8, 0.8);
    this._scene.add(ambient);

    // Soft hemisphere light: sky-blue from above, warm from below
    const hemi = new THREE.HemisphereLight(0xb0c4e8, 0x806040, 0.6);
    this._scene.add(hemi);

    // Gentle directional fill (like window light)
    const dirLight = new THREE.DirectionalLight(0xffe8d0, 0.4);
    dirLight.position.set(3, 5, 2);
    this._scene.add(dirLight);
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

    for (const cb of this._onUpdateCallbacks) {
      cb(deltaTime);
    }

    this._renderer.render(this._scene, this._camera);
  }
}
