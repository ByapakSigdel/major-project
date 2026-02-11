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
 * Anatomically correct maximum bend angles (radians) for each joint type.
 * 
 * Real human ranges (approximate):
 *   MCP (knuckle): ~90° flexion
 *   PIP (middle):  ~100-110° flexion
 *   DIP (tip):     ~70-80° flexion
 * 
 * Reduced from true anatomical ranges to avoid mesh self-intersection
 * with the WebXR Generic Hand model.
 */
const JOINT_MAX_ANGLES = {
  meta: 15 * DEG_TO_RAD,  // metacarpal: small flexion for smooth palm deformation
  mcp: 50 * DEG_TO_RAD,   // proximal phalanx at MCP joint
  pip: 55 * DEG_TO_RAD,   // intermediate phalanx at PIP joint
  dip: 35 * DEG_TO_RAD,   // distal phalanx at DIP joint
};

/**
 * Thumb joint angles.
 * 
 * Thumb anatomy is unique:
 *   CMC joint (metacarpal): ~50° flexion + opposition (rotation)
 *   MCP joint (proximal):   ~60° flexion
 *   IP joint (distal):      ~80° flexion
 * 
 * In our mapping:
 *   mcp = thumb metacarpal (CMC joint) — includes opposition
 *   pip = thumb proximal phalanx (MCP joint)
 *   dip = thumb distal phalanx (IP joint)
 */
