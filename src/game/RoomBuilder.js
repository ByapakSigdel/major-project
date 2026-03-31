/**
 * RoomBuilder - Procedural sci-fi room geometry and object creation
 *
 * Project ECHO themed: underground research facility objects
 *   - Terminals, keypads, containment pods, canisters
 *   - Filing cabinets, lockers, server racks, whiteboards
 *   - Pipes, cameras, warning lights
 *
 * All objects carry interaction metadata in userData.
 */

import * as THREE from 'three';

// ============================================================
//  Material Palette — Sci-Fi Lab
// ============================================================

const MAT = {
  // Structural
  metalClean:  () => new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.3, metalness: 0.7 }),
  metalDark:   () => new THREE.MeshStandardMaterial({ color: 0x404858, roughness: 0.4, metalness: 0.75 }),
  floorTile:   () => new THREE.MeshStandardMaterial({ color: 0x383c48, roughness: 0.55, metalness: 0.2 }),
  ceiling:     () => new THREE.MeshStandardMaterial({ color: 0x606878, roughness: 0.9 }),
  wallPanel:   () => new THREE.MeshStandardMaterial({ color: 0x505868, roughness: 0.7, metalness: 0.15 }),
  wallLight:   () => new THREE.MeshStandardMaterial({ color: 0x687080, roughness: 0.65, metalness: 0.1 }),
  concrete:    () => new THREE.MeshStandardMaterial({ color: 0x606068, roughness: 0.9, metalness: 0.05 }),

  // Glass / screen
  glass:       () => new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.3 }),
  holoScreen:  () => new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }),
  screenOff:   () => new THREE.MeshStandardMaterial({ color: 0x0a1820, roughness: 0.4, metalness: 0.3 }),

  // Accent / feedback
  warningStripe: () => new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.5, metalness: 0.1 }),
  cableBlack:  () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.1 }),
  emissiveCyan:() => new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.8 }),
  emissiveRed: () => new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.6 }),
  emissiveGreen:()=> new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 0.6 }),
  emissiveAmber:()=> new THREE.MeshStandardMaterial({ color: 0xffaa22, emissive: 0xffaa22, emissiveIntensity: 0.5 }),
  emissiveBlue:() => new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x4488ff, emissiveIntensity: 0.5 }),

  // Object specific
  paper:       () => new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.95, metalness: 0 }),
  plastic:     () => new THREE.MeshStandardMaterial({ color: 0xd0d0d8, roughness: 0.6, metalness: 0.05 }),
  red:         () => new THREE.MeshStandardMaterial({ color: 0xdd3333, roughness: 0.45, metalness: 0.1 }),
  blue:        () => new THREE.MeshStandardMaterial({ color: 0x3355dd, roughness: 0.45, metalness: 0.1 }),
  green:       () => new THREE.MeshStandardMaterial({ color: 0x33bb55, roughness: 0.45, metalness: 0.1 }),
  yellow:      () => new THREE.MeshStandardMaterial({ color: 0xddcc33, roughness: 0.45, metalness: 0.1 }),
};

export class RoomBuilder {
  constructor(scene, sceneManager) {
    this._scene = scene;
    this._sm = sceneManager;
  }

  // Helper to add to scene + tag as room object
  _add(obj) {
    obj.userData.roomObject = true;
    this._scene.add(obj);
    return obj;
  }
  
