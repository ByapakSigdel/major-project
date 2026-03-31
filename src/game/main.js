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


import "./style.css";
import * as THREE from "three";
import { GameSceneManager } from "./GameSceneManager.js";
import { createHandModelAsync } from "../rendering/HandModel.js";
import { SerialManager } from '../data/SerialManager.js';
import { SyntheticDataGenerator } from "../data/SyntheticDataGenerator.js";
import { HandAnimator } from "../animation/HandAnimator.js";
import { HandInteraction } from "./HandInteraction.js";
import { PickupAnimator } from "./PickupAnimator.js";
import { RoomBuilder } from "./RoomBuilder.js";
import { createRoom1, createRoom2, createRoom3 } from "./EscapeRooms.js";
import { GameUI } from "./GameUI.js";

// ---- Constants ----
const ROOM_CREATORS = [createRoom1, createRoom2, createRoom3];

// IMU sensitivity multipliers (adjusted for natural hand movement)
const IMU_PITCH_SCALE = 1.5;   // up/down tilt
const IMU_YAW_SCALE = 1.5;     // left/right rotation
const IMU_ROLL_SCALE = 2.0;    // wrist roll

// IMU smoothing (lower = smoother / more lag)
const IMU_SMOOTHING = 0.15;

// Camera-space hand anchor position (lower-right, in front of camera — VR-style)
// Positioned as if it's the player's right hand reaching forward
const HAND_ANCHOR = new THREE.Vector3(0.25, -0.20, -0.40);

