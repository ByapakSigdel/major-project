import './style.css';
import { SceneManager } from './rendering/SceneManager.js';
import { createHandModelAsync } from './rendering/HandModel.js';
import { SyntheticDataGenerator } from './data/SyntheticDataGenerator.js';
import { SerialManager } from './data/SerialManager.js';
import { HandAnimator } from './animation/HandAnimator.js';
import { ModeManager, MODES } from './modes/ModeManager.js';
import { GestureEngine } from './gestures/GestureEngine.js';
import { MouseController } from './modes/MouseController.js';
import { UIController } from './ui/UIController.js';

async function init() {
  // 1. Set up the 3D scene
  const container = document.getElementById('canvas-container');
  const sceneManager = new SceneManager(container);

  // 2. Load the hand model
  const modelData = await createHandModelAsync('/models/human_hand_base_mesh.glb');
  const { group, bones } = modelData;
  sceneManager.scene.add(group);

  // 3. Initialize Animators and Managers
  const animator = new HandAnimator(bones, 0.15);
  const modeManager = new ModeManager();
  const gestureEngine = new GestureEngine();
  const mouseController = new MouseController({
    cursorElement: document.getElementById('mouse-cursor'),
    clickIndicator: document.getElementById('click-indicator'),
  });

  // 4. Initialize Hardware
  const serial = new SerialManager();

  // Unified function to process data from ANY source
  const processFrame = (frame) => {
    animator.applyFrame(frame);

    if (modeManager.mode === MODES.GESTURE) {
      gestureEngine.classify(frame);
    }

    if (modeManager.mode === MODES.MOUSE) {
      mouseController.update(frame);
    }
  };

  // Helper function to update UI elements
  const updateUIElement = (id, value, isBar = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isBar) {
      el.style.width = `${value * 100}%`;
    } else {
      el.textContent = typeof value === 'number' ? value.toFixed(2) : value;
    }
  };

  // Setup Serial Listener
  serial.onData = (rawData) => {
    const formattedFrame = {
      fingers: {
        thumb: rawData.thumb,
        index: rawData.index,
        middle: rawData.middle,
        ring: rawData.ring,
        pinky: rawData.pinky
      },
      orientation: { roll: rawData.roll, pitch: rawData.pitch, yaw: rawData.yaw }
    };

    processFrame(formattedFrame);
    
    // Update the UI Bars and Values directly from hardware data
    updateUIElement('bar-thumb', rawData.thumb, true);
    updateUIElement('val-thumb', rawData.thumb);
    updateUIElement('bar-index', rawData.index, true);
    updateUIElement('val-index', rawData.index);
    updateUIElement('bar-middle', rawData.middle, true);
    updateUIElement('val-middle', rawData.middle);
    updateUIElement('bar-ring', rawData.ring, true);
    updateUIElement('val-ring', rawData.ring);
    updateUIElement('bar-pinky', rawData.pinky, true);
    updateUIElement('val-pinky', rawData.pinky);

    updateUIElement('val-roll', rawData.roll);
    updateUIElement('val-pitch', rawData.pitch);
    updateUIElement('val-yaw', rawData.yaw);

    const badge = document.getElementById('source-label');
    if (badge) {
      badge.textContent = 'Hardware';
      badge.style.background = '#4f46e5';
    }
  };

  // 5. Setup UI Controller
  const ui = new UIController({
    dataSource: new SyntheticDataGenerator({ mode: 'fist', updateRate: 30, speed: 1.0 }),
    animator,
    sceneManager,
    modeManager,
    gestureEngine,
    mouseController,
  });
  window.__ui = ui;

  // 6. Setup Event Listeners
  const connectBtn = document.getElementById('connect-hw');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      serial.connect();
    });
  }

  // 7. Render Loop Updates
  sceneManager.onUpdate((deltaTime) => {
    animator.update(deltaTime);
  });

  // Throttled UI Update (for Gestures and FPS)
  let debugAccum = 0;
  sceneManager.onUpdate((dt) => {
    debugAccum += dt;
    if (debugAccum >= 1 / 15) {
      ui.updateDebugPanel();
      if (modeManager.mode === MODES.GESTURE) {
        ui.updateGestureDisplay(); 
      }
      debugAccum = 0;
    }
  });

  // 8. Final Start
  ui.hideLoading();
  sceneManager.start();

  // Debug Console Exposure
  if (import.meta.env.DEV) {
    window.__hand = { animator, serial, sceneManager, ui };
    console.log('3D Hand Simulation Ready.');
  }
} // <--- This is where the init() function should actually close

init();