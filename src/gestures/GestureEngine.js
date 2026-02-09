/**
 * GestureEngine - Rule-based hand gesture recognition
 * 
 * Detects predefined hand gestures from finger bend + orientation data.
 * Each gesture is defined as a set of finger range constraints.
 * 
 * This module provides a PLACEHOLDER recognition system.
 * The architecture is designed so that a trained ML model can replace
 * the rule-based matching later:
 * 
 *   To add ML:
 *   1. Create MLGestureEngine implementing the same interface
 *   2. In classify(), pass the data frame to your model
 *   3. Return { gesture, confidence } from the model's output
 *   4. Swap in main.js: const gestureEngine = new MLGestureEngine(modelPath)
 * 
 * Supported gestures:
 *   - open_hand       (all fingers extended)
 *   - fist             (all fingers closed)
 *   - thumbs_up        (thumb up, others closed)
 *   - thumbs_down      (thumb up + wrist rotated, others closed)
 *   - peace / victory  (index + middle up, others closed)
 *   - point            (index up, others closed)
 *   - rock             (index + pinky up, others closed)
 *   - ok_sign          (thumb + index touching, others up)
 *   - call_me          (thumb + pinky up, others closed)
 *   - three            (index + middle + ring up)
 *   - four             (all except thumb up)
 *   - middle_finger    (middle up, others closed)
 */

// ---- Gesture Definitions ----

/**
 * Each gesture is defined by finger ranges and optional orientation.
 * 
 * Finger value: 0 = fully open, 1 = fully closed
 *   'open'   = value < 0.3
 *   'closed' = value > 0.6
 *   'any'    = don't care
 * 
 * Format: { name, display, emoji, fingers: { thumb, index, middle, ring, pinky }, orientation? }
 */
const GESTURE_DEFS = [
  {
    name: 'open_hand',
    display: 'Open Hand',
    emoji: '\u{1F590}',
    description: 'All fingers extended',
    fingers: { thumb: 'open', index: 'open', middle: 'open', ring: 'open', pinky: 'open' },
  },
  {
    name: 'fist',
    display: 'Fist',
    emoji: '\u{270A}',
    description: 'All fingers closed',
    fingers: { thumb: 'closed', index: 'closed', middle: 'closed', ring: 'closed', pinky: 'closed' },
  },
  {
    name: 'thumbs_up',
    display: 'Thumbs Up',
    emoji: '\u{1F44D}',
    description: 'Thumb extended, others closed',
    fingers: { thumb: 'open', index: 'closed', middle: 'closed', ring: 'closed', pinky: 'closed' },
  },
  {
    name: 'point',
    display: 'Pointing',
    emoji: '\u{261D}',
    description: 'Index finger extended',
    fingers: { thumb: 'closed', index: 'open', middle: 'closed', ring: 'closed', pinky: 'closed' },
  },
  {
    name: 'peace',
    display: 'Peace / Victory',
    emoji: '\u{270C}',
    description: 'Index and middle extended',
    fingers: { thumb: 'closed', index: 'open', middle: 'open', ring: 'closed', pinky: 'closed' },
  },
  {
    name: 'rock',
    display: 'Rock On',
    emoji: '\u{1F918}',
    description: 'Index and pinky extended',
    fingers: { thumb: 'closed', index: 'open', middle: 'closed', ring: 'closed', pinky: 'open' },
  },
  {
    name: 'call_me',
    display: 'Call Me',
    emoji: '\u{1F919}',
    description: 'Thumb and pinky extended',
    fingers: { thumb: 'open', index: 'closed', middle: 'closed', ring: 'closed', pinky: 'open' },
  },
  {
    name: 'ok_sign',
    display: 'OK',
    emoji: '\u{1F44C}',
    description: 'Thumb and index touching, others open',
    fingers: { thumb: 'closed', index: 'closed', middle: 'open', ring: 'open', pinky: 'open' },
  },
  {
    name: 'three',
    display: 'Three',
    emoji: '3\uFE0F\u20E3',
    description: 'Index, middle, ring extended',
    fingers: { thumb: 'closed', index: 'open', middle: 'open', ring: 'open', pinky: 'closed' },
  },
  {
    name: 'four',
    display: 'Four',
    emoji: '4\uFE0F\u20E3',
    description: 'All except thumb extended',
    fingers: { thumb: 'closed', index: 'open', middle: 'open', ring: 'open', pinky: 'open' },
  },
  {
    name: 'middle_finger',
    display: 'Middle Finger',
    emoji: '\u{1F595}',
    description: 'Middle finger extended',
    fingers: { thumb: 'closed', index: 'closed', middle: 'open', ring: 'closed', pinky: 'closed' },
  },
  {
    name: 'pinch',
    display: 'Pinch',
    emoji: '\u{1F90F}',
    description: 'Thumb and index closed, others open',
    fingers: { thumb: 'closed', index: 'closed', middle: 'open', ring: 'open', pinky: 'open' },
  },
];

// ---- Thresholds ----
const OPEN_THRESHOLD = 0.30;   // below this = finger is "open"
const CLOSED_THRESHOLD = 0.60; // above this = finger is "closed"
const MIN_CONFIDENCE = 0.5;    // minimum confidence to report a gesture
const STABILITY_FRAMES = 5;    // frames a gesture must persist to be reported

