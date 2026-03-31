// src/data/SerialManager.js
export class SerialManager {
  constructor() {
    this.reader = null;
    this.port = null;
    this.onData = null; // Callback function
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 }); // Ensure this matches your Arduino code

      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      this.readLoop();
    } catch (err) {
      console.error("Serial Connection Failed:", err);
    }
  }

  async readLoop() {
    let partialLine = "";
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;

      partialLine += value;
      const lines = partialLine.split("\n");
      partialLine = lines.pop(); // Keep the unfinished last line

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);
            if (this.onData) this.onData(json);
          } catch (e) {
            // Ignore malformed JSON lines
          }
        }
      }
    }
  }
}