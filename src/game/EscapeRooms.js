/**
 * EscapeRooms - Defines the 3 escape room puzzles
 * 
 * Room 1: "The Study" - Find a key hidden under objects to unlock the door
 * Room 2: "The Laboratory" - Press colored buttons in the right order (clue on wall)
 * Room 3: "The Vault" - Find 2 key halves and combine them at the safe
 * 
 * Each room returns a setup function and a state object for tracking puzzle progress.
 */

import * as THREE from 'three';

// ============================================================
//  ROOM 1: THE STUDY
//  Puzzle: Find the golden key hidden behind a book on the shelf,
//  read the note on the desk for a hint, use key on the door.
// ============================================================

export function createRoom1(builder, inventory) {
  const state = {
    solved: false,
    keyFound: false,
    noteRead: false,
    objects: {},
  };

  // Room shell - warm study with wooden tones
  builder.createRoom(6, 3.2, 6, {
    wallMaterial: new THREE.MeshStandardMaterial({ color: 0x9a8878, roughness: 0.8, metalness: 0.05 }),
    floorMaterial: new THREE.MeshStandardMaterial({ color: 0x806850, roughness: 0.7, metalness: 0.1 }),
    ceilingMaterial: new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.9 }),
    noDoorFront: false,
  });

  // Lighting - well-lit study
  builder.createCeilingLight(0, 3.15, 0, 0xffeedd, 3.0);
  builder.createLamp(-2, 0, -2.2, 0xffddaa, 1.2);

  // Furniture
  const desk = builder.createTable(0, 0, -1.5, 1.4, 0.7, 0.76);
  builder.createChair(0, 0, -0.8);
  builder.createBookshelf(-2.6, 0, -2.5);
  builder.createBookshelf(2.6, 0, -2.5);

  // Paintings
  builder.createPainting(-2.9, 1.8, 0, 0x1a2a4a, 0xcc8833);
  builder.createPainting(2.9, 1.8, 0, 0x2a1a2a, 0x33cc88);

  // ---- Puzzle Objects ----

  // Note on desk (clue)
  state.objects.note = builder.createNote(
    0.2, 0.8, -1.5,
    '"The key to freedom is always closer than you think. Look behind what others display proudly."',
    'Mysterious Note'
  );

  // Golden key (hidden on shelf, slightly behind books)
  state.objects.key = builder.createKey(-2.3, 1.05, -2.3, 'gold', 'room1_key');

  // Exit door (back wall)
  state.objects.door = builder.createDoor(0, 0, -2.95, 'room1_key');

  // Red herrings (grabbable but not useful)
  builder.createVase(2.2, 0.8, -1.5);
  builder.createBox(-1.8, 0, 1.5, 0.25);
  builder.createSphere(1.5, 0.8, -1.5, 0.06, 0xff4444);

  // Clock on wall (decorative, but adds atmosphere)
  builder.createClock(2.9, 2.0, -1.0, '7:45');

  return {
    state,
    name: 'The Study',
    subtitle: 'Find the key to escape...',
    bounds: { x: 2.5, z: 2.5 }, // 6×6 room with margin
    checkSolved: () => state.solved,
    handleInteraction: (obj, heldItem, addToInventory, showClue, showMessage, unlockDoor) => {
      // Note interaction
      if (obj.userData.interactionType === 'clue') {
        showClue(obj.userData.clueTitle, obj.userData.clueText);
        state.noteRead = true;
        return;
      }

      // Door interaction
      if (obj.userData.interactionType === 'door' && obj.userData.lockId === 'room1_key') {
        if (heldItem && heldItem.userData.keyId === 'room1_key') {
          unlockDoor(obj);
          state.solved = true;
          showMessage('The door unlocks! You can proceed to the next room.');
        } else if (inventory.has('room1_key')) {
          unlockDoor(obj);
          state.solved = true;
          showMessage('The door unlocks with the golden key!');
        } else {
          showMessage('The door is locked. You need a key.');
        }
        return;
      }
    },
    handleGrab: (obj, addToInventory, showMessage) => {
      if (obj.userData.keyId === 'room1_key') {
        state.keyFound = true;
        addToInventory(obj);
        if (showMessage) showMessage('You found the Golden Key!');
      }
    },
  };
}

