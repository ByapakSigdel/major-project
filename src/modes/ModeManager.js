/**
 * ModeManager - Application mode state machine
 * 
 * Three modes:
 *   1. simulation  - Default. 3D hand visualization with synthetic motion patterns.
 *   2. mouse       - Ctrl held. IMU orientation moves a virtual cursor, fist = click.
 *   3. gesture     - Gesture recognition. Detects hand signs and displays them.
 * 
 * Mode transitions:
 *   - Ctrl press/release toggles mouse mode (overlay on any mode)
 *   - UI buttons switch between simulation and gesture
 *   - Mouse mode is an overlay: pressing Ctrl from simulation or gesture
 *     temporarily enters mouse mode, releasing returns to previous mode.
 * 
 * The ModeManager emits events when modes change so each layer
 * can respond appropriately (UI updates, different processing, etc.)
 */

export const MODES = {
  SIMULATION: 'simulation',
  MOUSE: 'mouse',
  GESTURE: 'gesture',
};

export class ModeManager {
  constructor() {
    this._currentMode = MODES.SIMULATION;
    this._previousMode = MODES.SIMULATION; // for Ctrl toggle return
    this._ctrlHeld = false;
    this._listeners = [];

    this._initKeyboardListeners();
  }

  /** Current active mode */
  get mode() {
    return this._currentMode;
  }

  /** Whether Ctrl is currently held (mouse mode active) */
  get isCtrlHeld() {
    return this._ctrlHeld;
  }

  /**
   * Register a mode change listener.
   * Callback receives (newMode, previousMode).
   */
  onChange(callback) {
    this._listeners.push(callback);
  }

  /**
   * Switch to a base mode (simulation or gesture).
   * If Ctrl is held, the switch takes effect when Ctrl is released.
   */
  setMode(mode) {
    if (mode === MODES.MOUSE) {
      // Mouse mode is only activated via Ctrl, not directly
      console.warn('Mouse mode is activated by holding Ctrl');
      return;
    }

    if (this._ctrlHeld) {
      // Store as the mode to return to when Ctrl is released
      this._previousMode = mode;
    } else {
      this._previousMode = mode;
      this._setCurrentMode(mode);
    }
  }

  /** Internal mode setter with event emission */
  _setCurrentMode(newMode) {
    if (newMode === this._currentMode) return;
    const prev = this._currentMode;
    this._currentMode = newMode;
    for (const cb of this._listeners) {
      cb(newMode, prev);
    }
  }

  /** Set up Ctrl key listeners for mouse mode toggle */
  _initKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Control' && !this._ctrlHeld) {
        this._ctrlHeld = true;
        // Save current mode and switch to mouse
        if (this._currentMode !== MODES.MOUSE) {
          this._previousMode = this._currentMode;
        }
        this._setCurrentMode(MODES.MOUSE);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Control' && this._ctrlHeld) {
        this._ctrlHeld = false;
        // Return to previous mode
        this._setCurrentMode(this._previousMode);
      }
    });

    // Handle window blur (Ctrl release not detected if window loses focus)
    window.addEventListener('blur', () => {
      if (this._ctrlHeld) {
        this._ctrlHeld = false;
        this._setCurrentMode(this._previousMode);
      }
    });
  }

  /** Clean up listeners */
  destroy() {
    this._listeners = [];
  }
}
