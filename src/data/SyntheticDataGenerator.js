/**
 * SyntheticDataGenerator - Generates realistic hand motion data
 * 
 * Produces data in the exact same format that real hardware will send,
 * so the animation layer doesn't need to know the difference.
 * 
 * Motion modes:
 *   - fist:       smooth open/close fist cycle
 *   - wave:       sequential finger wave pattern
 *   - individual: one finger moves at a time
 *   - random:     natural random-looking motion (Perlin-like noise)
 *   - peace:      peace sign (index + middle extended)
 *   - counting:   count from 1 to 5 by extending fingers
 */

import { DataSource } from './DataSource.js';

// ---- Helpers ----

/** Attempt a smooth noise function using summed sine waves */
function smoothNoise(t, seed) {
  return (
    Math.sin(t * 1.0 + seed * 1.7) * 0.4 +
    Math.sin(t * 2.3 + seed * 3.1) * 0.25 +
    Math.sin(t * 4.7 + seed * 0.3) * 0.15 +
    Math.sin(t * 0.5 + seed * 5.9) * 0.2
  );
}

/** Clamp a value between min and max */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Smooth step for nice transitions */
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}


export class SyntheticDataGenerator extends DataSource {
  /**
   * @param {Object} options
   * @param {string} options.mode - Motion mode (fist, wave, individual, random, peace, counting)
   * @param {number} options.updateRate - Updates per second (Hz)
   * @param {number} options.speed - Animation speed multiplier
   */
  constructor(options = {}) {
    super();
    this._mode = options.mode || 'fist';
    this._updateRate = options.updateRate || 30;
    this._speed = options.speed || 1.0;
    this._intervalId = null;
    this._startTime = 0;
  }

  get sourceType() {
    return 'synthetic';
  }

  /** Set the motion pattern mode */
  set mode(value) {
    this._mode = value;
  }

  get mode() {
    return this._mode;
  }

  /** Set the update rate in Hz */
  set updateRate(hz) {
    this._updateRate = clamp(hz, 1, 120);
    // If running, restart with new rate
    if (this._running) {
      this._stopInterval();
      this._startInterval();
    }
  }

  get updateRate() {
    return this._updateRate;
  }

  /** Set the animation speed multiplier */
  set speed(value) {
    this._speed = clamp(value, 0.1, 5.0);
  }

  get speed() {
    return this._speed;
  }

  start() {
    super.start();
    this._startTime = performance.now();
    this._startInterval();
  }

  stop() {
    super.stop();
    this._stopInterval();
  }

  _startInterval() {
    const intervalMs = 1000 / this._updateRate;
    this._intervalId = setInterval(() => this._tick(), intervalMs);
  }

  _stopInterval() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /** Generate one frame of synthetic data based on current mode */
  _tick() {
    const elapsed = (performance.now() - this._startTime) / 1000 * this._speed;
    const data = this._generateFrame(elapsed);
    this._notifyListeners(data);
  }

  /**
   * Generate a data frame for the given time value.
   * All modes output the same format.
   */
  _generateFrame(t) {
    let fingers;
    let orientation;

    switch (this._mode) {
      case 'fist':
        fingers = this._modeFist(t);
        break;
      case 'wave':
        fingers = this._modeWave(t);
        break;
      case 'individual':
        fingers = this._modeIndividual(t);
        break;
      case 'random':
        fingers = this._modeRandom(t);
        break;
      case 'peace':
        fingers = this._modePeace(t);
        break;
      case 'counting':
        fingers = this._modeCounting(t);
        break;
      default:
        fingers = this._modeFist(t);
    }

    // Generate subtle wrist orientation for all modes
    orientation = this._generateOrientation(t);

    return {
      fingers,
      orientation,
      timestamp: Date.now(),
    };
  }

  // ---- Motion Modes ----

