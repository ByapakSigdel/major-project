/**
 * DataSource - Abstract base for hand sensor data providers
 * 
 * This is the INTEGRATION POINT for real hardware.
 * All data sources (synthetic, WebSocket, serial) implement this interface.
 * The animation layer only depends on this interface, never on a specific source.
 * 
 * Data format (shared contract):
 * {
 *   fingers: { thumb: 0-1, index: 0-1, middle: 0-1, ring: 0-1, pinky: 0-1 },
 *   orientation: { roll: degrees, pitch: degrees, yaw: degrees },
 *   timestamp: ms
 * }
 * 
 * TO ADD REAL HARDWARE:
 *   1. Create a new class extending DataSource (e.g., WebSocketSource)
 *   2. In start(), connect to your WebSocket / serial bridge
 *   3. Parse incoming MPU6050 + flex sensor data into the format above
 *   4. Call this._notifyListeners(data) with each reading
 *   5. Swap it in via main.js: `const source = new WebSocketSource('ws://...')`
 */

export class DataSource {
  constructor() {
    this._listeners = [];
    this._running = false;
  }

  /** Register a callback to receive data frames */
  onData(callback) {
    this._listeners.push(callback);
  }

  /** Remove a previously registered callback */
  offData(callback) {
    this._listeners = this._listeners.filter(cb => cb !== callback);
  }

  /** Start emitting data */
  start() {
    this._running = true;
  }

  /** Stop emitting data */
  stop() {
    this._running = false;
  }

  /** Check if source is active */
  get isRunning() {
    return this._running;
  }

  /** Notify all listeners with a data frame */
  _notifyListeners(data) {
    for (const cb of this._listeners) {
      cb(data);
    }
  }

  /** Return the source type name for UI display */
  get sourceType() {
    return 'unknown';
  }
}


/**
 * Example WebSocket data source (placeholder for real hardware).
 * 
 * Usage:
 *   const hwSource = new WebSocketDataSource('ws://192.168.4.1:81');
 *   hwSource.onData(frame => animator.applyFrame(frame));
 *   hwSource.start();
 * 
 * The ESP32/Arduino firmware should send JSON matching the data format above.
 */
export class WebSocketDataSource extends DataSource {
  constructor(url) {
    super();
    this._url = url;
    this._ws = null;
  }

  get sourceType() {
    return 'hardware';
  }

  start() {
    super.start();
    this._ws = new WebSocket(this._url);

    this._ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Normalize flex sensor values from 0-1023 to 0-1 if needed
        if (data.fingers) {
          for (const key of Object.keys(data.fingers)) {
            if (data.fingers[key] > 1) {
              data.fingers[key] = data.fingers[key] / 1023;
            }
          }
        }
        data.timestamp = data.timestamp || Date.now();
        this._notifyListeners(data);
      } catch (e) {
        console.warn('WebSocketDataSource: invalid message', e);
      }
    };

    this._ws.onerror = (e) => console.error('WebSocket error:', e);
    this._ws.onclose = () => {
      if (this._running) {
        // Auto-reconnect after 2 seconds
        setTimeout(() => this.start(), 2000);
      }
    };
  }

  stop() {
    super.stop();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }
}
