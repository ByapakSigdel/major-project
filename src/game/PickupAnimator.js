/**
 * PickupAnimator - Reach & Grab animation system
 *
 * Drives the hand container through a state machine:
 *   idle → reaching → grabbing → retracting → done
 *
 * Timeline:
 *   0.0 – 0.4 s  REACHING  : hand moves forward, fingers splay open
 *   0.4 – 0.7 s  GRABBING  : fingers close to fist
 *   0.7 – 1.2 s  RETRACTING: hand pulls back, object shrinks/fades to inventory
 *   1.2 – 1.5 s  RELEASING : fingers return to sensor-driven values
 *
 * Returns a Promise so callers can `await animator.playPickup(...)`.
 */

import * as THREE from 'three';

// Duration constants (seconds)
const REACH_START   = 0.0;
const REACH_END     = 0.4;
const GRAB_END      = 0.7;
const RETRACT_END   = 1.2;
const RELEASE_END   = 1.5;

// How far forward the hand reaches (in local camera space)
const REACH_OFFSET = new THREE.Vector3(0, 0.05, -0.25);

const _v3 = new THREE.Vector3();

export class PickupAnimator {
  constructor() {
    /** @type {'idle'|'reaching'|'grabbing'|'retracting'|'releasing'} */
    this.state = 'idle';
    this._time = 0;
    this._resolve = null;

    // Snapshot of hand container position at animation start (world)
    this._startPos = new THREE.Vector3();
    // Target position to reach toward (world)
    this._reachTarget = new THREE.Vector3();
    // The object being picked up
    this._targetObject = null;
    // Original scale of target object
    this._targetOrigScale = new THREE.Vector3(1, 1, 1);

    // Override finger curls during animation (0 = straight, 1 = fist).
    // When null the hand uses sensor data as usual.
    /** @type {number|null} */
    this.fingerOverride = null;
  }

  /** True when an animation is in-flight */
  get isAnimating() {
    return this.state !== 'idle';
  }

  /**
   * Play a full reach-grab-retract sequence.
   *
   * @param {THREE.Object3D} handContainer – the hand container group
   * @param {THREE.Object3D} targetObject  – the world-space object to pick up
   * @param {THREE.Camera}   camera        – active camera (for reach direction)
   * @returns {Promise<void>} resolves when the animation finishes
   */
  playPickup(handContainer, targetObject, camera) {
    if (this.state !== 'idle') return Promise.resolve();

    return new Promise((resolve) => {
      this._resolve = resolve;
      this._time = 0;
      this._targetObject = targetObject;
      this._targetOrigScale.copy(targetObject.scale);
      this._startPos.copy(handContainer.position);

      // Reach target: a point between current hand and the object
      const objWorld = new THREE.Vector3();
      targetObject.getWorldPosition(objWorld);
      // Move 60% toward the object from the hand
      this._reachTarget.copy(this._startPos).lerp(objWorld, 0.6);

      this.state = 'reaching';
      this.fingerOverride = 0; // fingers open
    });
  }

  /**
   * Play a button-press animation (reach forward briefly, retract).
   * Lighter-weight than a full pickup.
   */
  playPress(handContainer, targetObject, camera) {
    if (this.state !== 'idle') return Promise.resolve();

    return new Promise((resolve) => {
      this._resolve = resolve;
      this._time = 0;
      this._targetObject = null; // no object to shrink
      this._startPos.copy(handContainer.position);

      const objWorld = new THREE.Vector3();
      targetObject.getWorldPosition(objWorld);
      this._reachTarget.copy(this._startPos).lerp(objWorld, 0.4);

      this.state = 'reaching';
      this.fingerOverride = 0.8; // fingers mostly closed for press
    });
  }

  /**
   * Must be called every frame from the render loop.
   *
   * @param {number} dt – delta time in seconds
   * @param {THREE.Object3D} handContainer – hand container to animate
   * @returns {{ positionOffset: THREE.Vector3 }|null}
   *   A world-space offset to ADD to the hand's normal camera-following position,
   *   or null when idle.
   */
  update(dt, handContainer) {
    if (this.state === 'idle') return null;

    this._time += dt;

    const offset = _v3.set(0, 0, 0);

    switch (this.state) {
      case 'reaching': {
        const t = Math.min((this._time - REACH_START) / (REACH_END - REACH_START), 1);
        const ease = t * t * (3 - 2 * t); // smoothstep

        // Move hand toward reach target
        offset.copy(this._reachTarget).sub(this._startPos).multiplyScalar(ease);

        // Fingers splay open
        this.fingerOverride = Math.max(0, 0.1 * (1 - ease));

        if (this._time >= REACH_END) {
          this.state = 'grabbing';
        }
        break;
      }

      case 'grabbing': {
        const t = Math.min((this._time - REACH_END) / (GRAB_END - REACH_END), 1);
        const ease = t * t;

        // Hold at reach target
        offset.copy(this._reachTarget).sub(this._startPos);

        // Close fingers to fist
        this.fingerOverride = ease;

        if (this._time >= GRAB_END) {
          this.state = 'retracting';
          // Hide the original object (it's been "grabbed")
          if (this._targetObject) {
            this._targetObject.visible = false;
          }
        }
        break;
      }

      case 'retracting': {
        const t = Math.min((this._time - GRAB_END) / (RETRACT_END - GRAB_END), 1);
        const ease = t * t * (3 - 2 * t);

        // Pull back from reach target to start
        const fullOffset = _v3.copy(this._reachTarget).sub(this._startPos);
        offset.copy(fullOffset).multiplyScalar(1 - ease);

        // Keep fist closed
        this.fingerOverride = 1;

        if (this._time >= RETRACT_END) {
          this.state = 'releasing';
        }
        break;
      }

      case 'releasing': {
        const t = Math.min((this._time - RETRACT_END) / (RELEASE_END - RETRACT_END), 1);
        const ease = t * t * (3 - 2 * t);

        // Hand back at rest, fingers release to neutral
        this.fingerOverride = 1 - ease * 0.7; // relax to ~0.3 (slightly curved neutral)
        offset.set(0, 0, 0);

        if (this._time >= RELEASE_END) {
          this._finish();
        }
        break;
      }
    }

    return { positionOffset: offset.clone() };
  }

  /** Cancel any in-progress animation immediately */
  cancel() {
    if (this.state !== 'idle') {
      this._finish();
    }
  }

  _finish() {
    this.state = 'idle';
    this.fingerOverride = null;
    this._targetObject = null;
    this._time = 0;
    if (this._resolve) {
      const r = this._resolve;
      this._resolve = null;
      r();
    }
  }
}