// Natural resting orientation (radians): hand reaching forward, palm facing left/down
// Like a right hand in front of you ready to grab
const HAND_BASE_ROTATION = new THREE.Euler(
  -15 * (Math.PI / 180),    // slight downward tilt
  -10 * (Math.PI / 180),    // slight inward rotation
  15 * (Math.PI / 180),     // slight roll for natural wrist angle
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

  // Orient the hand so fingers point AWAY from camera (into the scene)
  // Fingers should point forward (-Z), palm facing down
  handPosePivot.rotation.set(
    -Math.PI / 2,             // -90° X: rotate fingers forward
    0,                        // no Y rotation
    0                         // no Z roll
  );

  // Outer container: anchored as a CHILD of the camera (camera-local space)
  const handContainer = new THREE.Group();
  handContainer.name = "HandContainer";
  handContainer.userData.roomObject = false;

  const fpsScale = isGLTF ? 0.10 : 0.18;
  handContainer.scale.set(1.8, 1.8, 1.8);
  // Apply model-type-specific scale on the inner pivot so the outer
  // container stays at the uniform 1.8 for a large, physically present hand.
  handPosePivot.scale.setScalar(fpsScale / 1.8);
  handContainer.add(handPosePivot);
  handContainer.renderOrder = 999;

  // ---- Add forearm geometry INTO the handContainer ----
  // Don't add forearm for cleaner floating hand look
  // const { forearmGroup } = createForearmGroup();

  // ---- Hand Material: Unified MeshStandardMaterial for cohesive skin ----
  const handSkinMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.7,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  // First pass: hide everything, then selectively show hand meshes
  handModel.traverse((child) => {
    if (child.isMesh) {
      child.visible = false; // Hide by default
    }
  });

  // Second pass: show only skinned meshes (the actual hand) and apply material
  handModel.traverse((child) => {
    if (child.isSkinnedMesh) {
      // This is the actual hand mesh
      child.material = handSkinMaterial;
      child.renderOrder = 1000;
      child.frustumCulled = false;
      child.visible = true;
    } else if (child.isMesh && child.parent?.isBone) {
      // Mesh attached to a bone (procedural hand parts)
      child.material = handSkinMaterial;
      child.renderOrder = 1000;
      child.frustumCulled = false;
      child.visible = true;
    }
  });

  // Ensure groups/bones are visible for hierarchy
  handModel.traverse((child) => {
    if (child.isBone || child.isGroup) {
      child.visible = true;
    }
  });

  // Make sure handContainer itself is visible
  handContainer.visible = true;
  handPosePivot.visible = true;
  handModel.visible = true;

  // ---- CAMERA-SPACE ANCHORING (exact Round 3 pattern) ----
  // Parent handContainer directly to the camera.
  sceneManager.camera.add(handContainer);
  // The camera must be added to the scene for its children to render
  sceneManager.scene.add(sceneManager.camera);

  // Set the anchor position in camera-local space
  handContainer.position.copy(HAND_ANCHOR);

  // Fill light on hand so it's always visible regardless of room lighting
  const handFillLight = new THREE.PointLight(0xffffff, 1.0, 3.0, 1.5);
  handFillLight.position.set(0, 0.4, 0.3);
  handContainer.add(handFillLight);

  // Additional ambient light for the hand
  const handAmbientLight = new THREE.AmbientLight(0xffffff, 0.5);
  handContainer.add(handAmbientLight);

  // ---- 3. Data Source ----
  const dataSource = new SyntheticDataGenerator({
    mode: "random",
    updateRate: 30,
    speed: 0.6,
  });

  const serial = new SerialManager();

  

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

  //let lastDataTimestamp = 0;  // for staleness detection
  //let latestJoystick = { x: 0, y: 0 };  // latest joystick input
   let lastDataTimestamp = 0;  
  let latestJoystick = { x: 0, y: 0 };
 
  

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
*/

/**
 * Game Main Entry Point — Project ECHO Escape Room (Hardware-Only Integration)
 */

import "./style.css";
import * as THREE from "three";
import { GameSceneManager } from "./GameSceneManager.js";
import { createHandModelAsync } from "../rendering/HandModel.js";
import { SerialManager } from '../data/SerialManager.js'; 
import { HandAnimator } from "../animation/HandAnimator.js";
import { HandInteraction } from "./HandInteraction.js";
import { PickupAnimator } from "./PickupAnimator.js";
import { RoomBuilder } from "./RoomBuilder.js";
import { createRoom1, createRoom2, createRoom3 } from "./EscapeRooms.js";
import { GameUI } from "./GameUI.js";

// ---- Constants ----
const ROOM_CREATORS = [createRoom1, createRoom2, createRoom3];
const IMU_PITCH_SCALE = 1.5;
const IMU_YAW_SCALE = 1.5;
const IMU_ROLL_SCALE = 2.0;
const IMU_SMOOTHING = 0.12;
const HAND_ANCHOR = new THREE.Vector3(0.25, -0.20, -0.40);
const HAND_BASE_ROTATION = new THREE.Euler(-15 * (Math.PI / 180), -10 * (Math.PI / 180), 15 * (Math.PI / 180), 'YXZ');
const RESTING_POSE = { thumb: 0.3, index: 0.2, middle: 0.2, ring: 0.25, pinky: 0.3 };
const JOYSTICK_MOVE_SPEED = 0.05;
const JOYSTICK_DEAD_ZONE = 0.08;
const BOB_SPEED = 3.0;
const SWAY_AMOUNT = 0.015;

// Interaction thresholds - lowered for better detection
const FIST_THRESHOLD = 0.65;  // Finger bend value to consider "closed"
const FIST_FINGERS_REQUIRED = 3;  // Number of fingers that need to be closed


async function init() {
  // ---- 1. Scene & Setup ----
  const container = document.getElementById("game-container");
  const sceneManager = new GameSceneManager(container);

  // ---- 2. Hand Model ----
  const { group: handModel, bones } = await createHandModelAsync("/models/human_hand_base_mesh.glb");
  const handPosePivot = new THREE.Group();
  handPosePivot.add(handModel);
  handPosePivot.rotation.set(-Math.PI / 2, 0, 0);

  const handContainer = new THREE.Group();
  handContainer.scale.set(1.8, 1.8, 1.8);
  const isGLTF = handModel.name === "HandWrapper";
  handPosePivot.scale.setScalar((isGLTF ? 0.10 : 0.18) / 1.8);
  handContainer.add(handPosePivot);
  
  const handSkinMaterial = new THREE.MeshStandardMaterial({ color: 0xFFCBA4, roughness: 0.7 });
  handModel.traverse(c => { if(c.isSkinnedMesh || (c.isMesh && c.parent?.isBone)) { c.material = handSkinMaterial; c.visible = true; }});

  sceneManager.camera.add(handContainer);
  sceneManager.scene.add(sceneManager.camera);
  handContainer.position.copy(HAND_ANCHOR);

  // ---- 3. Systems (Hardware Only - No Synthetic Data) ----
  const serial = new SerialManager(); 
  const animator = new HandAnimator(bones, 0.15);
  animator.skipWristOrientation = true;
  const interaction = new HandInteraction(sceneManager);
  const pickupAnimator = new PickupAnimator();
  const roomBuilder = new RoomBuilder(sceneManager.scene, sceneManager);
  const ui = new GameUI();
  
  // ---- 4. Hardware Data Handling ----
  let latestFrame = null;
  let latestJoystick = { x: 0, y: 0 };
  let hardwareConnected = false;
  
  // IMU calibration - stores initial offset to zero out drift
  let imuCalibration = { roll: 0, pitch: 0, yaw: 0 };
  let imuCalibrated = false;
  let calibrationSamples = [];
  const CALIBRATION_SAMPLES_NEEDED = 30;

  // Flex sensor calibration - adjust based on your hardware
  // Many flex sensors read HIGH when straight, LOW when bent
  // Set to true if your sensors work this way
  const INVERT_FLEX_SENSORS = true;
  
  // Min/Max ADC values for your flex sensors (calibrate these!)
  // These define the range: straight hand = FLEX_MIN, full fist = FLEX_MAX
  const FLEX_MIN = 200;   // ADC value when finger is straight (open hand)
  const FLEX_MAX = 800;   // ADC value when finger is fully bent (fist)
  
  // Helper to ensure finger values are in 0-1 range with proper calibration
  const normalizeFingerValue = (value) => {
    if (typeof value !== 'number' || isNaN(value)) return 0.2; // default neutral
    
    // If value is already 0-1, use as-is
    if (value >= 0 && value <= 1) {
      return INVERT_FLEX_SENSORS ? (1 - value) : value;
    }
    
    // ADC value (0-1023 range) - apply calibration
    const clamped = Math.max(FLEX_MIN, Math.min(FLEX_MAX, value));
    let normalized = (clamped - FLEX_MIN) / (FLEX_MAX - FLEX_MIN);
    
    // Invert if sensors read high when straight
    if (INVERT_FLEX_SENSORS) {
      normalized = 1 - normalized;
    }
    
    return Math.max(0, Math.min(1, normalized));
  };

  // Helper to apply IMU calibration offset
  const calibrateIMU = (rawRoll, rawPitch, rawYaw) => {
    return {
      roll: (rawRoll || 0) - imuCalibration.roll,
      pitch: (rawPitch || 0) - imuCalibration.pitch,
      yaw: (rawYaw || 0) - imuCalibration.yaw
    };
  };

  // ---- 5. Unified Processor ----
  const processFrame = (frame) => {
    latestFrame = frame;
    if (frame.joystick) latestJoystick = frame.joystick;
    
    // Grab animation overrides
    if (pickupAnimator.fingerOverride !== null) {
      const o = pickupAnimator.fingerOverride;
      frame = { 
        ...frame, 
        fingers: { thumb: o, index: o, middle: o, ring: o, pinky: o } 
      };
    }
    animator.applyFrame(frame);
  };

  // Hardware data listener - runs continuously regardless of UI state
  let lastDataTime = 0;
  let debugLogTimer = 0;
  serial.onData = (rawData) => {
    hardwareConnected = true;
    lastDataTime = Date.now();
    
    // Support BOTH nested and flat data formats from hardware
    // Nested: { fingers: { thumb: 512, ... }, orientation: { roll: 12, ... } }
    // Flat:   { thumb: 512, index: 230, roll: 12, pitch: 5, ... }
    
    // Extract finger values - check nested first, then flat
    const rawFingers = rawData.fingers || rawData;
    const rawThumb = rawFingers.thumb;
    const rawIndex = rawFingers.index;
    const rawMiddle = rawFingers.middle;
    const rawRing = rawFingers.ring;
    const rawPinky = rawFingers.pinky;
    
    // Extract orientation values - check nested first, then flat
    const rawOrientation = rawData.orientation || rawData;
    const rawRoll = rawOrientation.roll;
    const rawPitch = rawOrientation.pitch;
    const rawYaw = rawOrientation.yaw;
    
    // Extract joystick values - check nested first, then flat
    const rawJoystick = rawData.joystick || rawData;
    const rawJoyX = rawJoystick.joyX ?? rawJoystick.x ?? rawData.joyX ?? 0;
    const rawJoyY = rawJoystick.joyY ?? rawJoystick.y ?? rawData.joyY ?? 0;
    
    // Normalize finger values
    const fingers = {
      thumb: normalizeFingerValue(rawThumb),
      index: normalizeFingerValue(rawIndex),
      middle: normalizeFingerValue(rawMiddle),
      ring: normalizeFingerValue(rawRing),
      pinky: normalizeFingerValue(rawPinky)
    };
    
    // Debug: Log raw and normalized values periodically
    debugLogTimer++;
    if (debugLogTimer >= 30) { // Every ~1 second at 30fps
      console.log('Raw data format:', rawData.fingers ? 'NESTED' : 'FLAT');
      console.log('Raw flex:', { 
        thumb: rawThumb, 
        index: rawIndex, 
        middle: rawMiddle,
        ring: rawRing,
        pinky: rawPinky
      });
      console.log('Normalized:', fingers);
      console.log('Fist threshold:', FIST_THRESHOLD, 'Override active:', pickupAnimator.fingerOverride !== null);
      debugLogTimer = 0;
    }

    // IMU auto-calibration on first samples
    if (!imuCalibrated && calibrationSamples.length < CALIBRATION_SAMPLES_NEEDED) {
      calibrationSamples.push({
        roll: rawRoll || 0,
        pitch: rawPitch || 0,
        yaw: rawYaw || 0
      });
      
      if (calibrationSamples.length === CALIBRATION_SAMPLES_NEEDED) {
        // Average the samples to get calibration offset
        imuCalibration.roll = calibrationSamples.reduce((sum, s) => sum + s.roll, 0) / CALIBRATION_SAMPLES_NEEDED;
        imuCalibration.pitch = calibrationSamples.reduce((sum, s) => sum + s.pitch, 0) / CALIBRATION_SAMPLES_NEEDED;
        imuCalibration.yaw = calibrationSamples.reduce((sum, s) => sum + s.yaw, 0) / CALIBRATION_SAMPLES_NEEDED;
        imuCalibrated = true;
        console.log('IMU calibrated:', imuCalibration);
        ui.showMessage('IMU Calibrated - Ready to play!');
      }
    }

    // Apply IMU calibration
    const orientation = calibrateIMU(rawRoll, rawPitch, rawYaw);

    // Joystick with dead zone applied
    let joyX = rawJoyX;
    let joyY = rawJoyY;
    if (Math.abs(joyX) < JOYSTICK_DEAD_ZONE) joyX = 0;
    if (Math.abs(joyY) < JOYSTICK_DEAD_ZONE) joyY = 0;

    const hardwareFrame = {
      fingers,
      orientation,
      joystick: { x: joyX, y: joyY }
    };

    processFrame(hardwareFrame);
  };

  // UI Button for hardware connection
  const connectBtn = document.getElementById('game-connect-hw');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      serial.connect();
      ui.showMessage('Connecting to hardware...');
    });
  }

  // Manual IMU recalibration function (can be triggered by button)
  const recalibrateIMU = () => {
    imuCalibrated = false;
    calibrationSamples = [];
    ui.showMessage('Recalibrating IMU... Hold hand still');
  };
  
  // Expose debug functions and calibration settings to window
  window.recalibrateIMU = recalibrateIMU;
  window.flexCalibration = {
    get invertSensors() { return INVERT_FLEX_SENSORS; },
    get fistThreshold() { return FIST_THRESHOLD; },
    get fingersRequired() { return FIST_FINGERS_REQUIRED; },
    getLatestFrame: () => latestFrame,
    isAnimating: () => pickupAnimator.isAnimating,
    fingerOverride: () => pickupAnimator.fingerOverride
  };
  console.log('Debug: Use window.flexCalibration to check sensor state');
  console.log('Debug: Use window.recalibrateIMU() to recalibrate IMU');

  // ---- 6. Game Logic Functions ----
  let inventory = new Set();
  let currentRoom = createRoom1(roomBuilder, inventory);
  let currentRoomIndex = 0;
  let interactCooldown = 0;
  let isTransitioning = false;
  let gameStartTime = Date.now();

  // Apply initial room lighting
  if (currentRoom.lightingPreset) {
    sceneManager.setRoomLighting(currentRoom.lightingPreset);
  }
  sceneManager.setRoomBounds(
    currentRoom.bounds ? currentRoom.bounds.x : 2.5,
    currentRoom.bounds ? currentRoom.bounds.z : 2.5
  );
  ui.setActiveRoom(0);
  ui.setGameStartTime(gameStartTime);

  function addToInventory(obj) {
    const id = obj.userData.keyId;
    if (id) { inventory.add(id); ui.addInventoryItem({ keyId: id, name: obj.userData.displayName || id, emoji: obj.userData.emoji || "🔑" }); }
    obj.visible = false; sceneManager.removeInteractable(obj);
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
      const elapsed = (Date.now() - gameStartTime) / 1000;
      ui.showWinScreen(elapsed);
      return;
    }

    sceneManager.clearRoom();

    // Re-add hand container to camera
    if (!sceneManager.camera.children.includes(handContainer)) {
      sceneManager.camera.add(handContainer);
    }
    if (!sceneManager.scene.children.includes(sceneManager.camera)) {
      sceneManager.scene.add(sceneManager.camera);
    }

    // Build the new room
    const newRoomBuilder = new RoomBuilder(sceneManager.scene, sceneManager);
    currentRoom = ROOM_CREATORS[currentRoomIndex](newRoomBuilder, inventory);

    // Apply room lighting preset
    if (currentRoom.lightingPreset) {
      sceneManager.setRoomLighting(currentRoom.lightingPreset);
    }

    // Show transition overlay
    await ui.showTransition(
      `Room ${currentRoomIndex + 1}: ${currentRoom.name || "Unknown"}`,
      currentRoom.subtitle || ""
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
      ui.ariaSpeak("Cognitive assessment phase. Your pattern recognition will be tested. Do try to keep up, Doctor.");
    } else if (currentRoomIndex === 2) {
      ui.ariaSpeak("Welcome to the Core, Doctor Mercer. This is where it ends — one way or another.");
    }

    isTransitioning = false;
  }

  // ---- 7. Main Render Loop (The Heart of the App) ----
  const _imuEuler = new THREE.Euler();
  const _baseQuat = new THREE.Quaternion().setFromEuler(HAND_BASE_ROTATION);
  const _smoothedIMU = { roll: 0, pitch: 0, yaw: 0 };
  let _bobPhase = 0;
  

  sceneManager.onUpdate((dt) => {
    // Update animator
    animator.update(dt);
    
    // Camera movement via WASD
    sceneManager.moveCamera(dt);

    // Update interaction state and UI feedback (always runs, regardless of hardware)
    if (latestFrame) {
      const interactionState = interaction.update(latestFrame, dt);
      if (interactionState) {
        ui.setGrabbing(interactionState.isGrabbing && interactionState.isHolding);
        
        // Show interact prompt when looking at an object
        const target = sceneManager.getTargetObject();
        if (target && target.distance < 3.5) {
          const obj = target.object;
          ui.setTargeting(true);
          if (obj.userData.grabbable && !interactionState.isHolding) {
            ui.showInteractPrompt(true, "Fist to grab");
          } else if (obj.userData.interactive) {
            ui.showInteractPrompt(true, "Fist to interact");
          } else {
            ui.showInteractPrompt(false);
          }
        } else {
          ui.setTargeting(false);
          ui.showInteractPrompt(false);
        }
      }
    }

    // A. Joystick Locomotion (hardware joystick)
    if (latestFrame && hardwareConnected) {
      const moveMag = Math.sqrt(latestJoystick.x**2 + latestJoystick.y**2);
      if (moveMag > JOYSTICK_DEAD_ZONE) {
        const fwd = new THREE.Vector3(); 
        sceneManager.camera.getWorldDirection(fwd); 
        fwd.y = 0; 
        fwd.normalize();
        const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
        
        // Note: joystick Y is typically forward/back
        sceneManager.camera.position.addScaledVector(fwd, -latestJoystick.y * JOYSTICK_MOVE_SPEED);
        sceneManager.camera.position.addScaledVector(side, latestJoystick.x * JOYSTICK_MOVE_SPEED);
        
        // Clamp to room bounds
        const b = sceneManager.roomBounds;
        sceneManager.camera.position.x = Math.max(-b.x, Math.min(b.x, sceneManager.camera.position.x));
        sceneManager.camera.position.z = Math.max(-b.z, Math.min(b.z, sceneManager.camera.position.z));
        
        _bobPhase += dt * BOB_SPEED;
      } else { 
        _bobPhase *= 0.92; 
      }
    }

    // B. IMU Smoothing & Hand Rotation
    handContainer.quaternion.copy(_baseQuat);
    if (latestFrame?.orientation && imuCalibrated) {
      const ori = latestFrame.orientation;
      
      // Smooth the IMU values
      _smoothedIMU.roll += (ori.roll - _smoothedIMU.roll) * IMU_SMOOTHING;
      _smoothedIMU.pitch += (ori.pitch - _smoothedIMU.pitch) * IMU_SMOOTHING;
      _smoothedIMU.yaw += (ori.yaw - _smoothedIMU.yaw) * IMU_SMOOTHING;
      
      // Apply rotation with clamping to prevent wild swings
      const clampedRoll = Math.max(-45, Math.min(45, _smoothedIMU.roll));
      const clampedPitch = Math.max(-45, Math.min(45, _smoothedIMU.pitch));
      const clampedYaw = Math.max(-60, Math.min(60, _smoothedIMU.yaw));
      
      _imuEuler.set(
        clampedPitch * IMU_PITCH_SCALE * (Math.PI/180), 
        clampedYaw * IMU_YAW_SCALE * (Math.PI/180), 
        clampedRoll * IMU_ROLL_SCALE * (Math.PI/180), 
        'YXZ'
      );
      handContainer.quaternion.multiply(new THREE.Quaternion().setFromEuler(_imuEuler));
    }

    // C. Hand Position with sway
    handContainer.position.set(
      HAND_ANCHOR.x + (Math.cos(_bobPhase*0.5)*SWAY_AMOUNT), 
      HAND_ANCHOR.y + (Math.sin(_bobPhase)*SWAY_AMOUNT), 
      HAND_ANCHOR.z
    );

    // D. Interaction Check (Fist Detection from Flex Sensors)
    if (latestFrame && latestFrame.fingers && interactCooldown <= 0 && !pickupAnimator.isAnimating && hardwareConnected) {
      const f = latestFrame.fingers;
      
      // Count how many fingers are closed (bent)
      let closedCount = 0;
      if (f.thumb >= FIST_THRESHOLD) closedCount++;
      if (f.index >= FIST_THRESHOLD) closedCount++;
      if (f.middle >= FIST_THRESHOLD) closedCount++;
      if (f.ring >= FIST_THRESHOLD) closedCount++;
      if (f.pinky >= FIST_THRESHOLD) closedCount++;
      
      // Fist detected when enough fingers are closed
      if (closedCount >= FIST_FINGERS_REQUIRED) {
        const target = sceneManager.getTargetObject();
        if (target && target.distance < 3.5) {  // Slightly increased interaction distance
          const obj = target.object;
          
          console.log('FIST DETECTED! Closed fingers:', closedCount, 'Target:', obj.userData.displayName || 'unknown');
          
          if (obj.userData.grabbable) {
            console.log('Triggering GRAB animation for:', obj.userData.displayName);
            pickupAnimator.playPickup(handContainer, obj, sceneManager.camera).then(() => {
              currentRoom.handleGrab(obj, addToInventory, m => ui.showMessage(m));
            });
            interactCooldown = 2.0;
            ui.showMessage('Grabbed: ' + (obj.userData.displayName || 'item'));
          } else if (obj.userData.interactive) {
            console.log('Triggering PRESS animation for:', obj.userData.displayName);
            pickupAnimator.playPress(handContainer, obj, sceneManager.camera).then(() => {
              currentRoom.handleInteraction(obj, null, addToInventory, (t,tx) => ui.showClue(t,tx), m => ui.showMessage(m), unlockDoor, ui);
            });
            interactCooldown = 1.5;
          }
        }
      }
    }
    
    if (interactCooldown > 0) interactCooldown -= dt;
  });

  // E. UI Throttled Update (Prevent Lag)
  let debugAccum = 0;
  sceneManager.onUpdate((dt) => {
    debugAccum += dt;
    if (debugAccum >= 1 / 15) { // Only update UI 15 times a second
      ui.updateDebug(animator.currentState, sceneManager.fps);
      
      // Show connection status
      const statusEl = document.getElementById('hw-status');
      if (statusEl) {
        statusEl.textContent = hardwareConnected ? 'Hardware Connected' : 'Waiting for Hardware...';
        statusEl.style.color = hardwareConnected ? '#4ade80' : '#fbbf24';
      }
      
      debugAccum = 0;
    }
  });

  sceneManager.start();
  ui.hideLoading();
  
  // Show waiting for hardware message
  ui.showMessage('Connect hardware to start playing');

  // ARIA intro dialogue (delayed)
  setTimeout(() => {
    ui.ariaSpeak("Good morning, Doctor Mercer. Connect your neural interface to begin calibration.");
  }, 1500);

  // Play again handler
  ui.onPlayAgain(() => {
    currentRoomIndex = 0;
    inventory.clear();
    ui.clearInventory();
    gameStartTime = Date.now();
    ui.setGameStartTime(gameStartTime);
    isTransitioning = false;
    interactCooldown = 0;
    pickupAnimator.cancel();
    
    // Reset IMU calibration for fresh start
    recalibrateIMU();

    sceneManager.clearRoom();
    if (!sceneManager.camera.children.includes(handContainer)) {
      sceneManager.camera.add(handContainer);
    }
    if (!sceneManager.scene.children.includes(sceneManager.camera)) {
      sceneManager.scene.add(sceneManager.camera);
    }

    const rb = new RoomBuilder(sceneManager.scene, sceneManager);
    currentRoom = createRoom1(rb, inventory);

    if (currentRoom.lightingPreset) {
      sceneManager.setRoomLighting(currentRoom.lightingPreset);
    }

    ui.setActiveRoom(0);
    sceneManager.setRoomBounds(
      currentRoom.bounds ? currentRoom.bounds.x : 2.5,
      currentRoom.bounds ? currentRoom.bounds.z : 2.5
    );
    sceneManager.resetCamera();

    const winScreen = document.getElementById("win-screen");
    if (winScreen) winScreen.classList.add("hidden");

    setTimeout(() => {
      ui.ariaSpeak("Restarting neural calibration sequence. Let us begin again, Doctor Mercer.");
    }, 500);
  });
}

init().catch(console.error);