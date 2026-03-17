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

import "./style.css";
import * as THREE from "three";
import { GameSceneManager } from "./GameSceneManager.js";
import { createHandModelAsync, createForearmGroup } from "../rendering/HandModel.js";
import { SyntheticDataGenerator } from "../data/SyntheticDataGenerator.js";
import { HandAnimator } from "../animation/HandAnimator.js";
import { HandInteraction } from "./HandInteraction.js";
import { PickupAnimator } from "./PickupAnimator.js";
import { RoomBuilder } from "./RoomBuilder.js";
import { createRoom1, createRoom2, createRoom3 } from "./EscapeRooms.js";
import { GameUI } from "./GameUI.js";

// ---- Constants ----
const ROOM_CREATORS = [createRoom1, createRoom2, createRoom3];

// IMU sensitivity multipliers (2-3x range for responsive hand control)
const IMU_PITCH_SCALE = 2.5;
const IMU_YAW_SCALE = 2.0;
const IMU_ROLL_SCALE = 2.5;

// IMU smoothing (lower = smoother / more lag)
const IMU_SMOOTHING = 0.12;

// Camera-space hand anchor position (lower-right, close to camera — VR-style)
// These are the EXACT Round 3 values that were confirmed working/visible.
const HAND_ANCHOR = new THREE.Vector3(0.20, -0.24, -0.30);

// Natural resting orientation (radians): relaxed arm pose entering from below
const HAND_BASE_ROTATION = new THREE.Euler(
  -35 * (Math.PI / 180),   // -35° X
  160 * (Math.PI / 180),    // 160° Y
  -15 * (Math.PI / 180),    // -15° Z
  'YXZ'
);

// Neutral resting pose (fallback when hardware disconnected or stale >500ms)
const RESTING_POSE = {
  thumb: 0.3,
  index: 0.2,
  middle: 0.2,
  ring: 0.25,
  pinky: 0.3,
};

// Staleness threshold (ms) — if no data for this long, use resting pose
const STALE_THRESHOLD = 500;

// Joystick movement constants
const JOYSTICK_MOVE_SPEED = 0.08;
const JOYSTICK_DEAD_ZONE = 0.08;

// Hand sway/bob when moving via joystick
const BOB_SPEED = 3.0;
const SWAY_AMOUNT = 0.015;

