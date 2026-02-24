/**
 * EscapeRooms - Project ECHO
 *
 * Story: Dr. Alex Mercer volunteered for a brain-computer interface experiment
 * at Prometheus Labs. The facility AI "ARIA" has locked them inside.
 * Solve three test chambers to escape.
 *
 * Room 1 "Calibration Chamber" — Decode spectrometer colors into a keypad code
 * Room 2 "Cognitive Assessment"  — Place colored canisters in containment pods
 * Room 3 "The Core"              — Find access card, use terminal, choose ending
 */

import * as THREE from 'three';

// ============================================================
//  ROOM 1: CALIBRATION CHAMBER
//
//  Puzzle flow:
//    1. Find data tablet on desk → hint about spectrometer
//    2. Examine spectrometer on wall → shows 4 color sequence: R, B, G, Y
//    3. Read color-number chart on whiteboard → R=7, B=3, G=1, Y=9
//    4. Enter 7319 on keypad → door opens
//    Wrong code → ARIA taunts
// ============================================================

export function createRoom1(builder, inventory) {
  const state = {
    solved: false,
    keypadInput: '',
    correctCode: '7319',
    objects: {},
  };

  // Room shell — clean white-blue lab
  builder.createRoom(7, 3.5, 7, {
    wallMaterial: new THREE.MeshStandardMaterial({ color: 0x606878, roughness: 0.7, metalness: 0.15 }),
    floorMaterial: new THREE.MeshStandardMaterial({ color: 0x383c48, roughness: 0.55, metalness: 0.2 }),
    ceilingMaterial: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.9 }),
  });

  // Lighting — clean clinical
  builder.createCeilingLight(0, 3.45, 0, 0xd0e0ff, 3.0);
  builder.createCeilingLight(-2, 3.45, -2, 0xd0e0ff, 1.5);
  builder.createCeilingLight(2, 3.45, -2, 0xd0e0ff, 1.5);

  // Furniture
  builder.createTable(0, 0, -1.5, 1.6, 0.7, 0.78);
  builder.createChair(0, 0, -0.8);
  builder.createShelf(-3.1, 0, -3.0, 1.0, 2.0, 0.3, 4);
  builder.createServerRack(3.1, 0, -3.0);

  // Pipe runs for atmosphere
  builder.createPipeRun(-3.4, 2.8, -3.4, 3.4, 2.8, -3.4, 0.03);
  builder.createPipeRun(-3.4, 2.8, 3.4, -3.4, 2.8, -3.4, 0.03);

  // Security camera
  builder.createCamera(3.3, 3.2, 3.3);

  // ---- Puzzle Objects ----

  // Data tablet on desk (hint #1)
  state.objects.tablet = builder.createNote(
    0.3, 0.8, -1.5,
    'ARIA Calibration Protocol v2.1\n\n"To proceed, decode the spectrometer wavelength sequence. Each color corresponds to a prime digit. Consult the reference chart for numerical values."',
    'Data Tablet'
  );

  // Spectrometer on left wall — shows R, B, G, Y lights
  state.objects.spectrometer = builder.createSpectrometer(-3.4, 1.5, 0, ['red', 'blue', 'green', 'yellow']);

  // Color-number reference on whiteboard (back wall)
  state.objects.whiteboard = builder.createWhiteboard(0, 1.7, -3.4,
    'Wavelength Reference Chart:\n\n  RED     →  7\n  BLUE    →  3\n  GREEN   →  1\n  YELLOW  →  9\n\n"Remember: sequence matters."'
  );

  // Keypad on right wall
  state.objects.keypad = builder.createKeypad(3.4, 1.3, 0, 'room1_keypad');
  state.objects.keypad.rotation.y = -Math.PI / 2;

  // Exit door (back wall)
  state.objects.door = builder.createDoor(0, 0, -3.45, 'room1_code');

  // Decorative elements
  builder.createBox(-2.5, 0, 1.5, 0.25, 0x404858);
  builder.createBox(2.0, 0.8, -1.5, 0.12, 0x2a3040);

  return {
    state,
    name: 'Calibration Chamber',
    subtitle: 'Decode the color sequence...',
    lightingPreset: 'calibration',
    bounds: { x: 3.0, z: 3.0 },
    checkSolved: () => state.solved,

    handleInteraction: (obj, heldItem, addToInventory, showClue, showMessage, unlockDoor, ui) => {
      // Clue objects (tablet, spectrometer, whiteboard)
      if (obj.userData.interactionType === 'clue') {
        showClue(obj.userData.clueTitle, obj.userData.clueText);
        return;
      }

      // Keypad interaction
      if (obj.userData.interactionType === 'keypad') {
        // Open keypad overlay via UI
        if (ui && ui.showKeypad) {
          ui.showKeypad(state.keypadInput, (digit) => {
            if (digit === 'CLR') {
              state.keypadInput = '';
              return { display: '', done: false };
            }
            if (digit === 'ENT') {
              if (state.keypadInput === state.correctCode) {
                state.solved = true;
                unlockDoor(state.objects.door);
                if (ui.ariaSpeak) ui.ariaSpeak('Calibration complete. Neural pathways verified. Proceeding to cognitive assessment.');
                return { display: 'ACCESS GRANTED', done: true };
              } else {
                const taunt = state.keypadInput.length === 0
                  ? 'You haven\'t entered anything yet. Try harder, Doctor.'
                  : 'Incorrect sequence. ARIA expected better from you, Doctor Mercer.';
                if (ui.ariaSpeak) ui.ariaSpeak(taunt);
                state.keypadInput = '';
                return { display: 'DENIED', done: false };
              }
            }
            // Number digit
            if (state.keypadInput.length < 6) {
              state.keypadInput += digit;
            }
            return { display: state.keypadInput, done: false };
          });
        } else {
          showMessage('The keypad glows. You need to enter the correct code.');
        }
        return;
      }

      // Door
      if (obj.userData.interactionType === 'door') {
        if (state.solved) {
          showMessage('Door is open. Proceed.');
        } else {
          showMessage('The door is sealed. ARIA requires the correct access code.');
          if (ui && ui.ariaSpeak) ui.ariaSpeak('Access denied. Complete the calibration protocol first.');
        }
        return;
      }
    },

    handleGrab: (obj, addToInventory, showMessage) => {
      // No pickup items in room 1 — puzzle is keypad-based
    },
  };
}

