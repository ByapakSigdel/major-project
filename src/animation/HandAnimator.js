/**
 * HandAnimator - Maps sensor data to bone rotations
 * 
 * This is the bridge between raw data values and 3D bone transforms.
 * It is completely data-source-agnostic: it only receives data frames
 * in the standard format and applies them to bones.
 * 
 * Features:
 *   - Maps finger bend values (0-1) to anatomically correct joint angles
 *   - Applies wrist orientation (roll, pitch, yaw) to the root bone
 *   - Smooth interpolation (lerp) to prevent jittery motion
 *   - Configurable joint angle limits
 */

import * as THREE from 'three';
import { FINGER_NAMES } from '../rendering/HandModel.js';

// ---- Calibration Constants ----
// These define how sensor values map to joint rotation angles (radians).
// Adjust these when calibrating with real hardware.

const DEG_TO_RAD = Math.PI / 180;

/**
 * Maximum bend angle (radians) for each joint type.
 * MCP (knuckle) bends the most, DIP (fingertip) the least.
 * Real human ranges: MCP ~90deg, PIP ~110deg, DIP ~80deg
 */
const JOINT_MAX_ANGLES = {
  mcp: 90 * DEG_TO_RAD,   // knuckle joint
  pip: 110 * DEG_TO_RAD,  // middle joint
  dip: 80 * DEG_TO_RAD,   // fingertip joint
};

/**
 * Thumb has different mechanics - it rotates on a different axis
 * and has more limited range.
 */
const THUMB_MAX_ANGLES = {
  mcp: 60 * DEG_TO_RAD,
  pip: 70 * DEG_TO_RAD,
  dip: 50 * DEG_TO_RAD,
};

/**
 * Smoothing factor for lerp interpolation.
 * Lower = smoother but more latency. Higher = more responsive but jittery.
 * Typically 0.1-0.3 for sensor data, 0.5+ for synthetic.
 */
const DEFAULT_SMOOTHING = 0.15;

export class HandAnimator {
  /**
   * @param {Object} bones - Map of bone names to THREE.Bone objects
   * @param {number} smoothing - Interpolation factor (0-1)
   */
  constructor(bones, smoothing = DEFAULT_SMOOTHING) {
    this._bones = bones;
    this._smoothing = smoothing;

    // Current interpolated state (what's actually displayed)
    this._currentState = this._createEmptyState();
    // Target state (where we're interpolating toward)
    this._targetState = this._createEmptyState();

    // Store rest poses for all bones (for additive blending)
    this._restPoses = {};
    for (const [name, bone] of Object.entries(bones)) {
      this._restPoses[name] = {
        rotation: bone.rotation.clone(),
        position: bone.position.clone(),
      };
    }
  }

  /** Smoothing factor getter/setter */
  get smoothing() {
    return this._smoothing;
  }

  set smoothing(value) {
    this._smoothing = Math.max(0.01, Math.min(1.0, value));
  }

  /** Create a blank state object */
  _createEmptyState() {
    return {
      fingers: {
        thumb: 0,
        index: 0,
        middle: 0,
        ring: 0,
        pinky: 0,
      },
      orientation: {
        roll: 0,
        pitch: 0,
        yaw: 0,
      },
    };
  }

  /**
   * Receive a new data frame and set it as the interpolation target.
   * Called by the data source listener.
   */
  applyFrame(data) {
    if (data.fingers) {
      for (const name of FINGER_NAMES) {
        if (data.fingers[name] !== undefined) {
          this._targetState.fingers[name] = data.fingers[name];
        }
      }
    }
    if (data.orientation) {
      if (data.orientation.roll !== undefined)
        this._targetState.orientation.roll = data.orientation.roll;
      if (data.orientation.pitch !== undefined)
        this._targetState.orientation.pitch = data.orientation.pitch;
      if (data.orientation.yaw !== undefined)
        this._targetState.orientation.yaw = data.orientation.yaw;
    }
  }

  /**
   * Update animation state - call this every render frame.
   * Interpolates current state toward target and applies to bones.
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    const alpha = 1.0 - Math.pow(1.0 - this._smoothing, deltaTime * 60);

    // Interpolate finger bend values
    for (const name of FINGER_NAMES) {
      this._currentState.fingers[name] = THREE.MathUtils.lerp(
        this._currentState.fingers[name],
        this._targetState.fingers[name],
        alpha
      );
    }

    // Interpolate orientation
    this._currentState.orientation.roll = THREE.MathUtils.lerp(
      this._currentState.orientation.roll,
      this._targetState.orientation.roll,
      alpha
    );
    this._currentState.orientation.pitch = THREE.MathUtils.lerp(
      this._currentState.orientation.pitch,
      this._targetState.orientation.pitch,
      alpha
    );
    this._currentState.orientation.yaw = THREE.MathUtils.lerp(
      this._currentState.orientation.yaw,
      this._targetState.orientation.yaw,
      alpha
    );

    // Apply to bones
    this._applyFingerRotations();
    this._applyWristOrientation();
  }

  /** Get current interpolated state (for debug display) */
  get currentState() {
    return this._currentState;
  }

  // ---- Internal application methods ----

  /** Apply finger bend values to finger bones */
  _applyFingerRotations() {
    for (const finger of FINGER_NAMES) {
      const bendValue = this._currentState.fingers[finger];
      const isThumb = finger === 'thumb';
      const maxAngles = isThumb ? THUMB_MAX_ANGLES : JOINT_MAX_ANGLES;

      const joints = ['mcp', 'pip', 'dip'];

      for (const joint of joints) {
        const boneName = `${finger}_${joint}`;
        const bone = this._bones[boneName];
        if (!bone) continue;

        const rest = this._restPoses[boneName];
        if (!rest) continue;

        // Calculate joint angle from bend value.
        // bend 0 = straight (rest pose), bend 1 = fully curled.
        // Each joint bends to its own anatomical maximum.
        const maxAngle = maxAngles[joint];
        const clampedAngle = bendValue * maxAngle;

        if (isThumb) {
          // Thumb bends differently - primarily around Z axis with some X
          bone.rotation.x = rest.rotation.x;
          bone.rotation.y = rest.rotation.y;
          bone.rotation.z = rest.rotation.z - clampedAngle * 0.7;
          if (joint === 'mcp') {
            bone.rotation.x = rest.rotation.x - clampedAngle * 0.3;
          }
        } else {
          // Regular fingers bend around X axis (curl inward)
          bone.rotation.x = rest.rotation.x - clampedAngle;
          bone.rotation.y = rest.rotation.y;
          bone.rotation.z = rest.rotation.z;
        }
      }
    }
  }

  /** Apply wrist orientation to the wrist bone */
  _applyWristOrientation() {
    const wrist = this._bones['wrist'];
    if (!wrist) return;

    const rest = this._restPoses['wrist'];
    if (!rest) return;

    const { roll, pitch, yaw } = this._currentState.orientation;

    // Apply orientation as Euler angles (in radians)
    wrist.rotation.x = rest.rotation.x + pitch * DEG_TO_RAD;
    wrist.rotation.y = rest.rotation.y + yaw * DEG_TO_RAD;
    wrist.rotation.z = rest.rotation.z + roll * DEG_TO_RAD;
  }
}