// ============================================================
//  ROOM 2: THE LABORATORY
//  Puzzle: Press 3 colored buttons in the correct sequence.
//  Clue: A note says "The elements align: Water, Fire, Earth"
//  which maps to Blue, Red, Green.
// ============================================================

export function createRoom2(builder, inventory) {
  const state = {
    solved: false,
    sequence: [],
    correctSequence: ['blue', 'red', 'green'],
    buttonsPressed: { red: false, green: false, blue: false },
    objects: {},
  };

  // Room shell (clean lab feel with lighter tones)
  builder.createRoom(7, 3.5, 7, {
    wallMaterial: new THREE.MeshStandardMaterial({ color: 0x8898a8, roughness: 0.8, metalness: 0.15 }),
    floorMaterial: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.5, metalness: 0.25 }),
    ceilingMaterial: new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.9 }),
  });

  // Lab lighting (bright clinical fluorescent feel)
  builder.createCeilingLight(0, 3.45, 0, 0xdde8ff, 3.5);

  // Lab tables
  builder.createTable(-2, 0, -2, 1.6, 0.8, 0.9);
  builder.createTable(2, 0, -2, 1.6, 0.8, 0.9);
  builder.createTable(0, 0, 2, 2.0, 0.8, 0.8);

  // Shelf with lab equipment
  builder.createShelf(-3.1, 0, 0, 0.8, 2.0, 0.3, 3);

  // ---- Puzzle: Color buttons on the back wall ----
  state.objects.blueBtn = builder.createButton(-1, 1.5, -3.4, 'blue', 'blue');
  state.objects.redBtn = builder.createButton(0, 1.5, -3.4, 'red', 'red');
  state.objects.greenBtn = builder.createButton(1, 1.5, -3.4, 'green', 'green');

  // Clue note on lab table
  state.objects.note = builder.createNote(
    -1.8, 0.92, -2,
    '"The elements must align in proper order: Water flows first, then Fire burns, and Earth grounds last."',
    'Lab Journal'
  );

  // Second clue (on right table)
  state.objects.note2 = builder.createNote(
    2.2, 0.92, -2,
    '"Color Code Reference: Water = Blue, Fire = Red, Earth = Green. The sequence is everything."',
    'Color Reference Card'
  );

  // Exit door
  state.objects.door = builder.createDoor(0, 0, -3.45, 'room2_sequence');

  // Decorative objects
  builder.createSphere(-2.5, 0.92, -2, 0.08, 0x44aaff); // blue flask
  builder.createSphere(2.5, 0.92, -2, 0.08, 0xff6633);   // red flask
  builder.createBox(0.5, 0.92, 2, 0.15, 0x334455);
  builder.createVase(-3.0, 1.0, 0.2);

  return {
    state,
    name: 'The Laboratory',
    subtitle: 'Crack the color code...',
    bounds: { x: 3.0, z: 3.0 }, // 7×7 room with margin
    checkSolved: () => state.solved,
    handleInteraction: (obj, heldItem, addToInventory, showClue, showMessage, unlockDoor) => {
      // Clue notes
      if (obj.userData.interactionType === 'clue') {
        showClue(obj.userData.clueTitle, obj.userData.clueText);
        return;
      }

      // Button press
      if (obj.userData.interactionType === 'button') {
        const color = obj.userData.buttonId;

        // Visual feedback: push button in
        const btnMesh = obj.children.find(c => c.userData.buttonMesh);
        if (btnMesh) {
          btnMesh.position.z = 0.01;
          setTimeout(() => { btnMesh.position.z = 0.025; }, 300);
        }

        state.sequence.push(color);
        showMessage(`Pressed: ${state.sequence.map(c => c.toUpperCase()).join(' → ')}`);

        // Check sequence when 3 buttons pressed
        if (state.sequence.length === 3) {
          const correct = state.sequence.every((c, i) => c === state.correctSequence[i]);
          if (correct) {
            state.solved = true;
            unlockDoor(state.objects.door);
            showMessage('Correct sequence! The door unlocks!');
          } else {
            showMessage('Wrong sequence! Resetting...');
            state.sequence = [];
          }
        }
        return;
      }

      // Door
      if (obj.userData.interactionType === 'door') {
        if (state.solved) {
          showMessage('The door is unlocked! Proceed!');
        } else {
          showMessage('This door requires the correct button sequence. Look for clues...');
        }
        return;
      }
    },
    handleGrab: (obj, addToInventory, showMessage) => {},
  };
}