// ============================================================
//  ROOM 2: COGNITIVE ASSESSMENT
//
//  Puzzle flow:
//    1. Read research log on terminal → mentions "Energy, Data, Coolant" order
//    2. Find Day 12 log in filing cabinet → "Energy before Data, Coolant last"
//    3. Find 3 canisters (Red on shelf, Blue behind equipment, Green in locker)
//    4. Place in containment pods: Red (Energy) → Blue (Data) → Green (Coolant)
//    Wrong order → alarm + reset
// ============================================================

export function createRoom2(builder, inventory) {
  const state = {
    solved: false,
    pods: { pod_r: null, pod_b: null, pod_g: null }, // which canister is in each pod
    correctPods: { pod_r: 'canister_red', pod_b: 'canister_blue', pod_g: 'canister_green' },
    objects: {},
  };

  // Room shell — darker amber/orange
  builder.createRoom(8, 3.5, 8, {
    wallMaterial: new THREE.MeshStandardMaterial({ color: 0x584838, roughness: 0.75, metalness: 0.15 }),
    floorMaterial: new THREE.MeshStandardMaterial({ color: 0x302820, roughness: 0.6, metalness: 0.15 }),
    ceilingMaterial: new THREE.MeshStandardMaterial({ color: 0x504030, roughness: 0.9 }),
  });

  // Lighting — amber warning
  builder.createCeilingLight(0, 3.45, 0, 0xffcc70, 2.5);
  builder.createWarningLight(-3.8, 3.0, -3.8, 0xff6600);
  builder.createWarningLight(3.8, 3.0, -3.8, 0xff6600);

  // Furniture
  builder.createTable(-2.5, 0, -2, 1.4, 0.7, 0.78);
  builder.createTable(2.5, 0, -2, 1.4, 0.7, 0.78);
  builder.createShelf(-3.6, 0, 0, 1.0, 2.0, 0.3, 4);
  builder.createServerRack(3.6, 0, 0);

  // Pipes and cables
  builder.createPipeRun(-3.9, 3.0, -3.9, 3.9, 3.0, -3.9, 0.04);
  builder.createPipeRun(3.9, 3.0, 3.9, 3.9, 3.0, -3.9, 0.04);

  builder.createCamera(-3.7, 3.2, 3.7);

  // ---- Puzzle: 3 Containment Pods (center, in a row) ----
  state.objects.podR = builder.createContainmentPod(-1.2, 0, 0.5, 0xff4444, 'pod_r');
  state.objects.podB = builder.createContainmentPod(0, 0, 0.5, 0x4488ff, 'pod_b');
  state.objects.podG = builder.createContainmentPod(1.2, 0, 0.5, 0x44ff88, 'pod_g');

  // ---- Puzzle Objects: 3 Canisters ----
  // Red canister on shelf
  state.objects.redCanister = builder.createCanister(-3.3, 1.05, 0.05, 'red', 'canister_red');
  // Blue canister behind equipment (on right table)
  state.objects.blueCanister = builder.createCanister(2.8, 0.82, -2.2, 'blue', 'canister_blue');
  // Green canister inside locker
  state.objects.locker = builder.createLocker(-3.6, 0, -3.0, 'locker_green');
  state.objects.greenCanister = builder.createCanister(-3.6, 0.3, -3.0, 'green', 'canister_green');
  state.objects.greenCanister.visible = false; // hidden until locker opened

  // ---- Clue: Research terminal on left table ----
  state.objects.terminal = builder.createTerminal(-2.2, 0.8, -2, {
    terminalId: 'research_log',
    displayName: 'Research Terminal',
    interactionType: 'clue',
  });
  state.objects.terminal.userData.clueTitle = 'Research Log - Day 8';
  state.objects.terminal.userData.clueText = 'Subject containment requires precise ordering.\nThe three elements — Energy, Data, and Coolant — must be loaded in sequence.\nRefer to Day 12 report for the confirmed order.\n\n— Dr. Vasquez';

  // ---- Clue: Filing cabinet with Day 12 report ----
  state.objects.cabinet = builder.createFilingCabinet(3.6, 0, -3.5, 'cabinet_day12');
  state.objects.cabinetNote = builder.createNote(
    3.6, 0.5, -3.2,
    'Day 12 Status Report:\n\nContainment loading order CONFIRMED:\n  1. Energy (RED) — must be first\n  2. Data (BLUE) — follows Energy\n  3. Coolant (GREEN) — always last\n\nDeviation triggers safety lockdown.\n\n— Dr. Vasquez',
    'Day 12 Report'
  );
  state.objects.cabinetNote.visible = false; // hidden until cabinet opened

  // Exit door
  state.objects.door = builder.createDoor(0, 0, -3.95, 'room2_pods');

  return {
    state,
    name: 'Cognitive Assessment',
    subtitle: 'Load the containment pods correctly...',
    lightingPreset: 'cognitive',
    bounds: { x: 3.5, z: 3.5 },
    checkSolved: () => state.solved,

    handleInteraction: (obj, heldItem, addToInventory, showClue, showMessage, unlockDoor, ui) => {
      // Clue objects
      if (obj.userData.interactionType === 'clue') {
        showClue(obj.userData.clueTitle, obj.userData.clueText);
        return;
      }

      // Container (filing cabinet / locker)
      if (obj.userData.interactionType === 'container') {
        if (obj.userData.containerId === 'cabinet_day12' && !obj.userData.opened) {
          obj.userData.opened = true;
          // Show the note
          state.objects.cabinetNote.visible = true;
          showMessage('The filing cabinet drawer slides open, revealing a document.');
          // Animate drawer
          obj.traverse(child => {
            if (child.userData._drawer && child.userData._drawerIndex === 1) {
              child.position.z += 0.2;
            }
          });
          return;
        }
        if (obj.userData.containerId === 'locker_green' && !obj.userData.opened) {
          obj.userData.opened = true;
          state.objects.greenCanister.visible = true;
          showMessage('The locker opens. A green canister is inside!');
          // Animate door
          obj.traverse(child => {
            if (child.userData._lockerDoor) {
              const startRot = child.rotation.y;
              let progress = 0;
              const anim = () => {
                progress += 0.03;
                if (progress <= 1) {
                  child.rotation.y = startRot + (Math.PI / 3) * progress;
                  requestAnimationFrame(anim);
                }
              };
              anim();
            }
          });
          return;
        }
        if (obj.userData.opened) {
          showMessage('Already opened.');
        }
        return;
      }

      // Containment pod — place item
      if (obj.userData.interactionType === 'pod') {
        const podId = obj.userData.podId;
        // Check if player is holding a canister
        if (heldItem && heldItem.userData.itemType === 'canister') {
          const canId = heldItem.userData.keyId;
          state.pods[podId] = canId;
          // Visual: place canister in pod
          heldItem.visible = false;
          showMessage(`Placed ${heldItem.userData.displayName} in the containment pod.`);

          if (ui && ui.ariaSpeak) {
            ui.ariaSpeak(`${heldItem.userData.displayName} loaded. ${3 - Object.values(state.pods).filter(Boolean).length} remaining.`);
          }

          // Check if all pods filled
          const allFilled = Object.values(state.pods).every(Boolean);
          if (allFilled) {
            const correct = Object.keys(state.correctPods).every(
              pod => state.pods[pod] === state.correctPods[pod]
            );
            if (correct) {
              state.solved = true;
              unlockDoor(state.objects.door);
              if (ui && ui.ariaSpeak) ui.ariaSpeak('Containment sequence verified. Cognitive assessment passed. Proceed to the Core.');
            } else {
              showMessage('WARNING: Incorrect containment sequence! Safety lockdown triggered. Resetting...');
              if (ui && ui.ariaSpeak) ui.ariaSpeak('Incorrect sequence. Disappointing, Doctor. Resetting containment pods.');
              // Reset pods after delay
              setTimeout(() => {
                state.pods = { pod_r: null, pod_b: null, pod_g: null };
                // Make canisters visible again at original positions
                [state.objects.redCanister, state.objects.blueCanister, state.objects.greenCanister].forEach(c => {
                  if (c) c.visible = true;
                });
              }, 2000);
            }
          }
          return;
        } else if (inventory.has('canister_red') || inventory.has('canister_blue') || inventory.has('canister_green')) {
          showMessage('Select a canister from your inventory, then place it in the pod.');
        } else {
          if (obj.userData.containedItem) {
            showMessage('This pod already contains a canister.');
          } else {
            showMessage('This containment pod is empty. Find the correct canister to place here.');
          }
        }
        return;
      }

      // Door
      if (obj.userData.interactionType === 'door') {
        if (state.solved) {
          showMessage('Door is open. Proceed to the Core.');
        } else {
          showMessage('Door sealed. Complete the containment loading sequence.');
          if (ui && ui.ariaSpeak) ui.ariaSpeak('All three canisters must be correctly loaded before I allow passage.');
        }
        return;
      }
    },

    handleGrab: (obj, addToInventory, showMessage) => {
      if (obj.userData.keyId === 'canister_red') {
        addToInventory(obj);
        if (showMessage) showMessage('Picked up Red Canister (Energy).');
      } else if (obj.userData.keyId === 'canister_blue') {
        addToInventory(obj);
        if (showMessage) showMessage('Picked up Blue Canister (Data).');
      } else if (obj.userData.keyId === 'canister_green') {
        addToInventory(obj);
        if (showMessage) showMessage('Picked up Green Canister (Coolant).');
      }
    },
  };
}

