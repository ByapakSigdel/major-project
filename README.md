# 3D Hand Simulation

Real-time 3D hand motion visualization driven by synthetic sensor data, built with Three.js. Designed for a college major project demonstrating hand tracking concepts.

## Quick Start

```bash
cd hand-simulation
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Click **Start** to begin the simulation.

## Project Structure

```
hand-simulation/
├── index.html                    # Main HTML with UI markup
├── src/
│   ├── main.js                   # Entry point - wires all layers together
│   ├── style.css                 # UI styles
│   │
│   ├── data/                     # DATA SOURCE LAYER
│   │   ├── DataSource.js         # Abstract base class + WebSocket placeholder
│   │   └── SyntheticDataGenerator.js  # Generates fake sensor data
│   │
│   ├── animation/                # ANIMATION / MAPPING LAYER
│   │   └── HandAnimator.js       # Maps data values → bone rotations
│   │
│   ├── rendering/                # RENDERING LAYER
│   │   ├── SceneManager.js       # Three.js scene, camera, lights, render loop
│   │   └── HandModel.js          # Procedural 3D hand with bone hierarchy
│   │
│   └── ui/                       # UI LAYER
│       └── UIController.js       # DOM controls ↔ data source / animator
│
└── package.json
```

## Architecture

```
┌─────────────────────────────────┐
│        UI Controller            │  Controls, debug panel, mode select
├─────────────────────────────────┤
│      Rendering Layer            │  Three.js scene, camera, hand model
├─────────────────────────────────┤
│    Animation / Mapping Layer    │  Data → bone rotations + smoothing
├─────────────────────────────────┤
│      Data Source Layer          │  Pluggable: synthetic OR hardware
│  ┌────────────┐ ┌────────────┐  │
│  │ Synthetic  │ │ WebSocket  │  │
│  │ Generator  │ │ (hardware) │  │
│  └────────────┘ └────────────┘  │
└─────────────────────────────────┘
```

The key design principle: **each layer only depends on the one below it via a shared data format**. The animation layer never knows whether data comes from synthetic generation or real sensors.

## How Synthetic Data Works

The `SyntheticDataGenerator` (in `src/data/SyntheticDataGenerator.js`) produces data frames at a configurable rate (default 30 Hz). Each frame has this shape:

```json
{
  "fingers": {
    "thumb": 0.2,
    "index": 0.7,
    "middle": 0.9,
    "ring": 0.6,
    "pinky": 0.4
  },
  "orientation": {
    "roll": 12.0,
    "pitch": -8.0,
    "yaw": 25.0
  },
  "timestamp": 1700000000000
}
```

- **Finger values**: `0.0` = fully open, `1.0` = fully curled
- **Orientation**: degrees (roll/pitch/yaw from MPU6050-style IMU)

Available motion modes:
| Mode | Description |
|------|-------------|
| `fist` | All fingers open and close together |
| `wave` | Sequential finger wave pattern |
| `individual` | One finger curls at a time |
| `random` | Natural-looking random motion (summed sine waves) |
| `peace` | Peace sign pose with subtle breathing motion |
| `counting` | Count 1-5 by extending fingers |

## How to Replace Synthetic Data with Real Hardware

This is designed to be a **single-line swap**. In `src/main.js`:

### Current (synthetic):
```js
import { SyntheticDataGenerator } from './data/SyntheticDataGenerator.js';

const dataSource = new SyntheticDataGenerator({
  mode: 'fist',
  updateRate: 30,
  speed: 1.0,
});
```

### With real hardware (MPU6050 + flex sensors via WebSocket):
```js
import { WebSocketDataSource } from './data/DataSource.js';

const dataSource = new WebSocketDataSource('ws://192.168.4.1:81');
```

That's it. The animator, renderer, and UI all work identically because they only depend on the data format, not the source.

### ESP32/Arduino firmware requirements

Your microcontroller firmware needs to:

1. Read 5 analog flex sensor values (one per finger)
2. Read MPU6050 orientation (roll, pitch, yaw via DMP or complementary filter)
3. Send JSON over WebSocket at 30-60 Hz

Example Arduino/ESP32 JSON output:
```json
{
  "fingers": {
    "thumb": 512,
    "index": 230,
    "middle": 890,
    "ring": 445,
    "pinky": 100
  },
  "orientation": {
    "roll": 12.5,
    "pitch": -3.2,
    "yaw": 45.0
  }
}
```

The `WebSocketDataSource` automatically normalizes flex values from 0-1023 range to 0.0-1.0.

## Calibration

Key constants to adjust when calibrating with real hardware:

| File | Constant | Description |
|------|----------|-------------|
| `HandAnimator.js` | `JOINT_MAX_ANGLES` | Max bend angle per joint type (radians) |
| `HandAnimator.js` | `THUMB_MAX_ANGLES` | Thumb-specific max angles |
| `HandAnimator.js` | `DEFAULT_SMOOTHING` | Interpolation factor (0.1=smooth, 0.5=responsive) |
| `DataSource.js` | Flex normalization | Adjust the 0-1023 divisor if your ADC range differs |

## Controls

- **Start/Stop**: Toggle the data simulation
- **Motion Mode**: Switch between preset motion patterns
- **Update Rate**: How often data frames are generated (10-60 Hz)
- **Animation Speed**: Time multiplier for motion patterns
- **Mouse drag**: Orbit camera around the hand
- **Scroll**: Zoom in/out

## Tech Stack

- **Vite** - Build tool and dev server
- **Three.js** - 3D rendering
- **Vanilla JS** - No framework overhead, direct DOM manipulation
- **ES Modules** - Clean separation of concerns

## Building for Production

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server.
# major-project
