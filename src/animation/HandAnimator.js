/**
 * HandAnimator - Maps sensor data to bone rotations
 * 
 * This is the bridge between raw data values and 3D bone transforms.
 * It is completely data-source-agnostic: it only receives data frames
 * in the standard format and applies them to bones.
 * 
 * Features:
 *   - Maps finger bend values (0-1) to anatomically correct joint angles
 *   - Uses quaternion-based rotation to avoid gimbal lock
 *   - Applies wrist orientation (roll, pitch, yaw) to the root bone
 *   - Smooth interpolation (lerp) to prevent jittery motion
 *   - Configurable joint angle limits
 * 
 * Coordinate System (WebXR Generic Hand model, after re-parenting):
 *   After re-parenting, each bone's local frame is:
 *     - Local -Z: along the bone toward the fingertip
 *     - Local X: roughly perpendicular, pointing laterally
 *     - Local Y: roughly perpendicular, pointing toward palm side
 *   Finger flexion (curl): rotation around local X-axis
 *     Positive X rotation = curl toward palm (flexion)
 *     Negative X rotation = extend away from palm (hyperextension)
 * 
 * Joint Anatomy:
 *   mcp = MCP joint (knuckle) — the proximal phalanx bone rotates here
 *   pip = PIP joint (middle)  — the intermediate phalanx bone rotates here
 *   dip = DIP joint (tip)     — the distal phalanx bone rotates here
 * 
 *   Thumb is special: its metacarpal is mobile (CMC joint), unlike other fingers.
 *   Thumb opposition involves rotation around both X (flexion) and Y (abduction).
 */

import * as THREE from 'three';
import { FINGER_NAMES } from '../rendering/HandModel.js';

// ---- Calibration Constants ----

const DEG_TO_RAD = Math.PI / 180;

/**
 * Hardware finger curl mapping.
 * 
 * Each finger's 0.0–1.0 curl drives 3 joints using PI multipliers:
 *   MCP (knuckle): curl * PI * 0.45
 *   PIP (middle):  curl * PI * 0.55
 *   DIP (tip):     curl * PI * 0.40
 * 
 * These values map the full curl range to natural flexion arcs
 * without exceeding anatomical limits.
 */
const FINGER_CURL_MULTIPLIERS = {
  mcp: Math.PI * 0.45,   // ~81° at full curl
  pip: Math.PI * 0.55,   // ~99° at full curl
  dip: Math.PI * 0.40,   // ~72° at full curl
};

/**
 * Thumb curl mapping — uses the same 3-joint structure but with
 * separate base offsets on all 3 axes and additional curl influence
 * on Y (opposition) and Z (roll).
 * 
 * Base offsets position the thumb at rest; curl adds flexion + opposition.
 */
const THUMB_BASE_OFFSETS = {
  mcp: { x: -0.2, y: -0.4, z: 0.3 },   // CMC base pose (radians)
  pip: { x: -0.1, y: 0, z: 0 },          // MCP base
  dip: { x: -0.1, y: 0, z: 0 },          // IP base
};
const THUMB_CURL_MULTIPLIERS = {
  mcp: { x: Math.PI * 0.35, y: Math.PI * 0.25, z: Math.PI * 0.15 },
  pip: { x: Math.PI * 0.45, y: 0, z: 0 },
  dip: { x: Math.PI * 0.40, y: 0, z: 0 },
};

/**
 * Smoothing factor for lerp interpolation.
 * Lower = smoother but more latency. Higher = more responsive but jittery.
 */
const DEFAULT_SMOOTHING = 0.15;

/**
 * Natural MCP abduction (finger splay) angles in radians.
 * When fingers curl into a fist, they naturally converge toward the
 * palm center. This maps each finger's Y-axis rotation at the MCP joint.
 */
const MCP_ABDUCTION = {
  index:  5 * DEG_TO_RAD,    // converge inward when curling
  middle: 0,                  // middle finger is the reference axis
  ring:   -5 * DEG_TO_RAD,   // converge inward
  pinky:  -10 * DEG_TO_RAD,  // most convergence
};

/**
 * Rest splay — fingers fan out when extended.
 * Applied as a constant Z-axis rotation on MCP regardless of bend.
 * Using Z-axis because in bone-local space (bones along -Z),
 * Z rotation spreads fingers laterally.
 */