  // Helper to add subtle glow to interactable meshes
  _addInteractGlow(obj) {
    obj.traverse((child) => {
      if (child.isMesh && child.material) {
        // Skip if already has interact glow or has strong existing emissive
        if (child.material._hasInteractGlow) return;
        if (child.material.emissiveIntensity && child.material.emissiveIntensity > 0.2) return;
        
        // Clone material to avoid affecting other objects
        const mat = child.material.clone();
        // Add very subtle cyan emissive glow
        if (!mat.emissive) {
          mat.emissive = new THREE.Color(0x00ffcc);
        } else {
          // Blend subtle cyan with existing emissive
          mat.emissive.lerp(new THREE.Color(0x00ffcc), 0.3);
        }
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 0.08);
        mat._hasInteractGlow = true;
        child.material = mat;
      }
    });
  }
  
  _interact(obj) {
    obj.userData.interactable = true;
    this._sm.addInteractable(obj);
    // Add subtle glow to make interactable items slightly visible
    this._addInteractGlow(obj);
    return obj;
  }

  // ============================================================
  //  Room Shell
  // ============================================================

  createRoom(width, height, depth, options = {}) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    const wallMat = options.wallMaterial || MAT.wallPanel();
    const floorMat = options.floorMaterial || MAT.floorTile();
    const ceilMat = options.ceilingMaterial || MAT.ceiling();

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // Ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = height;
    group.add(ceil);

    // Back wall
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat.clone());
    back.position.set(0, height / 2, -depth / 2);
    group.add(back);

    // Front wall
    if (!options.noDoorFront) {
      const front = this._createWallWithDoor(width, height, options.doorWidth || 1.2, options.doorHeight || 2.2, wallMat);
      front.rotation.y = Math.PI;
      front.position.set(0, height / 2, depth / 2);
      group.add(front);
    } else {
      const front = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat.clone());
      front.rotation.y = Math.PI;
      front.position.set(0, height / 2, depth / 2);
      group.add(front);
    }

    // Left wall
    const left = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wallMat.clone());
    left.rotation.y = Math.PI / 2;
    left.position.set(-width / 2, height / 2, 0);
    group.add(left);

    // Right wall
    const right = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wallMat.clone());
    right.rotation.y = -Math.PI / 2;
    right.position.set(width / 2, height / 2, 0);
    group.add(right);

    // Wall trim strips (subtle sci-fi detail) — horizontal line at ~1m height
    const trimGeo = new THREE.BoxGeometry(width + 0.02, 0.02, 0.02);
    const trimMat = MAT.emissiveCyan();
    trimMat.emissiveIntensity = 0.15; // very subtle
    for (const z of [-depth / 2 + 0.01, depth / 2 - 0.01]) {
      const trim = new THREE.Mesh(trimGeo, trimMat);
      trim.position.set(0, 1.0, z);
      group.add(trim);
    }

    this._scene.add(group);
    return group;
  }

  _createWallWithDoor(wallWidth, wallHeight, doorWidth, doorHeight, wallMat) {
    const shape = new THREE.Shape();
    shape.moveTo(-wallWidth / 2, -wallHeight / 2);
    shape.lineTo(wallWidth / 2, -wallHeight / 2);
    shape.lineTo(wallWidth / 2, wallHeight / 2);
    shape.lineTo(-wallWidth / 2, wallHeight / 2);
    shape.lineTo(-wallWidth / 2, -wallHeight / 2);

    const hole = new THREE.Path();
    hole.moveTo(-doorWidth / 2, -wallHeight / 2);
    hole.lineTo(doorWidth / 2, -wallHeight / 2);
    hole.lineTo(doorWidth / 2, -wallHeight / 2 + doorHeight);
    hole.lineTo(-doorWidth / 2, -wallHeight / 2 + doorHeight);
    hole.lineTo(-doorWidth / 2, -wallHeight / 2);
    shape.holes.push(hole);

    const geo = new THREE.ShapeGeometry(shape);
    return new THREE.Mesh(geo, wallMat || MAT.wallPanel());
  }

  // ============================================================
  //  Lighting Fixtures
  // ============================================================

  createCeilingLight(x, y, z, color = 0xdde8ff, intensity = 2.5) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Fixture housing
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.04, 0.15),
      MAT.metalDark()
    );
    group.add(housing);

    // LED strip
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.01, 0.08),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 })
    );
    led.position.y = -0.025;
    group.add(led);

    // Actual light
    const light = new THREE.PointLight(color, intensity, 14);
    light.position.y = -0.1;
    group.add(light);

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  createWarningLight(x, y, z, color = 0xff4422) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Housing
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12),
      MAT.metalDark()
    );
    group.add(base);

    // Bulb
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 })
    );
    bulb.position.y = 0.04;
    bulb.userData._warningBulb = true;
    group.add(bulb);

    // Pulsing point light
    const light = new THREE.PointLight(color, 0.5, 4);
    light.position.y = 0.06;
    light.userData._warningLight = true;
    group.add(light);

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  // ============================================================
  //  Sci-Fi Furniture & Props
  // ============================================================

  createTable(x, y, z, width = 1.2, depth = 0.6, height = 0.75) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Tabletop
    const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, depth), MAT.metalClean());
    top.position.y = height;
    group.add(top);

    // Legs — angular sci-fi style
    const legGeo = new THREE.BoxGeometry(0.04, height, 0.04);
    const legMat = MAT.metalDark();
    const offsets = [
      [width / 2 - 0.06, depth / 2 - 0.06],
      [-width / 2 + 0.06, depth / 2 - 0.06],
      [width / 2 - 0.06, -depth / 2 + 0.06],
      [-width / 2 + 0.06, -depth / 2 + 0.06],
    ];
    for (const [ox, oz] of offsets) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(ox, height / 2, oz);
      group.add(leg);
    }

    group.position.set(x, y, z);
    this._add(group);
    return group;
  }

  createShelf(x, y, z, width = 1.0, height = 1.8, depth = 0.3, shelves = 4) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    const sideMat = MAT.metalDark();
    // Side panels
    for (const sx of [-width / 2, width / 2]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.03, height, depth), sideMat);
      side.position.set(sx, height / 2, 0);
      group.add(side);
    }
    // Back panel
    const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.02), MAT.metalClean());
    back.position.set(0, height / 2, -depth / 2 + 0.01);
    group.add(back);

    // Shelves
    const shelfGeo = new THREE.BoxGeometry(width - 0.02, 0.02, depth - 0.02);
    for (let i = 0; i <= shelves; i++) {
      const shelf = new THREE.Mesh(shelfGeo, sideMat);
      shelf.position.y = (i / shelves) * height;
      group.add(shelf);
    }

    group.position.set(x, y, z);
    this._add(group);
    return group;
  }

  // ---- Terminal (computer screen + keyboard base) ----

  createTerminal(x, y, z, options = {}) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = options.interactionType || 'terminal';
    group.userData.terminalId = options.terminalId || 'terminal';
    group.userData.displayName = options.displayName || 'Terminal';

    // Base unit
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.35),
      MAT.metalDark()
    );
    base.position.y = 0.03;
    group.add(base);

    // Screen (angled back)
    const screenFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.36, 0.02),
      MAT.metalDark()
    );
    screenFrame.position.set(0, 0.24, -0.12);
    screenFrame.rotation.x = -0.15;
    group.add(screenFrame);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.32),
      options.screenOn !== false ? MAT.holoScreen() : MAT.screenOff()
    );
    screen.position.set(0, 0.24, -0.1);
    screen.rotation.x = -0.15;
    screen.userData._screen = true;
    group.add(screen);

    // Status LED
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 8),
      MAT.emissiveCyan()
    );
    led.position.set(0.2, 0.065, 0.1);
    group.add(led);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Keypad (0-9 + Enter/Clear, each button interactable) ----

  createKeypad(x, y, z, keypadId = 'keypad') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'keypad';
    group.userData.keypadId = keypadId;
    group.userData.displayName = 'Keypad';

    // Back plate
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.32, 0.02),
      MAT.metalDark()
    );
    group.add(plate);

    // Display window
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.05),
      MAT.holoScreen()
    );
    display.position.set(0, 0.11, 0.011);
    display.userData._keypadDisplay = true;
    group.add(display);

    // Number buttons (3x4 grid: 1-9, *, 0, #)
    const labels = ['1','2','3','4','5','6','7','8','9','CLR','0','ENT'];
    const btnGeo = new THREE.BoxGeometry(0.045, 0.035, 0.015);
    for (let i = 0; i < 12; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const bx = (col - 1) * 0.06;
      const by = 0.06 - row * 0.05;

      const isAction = labels[i] === 'CLR' || labels[i] === 'ENT';
      const btnMat = isAction
        ? (labels[i] === 'ENT' ? MAT.emissiveGreen() : MAT.emissiveRed())
        : MAT.metalClean();

      const btn = new THREE.Mesh(btnGeo, btnMat);
      btn.position.set(bx, by, 0.018);
      btn.userData.keypadButton = labels[i];
      group.add(btn);
    }

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Containment Pod ----

  createContainmentPod(x, y, z, color = 0x4488ff, podId = 'pod') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'pod';
    group.userData.podId = podId;
    group.userData.displayName = 'Containment Pod';
    group.userData.podColor = color;
    group.userData.containedItem = null;

    // Base ring
    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.03, 8, 24),
      MAT.metalDark()
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.02;
    group.add(baseRing);

    // Glass cylinder
    const glassMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.2,
    });
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.6, 24, 1, true),
      glassMat
    );
    cylinder.position.y = 0.32;
    group.add(cylinder);

    // Top ring
    const topRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.03, 8, 24),
      MAT.metalDark()
    );
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 0.62;
    group.add(topRing);

    // Inner glow
    const glowMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.15,
    });
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.5, 16),
      glowMat
    );
    glow.position.y = 0.32;
    group.add(glow);

    // Status light at base
    const statusLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 8, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 })
    );
    statusLight.position.set(0.25, 0.05, 0);
    statusLight.userData._podStatus = true;
    group.add(statusLight);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Canister (pickable colored cylinder) ----

  createCanister(x, y, z, color, canisterId) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.grabbable = true;
    group.userData.itemType = 'canister';
    group.userData.keyId = canisterId;
    group.userData.canisterColor = color;
    group.userData.emoji = '🧪';

    const colorHex = color === 'red' ? 0xdd3333 :
                     color === 'blue' ? 0x3355dd :
                     color === 'green' ? 0x33bb55 : 0xcccccc;

    const displayName = `${color.charAt(0).toUpperCase() + color.slice(1)} Canister`;
    group.userData.displayName = displayName;

    // Cylinder body
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.15, 12),
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.5 })
    );
    body.position.y = 0.075;
    group.add(body);

    // Cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12),
      MAT.metalDark()
    );
    cap.position.y = 0.16;
    group.add(cap);

    // Label ring (glowing accent)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.042, 0.005, 8, 16),
      new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.5 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.075;
    group.add(ring);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Filing Cabinet (animated drawer) ----

  createFilingCabinet(x, y, z, cabinetId = 'cabinet') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'container';
    group.userData.containerId = cabinetId;
    group.userData.displayName = 'Filing Cabinet';
    group.userData.opened = false;

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 1.2, 0.5),
      MAT.metalClean()
    );
    body.position.y = 0.6;
    group.add(body);

    // Drawers (3)
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.34, 0.03),
        MAT.metalDark()
      );
      drawer.position.set(0, 0.2 + i * 0.38, 0.26);
      drawer.userData._drawer = true;
      drawer.userData._drawerIndex = i;
      group.add(drawer);

      // Handle
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.02, 0.02),
        MAT.metalClean()
      );
      handle.position.set(0, 0.2 + i * 0.38, 0.29);
      group.add(handle);
    }

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Locker (animated door) ----

  createLocker(x, y, z, lockerId = 'locker') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'container';
    group.userData.containerId = lockerId;
    group.userData.displayName = 'Locker';
    group.userData.opened = false;

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.8, 0.5),
      MAT.metalClean()
    );
    body.position.y = 0.9;
    group.add(body);

    // Door
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 1.74, 0.03),
      MAT.metalDark()
    );
    door.position.set(0, 0.9, 0.26);
    door.userData._lockerDoor = true;
    group.add(door);

    // Vent slots
    for (let i = 0; i < 3; i++) {
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.01, 0.035),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
      slot.position.set(0, 1.5 - i * 0.05, 0.28);
      group.add(slot);
    }

    // Handle
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.15, 0.02),
      MAT.metalClean()
    );
    handle.position.set(0.18, 0.9, 0.29);
    group.add(handle);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Whiteboard ----

  createWhiteboard(x, y, z, content = '') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'clue';
    group.userData.clueText = content;
    group.userData.clueTitle = 'Whiteboard';
    group.userData.displayName = 'Whiteboard';

    // Frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 0.03),
      MAT.metalDark()
    );
    group.add(frame);

    // Board surface
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3 })
    );
    surface.position.z = 0.016;
    group.add(surface);

    // Fake writing lines
    for (let i = 0; i < 5; i++) {
      const w = 0.3 + Math.random() * 0.5;
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.008, 0.001),
        new THREE.MeshStandardMaterial({ color: 0x2244aa })
      );
      line.position.set(-0.2 + Math.random() * 0.1, 0.2 - i * 0.1, 0.017);
      group.add(line);
    }

    group.position.set(x, y, z);

    // Auto-orient to face inward
    if (Math.abs(x) > Math.abs(z)) {
      group.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Server Rack (blinking lights) ----

  createServerRack(x, y, z) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 2.0, 0.5),
      MAT.metalDark()
    );
    frame.position.y = 1.0;
    group.add(frame);

    // Unit panels
    for (let i = 0; i < 8; i++) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.54, 0.18, 0.02),
        MAT.metalClean()
      );
      panel.position.set(0, 0.2 + i * 0.22, 0.26);
      group.add(panel);

      // Status LEDs (2 per panel)
      for (let j = 0; j < 2; j++) {
        const ledColor = Math.random() > 0.3 ? 0x33ff66 : 0xff3333;
        const led = new THREE.Mesh(
          new THREE.SphereGeometry(0.008, 6, 6),
          new THREE.MeshStandardMaterial({ color: ledColor, emissive: ledColor, emissiveIntensity: 0.8 })
        );
        led.position.set(0.2 - j * 0.05, 0.2 + i * 0.22, 0.28);
        led.userData._blinkLed = true;
        led.userData._blinkPhase = Math.random() * Math.PI * 2;
        group.add(led);
      }
    }

    group.position.set(x, y, z);
    this._add(group);
    return group;
  }

  // ---- Pipe Run ----

  createPipeRun(x1, y1, z1, x2, y2, z2, radius = 0.04) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    const start = new THREE.Vector3(x1, y1, z1);
    const end = new THREE.Vector3(x2, y2, z2);
    const length = start.distanceTo(end);
    const dir = new THREE.Vector3().subVectors(end, start).normalize();
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 8),
      MAT.metalDark()
    );
    pipe.position.copy(mid);
    // Align cylinder with direction
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    pipe.quaternion.copy(quat);
    group.add(pipe);

    // Joint caps at each end
    for (const pos of [start, end]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.3, 8, 8),
        MAT.metalClean()
      );
      cap.position.copy(pos);
      group.add(cap);
    }

    this._add(group);
    return group;
  }

  // ---- Security Camera ----

  createCamera(x, y, z) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Mount
    const mount = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.06),
      MAT.metalDark()
    );
    group.add(mount);

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.08),
      MAT.metalClean()
    );
    body.position.set(0, -0.04, 0.06);
    group.add(body);

    // Lens
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.8 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, -0.04, 0.12);
    group.add(lens);

    // Recording LED
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 6, 6),
      MAT.emissiveRed()
    );
    led.position.set(0.05, -0.02, 0.06);
    group.add(led);

    group.position.set(x, y, z);
    this._add(group);
    return group;
  }

  // ============================================================
  //  Interactive Objects (keys, notes, doors, safes)
  // ============================================================

  createNote(x, y, z, clueText, clueTitle = 'Document') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.grabbable = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'clue';
    group.userData.clueText = clueText;
    group.userData.clueTitle = clueTitle;
    group.userData.displayName = clueTitle;
    group.userData.emoji = '📄';

    // Data tablet appearance
    const tablet = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.002, 0.2),
      MAT.metalDark()
    );
    group.add(tablet);

    // Screen area
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.16),
      MAT.holoScreen()
    );
    screen.rotation.x = -Math.PI / 2;
    screen.position.y = 0.002;
    group.add(screen);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  createKey(x, y, z, color, keyId) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.grabbable = true;
    group.userData.itemType = 'keycard';
    group.userData.keyId = keyId;
    group.userData.displayName = `${color.charAt(0).toUpperCase() + color.slice(1)} Keycard`;
    group.userData.emoji = '💳';

    const colorHex = color === 'gold' ? 0xf0c050 :
                     color === 'red' ? 0xdd3333 :
                     color === 'blue' ? 0x3355dd :
                     color === 'green' ? 0x33bb55 : 0xb0b8c8;

    // Card body
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.002, 0.14),
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.6 })
    );
    group.add(card);

    // Chip
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.003, 0.025),
      new THREE.MeshStandardMaterial({ color: 0xf0d060, roughness: 0.2, metalness: 0.8 })
    );
    chip.position.set(-0.015, 0.002, -0.03);
    group.add(chip);

    // Emissive strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.003, 0.005),
      new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.5 })
    );
    strip.position.set(0, 0.002, 0.04);
    group.add(strip);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  createDoor(x, y, z, lockId, options = {}) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'door';
    group.userData.lockId = lockId;
    group.userData.locked = true;
    group.userData.displayName = 'Sealed Door';

    // Door panel (sci-fi sliding door style)
    const doorMat = MAT.metalDark();
    const doorGeo = new THREE.BoxGeometry(1.0, 2.1, 0.08);
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.y = 1.05;
    group.add(door);

    // Door frame
    const frameMat = MAT.metalClean();
    const topFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.12), frameMat);
    topFrame.position.y = 2.14;
    group.add(topFrame);
    for (const sx of [-0.56, 0.56]) {
      const sideFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.12), frameMat);
      sideFrame.position.set(sx, 1.05, 0);
      group.add(sideFrame);
    }

    // Horizontal accent strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.015, 0.09),
      MAT.emissiveCyan()
    );
    strip.position.set(0, 1.05, 0.045);
    strip.userData._doorStrip = true;
    group.add(strip);

    // Lock indicator
    const lockLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      MAT.emissiveRed()
    );
    lockLight.position.set(0.42, 1.15, 0.06);
    lockLight.userData.lockIndicator = true;
    group.add(lockLight);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  createSafe(x, y, z, lockId) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'safe';
    group.userData.lockId = lockId;
    group.userData.locked = true;
    group.userData.displayName = 'Secure Safe';

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.4),
      MAT.metalDark()
    );
    body.position.y = 0.25;
    group.add(body);

    // Door
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.03),
      MAT.metalClean()
    );
    door.position.set(0, 0.25, 0.22);
    group.add(door);

    // Digital display
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.04),
      MAT.holoScreen()
    );
    display.position.set(0, 0.35, 0.24);
    group.add(display);

    // Lock indicator
    const lockLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 8, 8),
      MAT.emissiveRed()
    );
    lockLight.position.set(0.15, 0.35, 0.24);
    lockLight.userData.lockIndicator = true;
    group.add(lockLight);

    group.position.set(x, y, z);
    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Spectrometer (4 colored lights for Room 1 puzzle) ----

  createSpectrometer(x, y, z, colors = ['red', 'blue', 'green', 'yellow']) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'clue';
    group.userData.displayName = 'Spectrometer';

    // Build clue text from colors
    const colorNames = colors.map(c => c.toUpperCase()).join(', ');
    group.userData.clueText = `The spectrometer displays four wavelengths in sequence: ${colorNames}. Each wavelength corresponds to a numerical value.`;
    group.userData.clueTitle = 'Spectrometer Reading';

    // Housing
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.15, 0.2),
      MAT.metalDark()
    );
    group.add(housing);

    // Color lights
    const colorMap = { red: 0xff3333, blue: 0x3355ff, green: 0x33ff55, yellow: 0xffdd33 };
    colors.forEach((c, i) => {
      const hex = colorMap[c] || 0xffffff;
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 12, 12),
        new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.9 })
      );
      light.position.set(-0.2 + i * 0.13, 0.02, 0.11);
      group.add(light);

      // Subtle point light for glow
      const pl = new THREE.PointLight(hex, 0.2, 0.5);
      pl.position.copy(light.position);
      group.add(pl);
    });

    group.position.set(x, y, z);

    // Auto-orient if on side wall
    if (Math.abs(x) > Math.abs(z)) {
      group.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    this._add(group);
    this._interact(group);
    return group;
  }

  // ---- Generic colored sphere (for decoration) ----

  createSphere(x, y, z, radius = 0.1, color = 0xcc3333) {
    const geo = new THREE.SphereGeometry(radius, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(x, y + radius, z);
    sphere.userData.roomObject = true;
    this._scene.add(sphere);
    return sphere;
  }

  // ---- Generic Box ----

  createBox(x, y, z, size = 0.3, color = 0x404858) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    const box = new THREE.Mesh(geo, mat);
    box.position.set(x, y + size / 2, z);
    box.userData.roomObject = true;
    this._scene.add(box);
    return box;
  }

  // ---- Chair (minimal sci-fi) ----

  createChair(x, y, z) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    const mat = MAT.metalDark();
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), mat);
    seat.position.y = 0.45;
    group.add(seat);

    // Back
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.03), mat);
    back.position.set(0, 0.72, -0.21);
    group.add(back);

    // Pedestal (single column instead of legs)
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.08, 0.43, 8),
      MAT.metalClean()
    );
    pedestal.position.y = 0.215;
    group.add(pedestal);

    group.position.set(x, y, z);
    this._add(group);
    return group;
  }
}
