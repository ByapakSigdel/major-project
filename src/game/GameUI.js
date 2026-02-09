/**
 * GameUI - Manages all game HUD elements
 * 
 * Handles:
 *   - Room progress indicator
 *   - Inventory display
 *   - Messages and clues
 *   - Room transitions
 *   - Win screen
 *   - Debug sensor panel
 */

export class GameUI {
  constructor() {
    this._els = {
      roomDots: document.querySelectorAll('.room-dot'),
      handCursor: document.getElementById('hand-cursor'),
      grabIndicator: document.getElementById('grab-indicator'),
      interactPrompt: document.getElementById('interact-prompt'),
      inventory: document.getElementById('inventory-slots'),
      message: document.getElementById('game-message'),
      messageText: document.getElementById('message-text'),
      clueDisplay: document.getElementById('clue-display'),
      clueTitle: document.getElementById('clue-title'),
      clueText: document.getElementById('clue-text'),
      clueDismiss: document.getElementById('clue-dismiss'),
      transition: document.getElementById('room-transition'),
      transTitle: document.getElementById('transition-title'),
      transSubtitle: document.getElementById('transition-subtitle'),
      winScreen: document.getElementById('win-screen'),
      winTime: document.getElementById('win-time'),
      btnPlayAgain: document.getElementById('btn-play-again'),
      loadingScreen: document.getElementById('loading-screen'),
      // Debug
      fps: document.getElementById('g-val-fps'),
    };

    // Finger debug elements
    this._fingerEls = {};
    for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      this._fingerEls[name] = document.getElementById(`g-val-${name}`);
    }
    this._orientEls = {
      roll: document.getElementById('g-val-roll'),
      pitch: document.getElementById('g-val-pitch'),
      yaw: document.getElementById('g-val-yaw'),
    };

    this._messageTimer = null;
    this._clueCallback = null;
    this._inventoryItems = [];

    this._bindEvents();
  }

  _bindEvents() {
    this._els.clueDismiss.addEventListener('click', () => {
      this._els.clueDisplay.classList.add('hidden');
      if (this._clueCallback) this._clueCallback();
    });

    // Also dismiss clue on any key press
    window.addEventListener('keydown', (e) => {
      if (!this._els.clueDisplay.classList.contains('hidden')) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          this._els.clueDisplay.classList.add('hidden');
          if (this._clueCallback) this._clueCallback();
        }
      }
    });
  }

  // ---- Loading ----

  hideLoading() {
    this._els.loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      this._els.loadingScreen.style.display = 'none';
    }, 500);
  }

  // ---- Room Progress ----

  setActiveRoom(index) {
    this._els.roomDots.forEach((dot, i) => {
      dot.classList.remove('active');
      if (i < index) {
        dot.classList.add('completed');
      }
    });
    if (this._els.roomDots[index]) {
      this._els.roomDots[index].classList.add('active');
    }
  }

  // ---- Cursor ----

  setGrabbing(isGrabbing) {
    if (isGrabbing) {
      this._els.handCursor.classList.add('grabbing');
      this._els.grabIndicator.classList.remove('hidden');
    } else {
      this._els.handCursor.classList.remove('grabbing');
      this._els.grabIndicator.classList.add('hidden');
    }
  }

  showInteractPrompt(show, text = 'to grab') {
    if (show) {
      this._els.interactPrompt.classList.remove('hidden');
      this._els.interactPrompt.querySelector('.prompt-text').textContent = text;
    } else {
      this._els.interactPrompt.classList.add('hidden');
    }
  }

  // ---- Inventory ----

  addInventoryItem(item) {
    this._inventoryItems.push(item);
    this._renderInventory();
  }

  removeInventoryItem(keyId) {
    this._inventoryItems = this._inventoryItems.filter(i => i.keyId !== keyId);
    this._renderInventory();
  }

  clearInventory() {
    this._inventoryItems = [];
    this._renderInventory();
  }

  _renderInventory() {
    this._els.inventory.innerHTML = '';
    // Always show at least 4 slots
    const slotCount = Math.max(4, this._inventoryItems.length);
    for (let i = 0; i < slotCount; i++) {
      const slot = document.createElement('div');
      slot.className = 'inventory-slot';
      if (this._inventoryItems[i]) {
        slot.classList.add('filled');
        slot.textContent = this._inventoryItems[i].emoji || '?';
        slot.title = this._inventoryItems[i].name || 'Item';
      }
      this._els.inventory.appendChild(slot);
    }
  }

  // ---- Messages ----

  showMessage(text, duration = 3000) {
    this._els.messageText.textContent = text;
    this._els.message.classList.remove('hidden');
    clearTimeout(this._messageTimer);
    this._messageTimer = setTimeout(() => {
      this._els.message.classList.add('hidden');
    }, duration);
  }

  // ---- Clues ----

  showClue(title, text, callback) {
    this._els.clueTitle.textContent = title;
    this._els.clueText.textContent = text;
    this._els.clueDisplay.classList.remove('hidden');
    this._clueCallback = callback || null;
  }

  // ---- Room Transition ----

  showTransition(title, subtitle) {
    return new Promise((resolve) => {
      this._els.transTitle.textContent = title;
      this._els.transSubtitle.textContent = subtitle;
      this._els.transition.classList.remove('hidden');
      this._els.transition.style.animation = 'none';
      void this._els.transition.offsetWidth; // force reflow
      this._els.transition.style.animation = 'transitionFade 2s ease-in-out';

      setTimeout(() => {
        this._els.transition.classList.add('hidden');
        resolve();
      }, 2000);
    });
  }

  // ---- Win Screen ----

  showWinScreen(elapsedSeconds) {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = Math.floor(elapsedSeconds % 60);
    this._els.winTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    this._els.winScreen.classList.remove('hidden');
  }

  onPlayAgain(callback) {
    this._els.btnPlayAgain.addEventListener('click', callback);
  }

  // ---- Debug Panel ----

  updateDebug(state, fps) {
    if (state && state.fingers) {
      for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        if (this._fingerEls[name]) {
          this._fingerEls[name].textContent = (state.fingers[name] || 0).toFixed(2);
        }
      }
    }
    if (state && state.orientation) {
      if (this._orientEls.roll) this._orientEls.roll.textContent = state.orientation.roll.toFixed(1);
      if (this._orientEls.pitch) this._orientEls.pitch.textContent = state.orientation.pitch.toFixed(1);
      if (this._orientEls.yaw) this._orientEls.yaw.textContent = state.orientation.yaw.toFixed(1);
    }
    if (this._els.fps) this._els.fps.textContent = fps;
  }
}
