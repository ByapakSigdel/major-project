/**
 * Game Main Entry Point — Project ECHO Escape Room
 *
 * Wires together:
 *   - GameSceneManager   (3D rendering, raycasting, per-room lighting)
 *   - SyntheticDataGenerator (hand data source)
 *   - HandAnimator       (maps data → bone rotations)
 *   - HandInteraction    (gesture detection)
 *   - PickupAnimator     (reach-grab-retract animation)
 *   - RoomBuilder        (sci-fi room geometry)
 *   - EscapeRooms        (puzzle definitions: 3 rooms)
 *   - GameUI             (ARIA dialogue, keypad, terminal, HUD)
 */

import './style.css';
import * as THREE from 'three';
import { GameSceneManager } from './GameSceneManager.js';
import { createHandModelAsync } from '../rendering/HandModel.js';
import { SyntheticDataGenerator } from '../data/SyntheticDataGenerator.js';
import { HandAnimator } from '../animation/HandAnimator.js';
import { HandInteraction } from './HandInteraction.js';
import { PickupAnimator } from './PickupAnimator.js';
import { RoomBuilder } from './RoomBuilder.js';
import { createRoom1, createRoom2, createRoom3 } from './EscapeRooms.js';
import { GameUI } from './GameUI.js';

// ---- Constants ----
const ROOM_CREATORS = [createRoom1, createRoom2, createRoom3];

// IMU sensitivity multipliers (2-3x range for responsive hand control)
const IMU_PITCH_SCALE = 2.5;
const IMU_YAW_SCALE   = 2.0;
const IMU_ROLL_SCALE  = 2.5;

// IMU smoothing (lower = smoother / more lag)
const IMU_SMOOTHING = 0.12;