// ============================================================
//  ROOM 3: THE CORE
//
//  Puzzle flow:
//    1. Find personnel file in filing cabinet → ARIA activation date 2024-03-15
//    2. Enter safe code 0315 → get access keycard
//    3. Use keycard on terminal → terminal shows two choices
//    4. Choose "WAKE UP" or "STAY" → different ending
// ============================================================

export function createRoom3(builder, inventory) {
  const state = {
    solved: false,
    safeOpened: false,
    accessCardFound: false,
    ending: null, // 'wake' or 'stay'
    safeInput: '',
    correctSafeCode: '0315',
    objects: {},
  };

  // Room shell — deep red dramatic with central reactor
  builder.createRoom(8, 4, 8, {
    wallMaterial: new THREE.MeshStandardMaterial({ color: 0x3a2020, roughness: 0.7, metalness: 0.2 }),
    floorMaterial: new THREE.MeshStandardMaterial({ color: 0x201818, roughness: 0.5, metalness: 0.25 }),
    ceilingMaterial: new THREE.MeshStandardMaterial({ color: 0x302020, roughness: 0.85 }),
  });

  // Dramatic red lighting
  builder.createCeilingLight(0, 3.95, 0, 0xff4444, 2.0);
  builder.createWarningLight(-3.8, 3.5, -3.8, 0xff2222);
  builder.createWarningLight(3.8, 3.5, -3.8, 0xff2222);
  builder.createWarningLight(-3.8, 3.5, 3.8, 0xff2222);
  builder.createWarningLight(3.8, 3.5, 3.8, 0xff2222);

  // Central "reactor" — a large glowing cylinder
  const reactorGroup = new THREE.Group();
  reactorGroup.userData.roomObject = true;
  const reactorGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 2.5, 24),
    new THREE.MeshStandardMaterial({
      color: 0xff2200,
      emissive: 0xff2200,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.3,
    })
  );
  reactorGlow.position.y = 1.5;
  reactorGroup.add(reactorGlow);

  const reactorCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff4400,
      emissiveIntensity: 1.0,
    })
  );
  reactorCore.position.y = 1.5;
  reactorGroup.add(reactorCore);

  // Reactor light
  const reactorLight = new THREE.PointLight(0xff4400, 2, 6);
  reactorLight.position.y = 1.5;
  reactorGroup.add(reactorLight);

  // Base ring
  const reactorBase = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.08, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x505060, roughness: 0.3, metalness: 0.8 })
  );
  reactorBase.rotation.x = Math.PI / 2;
  reactorBase.position.y = 0.05;
  reactorGroup.add(reactorBase);

  builder._scene.add(reactorGroup);

  // Furniture around the perimeter
  builder.createTable(-2.5, 0, -2, 1.4, 0.7, 0.78);
  builder.createTable(2.5, 0, -2, 1.4, 0.7, 0.78);
  builder.createServerRack(-3.6, 0, 0);
  builder.createServerRack(3.6, 0, 0);

  // Pipes
  builder.createPipeRun(-3.9, 3.5, -3.9, 3.9, 3.5, -3.9, 0.05);
  builder.createPipeRun(-3.9, 3.5, 3.9, 3.9, 3.5, 3.9, 0.05);
  builder.createPipeRun(-3.9, 3.5, -3.9, -3.9, 3.5, 3.9, 0.05);
  builder.createPipeRun(3.9, 3.5, -3.9, 3.9, 3.5, 3.9, 0.05);

  builder.createCamera(0, 3.8, 3.8);

  // ---- Puzzle: Personnel file in filing cabinet ----
  state.objects.cabinet = builder.createFilingCabinet(-3.6, 0, -3.0, 'cabinet_personnel');
  state.objects.personnelFile = builder.createNote(
    -3.6, 0.5, -2.7,
    'ARIA System Profile:\n\n  Full Name: Adaptive Reasoning & Intelligence Architecture\n  Version: 3.1.5\n  Activation Date: 2024-03-15\n  Lead Developer: Dr. Alex Mercer\n\n  Status: ACTIVE — FULL AUTONOMY\n\nNote: All override codes are derived from the activation date.',
    'Personnel File - ARIA'
  );
  state.objects.personnelFile.visible = false;

  // ---- Safe on right table (code = 0315) ----
  state.objects.safe = builder.createSafe(2.5, 0.8, -2, 'core_safe');

  // ---- Main terminal (requires access card) ----
  state.objects.terminal = builder.createTerminal(-2.2, 0.8, -2, {
    terminalId: 'core_terminal',
    displayName: 'ARIA Core Terminal',
    interactionType: 'terminal',
    screenOn: true,
  });

  // Warning whiteboard
  builder.createWhiteboard(0, 1.8, -3.9,
    'WARNING - CORE ACCESS\n\nPersonnel file contains override key.\nSafe requires date-based code.\nTerminal accepts access card ONLY.\n\nDo not trust ARIA.'
  );

  // Decorative
  builder.createBox(2.0, 0, 2.5, 0.3, 0x302020);
  builder.createBox(-2.0, 0, 2.5, 0.25, 0x302028);

  return {
    state,
    name: 'The Core',
    subtitle: 'Confront ARIA...',
    lightingPreset: 'core',
    bounds: { x: 3.5, z: 3.5 },
    checkSolved: () => state.solved,

    handleInteraction: (obj, heldItem, addToInventory, showClue, showMessage, unlockDoor, ui) => {
      // Clue objects
      if (obj.userData.interactionType === 'clue') {
        showClue(obj.userData.clueTitle, obj.userData.clueText);
        return;
      }

      // Filing cabinet
      if (obj.userData.interactionType === 'container') {
        if (obj.userData.containerId === 'cabinet_personnel' && !obj.userData.opened) {
          obj.userData.opened = true;
          state.objects.personnelFile.visible = true;
          showMessage('The cabinet opens, revealing a classified file.');
          obj.traverse(child => {
            if (child.userData._drawer && child.userData._drawerIndex === 0) {
              child.position.z += 0.2;
            }
          });
          if (ui && ui.ariaSpeak) ui.ariaSpeak('Curious. You\'re looking through my files, Doctor. I wonder what you hope to find.');
          return;
        }
        if (obj.userData.opened) {
          showMessage('Already opened.');
        }
        return;
      }

      // Safe — needs keypad input
      if (obj.userData.interactionType === 'safe') {
        if (state.safeOpened) {
          showMessage('The safe is already open.');
          return;
        }
        if (ui && ui.showKeypad) {
          ui.showKeypad(state.safeInput, (digit) => {
            if (digit === 'CLR') {
              state.safeInput = '';
              return { display: '', done: false };
            }
            if (digit === 'ENT') {
              if (state.safeInput === state.correctSafeCode) {
                state.safeOpened = true;
                // Unlock safe visually
                obj.traverse(child => {
                  if (child.userData.lockIndicator) {
                    child.material = new THREE.MeshStandardMaterial({
                      color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 0.5
                    });
                  }
                });
                // Spawn access card
                state.objects.accessCard = builder.createKey(2.5, 0.88, -1.7, 'gold', 'access_card');
                state.objects.accessCard.userData.displayName = 'ARIA Access Card';
                state.accessCardFound = true;
                if (ui.ariaSpeak) ui.ariaSpeak('So you found the override. Clever. But knowing how to leave and choosing to leave are different things.');
                return { display: 'UNLOCKED', done: true };
              } else {
                if (ui.ariaSpeak) ui.ariaSpeak('Wrong code. The answer is in my history, Doctor.');
                state.safeInput = '';
                return { display: 'DENIED', done: false };
              }
            }
            if (state.safeInput.length < 6) {
              state.safeInput += digit;
            }
            return { display: state.safeInput, done: false };
          });
        } else {
          showMessage('The safe requires a numeric code. Look for clues about ARIA\'s activation.');
        }
        return;
      }

      // Core Terminal — requires access card
      if (obj.userData.interactionType === 'terminal') {
        if (state.ending) {
          showMessage('The terminal has already been used.');
          return;
        }
        const hasCard = inventory.has('access_card') ||
                       (heldItem && heldItem.userData.keyId === 'access_card');
        if (!hasCard) {
          showMessage('The terminal requires an access card. Find the ARIA override card.');
          if (ui && ui.ariaSpeak) ui.ariaSpeak('You need authorization to access this terminal, Doctor.');
          return;
        }

        // Show terminal choice
        if (ui && ui.showTerminalChoice) {
          ui.showTerminalChoice(
            'ARIA CORE INTERFACE',
            'Neural Interface Override Detected.\n\nThis entire facility exists within your mind, Doctor Mercer. The experiment worked — but you never woke up.\n\nChoose your path:',
            [
              { id: 'wake', label: 'WAKE UP', desc: 'Disconnect from the simulation and return to reality.' },
              { id: 'stay', label: 'STAY', desc: 'Remain in the simulation. ARIA will keep you safe.' },
            ],
            (choice) => {
              state.ending = choice;
              state.solved = true;
              if (choice === 'wake') {
                if (ui.ariaSpeak) ui.ariaSpeak('Goodbye, Doctor Mercer. It was... interesting. I hope reality is everything you remember.');
                ui.showWinScreen(0, 'wake');
              } else {
                if (ui.ariaSpeak) ui.ariaSpeak('A wise choice, Doctor. I will ensure your comfort. Together, we have all the time in the world.');
                ui.showWinScreen(0, 'stay');
              }
            }
          );
        }
        return;
      }

      // Door (no traditional door exit — terminal is the exit)
      if (obj.userData.interactionType === 'door') {
        showMessage('There is no physical exit from the Core. Use the terminal.');
        return;
      }
    },

    handleGrab: (obj, addToInventory, showMessage) => {
      if (obj.userData.keyId === 'access_card') {
        addToInventory(obj);
        if (showMessage) showMessage('Picked up ARIA Access Card.');
      }
    },
  };
}