async function init() {
  // ---- 1. Scene ----
  const container = document.getElementById("game-container");
  const sceneManager = new GameSceneManager(container);

  // ---- 2. Hand Model (restoring Round 3 working pattern + forearm) ----
  const { group: handModel, bones } = await createHandModelAsync(
    "/models/human_hand_base_mesh.glb",
  );

  const isGLTF = handModel.name === "HandWrapper";
  console.log(
    `Hand model loaded: ${isGLTF ? "GLTF" : "Procedural"}, name="${handModel.name}"`,
  );

  // ---- Exact Round 3 hierarchy (PROVEN WORKING) ----
  //   camera
  //     └── handContainer (scale 1.5, position HAND_ANCHOR, rotation set each frame)
  //           └── handPosePivot (fpsScale / 1.5, +15° X tilt)
  //                 └── handModel
  //           └── forearmGroup (scaled to match hand proportions)

  const handPosePivot = new THREE.Group();
  handPosePivot.name = "HandPosePivot";
  handPosePivot.add(handModel);

  // Slight downward arm tilt
  handPosePivot.rotation.set(
    15 * (Math.PI / 180),  // +15° X: tilt the arm entry point downward
    0,
    0
  );

  // Outer container: anchored as a CHILD of the camera (camera-local space)
  const handContainer = new THREE.Group();
  handContainer.name = "HandContainer";
  handContainer.userData.roomObject = false;

  const fpsScale = isGLTF ? 0.08 : 0.15;
  handContainer.scale.set(1.5, 1.5, 1.5);
  // Apply model-type-specific scale on the inner pivot so the outer
  // container stays at the uniform 1.5 for a large, physically present hand.
  handPosePivot.scale.setScalar(fpsScale / 1.5);
  handContainer.add(handPosePivot);
  handContainer.renderOrder = 999;

  // ---- Add forearm geometry INTO the handContainer ----
  // The forearm is authored in procedural-hand units (PALM_LENGTH=1.1 reference).
  // We scale it by (fpsScale / 1.5) so it matches the hand's scale inside handContainer.
  const { forearmGroup } = createForearmGroup();
  forearmGroup.scale.setScalar(fpsScale / 1.5);
  handContainer.add(forearmGroup);

  // ---- Hand Material: Unified MeshStandardMaterial for cohesive skin ----
  const handSkinMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
  });

  handContainer.traverse((child) => {
    if (child.isMesh) {
      child.material = handSkinMaterial;
      child.renderOrder = 1;
      child.frustumCulled = false;
      child.visible = true;
    }
    // Ensure no Object3D in the hand hierarchy is accidentally hidden
    if (child.isObject3D) {
      child.visible = true;
    }
  });

  // ---- CAMERA-SPACE ANCHORING (exact Round 3 pattern) ----
  // Parent handContainer directly to the camera.
  sceneManager.camera.add(handContainer);
  // The camera must be added to the scene for its children to render
  sceneManager.scene.add(sceneManager.camera);

  // Set the anchor position in camera-local space
  handContainer.position.copy(HAND_ANCHOR);

  // Fill light on hand so it's always visible regardless of room lighting
  const handFillLight = new THREE.PointLight(0xffe8d0, 0.6, 2.5, 2);
  handFillLight.position.set(0, 0.3, 0.2);
  handContainer.add(handFillLight);

  // ---- 3. Data Source ----
  const dataSource = new SyntheticDataGenerator({
    mode: "random",
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
        emoji: obj.userData.emoji || "🔑",
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
    doorObj.userData.displayName = "Unlocked Door";

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
    doorObj.children.forEach((child) => {
      if (child.geometry && child.geometry.type === "BoxGeometry") {
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

    // Re-add hand container to camera (it may have been detached during clearRoom)
    if (!sceneManager.camera.children.includes(handContainer)) {
      sceneManager.camera.add(handContainer);
    }
    // Ensure camera is in the scene
    if (!sceneManager.scene.children.includes(sceneManager.camera)) {
      sceneManager.scene.add(sceneManager.camera);
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
      `Room ${currentRoomIndex + 1}: ${currentRoom.name || "Unknown"}`,
      currentRoom.subtitle || "",
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
      ui.ariaSpeak(
        "Cognitive assessment phase. Your pattern recognition will be tested. Do try to keep up, Doctor.",
      );
    } else if (currentRoomIndex === 2) {
      ui.ariaSpeak(
        "Welcome to the Core, Doctor Mercer. This is where it ends — one way or another.",
      );
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
    if (!sceneManager.camera.children.includes(handContainer)) {
      sceneManager.camera.add(handContainer);
    }
    if (!sceneManager.scene.children.includes(sceneManager.camera)) {
      sceneManager.scene.add(sceneManager.camera);
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
      currentRoom.bounds ? currentRoom.bounds.z : 2.5,
    );
    sceneManager.resetCamera();

    // Hide win screen
    const winScreen = document.getElementById("win-screen");
    if (winScreen) winScreen.classList.add("hidden");

    // ARIA intro
    setTimeout(() => {
      ui.ariaSpeak(
        "Restarting neural calibration sequence. Let us begin again, Doctor Mercer.",
      );
    }, 500);
  }

  // ---- Initialize First Room ----

  currentRoom = createRoom1(roomBuilder, inventory);
  if (currentRoom.lightingPreset) {
    sceneManager.setRoomLighting(currentRoom.lightingPreset);
  }
  sceneManager.setRoomBounds(
    currentRoom.bounds ? currentRoom.bounds.x : 2.5,
    currentRoom.bounds ? currentRoom.bounds.z : 2.5,
  );
  ui.setActiveRoom(0);

  // ---- Data Pipeline ----

  let lastDataTimestamp = 0;  // for staleness detection
  let latestJoystick = { x: 0, y: 0 };  // latest joystick input

  dataSource.onData((frame) => {
    latestFrame = frame;
    lastDataTimestamp = Date.now();

    // Track joystick data from hardware
    if (frame.joystick) {
      latestJoystick = frame.joystick;
    }

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

  // Reusable math objects (avoid GC pressure)
  const _imuQuat = new THREE.Quaternion();
  const _imuEuler = new THREE.Euler();
  const _baseQuat = new THREE.Quaternion();
  _baseQuat.setFromEuler(HAND_BASE_ROTATION);
  const _DEG2RAD = Math.PI / 180;
  const _forwardVec = new THREE.Vector3();
  const _rightVec = new THREE.Vector3();
  const _upVec = new THREE.Vector3(0, 1, 0);

  // Smoothed IMU values
  const _smoothedIMU = { roll: 0, pitch: 0, yaw: 0 };

  // Movement/sway state
  let _bobPhase = 0;
  let _moveMagnitude = 0;

  sceneManager.onUpdate((dt) => {
    animator.update(dt);

    // Camera movement (WASD — existing system)
    sceneManager.moveCamera(dt);

    const cam = sceneManager.camera;

    // ---- Staleness Detection ----
    const now = Date.now();
    const isStale = (now - lastDataTimestamp) > STALE_THRESHOLD;
    if (isStale && latestFrame) {
      // Apply resting pose as fallback
      const restingFrame = {
        fingers: { ...RESTING_POSE },
        orientation: { roll: 0, pitch: 0, yaw: 0 },
        timestamp: now,
      };
      animator.applyFrame(restingFrame);
      latestJoystick = { x: 0, y: 0 };
    }

    // ---- Joystick Movement ----
    let jx = latestJoystick.x || 0;
    let jy = latestJoystick.y || 0;

    // Apply dead zone
    if (Math.abs(jx) < JOYSTICK_DEAD_ZONE) jx = 0;
    if (Math.abs(jy) < JOYSTICK_DEAD_ZONE) jy = 0;

    _moveMagnitude = Math.sqrt(jx * jx + jy * jy);

    if (_moveMagnitude > 0) {
      // Get camera forward (zero Y, normalize) for ground-plane movement
      cam.getWorldDirection(_forwardVec);
      _forwardVec.y = 0;
      _forwardVec.normalize();

      // Right vector = forward cross up
      _rightVec.crossVectors(_forwardVec, _upVec).normalize();

      // Move player body (camera) — joystick Y is forward/back, X is strafe
      cam.position.addScaledVector(_forwardVec, jy * JOYSTICK_MOVE_SPEED);
      cam.position.addScaledVector(_rightVec, jx * JOYSTICK_MOVE_SPEED);

      // Clamp to room bounds
      const b = sceneManager.roomBounds;
      cam.position.x = Math.max(-b.x, Math.min(b.x, cam.position.x));
      cam.position.z = Math.max(-b.z, Math.min(b.z, cam.position.z));
    }

    // ---- Hand Sway / Bob (movement feedback) ----
    if (_moveMagnitude > 0) {
      _bobPhase += dt * BOB_SPEED;
    } else {
      // Ease phase back to 0 when stationary
      _bobPhase *= 0.92;
    }

    const bobY = Math.sin(_bobPhase) * SWAY_AMOUNT * _moveMagnitude;
    const swayX = Math.cos(_bobPhase * 0.5) * SWAY_AMOUNT * 0.5 * _moveMagnitude;

    // ---- Hand Orientation: Base + Additive IMU ----
    // Start from the base resting orientation
    handContainer.quaternion.copy(_baseQuat);

    // Apply additive IMU from hardware if available and not stale
    if (latestFrame && latestFrame.orientation && !isStale) {
      const ori = latestFrame.orientation;

      // Smooth the IMU values to reduce jitter
      _smoothedIMU.roll  += (ori.roll  - _smoothedIMU.roll)  * IMU_SMOOTHING;
      _smoothedIMU.pitch += (ori.pitch - _smoothedIMU.pitch) * IMU_SMOOTHING;
      _smoothedIMU.yaw   += (ori.yaw   - _smoothedIMU.yaw)   * IMU_SMOOTHING;

      // Build additive IMU quaternion
      _imuEuler.set(
        _smoothedIMU.pitch * IMU_PITCH_SCALE * _DEG2RAD,
        _smoothedIMU.yaw   * IMU_YAW_SCALE   * _DEG2RAD,
        _smoothedIMU.roll  * IMU_ROLL_SCALE  * _DEG2RAD,
        'YXZ'
      );
      _imuQuat.setFromEuler(_imuEuler);

      // Multiply: base * IMU  (additive on top of resting pose)
      handContainer.quaternion.multiply(_imuQuat);
    }

    // ---- Hand Position: Anchor + Sway + Pickup offset ----
    handContainer.position.set(
      HAND_ANCHOR.x + swayX,
      HAND_ANCHOR.y + bobY,
      HAND_ANCHOR.z
    );

    // Apply pickup animation offsets (camera-local space)
    if (pickupAnimator.isAnimating) {
      pickupAnimator.update(dt);
      const offset = pickupAnimator.currentOffset;
      if (offset) {
        handContainer.position.x += offset.x;
        handContainer.position.y += offset.y;
        handContainer.position.z += offset.z;
      }
    }

    // ---- Gesture Detection (via HandInteraction) ----
    if (latestFrame) {
      const interactionState = interaction.update(latestFrame, dt);

      if (interactionState) {
        // Update grab UI indicator
        ui.setGrabbing(
          interactionState.isGrabbing && interactionState.isHolding,
        );

        // Show interact prompt when looking at an object
        const target = sceneManager.getTargetObject();
        if (target && target.distance < 3) {
          const obj = target.object;
          ui.setTargeting(true);
          if (obj.userData.grabbable && !interactionState.isHolding) {
            ui.showInteractPrompt(true, "to grab");
          } else if (obj.userData.interactive) {
            ui.showInteractPrompt(true, "to interact");
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
        for (const name of ["thumb", "index", "middle", "ring", "pinky"]) {
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
              const needsPress =
                type === "keypad" ||
                type === "safe" ||
                type === "terminal" ||
                type === "pod";

              if (needsPress) {
                pickupAnimator.playPress(handContainer, obj, cam).then(() => {
                  currentRoom.handleInteraction(
                    obj,
                    interaction.heldObject,
                    addToInventory,
                    showClue,
                    showMessage,
                    unlockDoor,
                    ui,
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
                  ui,
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
    ui.ariaSpeak(
      "Good morning, Doctor Mercer. Welcome to Prometheus Labs. Your calibration begins now.",
    );
  }, 1500);

  // Play again handler
  ui.onPlayAgain(() => restartGame());

  // Debug exposure
  if (import.meta.env?.DEV) {
    window.__game = {
      sceneManager,
      dataSource,
      animator,
      interaction,
      pickupAnimator,
      currentRoom: () => currentRoom,
      inventory,
      ui,
    };
    console.log(
      "%cProject ECHO loaded",
      "color: #00ffc8; font-weight: bold;",
      "\nUse hand gestures to interact",
      "\nAccess internals via window.__game",
    );
  }
}

// Boot
init().catch((err) => {
  console.error("Game failed to initialize:", err);
  const loading = document.getElementById("loading-screen");
  if (loading) {
    loading.innerHTML = `<div style="color:#ff4444;text-align:center;padding:2rem;">
      <h2>Failed to start game</h2>
      <p>${err.message || "Unknown error"}</p>
      <p style="opacity:0.6;font-size:0.85rem;">Check the browser console for details.</p>
    </div>`;
    loading.style.display = "flex";
    loading.style.alignItems = "center";
    loading.style.justifyContent = "center";
  }
});