// ============================================================
//  ROOM 3: THE VAULT
//  Puzzle: Find a red key card (in a vase) and a blue key card 
//  (under a box). Use both on the safe to get the exit key.
//  Then use the exit key on the final door.
// ============================================================

export function createRoom3(builder, inventory) {
  const state = {
    solved: false,
    redCardFound: false,
    blueCardFound: false,
    safeOpened: false,
    exitKeyFound: false,
    objects: {},
  };

  // Room shell (vault-like but still visible - polished concrete/steel)
  builder.createRoom(8, 4, 8, {
    wallMaterial: new THREE.MeshStandardMaterial({ color: 0x6a6a78, roughness: 0.65, metalness: 0.25 }),
    floorMaterial: new THREE.MeshStandardMaterial({ color: 0x585860, roughness: 0.45, metalness: 0.35 }),
    ceilingMaterial: new THREE.MeshStandardMaterial({ color: 0x808088, roughness: 0.8 }),
  });

  // Dramatic but well-lit lighting
  builder.createCeilingLight(0, 3.95, 0, 0xffeedd, 3.5);
  builder.createLamp(-3, 0, -3, 0xffaa77, 1.2);
  builder.createLamp(3, 0, -3, 0x88aaff, 1.2);

  // Furniture
  builder.createTable(0, 0, -2, 1.8, 0.8, 0.8);
  builder.createShelf(-3.5, 0, -3.5, 1.0, 2.5, 0.35, 5);
  builder.createShelf(3.5, 0, -3.5, 1.0, 2.5, 0.35, 5);
  builder.createChair(-1, 0, -1);
  builder.createChair(1, 0, -1);

  // Paintings (decorative)
  builder.createPainting(-3.9, 2.2, 0, 0x0a1a3a, 0xffd700);
  builder.createPainting(3.9, 2.2, 0, 0x3a0a1a, 0x00ffd7);

  // Clock with time hint
  builder.createClock(0, 2.5, -3.9, '12:00');

  // ---- Puzzle Objects ----

  // Red key card (inside vase on shelf)
  state.objects.redCard = builder.createKey(-3.2, 1.55, -3.3, 'red', 'red_card');
  state.objects.redCard.userData.displayName = 'Red Key Card';

  // Blue key card (behind box on table)
  state.objects.blueCard = builder.createKey(0.5, 0.88, -2.0, 'blue', 'blue_card');
  state.objects.blueCard.userData.displayName = 'Blue Key Card';

  // Vase (near red card, acts as visual hint)
  builder.createVase(-3.0, 1.2, -3.3);

  // Box covering blue card hint
  builder.createBox(0.5, 0, -2, 0.2, 0x444455);

  // Note on desk (main clue)
  state.objects.note = builder.createNote(
    -0.3, 0.88, -2,
    '"Two halves make a whole. Red hides among ancient relics on the left. Blue rests beneath what seems ordinary on the desk."',
    'Vault Memo'
  );

  // Second note (on right shelf)
  state.objects.note2 = builder.createNote(
    3.6, 1.3, -3.5,
    '"The safe accepts two cards. Insert both to reveal the final key. Only then will freedom be yours."',
    'Security Protocol'
  );

  // The Safe (needs both cards)
  state.objects.safe = builder.createSafe(0, 0, -3.5, 'vault_safe');

  // Exit door (final door!)
  state.objects.door = builder.createDoor(0, 0, 3.95, 'exit_key');
  state.objects.door.rotation.y = Math.PI;

  // Decorative items
  builder.createSphere(-2, 0.88, -2, 0.07, 0xcc44cc);
  builder.createSphere(2, 0, 2, 0.12, 0x666688);
  builder.createBox(-2.5, 0, 2, 0.3, 0x554433);
  builder.createBox(2.5, 0, 2, 0.25, 0x443344);

  return {
    state,
    name: 'The Vault',
    subtitle: 'The final challenge awaits...',
    bounds: { x: 3.5, z: 3.5 }, // 8×8 room with margin
    checkSolved: () => state.solved,
    handleInteraction: (obj, heldItem, addToInventory, showClue, showMessage, unlockDoor) => {
      // Clue notes
      if (obj.userData.interactionType === 'clue') {
        showClue(obj.userData.clueTitle, obj.userData.clueText);
        return;
      }

      // Safe interaction
      if (obj.userData.interactionType === 'safe') {
        if (state.safeOpened) {
          showMessage('The safe is already open.');
          return;
        }

        const hasRed = inventory.has('red_card') || (heldItem && heldItem.userData.keyId === 'red_card');
        const hasBlue = inventory.has('blue_card') || (heldItem && heldItem.userData.keyId === 'blue_card');

        if (hasRed && hasBlue) {
          state.safeOpened = true;
          // Unlock safe visually
          const lockIndicator = obj.children.find(c =>
            c.children?.find(cc => cc.userData.lockIndicator) || c.userData.lockIndicator
          );
          if (lockIndicator) {
            lockIndicator.material = new THREE.MeshStandardMaterial({
              color: 0x22ff44, emissive: 0x22ff44, emissiveIntensity: 0.5
            });
          }
          obj.userData.locked = false;

          // Spawn exit key inside safe
          state.objects.exitKey = builder.createKey(0, 0.25, -3.2, 'gold', 'exit_key');
          state.objects.exitKey.userData.displayName = 'Exit Key';
          state.exitKeyFound = true;

          showClue('Safe Opened!', 'The safe clicks open revealing a golden key! This must be the way out!');
          inventory.delete('red_card');
          inventory.delete('blue_card');
        } else {
          const missing = [];
          if (!hasRed) missing.push('Red Key Card');
          if (!hasBlue) missing.push('Blue Key Card');
          showMessage(`The safe requires two key cards. Missing: ${missing.join(', ')}`);
        }
        return;
      }

      // Exit door
      if (obj.userData.interactionType === 'door' && obj.userData.lockId === 'exit_key') {
        if (heldItem && heldItem.userData.keyId === 'exit_key') {
          unlockDoor(obj);
          state.solved = true;
        } else if (inventory.has('exit_key')) {
          unlockDoor(obj);
          state.solved = true;
        } else {
          showMessage('The exit door is locked. You need the exit key from the safe.');
        }
        return;
      }
    },
    handleGrab: (obj, addToInventory, showMessage) => {
      if (obj.userData.keyId === 'red_card') {
        state.redCardFound = true;
        addToInventory(obj);
        if (showMessage) showMessage('You found a Red Key Card!');
      } else if (obj.userData.keyId === 'blue_card') {
        state.blueCardFound = true;
        addToInventory(obj);
        if (showMessage) showMessage('You found a Blue Key Card!');
      } else if (obj.userData.keyId === 'exit_key') {
        addToInventory(obj);
        if (showMessage) showMessage('You picked up the Exit Key!');
      }
    },
  };
}