async function init() {
  // ---- 1. Scene ----
  const container = document.getElementById('game-container');
  const sceneManager = new GameSceneManager(container);

  // ---- 2. Hand Model ----
  const { group: handModel, bones } = await createHandModelAsync('/models/human_hand_base_mesh.glb');

  const isGLTF = handModel.name === 'HandWrapper';
  console.log(`Hand model loaded: ${isGLTF ? 'GLTF' : 'Procedural'}, name="${handModel.name}"`);

  // Override wrapper rotation for FPS pose.
  //
  // The wrapper (in HandModel.js) applies Euler(PI, PI/2, 0) to the raw WebXR model,
  // producing: fingers +Y (up), palm normal +Z (toward camera).
  //
  // For FPS we need:
  //   - Fingers → -Z (forward, into the screen)
  //   - Back of hand (dorsal) → +Y (visible to player looking down)
  //   - Palm → -Y (facing down, hidden)
  //   - Thumb → -X (pointing inward for a right hand, palm down)
  //
  // Derivation:
  //   Rx(-PI/2) maps +Y → -Z (fingers forward) and +Z → +Y (palm now up).
  //   Rz(PI)    maps +Y → -Y (flips palm down) while leaving -Z unchanged.
  //   Combined in XYZ Euler order (Rz * Ry * Rx): Euler(-PI/2, 0, PI).
  if (isGLTF) {
    handModel.rotation.set(-Math.PI / 2, 0, Math.PI);
  }

  // Outer container for camera-attached positioning
  const handContainer = new THREE.Group();
  handContainer.name = 'HandContainer';
  handContainer.userData.roomObject = false;

  const fpsScale = isGLTF ? 0.08 : 0.15;
  handContainer.scale.setScalar(fpsScale);
  handContainer.add(handModel);
  handContainer.renderOrder = 999;

  // ---- Hand Material: MeshStandardMaterial (fixes shading with depthTest:false) ----
  const handSkinMaterial = new THREE.MeshStandardMaterial({
    color: 0xdea87a,
    roughness: 0.5,
    metalness: 0.0,
    emissive: 0x3a2518,
    emissiveIntensity: 0.12,
    side: THREE.FrontSide,
    depthTest: false,
  });

  handContainer.traverse((child) => {
    if (child.isMesh) {
      child.material = handSkinMaterial;
      child.renderOrder = 999;
      child.frustumCulled = false;
    }
  });
  sceneManager.scene.add(handContainer);

  // Fill light on hand so it's always visible regardless of room lighting
  const handFillLight = new THREE.PointLight(0xffe8d0, 0.6, 2.5, 2);
  handFillLight.position.set(0, 0.3, 0.2);
  handContainer.add(handFillLight);

  // ---- 3. Data Source ----
  const dataSource = new SyntheticDataGenerator({
    mode: 'random',
    updateRate: 30,
    speed: 0.6,
  });

  // ---- 4. Animator ----
  const animator = new HandAnimator(bones, 0.15);
  animator.skipWristOrientation = true;

  // ---- 5. Interaction (gesture detection only — carry/throw unused) ----
  const interaction = new HandInteraction(sceneManager);

  // ---- 6. Pickup Animator ----
  const pickupAnimator = new PickupAnimator();

  // ---- 7. Room Builder ----
  const roomBuilder = new RoomBuilder(sceneManager.scene, sceneManager);

  // ---- 8. UI ----
  const ui = new GameUI();
  ui._renderInventory();

  // ---- Game State ----
  let currentRoomIndex = 0;
  let currentRoom = null;
  let inventory = new Set();
  let gameStartTime = Date.now();
  let latestFrame = null;
  let interactCooldown = 0;
  let isTransitioning = false;

  ui.setGameStartTime(gameStartTime);

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

    // Animate door panel opening
    let doorPanel = null;
    doorObj.children.forEach(child => {
      if (child.geometry && child.geometry.type === 'BoxGeometry') {
        const params = child.geometry.parameters;
        if (params && params.height > 1.5) {
          doorPanel = child;
        }
      }
    });

    if (doorPanel) {
      const startRot = doorPanel.rotation.y;
      const openAnim = { progress: 0 };
      const animateOpen = () => {
        openAnim.progress += 0.02;
        if (openAnim.progress <= 1) {
          doorPanel.rotation.y = startRot + (Math.PI / 2) * openAnim.progress;
          requestAnimationFrame(animateOpen);
        }
      };
      animateOpen();
    }

    // Room 3 has no traditional door exit — the terminal IS the exit.
    // Only auto-advance for rooms 1 and 2.
    if (currentRoomIndex < ROOM_CREATORS.length - 1) {
      setTimeout(() => {
        if (!isTransitioning) {
          goToNextRoom();
        }
      }, 2500);
    }
  }

  async function goToNextRoom() {
    isTransitioning = true;
    currentRoomIndex++;

    if (currentRoomIndex >= ROOM_CREATORS.length) {
      // Shouldn't normally reach here — Room 3 exits via terminal
      const elapsed = (Date.now() - gameStartTime) / 1000;
      ui.showWinScreen(elapsed);
      return;
    }

    // Create a temp room to peek at metadata for transition screen
    const roomCreator = ROOM_CREATORS[currentRoomIndex];

    // We need room name/subtitle. Build a temporary room to get metadata,
    // then actually use it as the real room.
    // Show transition with the next room's name.
    // To avoid building twice, we build after the transition.

    // Use known room metadata from the creator
    // Build the room FIRST in a detached state so we can read .name / .subtitle,
    // then show transition, then wire it in. But builders add to scene directly,
    // so we must clear first, build, then show transition overlay on top.

    // Simpler approach: clear, build, get metadata, overlay transition on top.
    sceneManager.clearRoom();

    // Re-add hand container
    if (!sceneManager.scene.children.includes(handContainer)) {
      sceneManager.scene.add(handContainer);
    }

    // Build the new room
    const newRoomBuilder = new RoomBuilder(sceneManager.scene, sceneManager);
    currentRoom = roomCreator(newRoomBuilder, inventory);

    // Apply room lighting preset
    if (currentRoom.lightingPreset) {
      sceneManager.setRoomLighting(currentRoom.lightingPreset);
    }

    // Show transition overlay (room renders underneath, hidden by overlay)
    await ui.showTransition(
      `Room ${currentRoomIndex + 1}: ${currentRoom.name || 'Unknown'}`,
      currentRoom.subtitle || ''
    );

    // Set bounds
    if (currentRoom.bounds) {
      sceneManager.setRoomBounds(currentRoom.bounds.x, currentRoom.bounds.z);
    }

    // Reset camera
    sceneManager.resetCamera();

    ui.setActiveRoom(currentRoomIndex);

    // ARIA intro for each room
    if (currentRoomIndex === 1) {
      ui.ariaSpeak('Cognitive assessment phase. Your pattern recognition will be tested. Do try to keep up, Doctor.');
    } else if (currentRoomIndex === 2) {
      ui.ariaSpeak('Welcome to the Core, Doctor Mercer. This is where it ends — one way or another.');
    }

    isTransitioning = false;
  }

  function restartGame() {
    currentRoomIndex = 0;
    inventory.clear();
    ui.clearInventory();
    gameStartTime = Date.now();
    ui.setGameStartTime(gameStartTime);
    isTransitioning = false;
    interactCooldown = 0;
    pickupAnimator.cancel();

    // Clear and rebuild
    sceneManager.clearRoom();
    if (!sceneManager.scene.children.includes(handContainer)) {
      sceneManager.scene.add(handContainer);
    }

    const rb = new RoomBuilder(sceneManager.scene, sceneManager);
    currentRoom = createRoom1(rb, inventory);

    // Apply room 1 lighting
    if (currentRoom.lightingPreset) {
      sceneManager.setRoomLighting(currentRoom.lightingPreset);
    }

    ui.setActiveRoom(0);
    sceneManager.setRoomBounds(
      currentRoom.bounds ? currentRoom.bounds.x : 2.5,
      currentRoom.bounds ? currentRoom.bounds.z : 2.5
    );
    sceneManager.resetCamera();

    // Hide win screen
    const winScreen = document.getElementById('win-screen');
    if (winScreen) winScreen.classList.add('hidden');

    // ARIA intro
    setTimeout(() => {
      ui.ariaSpeak('Restarting neural calibration sequence. Let us begin again, Doctor Mercer.');
    }, 500);
  }

  // ---- Initialize First Room ----

  currentRoom = createRoom1(roomBuilder, inventory);
  if (currentRoom.lightingPreset) {
    sceneManager.setRoomLighting(currentRoom.lightingPreset);
  }
  sceneManager.setRoomBounds(
    currentRoom.bounds ? currentRoom.bounds.x : 2.5,
    currentRoom.bounds ? currentRoom.bounds.z : 2.5
  );
  ui.setActiveRoom(0);

  // ---- Data Pipeline ----

  dataSource.onData((frame) => {
    latestFrame = frame;

    // If PickupAnimator has a fingerOverride active, patch the frame
    // so the hand visually closes/opens per the animation state.
    if (pickupAnimator.fingerOverride !== null) {
      const override = pickupAnimator.fingerOverride;
      frame = {
        ...frame,
        fingers: {
          thumb: override,
          index: override,
          middle: override,
          ring: override,
          pinky: override,
        },
      };
    }

    animator.applyFrame(frame);
  });

  // ---- Render Loop ----

  // Base quaternion for FPS rest orientation (subtle natural wrist drop + inward roll)
  const handBaseQuat = new THREE.Quaternion();
  const _handEuler = new THREE.Euler(-0.12, 0, -0.08, 'YXZ');
  handBaseQuat.setFromEuler(_handEuler);

  // Reusable math objects (avoid GC pressure)
  const _offsetVec = new THREE.Vector3();
  const _imuQuat = new THREE.Quaternion();
  const _imuEuler = new THREE.Euler();
  const _DEG2RAD = Math.PI / 180;

  // Smoothed IMU values
  const _smoothedIMU = { roll: 0, pitch: 0, yaw: 0 };

  // Idle bob
  let _idleTime = 0;

  sceneManager.onUpdate((dt) => {
    animator.update(dt);

    // Camera movement
    sceneManager.moveCamera(dt);

    const cam = sceneManager.camera;

    // ---- Position hand in view (VR-style) ----

    // Idle bob animation
    _idleTime += dt;
    const bobY = Math.sin(_idleTime * 1.8) * 0.006;
    const bobX = Math.sin(_idleTime * 1.1) * 0.003;
    const bobZ = Math.sin(_idleTime * 0.9) * 0.004;

    // Base position: offset in camera-local space, transformed to world
    _offsetVec.set(0.32 + bobX, -0.22 + bobY, -0.5 + bobZ);
    _offsetVec.applyQuaternion(cam.quaternion);
    handContainer.position.copy(cam.position).add(_offsetVec);

    // ---- Apply PickupAnimator position offset ----
    const pickupResult = pickupAnimator.update(dt, handContainer);
    if (pickupResult && pickupResult.positionOffset) {
      handContainer.position.add(pickupResult.positionOffset);
    }

    // ---- Rotation: IMU-driven, decoupled from camera ----
    const imuAlpha = 1.0 - Math.pow(1.0 - IMU_SMOOTHING, dt * 60);
    const imuState = animator.currentState.orientation;

    _smoothedIMU.pitch = THREE.MathUtils.lerp(_smoothedIMU.pitch, imuState.pitch, imuAlpha);
    _smoothedIMU.roll  = THREE.MathUtils.lerp(_smoothedIMU.roll,  imuState.roll,  imuAlpha);
    _smoothedIMU.yaw   = THREE.MathUtils.lerp(_smoothedIMU.yaw,   imuState.yaw,   imuAlpha);

    // Build IMU quaternion with increased sensitivity (2-3x)
    _imuEuler.set(
      _smoothedIMU.pitch * _DEG2RAD * IMU_PITCH_SCALE,
      _smoothedIMU.yaw   * _DEG2RAD * IMU_YAW_SCALE,
      _smoothedIMU.roll  * _DEG2RAD * IMU_ROLL_SCALE,
      'YXZ'
    );
    _imuQuat.setFromEuler(_imuEuler);

    // Compose: camera frame → base wrist → IMU
    handContainer.quaternion.copy(cam.quaternion)
      .multiply(handBaseQuat)
      .multiply(_imuQuat);

    // ---- Gesture Detection (via HandInteraction) ----
    if (latestFrame) {
      const interactionState = interaction.update(latestFrame, dt);

      if (interactionState) {
        // Update grab UI indicator
        ui.setGrabbing(interactionState.isGrabbing && interactionState.isHolding);

        // Show interact prompt when looking at an object
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

    // ---- Fist-close interaction (puzzle handler) ----
    if (interactCooldown > 0) {
      interactCooldown -= dt;
    }

    // Don't allow interaction while pickup animation is playing
    if (latestFrame && interactCooldown <= 0 && !pickupAnimator.isAnimating) {
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

            // Grabbable items (canisters, keys, etc.)
            if (obj.userData.grabbable && obj.userData.keyId) {
              // Play reach-grab animation, then add to inventory
              pickupAnimator.playPickup(handContainer, obj, cam).then(() => {
                currentRoom.handleGrab(obj, addToInventory, showMessage);
              });
              interactCooldown = 2.0;
            }
            // Interactive objects (keypads, terminals, doors, containers, etc.)
            else if (obj.userData.interactive) {
              // Play a quick press animation for buttons/keypads, skip for clues/doors
              const type = obj.userData.interactionType;
              const needsPress = type === 'keypad' || type === 'safe' || type === 'terminal' || type === 'pod';

              if (needsPress) {
                pickupAnimator.playPress(handContainer, obj, cam).then(() => {
                  currentRoom.handleInteraction(
                    obj,
                    interaction.heldObject,
                    addToInventory,
                    showClue,
                    showMessage,
                    unlockDoor,
                    ui
                  );
                });
              } else {
                // Immediate interaction for clues, doors, containers
                currentRoom.handleInteraction(
                  obj,
                  interaction.heldObject,
                  addToInventory,
                  showClue,
                  showMessage,
                  unlockDoor,
                  ui
                );
              }
              interactCooldown = 1.5;
            }
          }
        }
      }
    }
  });

  // ---- Debug UI (15 Hz) ----
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
  dataSource.start();
  ui.hideLoading();

  // ARIA intro dialogue
  setTimeout(() => {
    ui.ariaSpeak('Good morning, Doctor Mercer. Welcome to Prometheus Labs. Your calibration begins now.');
  }, 1500);

  // Play again handler
  ui.onPlayAgain(() => restartGame());

  // Debug exposure
  if (import.meta.env?.DEV) {
    window.__game = {
      sceneManager, dataSource, animator, interaction, pickupAnimator,
      currentRoom: () => currentRoom,
      inventory,
      ui,
    };
    console.log(
      '%cProject ECHO loaded',
      'color: #00ffc8; font-weight: bold;',
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
