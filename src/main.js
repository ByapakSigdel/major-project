/**
 * main.js - Application entry point
 * 
 * Wires together all layers:
 *   1. Rendering  (SceneManager + HandModel)
 *   2. Data       (SyntheticDataGenerator)
 *   3. Animation  (HandAnimator)
 *   4. Modes      (ModeManager)
 *   5. Gestures   (GestureEngine)
 *   6. Mouse      (MouseController)
 *   7. UI         (UIController)
 * 
 * ============================================================
 * HOW TO SWITCH TO REAL HARDWARE:
 * ============================================================
 * Replace the SyntheticDataGenerator with a WebSocketDataSource:
 * 
 *   import { WebSocketDataSource } from './data/DataSource.js';
 *   const dataSource = new WebSocketDataSource('ws://YOUR_ESP32_IP:81');
 * 
 * Everything else stays the same. The animator and renderer don't
 * need any changes because they only depend on the data format,
 * not the source.
 * ============================================================
 */

import './style.css';
import { SceneManager } from './rendering/SceneManager.js';
import { createHandModel } from './rendering/HandModel.js';
import { SyntheticDataGenerator } from './data/SyntheticDataGenerator.js';
import { HandAnimator } from './animation/HandAnimator.js';
import { ModeManager, MODES } from './modes/ModeManager.js';
import { GestureEngine } from './gestures/GestureEngine.js';
import { MouseController } from './modes/MouseController.js';
import { UIController } from './ui/UIController.js';

// ---- Initialize ----

function init() {
  // 1. Set up the 3D scene
  const container = document.getElementById('canvas-container');
  const sceneManager = new SceneManager(container);

  // 2. Create and add the hand model
  const { group, skeleton, bones, mesh } = createHandModel();
  sceneManager.scene.add(group);

  // 3. Create the data source (synthetic for now)
  //    SWAP POINT: Replace this with WebSocketDataSource for real hardware
  const dataSource = new SyntheticDataGenerator({
    mode: 'fist',
    updateRate: 30,
    speed: 1.0,
  });

  // 4. Create the animator (maps data → bone rotations)
  const animator = new HandAnimator(bones, 0.15);

  // 5. Create the mode manager (simulation / gesture / mouse state machine)
  const modeManager = new ModeManager();

  // 6. Create the gesture recognition engine
  const gestureEngine = new GestureEngine();

  // 7. Create the mouse controller
  const mouseController = new MouseController({
    cursorElement: document.getElementById('mouse-cursor'),
    clickIndicator: document.getElementById('click-indicator'),
  });

  // 8. Connect data source to animator
  //    This is the key pipeline: source → animator → bones → renderer
  //    Also feed data into gesture engine and mouse controller
  let latestFrame = null;
  dataSource.onData((frame) => {
    latestFrame = frame;
    animator.applyFrame(frame);

    // Feed gesture engine when in gesture mode
    if (modeManager.mode === MODES.GESTURE) {
      gestureEngine.classify(frame);
    }

    // Feed mouse controller when in mouse mode
    if (modeManager.mode === MODES.MOUSE) {
      mouseController.update(frame);
    }
  });

  // 9. Handle mode transitions
  modeManager.onChange((newMode, prevMode) => {
    // Activate/deactivate mouse controller on mode change
    if (newMode === MODES.MOUSE) {
      const orientation = latestFrame?.orientation || null;
      mouseController.activate(orientation);
    } else if (prevMode === MODES.MOUSE) {
      mouseController.deactivate();
    }
  });

  // 10. Register animator update in the render loop
  //     (interpolation happens here at display frame rate)
  sceneManager.onUpdate((deltaTime) => {
    animator.update(deltaTime);
  });

  // 11. Set up UI controls (pass ALL dependencies)
  const ui = new UIController({
    dataSource,
    animator,
    sceneManager,
    modeManager,
    gestureEngine,
    mouseController,
  });

  // Update debug panel + gesture/mouse displays at ~15 Hz
  let debugAccum = 0;
  sceneManager.onUpdate((dt) => {
    debugAccum += dt;
    if (debugAccum >= 1 / 15) {
      ui.updateDebugPanel();

      // Update gesture display when in gesture mode
      if (modeManager.mode === MODES.GESTURE) {
        ui.updateGestureDisplay();
      }

      // Update mouse status when in mouse mode
      if (modeManager.mode === MODES.MOUSE) {
        ui.updateMouseStatus();
      }

      debugAccum = 0;
    }
  });

  // 12. Start rendering (does NOT start data - user clicks "Start")
  sceneManager.start();

  // 13. Hide the loading screen now that everything is ready
  ui.hideLoading();

  // Expose to console for debugging
  if (import.meta.env.DEV) {
    window.__hand = {
      sceneManager, dataSource, animator, bones, skeleton,
      modeManager, gestureEngine, mouseController,
    };
    console.log(
      '%c3D Hand Simulation loaded (all modes active)',
      'color: #6080ff; font-weight: bold;',
      '\nAccess internals via window.__hand',
      '\nModes: simulation | gesture | mouse (Ctrl)'
    );
  }
}

// Boot
init();