  /** All fingers open and close together */
  _modeFist(t) {
    const cycle = (Math.sin(t * 1.5) + 1) / 2; // 0 to 1 oscillation
    return {
      thumb:  clamp(cycle * 0.85, 0, 1),
      index:  clamp(cycle, 0, 1),
      middle: clamp(cycle, 0, 1),
      ring:   clamp(cycle, 0, 1),
      pinky:  clamp(cycle, 0, 1),
    };
  }

  /** Sequential wave - fingers curl one after another */
  _modeWave(t) {
    const period = 2.5; // seconds per full wave
    const offset = 0.3; // delay between fingers in seconds
    const names = ['index', 'middle', 'ring', 'pinky', 'thumb'];

    const fingers = {};
    for (let i = 0; i < names.length; i++) {
      const phase = (t - i * offset) / period;
      const v = (Math.sin(phase * Math.PI * 2) + 1) / 2;
      fingers[names[i]] = clamp(v, 0, 1);
    }
    return fingers;
  }

  /** One finger at a time curls and uncurls */
  _modeIndividual(t) {
    const names = ['thumb', 'index', 'middle', 'ring', 'pinky'];
    const cycleDuration = 2.0; // seconds per finger
    const totalCycle = cycleDuration * names.length;
    const phase = t % totalCycle;
    const activeIndex = Math.floor(phase / cycleDuration);
    const withinPhase = (phase % cycleDuration) / cycleDuration;

    const fingers = {};
    for (let i = 0; i < names.length; i++) {
      if (i === activeIndex) {
        // Active finger: bell curve
        fingers[names[i]] = clamp(Math.sin(withinPhase * Math.PI), 0, 1);
      } else {
        fingers[names[i]] = 0;
      }
    }
    return fingers;
  }

  /** Perlin-like natural random motion */
  _modeRandom(t) {
    return {
      thumb:  clamp((smoothNoise(t, 0) + 1) / 2, 0, 1),
      index:  clamp((smoothNoise(t, 1) + 1) / 2, 0, 1),
      middle: clamp((smoothNoise(t, 2) + 1) / 2, 0, 1),
      ring:   clamp((smoothNoise(t, 3) + 1) / 2, 0, 1),
      pinky:  clamp((smoothNoise(t, 4) + 1) / 2, 0, 1),
    };
  }

  /** Peace sign - index and middle extended, others curled */
  _modePeace(t) {
    const breathe = Math.sin(t * 2) * 0.05; // subtle motion
    return {
      thumb:  clamp(0.7 + breathe, 0, 1),
      index:  clamp(0.05 + breathe, 0, 1),
      middle: clamp(0.05 + breathe, 0, 1),
      ring:   clamp(0.85 + breathe, 0, 1),
      pinky:  clamp(0.85 + breathe, 0, 1),
    };
  }

  /** Count 1-5 by extending fingers sequentially */
  _modeCounting(t) {
    const stepDuration = 1.5; // seconds per count
    const totalCycle = stepDuration * 6; // 0-5 then pause
    const phase = t % totalCycle;
    const count = Math.min(5, Math.floor(phase / stepDuration));
    const transition = (phase % stepDuration) / stepDuration;
    const ease = smoothstep(0, 0.3, transition);

    // Order: index, middle, ring, pinky, thumb
    const order = ['index', 'middle', 'ring', 'pinky', 'thumb'];
    const fingers = {};

    for (let i = 0; i < order.length; i++) {
      if (i < count) {
        fingers[order[i]] = 0; // fully extended
      } else if (i === count) {
        fingers[order[i]] = clamp(1 - ease, 0, 1); // transitioning
      } else {
        fingers[order[i]] = 1; // fully bent
      }
    }

    return fingers;
  }

  // ---- Orientation ----

  /** Generate subtle wrist orientation (simulates natural hand sway) */
  _generateOrientation(t) {
    return {
      roll:  smoothNoise(t * 0.7, 10) * 15,    // +-15 degrees
      pitch: smoothNoise(t * 0.5, 20) * 10,    // +-10 degrees
      yaw:   smoothNoise(t * 0.3, 30) * 20,    // +-20 degrees
    };
  }
}
