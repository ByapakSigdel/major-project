/**
 * SceneManager - Three.js scene setup and render loop
 * 
 * Handles:
 *   - Scene, camera, renderer, lights
 *   - Orbit controls for mouse interaction
 *   - Window resizing
 *   - FPS tracking
 *   - Render loop
 * 
 * This module is purely about rendering. It has no knowledge
 * of data sources or animation logic.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  /**
   * @param {HTMLElement} container - DOM element to render into
   */
  constructor(container) {
    this._container = container;
    this._onUpdateCallbacks = [];

    // FPS tracking
    this._frameCount = 0;
    this._lastFpsTime = performance.now();
    this._fps = 0;

    this._initScene();
    this._initLights();
    this._initControls();
    this._initResize();
  }

  /** Access the Three.js scene to add objects */
  get scene() {
    return this._scene;
  }

  /** Current measured FPS */
  get fps() {
    return this._fps;
  }

  /** Register a callback that runs every frame with deltaTime */
  onUpdate(callback) {
    this._onUpdateCallbacks.push(callback);
  }

  /** Start the render loop */
  start() {
    this._clock = new THREE.Clock();
    this._animate();
  }

  // ---- Init methods ----

  _initScene() {
    // Scene
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x161630);

    // Subtle fog for depth
    this._scene.fog = new THREE.FogExp2(0x0a0a1a, 0.15);

    // Camera
    this._camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this._camera.position.set(0, 1.5, 3);
    this._camera.lookAt(0, 0.5, 0);

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
    this._renderer.toneMappingExposure = 1.2;

    this._container.appendChild(this._renderer.domElement);

    // Ground plane for shadow catching
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x111122,
      roughness: 0.9,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this._scene.add(ground);

    // Grid helper for spatial reference
    const grid = new THREE.GridHelper(6, 20, 0x222244, 0x1a1a30);
    grid.position.y = -0.49;
    this._scene.add(grid);
  }

  _initLights() {
    // Ambient light for base visibility
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this._scene.add(ambient);

    // Key light (main directional)
    const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    keyLight.position.set(3, 5, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.top = 3;
    keyLight.shadow.camera.bottom = -3;
    this._scene.add(keyLight);

    // Fill light (softer, from the other side)
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    fillLight.position.set(-3, 3, -2);
    this._scene.add(fillLight);

    // Rim light (from behind for edge definition)
    const rimLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    rimLight.position.set(0, 2, -4);
    this._scene.add(rimLight);

    // Hemisphere light for natural ambient
    const hemiLight = new THREE.HemisphereLight(0x8080a0, 0x202040, 0.3);
    this._scene.add(hemiLight);
  }

  _initControls() {
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.target.set(0, 0.5, 0);
    this._controls.minDistance = 1;
    this._controls.maxDistance = 8;
    this._controls.update();
  }

  _initResize() {
    window.addEventListener('resize', () => {
      this._camera.aspect = window.innerWidth / window.innerHeight;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ---- Render loop ----

  _animate() {
    requestAnimationFrame(() => this._animate());

    const deltaTime = this._clock.getDelta();

    // Update FPS counter
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
    }

    // Run all update callbacks
    for (const cb of this._onUpdateCallbacks) {
      cb(deltaTime);
    }

    // Update orbit controls
    this._controls.update();

    // Render
    this._renderer.render(this._scene, this._camera);
  }
}
