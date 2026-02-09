/**
 * HandInteraction - Manages grab, throw, and interact mechanics
 * 
 * Uses finger bend data to detect:
 *   - Fist close = grab
 *   - Fist open while holding = throw
 *   - Pointing (index only) = interact/use
 * 
 * Objects can be picked up, carried, thrown at targets, and used on
 * interaction points (doors, locks, switches).
 */

import * as THREE from 'three';

const GRAB_THRESHOLD = 0.6;    // fingers above this = closed
const OPEN_THRESHOLD = 0.3;    // fingers below this = open
const GRAB_FINGERS = 3;        // minimum fingers closed to grab
const THROW_FORCE = 8;         // velocity multiplier for throwing
const CARRY_DISTANCE = 1.5;    // how far in front of camera to hold objects
const CARRY_HEIGHT = 1.4;      // height offset when carrying
const INTERACT_DISTANCE = 3.0; // max distance for interaction

export class HandInteraction {
  constructor(sceneManager) {
    this._scene = sceneManager;
    this._heldObject = null;
    this._isGrabbing = false;
    this._wasGrabbing = false;
    this._throwVelocity = new THREE.Vector3();
    this._thrownObjects = []; // { mesh, velocity, gravity }

    // Callbacks
    this._onGrab = null;
    this._onRelease = null;
    this._onInteract = null;
    this._onThrow = null;
  }

  /** Register callbacks */
  onGrab(cb) { this._onGrab = cb; }
  onRelease(cb) { this._onRelease = cb; }
  onInteract(cb) { this._onInteract = cb; }
  onThrow(cb) { this._onThrow = cb; }

  /** Currently held object */
  get heldObject() { return this._heldObject; }
  get isGrabbing() { return this._isGrabbing; }

  /**
   * Update hand interaction state from sensor data
   * Called every frame with the latest data
   */
  update(data, deltaTime) {
    if (!data || !data.fingers) return;

    const fingers = data.fingers;
    this._wasGrabbing = this._isGrabbing;

    // Count closed fingers
    let closedCount = 0;
    for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      if (fingers[name] >= GRAB_THRESHOLD) closedCount++;
    }

    this._isGrabbing = closedCount >= GRAB_FINGERS;

    // ---- Grab detection (transition: open -> closed) ----
    if (this._isGrabbing && !this._wasGrabbing) {
      if (!this._heldObject) {
        this._tryGrab();
      }
    }

    // ---- Release / Throw detection (transition: closed -> open) ----
    if (!this._isGrabbing && this._wasGrabbing) {
      if (this._heldObject) {
        this._release(data);
      }
    }

    // ---- Carry held object ----
    if (this._heldObject) {
      this._carryObject();
    }

    // ---- Update thrown objects physics ----
    this._updateThrownObjects(deltaTime);

    // ---- Detect pointing gesture for interaction ----
    const isPointing = fingers.index < OPEN_THRESHOLD &&
                       fingers.middle >= GRAB_THRESHOLD &&
                       fingers.ring >= GRAB_THRESHOLD &&
                       fingers.pinky >= GRAB_THRESHOLD;

    return {
      isGrabbing: this._isGrabbing,
      isHolding: this._heldObject !== null,
      isPointing,
      heldObject: this._heldObject,
    };
  }

  /** Try to grab the object we're looking at */
  _tryGrab() {
    const target = this._scene.getTargetObject();
    if (!target) return;
    if (target.distance > INTERACT_DISTANCE) return;

    const obj = target.object;
    if (!obj.userData.grabbable) return;

    this._heldObject = obj;

    // Store original position for potential reset
    obj.userData.originalPosition = obj.position.clone();
    obj.userData.originalRotation = obj.rotation.clone();

    if (this._onGrab) this._onGrab(obj);
  }

  /** Release held object (throw or drop) */
  _release(data) {
    if (!this._heldObject) return;
    const obj = this._heldObject;

    // Calculate throw direction from camera
    const camera = this._scene.camera;
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion);

    // Check if any fingers snapped open quickly (throw vs gentle drop)
    const avgBend = (data.fingers.index + data.fingers.middle + data.fingers.ring) / 3;
    const force = avgBend < 0.2 ? THROW_FORCE : 2; // fast open = throw, slow = drop

    const velocity = dir.multiplyScalar(force);
    velocity.y += 2; // slight upward arc

    this._thrownObjects.push({
      mesh: obj,
      velocity: velocity,
      time: 0,
    });

    if (this._onThrow) this._onThrow(obj, velocity);
    if (this._onRelease) this._onRelease(obj);

    this._heldObject = null;
  }

  /** Move held object to follow camera */
  _carryObject() {
    const camera = this._scene.camera;
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion);

    const targetPos = camera.position.clone().add(dir.multiplyScalar(CARRY_DISTANCE));
    targetPos.y = CARRY_HEIGHT;

    // Smooth follow
    this._heldObject.position.lerp(targetPos, 0.15);

    // Slight rotation to make it feel alive
    this._heldObject.rotation.y += 0.01;
  }

  /** Physics simulation for thrown objects */
  _updateThrownObjects(deltaTime) {
    const gravity = -9.8;
    const toRemove = [];

    for (const thrown of this._thrownObjects) {
      thrown.time += deltaTime;
      thrown.velocity.y += gravity * deltaTime;

      thrown.mesh.position.x += thrown.velocity.x * deltaTime;
      thrown.mesh.position.y += thrown.velocity.y * deltaTime;
      thrown.mesh.position.z += thrown.velocity.z * deltaTime;

      thrown.mesh.rotation.x += deltaTime * 2;
      thrown.mesh.rotation.z += deltaTime * 1.5;

      // Ground collision
      if (thrown.mesh.position.y < 0.1) {
        thrown.mesh.position.y = 0.1;
        thrown.velocity.y *= -0.3; // bounce
        thrown.velocity.x *= 0.7;
        thrown.velocity.z *= 0.7;
      }

      // Stop after a while
      if (thrown.time > 5 || thrown.velocity.length() < 0.1) {
        toRemove.push(thrown);
      }
    }

    for (const t of toRemove) {
      const idx = this._thrownObjects.indexOf(t);
      if (idx !== -1) this._thrownObjects.splice(idx, 1);
    }
  }

  /** Check if a thrown object hits a target area */
  checkThrowHit(targetPosition, radius) {
    for (const thrown of this._thrownObjects) {
      const dist = thrown.mesh.position.distanceTo(targetPosition);
      if (dist < radius) {
        return thrown.mesh;
      }
    }
    return null;
  }

  /** Interact with an object (use item, press button) */
  interact() {
    const target = this._scene.getTargetObject();
    if (!target || target.distance > INTERACT_DISTANCE) return null;

    const obj = target.object;
    if (obj.userData.interactive && this._onInteract) {
      this._onInteract(obj, this._heldObject);
    }
    return obj;
  }

  /** Drop held object back to original position */
  dropHeldObject() {
    if (!this._heldObject) return;
    const obj = this._heldObject;
    if (obj.userData.originalPosition) {
      obj.position.copy(obj.userData.originalPosition);
      obj.rotation.copy(obj.userData.originalRotation);
    }
    this._heldObject = null;
  }
}
