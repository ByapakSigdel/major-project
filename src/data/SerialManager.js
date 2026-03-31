// src/data/SerialManager.js
export class SerialManager {
  constructor() {
    this.reader = null;
    this.port = null;
    this.onData = null; // Callback function
    this._parseErrorCount = 0;
    this._lastSuccessTime = 0;
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 }); // Ensure this matches your Arduino code

      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      console.log('Serial port connected at 115200 baud');
      this._parseErrorCount = 0;
      this.readLoop();
    } catch (err) {
      console.error("Serial Connection Failed:", err);
    }
  }

  async readLoop() {
    let partialLine = "";
    while (true) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          console.log('Serial reader done');
          break;
        }

        partialLine += value;
        const lines = partialLine.split("\n");
        partialLine = lines.pop(); // Keep the unfinished last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            try {
              const json = JSON.parse(trimmed);
              this._lastSuccessTime = Date.now();
              this._parseErrorCount = 0;
              if (this.onData) this.onData(json);
            } catch (e) {
              this._parseErrorCount++;
              // Log parse errors periodically to help debugging
              if (this._parseErrorCount <= 3 || this._parseErrorCount % 100 === 0) {
                console.warn(`Serial JSON parse error #${this._parseErrorCount}:`, trimmed.substring(0, 100));
              }
            }
          }
        }
      } catch (readError) {
        console.error('Serial read error:', readError);
        break;
      }
    }
  }
  
  // Check if data is stale (no successful parse in last 2 seconds)
  isDataStale() {
    return Date.now() - this._lastSuccessTime > 2000;
  }
}