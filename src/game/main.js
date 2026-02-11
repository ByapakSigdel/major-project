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
import { createHandModelAsync } from '../rendering/HandModel.js';
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

  // 2. Create hand model (load GLTF with proper bone mapping, fallback to procedural)
  const { group: handGroup, bones } = await createHandModelAsync('/models/human_hand_base_mesh.glb');
  handGroup.scale.setScalar(0.6);
  handGroup.userData.roomObject = false; // Don't clear with room
  // Render hand on top of everything (separate pass) to prevent clipping into walls
  handGroup.renderOrder = 999;
  handGroup.traverse((child) => {
    if (child.isMesh) {
      child.material.depthTest = false;
      child.renderOrder = 999;
    }
  });
  sceneManager.scene.add(handGroup);

  // 3. Data source
  const dataSource = new SyntheticDataGenerator({
    mode: 'fist',
    updateRate: 30,
    speed: 0.8,
  });

  // 4. Animator (maps data → bone rotations)
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

    // Set bounds for collision
    if (nextRoomData.bounds) {
      sceneManager.setRoomBounds(nextRoomData.bounds.x, nextRoomData.bounds.z);
    }

    // Reset camera
    sceneManager.resetCamera();

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

    // Reset camera + bounds
    sceneManager.setRoomBounds(2.5, 2.5);
    sceneManager.resetCamera();

    // Hide win screen
    document.getElementById('win-screen').classList.add('hidden');
  }

  // ---- Initialize First Room ----

  currentRoom = createRoom1(roomBuilder, inventory);
  sceneManager.setRoomBounds(2.5, 2.5); // 6×6 room, margin 0.5
  ui.setActiveRoom(0);

  // ---- Data Pipeline ----

  dataSource.onData((frame) => {
    latestFrame = frame;
    animator.applyFrame(frame);
  });

  // ---- Render Loop Updates ----

  sceneManager.onUpdate((dt) => {
    animator.update(dt);

    // Mouse look + WASD movement
    sceneManager.moveCamera(dt);

    // ---- Position hand in view (FPP VR placement) ----
    // Place hand at bottom-right of viewport, always visible.
    // Offset is in camera-local space: right(+X), down(-Y), forward(-Z).
    const cam = sceneManager.camera;
    const handOffset = new THREE.Vector3(0.25, -0.3, -0.45);
    handOffset.applyQuaternion(cam.quaternion);
    handGroup.position.copy(cam.position).add(handOffset);

    // Copy camera orientation, then tilt hand naturally
    handGroup.quaternion.copy(cam.quaternion);
    handGroup.rotateX(-0.5);   // tilt fingers forward/down
    handGroup.rotateZ(0.15);   // slight roll so palm faces inward

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
          ui.setTargeting(true);
          if (obj.userData.grabbable && !interactionState.isHolding) {
            ui.showInteractPrompt(true, 'to grab');
          } else if (obj.userData.interactive) {
            ui.showInteractPrompt(true, 'to interact');
          } else {
            ui.showInteractPrompt(false);
          }
        } else {
          ui.setTargeting(false);
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
              currentRoom.handleGrab(obj, addToInventory, showMessage);
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
init().catch((err) => {
  console.error('Game failed to initialize:', err);
  const loading = document.getElementById('loading-screen');
  if (loading) {
    loading.innerHTML = `<div style="color:#ff4444;text-align:center;padding:2rem;">
      <h2>Failed to start game</h2>
      <p>${err.message || 'Unknown error'}</p>
      <p style="opacity:0.6;font-size:0.85rem;">Check the browser console for details.</p>
    </div>`;
    loading.style.display = 'flex';
    loading.style.alignItems = 'center';
    loading.style.justifyContent = 'center';
  }
});
