/**
 * UIController - Manages all UI interactions across modes
 * 
 * Handles:
 *   - Mode tab switching (simulation / gesture)
 *   - Ctrl indicator for mouse mode
 *   - Simulation controls (start/stop, motion mode, rate, speed)
 *   - Gesture controls (start/stop, motion select, ML logging)
 *   - Gesture display (emoji, name, confidence, grid)
 *   - Mouse mode status overlay
 *   - Debug panel (sensor values, FPS)
 *   - Loading screen
 */

import { FINGER_NAMES } from '../rendering/HandModel.js';
import { MODES } from '../modes/ModeManager.js';

export class UIController {
  /**
   * @param {Object} deps - All dependencies injected
   * @param {import('../data/SyntheticDataGenerator').SyntheticDataGenerator} deps.dataSource
   * @param {import('../animation/HandAnimator').HandAnimator} deps.animator
   * @param {import('../rendering/SceneManager').SceneManager} deps.sceneManager
   * @param {import('../modes/ModeManager').ModeManager} deps.modeManager
   * @param {import('../gestures/GestureEngine').GestureEngine} deps.gestureEngine
   * @param {import('../modes/MouseController').MouseController} deps.mouseController
   */
  constructor(deps) {
    this._dataSource = deps.dataSource;
    this._animator = deps.animator;
    this._sceneManager = deps.sceneManager;
    this._modeManager = deps.modeManager;
    this._gestureEngine = deps.gestureEngine;
    this._mouseController = deps.mouseController;

    // Cache DOM elements
    this._els = {
      // Top bar
      modeTabs: document.querySelectorAll('.mode-tab'),
      ctrlIndicator: document.getElementById('ctrl-indicator'),
      modeHint: document.getElementById('mode-hint'),

      // Control panel
      simControls: document.getElementById('sim-controls'),
      gestureControls: document.getElementById('gesture-controls'),
      btnToggle: document.getElementById('btn-toggle'),
      selectMode: document.getElementById('select-mode'),
      sliderRate: document.getElementById('slider-rate'),
      sliderSpeed: document.getElementById('slider-speed'),
      rateValue: document.getElementById('rate-value'),
      speedValue: document.getElementById('speed-value'),
      sourceLabel: document.getElementById('source-label'),

      // Gesture controls
      btnToggleGesture: document.getElementById('btn-toggle-gesture'),
      selectGestureMotion: document.getElementById('select-gesture-motion'),
      btnLogToggle: document.getElementById('btn-log-toggle'),
      btnLogExport: document.getElementById('btn-log-export'),

      // Gesture display
      gestureDisplay: document.getElementById('gesture-display'),
      gestureEmoji: document.getElementById('gesture-emoji'),
      gestureName: document.getElementById('gesture-name'),
      confidenceFill: document.getElementById('confidence-fill'),
      confidenceValue: document.getElementById('confidence-value'),
      gestureGrid: document.getElementById('gesture-grid'),

      // Mouse status
      mouseStatus: document.getElementById('mouse-status'),
      mouseFistStatus: document.getElementById('mouse-fist-status'),
      mouseX: document.getElementById('mouse-x'),
      mouseY: document.getElementById('mouse-y'),

      // Debug panel
      liveDot: document.querySelector('.live-dot'),
      fps: document.getElementById('val-fps'),

      // Loading
      loadingScreen: document.getElementById('loading-screen'),
    };

    // Finger elements
    this._fingerEls = {};
    for (const name of FINGER_NAMES) {
      this._fingerEls[name] = {
        bar: document.getElementById(`bar-${name}`),
        val: document.getElementById(`val-${name}`),
      };
    }

    // Orientation elements
    this._orientEls = {
      roll: document.getElementById('val-roll'),
      pitch: document.getElementById('val-pitch'),
      yaw: document.getElementById('val-yaw'),
    };

    this._isLogging = false;

    this._bindEvents();
    this._buildGestureGrid();
    this._updateSourceLabel();
    this._listenToModeChanges();
  }

  // ---- Event Binding ----