const REST_SPLAY = {
  index:  8 * DEG_TO_RAD,    // outward from middle
  middle: 2 * DEG_TO_RAD,
  ring:   -4 * DEG_TO_RAD,   // outward from middle (other direction)
  pinky:  -12 * DEG_TO_RAD,  // most outward
};

/**
 * Per-joint bend distribution.
 * With the new PI multiplier system, distribution is baked into the multipliers.
 * Metacarpal still gets a gentle engagement for palm deformation.
 */
const JOINT_DISTRIBUTION = {
  meta: 0.3,   // metacarpal engages gently for palm deformation
};

// Reusable objects (avoid allocations in the render loop hot path)
const _curlQuat = new THREE.Quaternion();
const _restQuat = new THREE.Quaternion();
const _abductQuat = new THREE.Quaternion();
const _splayQuat = new THREE.Quaternion();
const _orientQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

export class HandAnimator {
  /**
   * @param {Object} bones - Map of bone names to THREE.Bone objects
   * @param {number} smoothing - Interpolation factor (0-1)
   */
  constructor(bones, smoothing = DEFAULT_SMOOTHING) {
    this._bones = bones;
    this._smoothing = smoothing;

    // When true, wrist orientation from IMU is NOT applied to the wrist bone.
    // Used in game mode where orientation is applied to the container instead.
    this._skipWristOrientation = false;

    // Current interpolated state (what's actually displayed)
    this._currentState = this._createEmptyState();
    // Target state (where we're interpolating toward)
    this._targetState = this._createEmptyState();

    // Store rest poses for all bones (quaternion-based for precision)
    this._restPoses = {};
    for (const [name, bone] of Object.entries(bones)) {
      this._restPoses[name] = {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone(),
      };
    }

    // Debug axis helpers (toggle with toggleDebugAxes())
    this._debugAxes = [];
    this._debugVisible = false;
  }

  /** Enable/disable wrist orientation application on the wrist bone */
  set skipWristOrientation(value) {
    this._skipWristOrientation = !!value;
  }

