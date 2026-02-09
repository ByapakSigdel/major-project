/**
 * MouseController - Virtual mouse using hand IMU + fist gesture
 * 
 * When Ctrl is held, this module:
 *   - Maps wrist pitch/yaw to a cursor position on screen
 *   - Detects a closed fist (all fingers > threshold) as a "click"
 *   - Shows a visible cursor overlay
 *   - Fires click events on detected "clicks"
 * 
 * This simulates how the real hardware glove will work:
 *   - Tilt hand left/right → cursor moves horizontally
 *   - Tilt hand up/down → cursor moves vertically
 *   - Close fist → click at current position
 * 
 * The controller does NOT actually move the OS mouse pointer
 * (browsers don't allow that). Instead it moves a custom cursor
 * element and can dispatch synthetic click events at the position.
 */

export class MouseController {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.cursorElement - The visible cursor DOM element
   * @param {HTMLElement} options.clickIndicator - Visual click feedback element
   */
  constructor({ cursorElement, clickIndicator }) {
    this._cursor = cursorElement;
    this._clickIndicator = clickIndicator;
    this._active = false;

    // Cursor position (pixels)
    this._x = window.innerWidth / 2;
    this._y = window.innerHeight / 2;

    // Sensitivity (pixels per degree of rotation)
    this._sensitivityX = 12;
    this._sensitivityY = 10;

    // Dead zone (degrees) - ignore tiny movements
    this._deadzone = 2;

    // Click detection
    this._fistThreshold = 0.65;   // finger bend value above this = "closed"
    this._fistFingerCount = 4;    // how many fingers must be closed for a fist
    this._isFistClosed = false;
    this._clickCooldown = 0;      // prevent rapid re-clicking
    this._clickCooldownMs = 500;  // minimum ms between clicks

    // Reference orientation (calibrated when entering mouse mode)
    this._refPitch = 0;
    this._refYaw = 0;
    this._calibrated = false;

    // Click callback
    this._onClickCallback = null;
  }

  /** Register a click callback: (x, y) => void */
  onClick(callback) {
    this._onClickCallback = callback;
  }

  /** Activate mouse mode (called when Ctrl is pressed) */
  activate(currentOrientation) {
    this._active = true;
    this._cursor.style.display = 'block';

    // Calibrate: current orientation = center of screen
    if (currentOrientation) {
      this._refPitch = currentOrientation.pitch || 0;
      this._refYaw = currentOrientation.yaw || 0;
    }
    this._calibrated = true;

    // Start cursor at center
    this._x = window.innerWidth / 2;
    this._y = window.innerHeight / 2;
    this._updateCursorPosition();
  }

  /** Deactivate mouse mode */
  deactivate() {
    this._active = false;
    this._cursor.style.display = 'none';
    this._isFistClosed = false;
    this._calibrated = false;
  }

  /** Whether mouse mode is currently active */
  get isActive() {
    return this._active;
  }

  /** Current cursor position */
  get position() {
    return { x: this._x, y: this._y };
  }

  /** Whether fist is currently detected as closed */
  get isFistClosed() {
    return this._isFistClosed;
  }

  /**
   * Update cursor position and check for clicks.
   * Called from the render loop with each data frame.
   * 
   * @param {Object} data - Standard sensor data frame
   * @param {number} data.orientation.pitch
   * @param {number} data.orientation.yaw
   * @param {Object} data.fingers - { thumb, index, middle, ring, pinky }
   */
  update(data) {
    if (!this._active || !data) return;

    // ---- Cursor movement from IMU ----
    if (data.orientation && this._calibrated) {
      const dYaw = data.orientation.yaw - this._refYaw;
      const dPitch = data.orientation.pitch - this._refPitch;

      // Apply dead zone
      const effectiveYaw = Math.abs(dYaw) > this._deadzone
        ? (dYaw - Math.sign(dYaw) * this._deadzone)
        : 0;
      const effectivePitch = Math.abs(dPitch) > this._deadzone
        ? (dPitch - Math.sign(dPitch) * this._deadzone)
        : 0;

      // Map to screen position (relative to center)
      const targetX = (window.innerWidth / 2) + effectiveYaw * this._sensitivityX;
      const targetY = (window.innerHeight / 2) - effectivePitch * this._sensitivityY;

      // Smooth cursor movement
      this._x += (targetX - this._x) * 0.2;
      this._y += (targetY - this._y) * 0.2;

      // Clamp to screen bounds
      this._x = Math.max(0, Math.min(window.innerWidth, this._x));
      this._y = Math.max(0, Math.min(window.innerHeight, this._y));

      this._updateCursorPosition();
    }

    // ---- Fist / click detection ----
    if (data.fingers) {
      const fingers = data.fingers;
      let closedCount = 0;

      // Count how many fingers are above the fist threshold
      for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        if (fingers[name] >= this._fistThreshold) {
          closedCount++;
        }
      }

      const wasFist = this._isFistClosed;
      this._isFistClosed = closedCount >= this._fistFingerCount;

      // Detect fist close transition (rising edge = click)
      if (this._isFistClosed && !wasFist) {
        const now = Date.now();
        if (now - this._clickCooldown > this._clickCooldownMs) {
          this._clickCooldown = now;
          this._triggerClick();
        }
      }
    }
  }

  /** Visually update cursor position */
  _updateCursorPosition() {
    this._cursor.style.left = `${this._x}px`;
    this._cursor.style.top = `${this._y}px`;
  }

  /** Fire a click event */
  _triggerClick() {
    // Visual feedback
    this._showClickFeedback();

    // Callback
    if (this._onClickCallback) {
      this._onClickCallback(this._x, this._y);
    }

    // Try to click on the element under the cursor
    const element = document.elementFromPoint(this._x, this._y);
    if (element) {
      element.click();
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: this._x,
        clientY: this._y,
      }));
    }
  }

  /** Show a ripple effect at the click position */
  _showClickFeedback() {
    if (!this._clickIndicator) return;

    this._clickIndicator.style.left = `${this._x}px`;
    this._clickIndicator.style.top = `${this._y}px`;
    this._clickIndicator.classList.remove('click-animate');

    // Force reflow to restart animation
    void this._clickIndicator.offsetWidth;
    this._clickIndicator.classList.add('click-animate');
  }
}
