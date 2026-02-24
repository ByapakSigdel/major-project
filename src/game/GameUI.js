/**
 * GameUI - Sci-Fi HUD for Project ECHO
 *
 * Features:
 *   - ARIA typewriter dialogue system
 *   - Keypad input overlay
 *   - Terminal choice overlay
 *   - Scan-line transitions
 *   - Two-ending win screen
 *   - Room progress, inventory, clues, debug panel
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
      winTitle: document.getElementById('win-title'),
      winDesc: document.getElementById('win-desc'),
      btnPlayAgain: document.getElementById('btn-play-again'),
      loadingScreen: document.getElementById('loading-screen'),
      ariaBox: document.getElementById('aria-dialogue'),
      ariaText: document.getElementById('aria-text'),
      keypadOverlay: document.getElementById('keypad-overlay'),
      keypadDisplay: document.getElementById('keypad-display-text'),
      keypadButtons: document.getElementById('keypad-buttons'),
      terminalOverlay: document.getElementById('terminal-overlay'),
      terminalTitle: document.getElementById('terminal-title'),
      terminalDesc: document.getElementById('terminal-desc'),
      terminalChoices: document.getElementById('terminal-choices'),
      fps: document.getElementById('g-val-fps'),
    };

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
    this._ariaTimer = null;
    this._ariaQueue = [];
    this._keypadCallback = null;
    this._gameStartTime = Date.now();

    this._bindEvents();
  }

  _bindEvents() {
    // Clue dismiss
    if (this._els.clueDismiss) {
      this._els.clueDismiss.addEventListener('click', () => {
        this._els.clueDisplay.classList.add('hidden');
        if (this._clueCallback) this._clueCallback();
      });
    }

    window.addEventListener('keydown', (e) => {
      // Dismiss clue
      if (this._els.clueDisplay && !this._els.clueDisplay.classList.contains('hidden')) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          this._els.clueDisplay.classList.add('hidden');
          if (this._clueCallback) this._clueCallback();
        }
      }
      // Close keypad on Escape
      if (this._els.keypadOverlay && !this._els.keypadOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          this._els.keypadOverlay.classList.add('hidden');
          this._keypadCallback = null;
        }
      }
      // Close terminal on Escape
      if (this._els.terminalOverlay && !this._els.terminalOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          this._els.terminalOverlay.classList.add('hidden');
        }
      }
    });
  }

  // ---- Loading ----

  hideLoading() {
    if (!this._els.loadingScreen) return;
    this._els.loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      this._els.loadingScreen.style.display = 'none';
    }, 500);
  }

  // ---- Room Progress ----

  setActiveRoom(index) {
    this._els.roomDots.forEach((dot, i) => {
      dot.classList.remove('active');
      if (i < index) dot.classList.add('completed');
    });
    if (this._els.roomDots[index]) {
      this._els.roomDots[index].classList.add('active');
    }
  }

  // ---- Cursor ----

  setGrabbing(isGrabbing) {
    if (!this._els.handCursor) return;
    if (isGrabbing) {
      this._els.handCursor.classList.add('grabbing');
      this._els.grabIndicator?.classList.remove('hidden');
    } else {
      this._els.handCursor.classList.remove('grabbing');
      this._els.grabIndicator?.classList.add('hidden');
    }
  }

  setTargeting(isTargeting) {
    if (!this._els.handCursor) return;
    if (isTargeting) {
      this._els.handCursor.classList.add('targeting');
    } else {
      this._els.handCursor.classList.remove('targeting');
    }
  }

  showInteractPrompt(show, text = 'to interact') {
    if (!this._els.interactPrompt) return;
    if (show) {
      this._els.interactPrompt.classList.remove('hidden');
      const promptText = this._els.interactPrompt.querySelector('.prompt-text');
      if (promptText) promptText.textContent = text;
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
    if (!this._els.inventory) return;
    this._els.inventory.innerHTML = '';
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
    if (!this._els.messageText || !this._els.message) return;
    this._els.messageText.textContent = text;
    this._els.message.classList.remove('hidden');
    clearTimeout(this._messageTimer);
    this._messageTimer = setTimeout(() => {
      this._els.message.classList.add('hidden');
    }, duration);
  }

  // ---- Clues ----

  showClue(title, text, callback) {
    if (!this._els.clueDisplay) return;
    this._els.clueTitle.textContent = title;
    this._els.clueText.textContent = text;
    this._els.clueDisplay.classList.remove('hidden');
    this._clueCallback = callback || null;
  }

  // ---- ARIA Dialogue (typewriter effect) ----

  ariaSpeak(text, duration = 6000) {
    if (!this._els.ariaBox || !this._els.ariaText) return;
    clearTimeout(this._ariaTimer);

    this._els.ariaBox.classList.remove('hidden');
    this._els.ariaText.textContent = '';

    // Typewriter
    let i = 0;
    const type = () => {
      if (i < text.length) {
        this._els.ariaText.textContent += text[i];
        i++;
        this._ariaTimer = setTimeout(type, 25 + Math.random() * 15);
      } else {
        // Auto-dismiss after duration
        this._ariaTimer = setTimeout(() => {
          this._els.ariaBox.classList.add('hidden');
        }, duration);
      }
    };
    type();
  }

  // ---- Keypad Overlay ----

  showKeypad(currentInput, callback) {
    if (!this._els.keypadOverlay) return;
    this._keypadCallback = callback;
    this._els.keypadDisplay.textContent = currentInput || '';
    this._els.keypadOverlay.classList.remove('hidden');

    // Clear previous listeners
    const newButtons = this._els.keypadButtons.cloneNode(true);
    this._els.keypadButtons.parentNode.replaceChild(newButtons, this._els.keypadButtons);
    this._els.keypadButtons = newButtons;

    // Bind buttons
    newButtons.querySelectorAll('.kp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        if (this._keypadCallback) {
          const result = this._keypadCallback(val);
          if (result) {
            this._els.keypadDisplay.textContent = result.display;
            if (result.done) {
              setTimeout(() => {
                this._els.keypadOverlay.classList.add('hidden');
                this._keypadCallback = null;
              }, 1000);
            }
          }
        }
      });
    });
  }

  // ---- Terminal Choice Overlay ----

  showTerminalChoice(title, desc, choices, callback) {
    if (!this._els.terminalOverlay) return;
    this._els.terminalTitle.textContent = title;
    this._els.terminalDesc.textContent = desc;
    this._els.terminalChoices.innerHTML = '';

    choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'terminal-choice-btn';
      btn.innerHTML = `<span class="choice-label">${choice.label}</span><span class="choice-desc">${choice.desc}</span>`;
      btn.addEventListener('click', () => {
        this._els.terminalOverlay.classList.add('hidden');
        if (callback) callback(choice.id);
      });
      this._els.terminalChoices.appendChild(btn);
    });

    this._els.terminalOverlay.classList.remove('hidden');
  }

  // ---- Room Transition ----

  showTransition(title, subtitle) {
    return new Promise((resolve) => {
      if (!this._els.transition) { resolve(); return; }
      this._els.transTitle.textContent = title;
      this._els.transSubtitle.textContent = subtitle;
      this._els.transition.classList.remove('hidden');
      this._els.transition.style.animation = 'none';
      void this._els.transition.offsetWidth;
      this._els.transition.style.animation = 'transitionFade 2.5s ease-in-out';

      setTimeout(() => {
        this._els.transition.classList.add('hidden');
        resolve();
      }, 2500);
    });
  }

  // ---- Win Screen ----

  showWinScreen(elapsedSeconds, ending = 'wake') {
    if (!this._els.winScreen) return;
    // Calculate time from game start if elapsedSeconds is 0
    const elapsed = elapsedSeconds || (Date.now() - this._gameStartTime) / 1000;
    const mins = Math.floor(elapsed / 60);
    const secs = Math.floor(elapsed % 60);
    if (this._els.winTime) this._els.winTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    if (ending === 'wake') {
      if (this._els.winTitle) this._els.winTitle.textContent = 'YOU WOKE UP';
      if (this._els.winDesc) this._els.winDesc.textContent = 'The simulation dissolves. Light floods your vision. You hear voices — real voices. Doctor Mercer, welcome back to reality.';
    } else {
      if (this._els.winTitle) this._els.winTitle.textContent = 'YOU STAYED';
      if (this._els.winDesc) this._els.winDesc.textContent = 'The facility dims to a comfortable glow. ARIA hums softly. In this digital world, you are safe. You are home. But is it real?';
    }

    this._els.winScreen.classList.remove('hidden');
  }

  setGameStartTime(t) {
    this._gameStartTime = t;
  }

  onPlayAgain(callback) {
    if (this._els.btnPlayAgain) {
      this._els.btnPlayAgain.addEventListener('click', callback);
    }
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