  get skipWristOrientation() {
    return this._skipWristOrientation;
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

  /**
   * Toggle debug axis helpers on all bones.
   * Red = X, Green = Y, Blue = Z.
   * Useful for verifying which axis is the curl axis.
   */
  toggleDebugAxes() {
    this._debugVisible = !this._debugVisible;

    if (this._debugVisible && this._debugAxes.length === 0) {
      // Create axes helpers for each bone
      for (const [name, bone] of Object.entries(this._bones)) {
        const axisSize = name === 'wrist' ? 0.05 : 0.03;
        const helper = new THREE.AxesHelper(axisSize);
        helper.name = `debug_axes_${name}`;
        bone.add(helper);
        this._debugAxes.push(helper);
      }
    }

    for (const helper of this._debugAxes) {
      helper.visible = this._debugVisible;
    }

    console.log(`Debug axes: ${this._debugVisible ? 'ON' : 'OFF'}`);
    return this._debugVisible;
  }

  // ---- Internal application methods ----

  /**
   * Apply finger bend values to finger bones using the hardware curl mapping.
   * 
   * Each finger's 0.0–1.0 curl drives 3 joints:
   *   MCP = curl * PI * 0.45
   *   PIP = curl * PI * 0.55
   *   DIP = curl * PI * 0.40
   * 
   * Thumb uses separate base offsets + curl influence on X/Y/Z.
   * 
   * Metacarpal bones (non-thumb) get a small engagement for palm deformation.
   * MCP joints also get subtle abduction (finger splay) and rest splay.
   * 
   * Formula: bone.quaternion = restQuat * [splay] * [abduct] * curlQuat
   */
  _applyFingerRotations() {
    for (const finger of FINGER_NAMES) {
      // Clamp bend value to [0.1, 1.0] before applying to joints.
      const rawBend = this._currentState.fingers[finger];
      const bendValue = Math.max(0.1, Math.min(1.0, rawBend));
      const isThumb = finger === 'thumb';

      // Thumb has no separate metacarpal; others include meta
      const joints = isThumb ? ['mcp', 'pip', 'dip'] : ['meta', 'mcp', 'pip', 'dip'];

      for (const joint of joints) {
        const boneName = `${finger}_${joint}`;
        const bone = this._bones[boneName];
        if (!bone) continue;

        const rest = this._restPoses[boneName];
        if (!rest) continue;

        if (isThumb) {
          this._applyThumbRotation(bone, rest, joint, bendValue);
        } else if (joint === 'meta') {
          // Metacarpal: small engagement for palm deformation
          const distribution = JOINT_DISTRIBUTION.meta;
          const curlAngle = -(bendValue * distribution * FINGER_CURL_MULTIPLIERS.mcp);
          _restQuat.copy(rest.quaternion);
          _curlQuat.setFromAxisAngle(_xAxis, curlAngle);
          bone.quaternion.copy(_restQuat).multiply(_curlQuat);
        } else {
          // MCP, PIP, DIP: use PI multipliers directly
          const maxAngle = FINGER_CURL_MULTIPLIERS[joint];
          const curlAngle = -(bendValue * maxAngle);

          _restQuat.copy(rest.quaternion);
          _curlQuat.setFromAxisAngle(_xAxis, curlAngle);

          if (joint === 'mcp') {
            // MCP gets rest splay (Z) and dynamic abduction (Y)
            const restSplay = REST_SPLAY[finger] || 0;
            const dynamicAbduction = (MCP_ABDUCTION[finger] || 0) * bendValue;

            _splayQuat.setFromAxisAngle(_zAxis, restSplay);
            _abductQuat.setFromAxisAngle(_yAxis, dynamicAbduction);

            bone.quaternion.copy(_restQuat)
              .multiply(_splayQuat)
              .multiply(_abductQuat)
              .multiply(_curlQuat);
          } else {
            bone.quaternion.copy(_restQuat).multiply(_curlQuat);
          }
        }
      }
    }
  }

  /**
   * Apply thumb rotation with base offsets and curl influence on Y/Z.
   * 
   * The thumb has separate base offsets on all 3 axes for each joint,
   * plus additional curl influence:
   *   - MCP (CMC): base X/Y/Z + curl * multiplier on X, Y (opposition), Z (roll)
   *   - PIP (MCP): base X + curl * multiplier on X
   *   - DIP (IP):  base X + curl * multiplier on X
   * 
   * This gives natural thumb posture at rest and progressive opposition
   * when curling into a fist.
   */
  _applyThumbRotation(bone, rest, joint, bendValue) {
    _restQuat.copy(rest.quaternion);

    const base = THUMB_BASE_OFFSETS[joint];
    const mult = THUMB_CURL_MULTIPLIERS[joint];

    // Compute total rotation = base + curl * multiplier per axis
    const rx = base.x + bendValue * (-mult.x);   // flexion (negative X = curl toward palm)
    const ry = base.y + bendValue * (-mult.y);    // opposition (Y)
    const rz = base.z + bendValue * mult.z;        // roll (Z)

    _euler.set(rx, ry, rz, 'YXZ');
    _curlQuat.setFromEuler(_euler);

    bone.quaternion.copy(_restQuat).multiply(_curlQuat);
  }

  /**
   * Apply wrist orientation to the wrist bone.
   * Uses quaternion composition to avoid gimbal lock.
   * 
   * The wrist bone's rest pose defines its default orientation.
   * We apply roll/pitch/yaw as incremental rotations on top.
   * 
   * When _skipWristOrientation is true (game mode), the wrist bone
   * is left at its rest pose — orientation is applied to the container instead.
   */
  _applyWristOrientation() {
    const wrist = this._bones['wrist'];
    if (!wrist) return;

    const rest = this._restPoses['wrist'];
    if (!rest) return;

    if (this._skipWristOrientation) {
      // In game mode: keep wrist at rest pose, orientation is handled externally
      wrist.quaternion.copy(rest.quaternion);
      return;
    }

    const { roll, pitch, yaw } = this._currentState.orientation;

    // Build orientation quaternion from Euler angles (in radians)
    _euler.set(
      pitch * DEG_TO_RAD,   // pitch around X
      yaw * DEG_TO_RAD,     // yaw around Y
      roll * DEG_TO_RAD,    // roll around Z
      'YXZ'                 // yaw first, then pitch, then roll
    );
    _orientQuat.setFromEuler(_euler);

    // Compose: restQuat * orientationQuat
    wrist.quaternion.copy(rest.quaternion).multiply(_orientQuat);
  }
}