export class GestureEngine {
  constructor() {
    this._gestureDefs = [...GESTURE_DEFS];
    this._currentGesture = null;
    this._currentConfidence = 0;
    this._gestureHistory = [];    // recent gesture names for stability
    this._maxHistory = STABILITY_FRAMES;
    this._listeners = [];

    // Stats for ML training data collection
    this._logEnabled = false;
    this._dataLog = [];
  }

  /** Get all available gesture definitions */
  get gestures() {
    return this._gestureDefs;
  }

  /** Current detected gesture (or null) */
  get currentGesture() {
    return this._currentGesture;
  }

  /** Confidence of current detection (0-1) */
  get confidence() {
    return this._currentConfidence;
  }

  /** Register a gesture change listener: (gesture, confidence) => void */
  onGesture(callback) {
    this._listeners.push(callback);
  }

  /**
   * Add a custom gesture definition.
   * This allows extending the gesture set without modifying this file.
   * 
   * @param {Object} def - { name, display, emoji, description, fingers }
   */
  addGesture(def) {
    this._gestureDefs.push(def);
  }

  /**
   * Classify the current hand state.
   * Call this with each data frame.
   * 
   * ============================================================
   * ML INTEGRATION POINT:
   * Replace the body of this method with your model inference.
   * Input: data.fingers (5 float values) + data.orientation (3 floats)
   * Output: { gesture: string, confidence: number }
   * ============================================================
   * 
   * @param {Object} data - Standard sensor data frame
   * @returns {{ gesture: Object|null, confidence: number }}
   */
  classify(data) {
    if (!data || !data.fingers) {
      return { gesture: null, confidence: 0 };
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const def of this._gestureDefs) {
      const score = this._scoreGesture(def, data.fingers);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = def;
      }
    }

    // Apply confidence threshold
    if (bestScore < MIN_CONFIDENCE) {
      bestMatch = null;
      bestScore = 0;
    }

    // Stability filter: only report if consistent over several frames
    this._gestureHistory.push(bestMatch ? bestMatch.name : null);
    if (this._gestureHistory.length > this._maxHistory) {
      this._gestureHistory.shift();
    }

    const stableGesture = this._getStableGesture();
    const prevGesture = this._currentGesture;

    if (stableGesture !== null) {
      this._currentGesture = this._gestureDefs.find(g => g.name === stableGesture) || null;
      this._currentConfidence = bestScore;
    } else {
      this._currentGesture = null;
      this._currentConfidence = 0;
    }

    // Notify on change
    if (this._currentGesture?.name !== prevGesture?.name) {
      for (const cb of this._listeners) {
        cb(this._currentGesture, this._currentConfidence);
      }
    }

    // Log data for ML training if enabled
    if (this._logEnabled && data.fingers) {
      this._dataLog.push({
        fingers: { ...data.fingers },
        orientation: data.orientation ? { ...data.orientation } : null,
        label: this._currentGesture?.name || 'unknown',
        timestamp: Date.now(),
      });
    }

    return { gesture: this._currentGesture, confidence: this._currentConfidence };
  }

  /**
   * Score how well finger data matches a gesture definition.
   * Returns 0-1 confidence.
   */
  _scoreGesture(def, fingers) {
    const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky'];
    let totalScore = 0;
    let constraints = 0;

    for (const name of fingerNames) {
      const expected = def.fingers[name];
      const value = fingers[name];

      if (expected === 'any') continue;

      constraints++;

      if (expected === 'open') {
        if (value < OPEN_THRESHOLD) {
          totalScore += 1.0;
        } else if (value < CLOSED_THRESHOLD) {
          // Partial match: linearly degrade
          totalScore += 1.0 - (value - OPEN_THRESHOLD) / (CLOSED_THRESHOLD - OPEN_THRESHOLD);
        }
        // else: value >= CLOSED_THRESHOLD → 0 score for this finger
      } else if (expected === 'closed') {
        if (value > CLOSED_THRESHOLD) {
          totalScore += 1.0;
        } else if (value > OPEN_THRESHOLD) {
          totalScore += (value - OPEN_THRESHOLD) / (CLOSED_THRESHOLD - OPEN_THRESHOLD);
        }
      }
    }

    return constraints > 0 ? totalScore / constraints : 0;
  }

  /** Get the most common gesture in history (stability check) */
  _getStableGesture() {
    if (this._gestureHistory.length < this._maxHistory) return null;

    const counts = {};
    for (const g of this._gestureHistory) {
      if (g === null) continue;
      counts[g] = (counts[g] || 0) + 1;
    }

    let maxCount = 0;
    let maxGesture = null;
    for (const [gesture, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        maxGesture = gesture;
      }
    }

    // Must be present in at least 60% of history frames
    return maxCount >= this._maxHistory * 0.6 ? maxGesture : null;
  }

  // ---- ML Training Data Collection ----

  /** Enable/disable data logging for ML training */
  set logging(enabled) {
    this._logEnabled = enabled;
  }

  /** Get collected training data */
  get trainingData() {
    return this._dataLog;
  }

  /** Export training data as JSON (for downloading) */
  exportTrainingData() {
    const blob = new Blob([JSON.stringify(this._dataLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesture_training_data_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Clear collected training data */
  clearTrainingData() {
    this._dataLog = [];
  }
}