const THUMB_MAX_ANGLES = {
  mcp: 25 * DEG_TO_RAD,   // CMC joint (metacarpal flexion + opposition)
  pip: 30 * DEG_TO_RAD,   // MCP joint (proximal flexion)
  dip: 35 * DEG_TO_RAD,   // IP joint (distal flexion)
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
 * In real hands, joints don't all bend equally from the same input.
 * The PIP (middle) joint leads, then MCP, then DIP follows.
 * Values are multipliers on the bend input (0-1).
 */
const JOINT_DISTRIBUTION = {
  meta: 0.5,   // metacarpal engages gently (half the bend value)
  mcp: 1.0,    // MCP leads the curl (knuckle bends first)
  pip: 0.9,    // PIP follows closely
  dip: 0.6,    // DIP follows passively (distal joint bends least)
};

// Reusable objects (avoid allocations in the render loop hot path)
const _curlQuat = new THREE.Quaternion();
const _restQuat = new THREE.Quaternion();
const _oppositionQuat = new THREE.Quaternion();
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
   * Apply finger bend values to finger bones using quaternion rotation.
   * 
   * After re-parenting, bones extend along local -Z. Flexion (curling toward
   * palm) is achieved by POSITIVE rotation around the local X-axis.
   * 
   * Each joint in the chain bends with weighted distribution:
   *   - meta: metacarpal (small flex for smooth palm deformation) — 50% of input
   *   - MCP: the "knuckle" bend (proximal phalanx bone) — 100% of input (leads)
   *   - PIP: middle joint (intermediate phalanx bone)   — 90% of input
   *   - DIP: fingertip joint (distal phalanx bone)      — 60% of input (follows)
   * 
   * MCP joints also get subtle abduction (finger splay) that increases with
   * curl, causing fingers to naturally converge when making a fist.
   * 
   * Formula: bone.quaternion = restQuat * abductQuat * curlQuat
   */
  _applyFingerRotations() {
    for (const finger of FINGER_NAMES) {
      const bendValue = this._currentState.fingers[finger];
      const isThumb = finger === 'thumb';
      const maxAngles = isThumb ? THUMB_MAX_ANGLES : JOINT_MAX_ANGLES;

      // Thumb has no separate metacarpal mapping (its metacarpal IS the mcp)
      const joints = isThumb ? ['mcp', 'pip', 'dip'] : ['meta', 'mcp', 'pip', 'dip'];

      for (const joint of joints) {
        const boneName = `${finger}_${joint}`;
        const bone = this._bones[boneName];
        if (!bone) continue;

        const rest = this._restPoses[boneName];
        if (!rest) continue;

        const maxAngle = maxAngles[joint];

        if (isThumb) {
          this._applyThumbRotation(bone, rest, joint, bendValue, maxAngle);
        } else {
          // Apply per-joint distribution (PIP leads, DIP follows)
          const distribution = JOINT_DISTRIBUTION[joint] || 1.0;
          const effectiveBend = Math.min(1.0, bendValue * distribution);
          
          // Flexion: negative X rotation = curl toward palm
          // (bones extend along -Z; after scene rotation the visual "toward palm"
          //  direction corresponds to -X rotation in bone-local space)
          const curlAngle = -(effectiveBend * maxAngle);
          
          _restQuat.copy(rest.quaternion);
          _curlQuat.setFromAxisAngle(_xAxis, curlAngle);
          
          if (joint === 'mcp') {
            // MCP gets:
            //   1. Rest splay (Z-axis) — constant spread when extended
            //   2. Dynamic abduction (Y-axis) — convergence during curl
            const restSplay = REST_SPLAY[finger] || 0;
            const dynamicAbduction = (MCP_ABDUCTION[finger] || 0) * bendValue;
            
            _splayQuat.setFromAxisAngle(_zAxis, restSplay);
            _abductQuat.setFromAxisAngle(_yAxis, dynamicAbduction);
            
            // Compose: rest * splay * abduction * curl
            bone.quaternion.copy(_restQuat)
              .multiply(_splayQuat)
              .multiply(_abductQuat)
              .multiply(_curlQuat);
          } else {
            // PIP and DIP: pure flexion
            bone.quaternion.copy(_restQuat).multiply(_curlQuat);
          }
        }
      }
    }
  }

  /**
   * Apply thumb rotation with proper opposition mechanics.
   * 
   * The thumb is anatomically unique:
   *   - CMC joint (mapped to mcp): has 2 degrees of freedom
   *     - Flexion (curl toward palm) around local X
   *     - Opposition/adduction (rotate toward fingers) around local Y
   *     The opposition engages progressively: starts gentle, accelerates
   *     with more bend. This mimics real thumb behavior — light touch
   *     uses mostly flexion, tight fist adds strong opposition.
   *   - MCP joint (mapped to pip): primarily flexion around X
   *   - IP joint (mapped to dip): primarily flexion around X
   * 
   * When making a fist, the thumb both curls AND rotates inward.
   * The opposition uses an eased curve (quadratic) rather than linear
   * for more natural motion.
   */
  _applyThumbRotation(bone, rest, joint, bendValue, maxAngle) {
    _restQuat.copy(rest.quaternion);

    if (joint === 'mcp') {
      // Thumb CMC (metacarpal): flexion + opposition

      // Flexion: rotate around -X (curl toward palm)
      const flexAngle = -(bendValue * maxAngle);
      _curlQuat.setFromAxisAngle(_xAxis, flexAngle);
      
      // Opposition: rotate around Y (adduct toward other fingers)
      // Use quadratic easing: opposition engages more at higher bend values.
      // This prevents the thumb from rotating weirdly at low bend values
      // while still achieving good opposition for a full fist.
      const easedBend = bendValue * bendValue;  // quadratic ease-in
      const oppositionAngle = -easedBend * maxAngle * 0.6;
      _oppositionQuat.setFromAxisAngle(_yAxis, oppositionAngle);
      
      // Compose: rest * opposition * flexion
      // Opposition first (gross rotation), then flexion (fine curl)
      bone.quaternion.copy(_restQuat).multiply(_oppositionQuat).multiply(_curlQuat);
    } else {
      // Thumb MCP (pip) and IP (dip): pure flexion (negative X)
      const curlAngle = -(bendValue * maxAngle);
      _curlQuat.setFromAxisAngle(_xAxis, curlAngle);
      bone.quaternion.copy(_restQuat).multiply(_curlQuat);
    }
  }

  /**
   * Apply wrist orientation to the wrist bone.
   * Uses quaternion composition to avoid gimbal lock.
   * 
   * The wrist bone's rest pose defines its default orientation.
   * We apply roll/pitch/yaw as incremental rotations on top.
   */
  _applyWristOrientation() {
    const wrist = this._bones['wrist'];
    if (!wrist) return;

    const rest = this._restPoses['wrist'];
    if (!rest) return;

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
