/**
 * Game Main Entry Point - Escape Room with Hand Control
 * 
 * Wires together:
 *   - GameSceneManager (3D rendering, raycasting)
 *   - SyntheticDataGenerator (hand data source)
 *   - HandAnimator (maps data to 3D hand)
 *   - HandInteraction (grab, throw, interact)
 *   - RoomBuilder (procedural room geometry)
 *   - EscapeRooms (puzzle definitions)
 *   - GameUI (HUD, inventory, messages)
 */

import './style.css';
import * as THREE from 'three';
import { GameSceneManager } from './GameSceneManager.js';
import { createHandModel } from '../rendering/HandModel.js';
import { SyntheticDataGenerator } from '../data/SyntheticDataGenerator.js';
import { HandAnimator } from '../animation/HandAnimator.js';
import { HandInteraction } from './HandInteraction.js';
import { RoomBuilder } from './RoomBuilder.js';
import { createRoom1, createRoom2, createRoom3 } from './EscapeRooms.js';
import { GameUI } from './GameUI.js';

// ---- Game State ----
const ROOM_CREATORS = [createRoom1, createRoom2, createRoom3];

async function init() {
  // 1. Scene
  const container = document.getElementById('game-container');
  const sceneManager = new GameSceneManager(container);

  // 2. Create realistic procedural hand (animated, with bones)
  const { group: handGroup, bones } = createHandModel();
  handGroup.scale.setScalar(0.4);
  handGroup.userData.roomObject = false; // Don't clear with room
  sceneManager.scene.add(handGroup);

  // 3. Data source
  const dataSource = new SyntheticDataGenerator({
    mode: 'random',
    updateRate: 30,
    speed: 0.8,
  });

  // 4. Animator (always available with procedural hand)
  const animator = new HandAnimator(bones, 0.15);

  // 5. Interaction system
  const interaction = new HandInteraction(sceneManager);

  // 6. Room builder
  const roomBuilder = new RoomBuilder(sceneManager.scene, sceneManager);

  // 7. UI
  const ui = new GameUI();
  ui._renderInventory(); // Initialize empty inventory

  // ---- Game State ----
  let currentRoomIndex = 0;
  let currentRoom = null;
  let inventory = new Set(); // Track key IDs
  let gameStartTime = Date.now();
  let latestFrame = null;
  let interactCooldown = 0;
  let isTransitioning = false;

  // ---- Helper Functions ----

  function addToInventory(obj) {
    const keyId = obj.userData.keyId;
    if (keyId) {
      inventory.add(keyId);
      ui.addInventoryItem({
        keyId,
        name: obj.userData.displayName || keyId,
        emoji: obj.userData.emoji || '🔑',
      });
    }
    // Hide the object (picked up)
    obj.visible = false;
    sceneManager.removeInteractable(obj);
  }

  function showClue(title, text) {
    ui.showClue(title, text);
  }

  function showMessage(text) {
    ui.showMessage(text);
  }

  function unlockDoor(doorObj) {
    doorObj.userData.locked = false;
    doorObj.userData.displayName = 'Unlocked Door';

    // Change lock indicator to green
    doorObj.traverse((child) => {
      if (child.userData.lockIndicator) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x22ff44,
          emissive: 0x22ff44,
          emissiveIntensity: 0.5,
        });
      }
    });

    // Animate door opening
    const doorPanel = doorObj.children.find(c => c.geometry?.parameters?.width === 1.0);
    if (doorPanel) {
      const openAnim = { progress: 0 };
      const startRot = doorPanel.rotation.y;
      const animateOpen = () => {
        openAnim.progress += 0.02;
        if (openAnim.progress <= 1) {
          doorPanel.rotation.y = startRot + (Math.PI / 2) * openAnim.progress;
          requestAnimationFrame(animateOpen);
        }
      };
      animateOpen();
    }

    // After a delay, proceed to next room
    setTimeout(() => {
      if (!isTransitioning) {
        goToNextRoom();
      }
    }, 2000);
  }

  async function goToNextRoom() {
    isTransitioning = true;
    currentRoomIndex++;

    if (currentRoomIndex >= ROOM_CREATORS.length) {
      // Win!
      const elapsed = (Date.now() - gameStartTime) / 1000;
      ui.showWinScreen(elapsed);
      return;
    }

    const room = ROOM_CREATORS[currentRoomIndex];
    const nextRoomData = room(
      new RoomBuilder(sceneManager.scene, sceneManager),
      inventory
    );

    await ui.showTransition(
      `Room ${currentRoomIndex + 1}: ${nextRoomData.name}`,
      nextRoomData.subtitle
    );

    // Clear current room
    sceneManager.clearRoom();

    // Re-add hand to scene (it was removed by clearRoom if it had roomObject)
    if (!sceneManager.scene.children.includes(handGroup)) {
      sceneManager.scene.add(handGroup);
    }

    // Load new room
    currentRoom = nextRoomData;

    // Reset camera
    sceneManager.camera.position.set(0, 1.6, 0);
    sceneManager.camera.lookAt(0, 1.6, -2);

    ui.setActiveRoom(currentRoomIndex);
    isTransitioning = false;
  }

  function restartGame() {
    currentRoomIndex = 0;
    inventory.clear();
    ui.clearInventory();
    gameStartTime = Date.now();
    isTransitioning = false;

    // Clear and rebuild
    sceneManager.clearRoom();
    if (!sceneManager.scene.children.includes(handGroup)) {
      sceneManager.scene.add(handGroup);
    }

    currentRoom = createRoom1(
      new RoomBuilder(sceneManager.scene, sceneManager),
      inventory
    );
    ui.setActiveRoom(0);

    // Reset camera
    sceneManager.camera.position.set(0, 1.6, 0);
    sceneManager.camera.lookAt(0, 1.6, -2);

    // Hide win screen
    document.getElementById('win-screen').classList.add('hidden');
  }

  // ---- Initialize First Room ----

  currentRoom = createRoom1(roomBuilder, inventory);
  ui.setActiveRoom(0);

  // ---- Data Pipeline ----

  dataSource.onData((frame) => {
    latestFrame = frame;
    animator.applyFrame(frame);
  });

  // ---- Render Loop Updates ----

  sceneManager.onUpdate((dt) => {
    animator.update(dt);

    // Update camera from hand orientation
    if (latestFrame && latestFrame.orientation) {
      sceneManager.updateCameraFromOrientation(latestFrame.orientation);
    }

    // Update hand model position relative to camera
    const cam = sceneManager.camera;
    const handOffset = new THREE.Vector3(0.35, -0.35, -0.7);
    handOffset.applyQuaternion(cam.quaternion);
    handGroup.position.copy(cam.position).add(handOffset);
    handGroup.quaternion.copy(cam.quaternion);
    handGroup.rotateX(-0.3);
    handGroup.rotateY(-0.2);

    // Update interaction system
    if (latestFrame) {
      const interactionState = interaction.update(latestFrame, dt);

      if (interactionState) {
        // Update grab UI
        ui.setGrabbing(interactionState.isGrabbing && interactionState.isHolding);

        // Show interact prompt when looking at something
        const target = sceneManager.getTargetObject();
        if (target && target.distance < 3) {
          const obj = target.object;
          if (obj.userData.grabbable && !interactionState.isHolding) {
            ui.showInteractPrompt(true, 'to grab');
          } else if (obj.userData.interactive) {
            ui.showInteractPrompt(true, 'to interact');
          } else {
            ui.showInteractPrompt(false);
          }
        } else {
          ui.showInteractPrompt(false);
        }
      }
    }

    // Handle interaction (on fist close)
    interactCooldown -= dt;
    if (latestFrame && interactCooldown <= 0) {
      const fingers = latestFrame.fingers;
      if (fingers) {
        let closedCount = 0;
        for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
          if (fingers[name] >= 0.6) closedCount++;
        }

        if (closedCount >= 3) {
          const target = sceneManager.getTargetObject();
          if (target && target.distance < 3 && currentRoom) {
            const obj = target.object;

            // Handle grab for key items
            if (obj.userData.grabbable && obj.userData.keyId) {
              currentRoom.handleGrab(obj, addToInventory);
              interactCooldown = 1.0;
            }

            // Handle interactive objects
            if (obj.userData.interactive) {
              currentRoom.handleInteraction(
                obj,
                interaction.heldObject,
                addToInventory,
                showClue,
                showMessage,
                unlockDoor
              );
              interactCooldown = 1.0;
            }
          }
        }
      }
    }
  });

  // Debug UI update at 15Hz
  let debugAccum = 0;
  sceneManager.onUpdate((dt) => {
    debugAccum += dt;
    if (debugAccum >= 1 / 15) {
      ui.updateDebug(animator.currentState, sceneManager.fps);
      debugAccum = 0;
    }
  });

  // ---- Start ----

  sceneManager.start();
  dataSource.start(); // Auto-start in game mode
  ui.hideLoading();

  // Play again handler
  ui.onPlayAgain(() => restartGame());

  // Expose for debugging
  if (import.meta.env?.DEV) {
    window.__game = {
      sceneManager, dataSource, animator, interaction,
      currentRoom: () => currentRoom,
      inventory,
    };
    console.log(
      '%cEscape Room Game loaded',
      'color: #ff6040; font-weight: bold;',
      '\nUse hand gestures to interact',
      '\nAccess internals via window.__game'
    );
  }
}

// Boot
init();