  _bindEvents() {
    // Mode tabs
    this._els.modeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        this._modeManager.setMode(mode);
      });
    });

    // Simulation: Start/Stop
    this._els.btnToggle.addEventListener('click', () => {
      if (this._dataSource.isRunning) {
        this._dataSource.stop();
        this._els.btnToggle.textContent = 'Start';
        this._els.btnToggle.classList.remove('active');
        this._els.liveDot.classList.remove('active');
      } else {
        this._dataSource.start();
        this._els.btnToggle.textContent = 'Stop';
        this._els.btnToggle.classList.add('active');
        this._els.liveDot.classList.add('active');
      }
    });

    // Motion mode select
    this._els.selectMode.addEventListener('change', (e) => {
      if (this._dataSource.mode !== undefined) {
        this._dataSource.mode = e.target.value;
      }
    });

    // Rate slider
    this._els.sliderRate.addEventListener('input', (e) => {
      const rate = parseInt(e.target.value);
      this._els.rateValue.textContent = rate;
      if (this._dataSource.updateRate !== undefined) {
        this._dataSource.updateRate = rate;
      }
    });

    // Speed slider
    this._els.sliderSpeed.addEventListener('input', (e) => {
      const speed = parseFloat(e.target.value);
      this._els.speedValue.textContent = speed.toFixed(1);
      if (this._dataSource.speed !== undefined) {
        this._dataSource.speed = speed;
      }
    });

    // Gesture: Start/Stop
    this._els.btnToggleGesture.addEventListener('click', () => {
      if (this._dataSource.isRunning) {
        this._dataSource.stop();
        this._els.btnToggleGesture.textContent = 'Start';
        this._els.btnToggleGesture.classList.remove('active');
        this._els.liveDot.classList.remove('active');
      } else {
        this._dataSource.start();
        this._els.btnToggleGesture.textContent = 'Stop';
        this._els.btnToggleGesture.classList.add('active');
        this._els.liveDot.classList.add('active');
      }
    });

    // Gesture motion select
    this._els.selectGestureMotion.addEventListener('change', (e) => {
      if (this._dataSource.mode !== undefined) {
        this._dataSource.mode = e.target.value;
      }
    });

    // ML logging toggle
    this._els.btnLogToggle.addEventListener('click', () => {
      this._isLogging = !this._isLogging;
      this._gestureEngine.logging = this._isLogging;
      this._els.btnLogToggle.textContent = this._isLogging ? 'Stop Rec' : 'Record';
      this._els.btnLogToggle.classList.toggle('recording', this._isLogging);
    });

    // ML export
    this._els.btnLogExport.addEventListener('click', () => {
      this._gestureEngine.exportTrainingData();
    });
  }

  // ---- Mode Change Handling ----

  _listenToModeChanges() {
    this._modeManager.onChange((newMode, prevMode) => {
      this._updateModeUI(newMode);
    });
  }

  _updateModeUI(mode) {
    // Update tab active states (only for non-mouse modes)
    if (mode !== MODES.MOUSE) {
      this._els.modeTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
      });
    }

    // Show/hide mode-specific sections
    const isSim = mode === MODES.SIMULATION;
    const isGesture = mode === MODES.GESTURE;
    const isMouse = mode === MODES.MOUSE;

    this._els.simControls.classList.toggle('hidden', !isSim);
    this._els.gestureControls.classList.toggle('hidden', !isGesture);
    this._els.gestureDisplay.classList.toggle('hidden', !isGesture);

    // Ctrl indicator
    this._els.ctrlIndicator.classList.toggle('hidden', !isMouse);
    this._els.modeHint.classList.toggle('hidden', isMouse);

    // Mouse status overlay
    this._els.mouseStatus.classList.toggle('hidden', !isMouse);
  }

  // ---- Gesture Grid ----

  _buildGestureGrid() {
    const grid = this._els.gestureGrid;
    grid.innerHTML = '';

    for (const gesture of this._gestureEngine.gestures) {
      const chip = document.createElement('div');
      chip.className = 'gesture-chip';
      chip.dataset.gesture = gesture.name;
      chip.title = gesture.description;
      chip.innerHTML = `
        <span class="chip-emoji">${gesture.emoji}</span>
        <span class="chip-label">${gesture.display}</span>
      `;
      grid.appendChild(chip);
    }
  }

  // ---- Debug Panel Updates ----

  updateDebugPanel() {
    const state = this._animator.currentState;

    // Finger bars and values
    for (const name of FINGER_NAMES) {
      const el = this._fingerEls[name];
      if (!el) continue;
      const val = state.fingers[name];
      if (el.bar) el.bar.style.width = `${(val * 100).toFixed(0)}%`;
      if (el.val) el.val.textContent = val.toFixed(2);
    }

    // Orientation
    if (this._orientEls.roll)
      this._orientEls.roll.textContent = state.orientation.roll.toFixed(1);
    if (this._orientEls.pitch)
      this._orientEls.pitch.textContent = state.orientation.pitch.toFixed(1);
    if (this._orientEls.yaw)
      this._orientEls.yaw.textContent = state.orientation.yaw.toFixed(1);

    // FPS
    if (this._els.fps)
      this._els.fps.textContent = this._sceneManager.fps;
  }

  /** Update gesture display */
  updateGestureDisplay() {
    const gesture = this._gestureEngine.currentGesture;
    const confidence = this._gestureEngine.confidence;

    if (gesture) {
      this._els.gestureEmoji.textContent = gesture.emoji;
      this._els.gestureEmoji.classList.add('detected');
      this._els.gestureName.textContent = gesture.display;
    } else {
      this._els.gestureEmoji.textContent = '-';
      this._els.gestureEmoji.classList.remove('detected');
      this._els.gestureName.textContent = 'No gesture detected';
    }

    // Confidence bar
    const pct = (confidence * 100).toFixed(0);
    this._els.confidenceFill.style.width = `${pct}%`;
    this._els.confidenceValue.textContent = `${pct}%`;

    // Update gesture grid chips
    const chips = this._els.gestureGrid.querySelectorAll('.gesture-chip');
    chips.forEach(chip => {
      chip.classList.toggle('active', gesture && chip.dataset.gesture === gesture.name);
    });
  }

  /** Update mouse mode status */
  updateMouseStatus() {
    if (!this._mouseController.isActive) return;

    const pos = this._mouseController.position;
    this._els.mouseX.textContent = Math.round(pos.x);
    this._els.mouseY.textContent = Math.round(pos.y);

    const isFist = this._mouseController.isFistClosed;
    this._els.mouseFistStatus.textContent = isFist ? 'CLICK' : 'OPEN';
    this._els.mouseFistStatus.className = isFist ? 'fist-closed' : 'fist-open';
  }

  /** Hide loading screen */
  hideLoading() {
    this._els.loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      this._els.loadingScreen.style.display = 'none';
    }, 500);
  }

  /** Update the data source label */
  _updateSourceLabel() {
    const type = this._dataSource.sourceType;
    this._els.sourceLabel.textContent = type === 'synthetic' ? 'Synthetic' : 'Hardware';
    this._els.sourceLabel.className = 'badge' + (type === 'hardware' ? ' hardware' : '');
  }

  /** Hot-swap data source */
  setDataSource(newSource) {
    const wasRunning = this._dataSource.isRunning;
    if (wasRunning) this._dataSource.stop();
    this._dataSource = newSource;
    this._updateSourceLabel();
    if (wasRunning) this._dataSource.start();
  }
}
