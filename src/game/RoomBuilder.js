/**
 * RoomBuilder - Procedural room geometry and object creation
 * 
 * Creates rooms with walls, floor, ceiling, doors, and furniture
 * using only Three.js primitives (no external models needed).
 * 
 * Each object has metadata for interaction:
 *   - grabbable: can be picked up
 *   - interactive: can be used/activated
 *   - clue: shows a clue when interacted
 *   - key: unlocks a specific lock
 */

import * as THREE from 'three';

// ---- Material Palette (bright, presentable) ----
const MATERIALS = {
  wall: () => new THREE.MeshStandardMaterial({ color: 0x8890a0, roughness: 0.85, metalness: 0.05 }),
  wallDark: () => new THREE.MeshStandardMaterial({ color: 0x6a6e80, roughness: 0.9, metalness: 0.05 }),
  floor: () => new THREE.MeshStandardMaterial({ color: 0x706858, roughness: 0.75, metalness: 0.1 }),
  ceiling: () => new THREE.MeshStandardMaterial({ color: 0xd0ccc4, roughness: 0.95 }),
  wood: () => new THREE.MeshStandardMaterial({ color: 0x9b6b3e, roughness: 0.65, metalness: 0.05 }),
  woodLight: () => new THREE.MeshStandardMaterial({ color: 0xbb9050, roughness: 0.55, metalness: 0.05 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0xaab0c0, roughness: 0.3, metalness: 0.7 }),
  metalGold: () => new THREE.MeshStandardMaterial({ color: 0xf0c050, roughness: 0.3, metalness: 0.85 }),
  glass: () => new THREE.MeshStandardMaterial({ color: 0x88bbdd, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 }),
  red: () => new THREE.MeshStandardMaterial({ color: 0xe04040, roughness: 0.45, metalness: 0.1 }),
  green: () => new THREE.MeshStandardMaterial({ color: 0x40bb55, roughness: 0.45, metalness: 0.1 }),
  blue: () => new THREE.MeshStandardMaterial({ color: 0x4060dd, roughness: 0.45, metalness: 0.1 }),
  yellow: () => new THREE.MeshStandardMaterial({ color: 0xeedd44, roughness: 0.4, metalness: 0.1 }),
  paper: () => new THREE.MeshStandardMaterial({ color: 0xfaf5e8, roughness: 0.95, metalness: 0 }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x7c5030, roughness: 0.75, metalness: 0.05 }),
  emissiveRed: () => new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff4444, emissiveIntensity: 0.6 }),
  emissiveGreen: () => new THREE.MeshStandardMaterial({ color: 0x44ff66, emissive: 0x44ff66, emissiveIntensity: 0.6 }),
  emissiveBlue: () => new THREE.MeshStandardMaterial({ color: 0x5588ff, emissive: 0x5588ff, emissiveIntensity: 0.4 }),
  brick: () => new THREE.MeshStandardMaterial({ color: 0xb06030, roughness: 0.85, metalness: 0.0 }),
  concrete: () => new THREE.MeshStandardMaterial({ color: 0x909098, roughness: 0.9, metalness: 0.05 }),
};

export class RoomBuilder {
  constructor(scene, sceneManager) {
    this._scene = scene;
    this._sceneManager = sceneManager;
  }

  // ============================================================
  //  Room Shell (walls, floor, ceiling)
  // ============================================================

  createRoom(width, height, depth, options = {}) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    const wallMat = options.wallMaterial || MATERIALS.wall();
    const floorMat = options.floorMaterial || MATERIALS.floor();
    const ceilMat = options.ceilingMaterial || MATERIALS.ceiling();

    // Floor
    const floorGeo = new THREE.PlaneGeometry(width, depth);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData.roomObject = true;
    group.add(floor);

    // Ceiling
    const ceilGeo = new THREE.PlaneGeometry(width, depth);
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    ceiling.userData.roomObject = true;
    group.add(ceiling);

    // Back wall
    const backGeo = new THREE.PlaneGeometry(width, height);
    const backWall = new THREE.Mesh(backGeo, wallMat.clone());
    backWall.position.z = -depth / 2;
    backWall.position.y = height / 2;
    backWall.receiveShadow = true;
    backWall.userData.roomObject = true;
    group.add(backWall);

    // Front wall (with potential door hole)
    if (!options.noDoorFront) {
      const frontWall = this._createWallWithDoor(width, height, options.doorWidth || 1.2, options.doorHeight || 2.2);
      frontWall.rotation.y = Math.PI;
      frontWall.position.z = depth / 2;
      frontWall.position.y = height / 2;
      frontWall.userData.roomObject = true;
      group.add(frontWall);
    } else {
      const frontGeo = new THREE.PlaneGeometry(width, height);
      const frontWall = new THREE.Mesh(frontGeo, wallMat.clone());
      frontWall.rotation.y = Math.PI;
      frontWall.position.z = depth / 2;
      frontWall.position.y = height / 2;
      frontWall.receiveShadow = true;
      frontWall.userData.roomObject = true;
      group.add(frontWall);
    }

    // Left wall
    const leftGeo = new THREE.PlaneGeometry(depth, height);
    const leftWall = new THREE.Mesh(leftGeo, wallMat.clone());
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -width / 2;
    leftWall.position.y = height / 2;
    leftWall.receiveShadow = true;
    leftWall.userData.roomObject = true;
    group.add(leftWall);

    // Right wall
    const rightGeo = new THREE.PlaneGeometry(depth, height);
    const rightWall = new THREE.Mesh(rightGeo, wallMat.clone());
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = width / 2;
    rightWall.position.y = height / 2;
    rightWall.receiveShadow = true;
    rightWall.userData.roomObject = true;
    group.add(rightWall);

    this._scene.add(group);
    return group;
  }

  _createWallWithDoor(wallWidth, wallHeight, doorWidth, doorHeight) {
    const shape = new THREE.Shape();
    shape.moveTo(-wallWidth / 2, -wallHeight / 2);
    shape.lineTo(wallWidth / 2, -wallHeight / 2);
    shape.lineTo(wallWidth / 2, wallHeight / 2);
    shape.lineTo(-wallWidth / 2, wallHeight / 2);
    shape.lineTo(-wallWidth / 2, -wallHeight / 2);

    // Door hole
    const hole = new THREE.Path();
    hole.moveTo(-doorWidth / 2, -wallHeight / 2);
    hole.lineTo(doorWidth / 2, -wallHeight / 2);
    hole.lineTo(doorWidth / 2, -wallHeight / 2 + doorHeight);
    hole.lineTo(-doorWidth / 2, -wallHeight / 2 + doorHeight);
    hole.lineTo(-doorWidth / 2, -wallHeight / 2);
    shape.holes.push(hole);

    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, MATERIALS.wall());
    mesh.receiveShadow = true;
    return mesh;
  }

  // ============================================================
  //  Furniture & Props
  // ============================================================

  createTable(x, y, z, width = 1.2, depth = 0.6, height = 0.75) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Tabletop
    const topGeo = new THREE.BoxGeometry(width, 0.04, depth);
    const top = new THREE.Mesh(topGeo, MATERIALS.wood());
    top.position.y = height;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.05, height, 0.05);
    const legMat = MATERIALS.wood();
    const offsets = [
      [width / 2 - 0.05, depth / 2 - 0.05],
      [-width / 2 + 0.05, depth / 2 - 0.05],
      [width / 2 - 0.05, -depth / 2 + 0.05],
      [-width / 2 + 0.05, -depth / 2 + 0.05],
    ];
    for (const [ox, oz] of offsets) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(ox, height / 2, oz);
      leg.castShadow = true;
      group.add(leg);
    }

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  createShelf(x, y, z, width = 1.0, height = 1.8, depth = 0.3, shelves = 4) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Side panels
    const sideGeo = new THREE.BoxGeometry(0.03, height, depth);
    const sideMat = MATERIALS.wood();
    const leftSide = new THREE.Mesh(sideGeo, sideMat);
    leftSide.position.set(-width / 2, height / 2, 0);
    leftSide.castShadow = true;
    group.add(leftSide);

    const rightSide = new THREE.Mesh(sideGeo, sideMat);
    rightSide.position.set(width / 2, height / 2, 0);
    rightSide.castShadow = true;
    group.add(rightSide);

    // Back panel
    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, MATERIALS.woodLight());
    back.position.set(0, height / 2, -depth / 2 + 0.01);
    group.add(back);

    // Shelves
    const shelfGeo = new THREE.BoxGeometry(width - 0.02, 0.02, depth - 0.02);
    for (let i = 0; i <= shelves; i++) {
      const shelf = new THREE.Mesh(shelfGeo, sideMat);
      shelf.position.y = (i / shelves) * height;
      shelf.receiveShadow = true;
      group.add(shelf);
    }

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  createChair(x, y, z) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    const mat = MATERIALS.wood();
    // Seat
    const seatGeo = new THREE.BoxGeometry(0.45, 0.04, 0.45);
    const seat = new THREE.Mesh(seatGeo, mat);
    seat.position.y = 0.45;
    seat.castShadow = true;
    group.add(seat);

    // Back
    const backGeo = new THREE.BoxGeometry(0.45, 0.5, 0.03);
    const back = new THREE.Mesh(backGeo, mat);
    back.position.set(0, 0.72, -0.21);
    back.castShadow = true;
    group.add(back);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6);
    const positions = [
      [0.18, 0.225, 0.18],
      [-0.18, 0.225, 0.18],
      [0.18, 0.225, -0.18],
      [-0.18, 0.225, -0.18],
    ];
    for (const [lx, ly, lz] of positions) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx, ly, lz);
      leg.castShadow = true;
      group.add(leg);
    }

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  // ============================================================
  //  Interactive Objects (grabbable, keys, clues)
  // ============================================================

  createKey(x, y, z, color, keyId) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.grabbable = true;
    group.userData.itemType = 'key';
    group.userData.keyId = keyId;
    group.userData.displayName = `${color.charAt(0).toUpperCase() + color.slice(1)} Key`;
    group.userData.emoji = '🔑';

    const mat = color === 'gold' ? MATERIALS.metalGold() :
                color === 'red' ? MATERIALS.red() :
                color === 'blue' ? MATERIALS.blue() :
                color === 'green' ? MATERIALS.green() : MATERIALS.metal();

    // Key handle (ring)
    const ringGeo = new THREE.TorusGeometry(0.06, 0.015, 8, 16);
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    group.add(ring);

    // Key shaft
    const shaftGeo = new THREE.BoxGeometry(0.015, 0.12, 0.008);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.y = -0.06;
    shaft.castShadow = true;
    group.add(shaft);

    // Key teeth
    for (let i = 0; i < 3; i++) {
      const toothGeo = new THREE.BoxGeometry(0.025, 0.008, 0.008);
      const tooth = new THREE.Mesh(toothGeo, mat);
      tooth.position.set(0.012, -0.1 - i * 0.015, 0);
      group.add(tooth);
    }

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }

  createDoor(x, y, z, lockId, options = {}) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'door';
    group.userData.lockId = lockId;
    group.userData.locked = true;
    group.userData.displayName = 'Locked Door';

    // Door panel
    const doorGeo = new THREE.BoxGeometry(1.0, 2.1, 0.08);
    const door = new THREE.Mesh(doorGeo, options.material || MATERIALS.wood());
    door.position.y = 1.05;
    door.castShadow = true;
    door.receiveShadow = true;
    group.add(door);

    // Door frame
    const frameMat = MATERIALS.woodLight();
    // Top frame
    const topFrameGeo = new THREE.BoxGeometry(1.2, 0.08, 0.12);
    const topFrame = new THREE.Mesh(topFrameGeo, frameMat);
    topFrame.position.y = 2.14;
    group.add(topFrame);
    // Side frames
    const sideFrameGeo = new THREE.BoxGeometry(0.08, 2.2, 0.12);
    const leftFrame = new THREE.Mesh(sideFrameGeo, frameMat);
    leftFrame.position.set(-0.56, 1.05, 0);
    group.add(leftFrame);
    const rightFrame = new THREE.Mesh(sideFrameGeo, frameMat);
    rightFrame.position.set(0.56, 1.05, 0);
    group.add(rightFrame);

    // Door handle
    const handleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8);
    const handle = new THREE.Mesh(handleGeo, MATERIALS.metal());
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0.4, 1.0, 0.06);
    handle.castShadow = true;
    group.add(handle);

    // Lock indicator light (red = locked, green = unlocked)
    const lockLightGeo = new THREE.SphereGeometry(0.02, 8, 8);
    const lockLight = new THREE.Mesh(lockLightGeo, MATERIALS.emissiveRed());
    lockLight.position.set(0.4, 1.15, 0.06);
    lockLight.userData.lockIndicator = true;
    group.add(lockLight);

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }

  createNote(x, y, z, clueText, clueTitle = 'Note Found') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.grabbable = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'clue';
    group.userData.clueText = clueText;
    group.userData.clueTitle = clueTitle;
    group.userData.displayName = 'Note';
    group.userData.emoji = '📜';

    const noteGeo = new THREE.BoxGeometry(0.15, 0.002, 0.2);
    const note = new THREE.Mesh(noteGeo, MATERIALS.paper());
    note.castShadow = true;
    group.add(note);

    // Text line indicators (visual only)
    for (let i = 0; i < 4; i++) {
      const lineGeo = new THREE.BoxGeometry(0.1, 0.001, 0.002);
      const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ color: 0x999999 }));
      line.position.set(0, 0.002, -0.06 + i * 0.035);
      group.add(line);
    }

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }

  createBox(x, y, z, size = 0.3, color = 0x6b4226) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
    const box = new THREE.Mesh(geo, mat);
    box.position.set(x, y + size / 2, z);
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.roomObject = true;
    box.userData.grabbable = true;
    box.userData.displayName = 'Box';
    box.userData.emoji = '📦';
    this._scene.add(box);
    this._sceneManager.addInteractable(box);
    return box;
  }

  createButton(x, y, z, buttonId, color = 'red') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'button';
    group.userData.buttonId = buttonId;
    group.userData.pressed = false;
    group.userData.displayName = `${color.charAt(0).toUpperCase() + color.slice(1)} Button`;

    // Button base plate
    const baseGeo = new THREE.BoxGeometry(0.15, 0.15, 0.03);
    const base = new THREE.Mesh(baseGeo, MATERIALS.metal());
    group.add(base);

    // Button itself
    const btnGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16);
    const matFn = color === 'red' ? MATERIALS.emissiveRed :
                  color === 'green' ? MATERIALS.emissiveGreen :
                  MATERIALS.emissiveBlue;
    const btn = new THREE.Mesh(btnGeo, matFn());
    btn.rotation.x = Math.PI / 2;
    btn.position.z = 0.025;
    btn.userData.buttonMesh = true;
    group.add(btn);

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }

  createSphere(x, y, z, radius = 0.1, color = 0xcc3333) {
    const geo = new THREE.SphereGeometry(radius, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(x, y + radius, z);
    sphere.castShadow = true;
    sphere.userData.roomObject = true;
    sphere.userData.grabbable = true;
    sphere.userData.displayName = 'Ball';
    sphere.userData.emoji = '🔴';
    this._scene.add(sphere);
    this._sceneManager.addInteractable(sphere);
    return sphere;
  }

  createClock(x, y, z, time = '3:15') {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'clue';
    group.userData.clueText = `The clock shows ${time}. Is this the combination?`;
    group.userData.clueTitle = 'Wall Clock';
    group.userData.displayName = 'Clock';

    // Clock face
    const faceGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 32);
    const face = new THREE.Mesh(faceGeo, MATERIALS.paper());
    face.rotation.x = Math.PI / 2;
    group.add(face);

    // Clock frame
    const frameGeo = new THREE.TorusGeometry(0.2, 0.015, 8, 32);
    const frame = new THREE.Mesh(frameGeo, MATERIALS.metalGold());
    group.add(frame);

    // Hour markers
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const markerGeo = new THREE.BoxGeometry(0.02, 0.006, 0.006);
      const marker = new THREE.Mesh(markerGeo, MATERIALS.metal());
      marker.position.set(Math.cos(angle) * 0.16, Math.sin(angle) * 0.16, 0.02);
      marker.rotation.z = angle;
      group.add(marker);
    }

    // Hands (based on time)
    const [hours, minutes] = time.split(':').map(Number);
    const hourAngle = ((hours % 12) / 12) * Math.PI * 2 + (minutes / 60) * (Math.PI / 6) - Math.PI / 2;
    const minuteAngle = (minutes / 60) * Math.PI * 2 - Math.PI / 2;

    // Hour hand
    const hourGeo = new THREE.BoxGeometry(0.1, 0.008, 0.005);
    const hourHand = new THREE.Mesh(hourGeo, MATERIALS.metal());
    hourHand.position.set(Math.cos(hourAngle) * 0.05, Math.sin(hourAngle) * 0.05, 0.02);
    hourHand.rotation.z = hourAngle;
    group.add(hourHand);

    // Minute hand
    const minGeo = new THREE.BoxGeometry(0.14, 0.005, 0.005);
    const minHand = new THREE.Mesh(minGeo, MATERIALS.metal());
    minHand.position.set(Math.cos(minuteAngle) * 0.07, Math.sin(minuteAngle) * 0.07, 0.025);
    minHand.rotation.z = minuteAngle;
    group.add(minHand);

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }

  createPainting(x, y, z, color1, color2) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Frame
    const frameGeo = new THREE.BoxGeometry(0.8, 0.6, 0.04);
    const frame = new THREE.Mesh(frameGeo, MATERIALS.metalGold());
    group.add(frame);

    // Canvas
    const canvasGeo = new THREE.BoxGeometry(0.7, 0.5, 0.01);
    const canvasMat = new THREE.MeshStandardMaterial({ color: color1 || 0x223344, roughness: 0.9 });
    const canvas = new THREE.Mesh(canvasGeo, canvasMat);
    canvas.position.z = 0.02;
    group.add(canvas);

    // Abstract art shapes
    const circleGeo = new THREE.CircleGeometry(0.1, 16);
    const circle = new THREE.Mesh(circleGeo, new THREE.MeshStandardMaterial({ color: color2 || 0xcc6633 }));
    circle.position.set(-0.1, 0.05, 0.03);
    group.add(circle);

    const triGeo = new THREE.ConeGeometry(0.08, 0.14, 3);
    const tri = new THREE.Mesh(triGeo, new THREE.MeshStandardMaterial({ color: 0x33cc66 }));
    tri.position.set(0.15, -0.05, 0.03);
    group.add(tri);

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  createBookshelf(x, y, z) {
    const shelf = this.createShelf(x, y, z, 1.2, 2.0, 0.35, 4);

    // Add books
    const bookColors = [0xcc3333, 0x3344cc, 0x33aa44, 0xddcc22, 0x8833cc, 0xcc6633, 0x338899];
    for (let row = 0; row < 4; row++) {
      const numBooks = 4 + Math.floor(Math.random() * 4);
      for (let b = 0; b < numBooks; b++) {
        const bookH = 0.25 + Math.random() * 0.15;
        const bookW = 0.03 + Math.random() * 0.04;
        const bookGeo = new THREE.BoxGeometry(bookW, bookH, 0.22);
        const bookMat = new THREE.MeshStandardMaterial({
          color: bookColors[Math.floor(Math.random() * bookColors.length)],
          roughness: 0.7,
        });
        const book = new THREE.Mesh(bookGeo, bookMat);
        book.position.set(
          -0.45 + b * 0.1 + Math.random() * 0.03,
          (row / 4) * 2.0 + 0.02 + bookH / 2,
          0.02
        );
        book.castShadow = true;
        book.userData.roomObject = true;
        shelf.add(book);
      }
    }

    return shelf;
  }

  createLamp(x, y, z, color = 0xffeedd, intensity = 1.5) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Lamp post
    const postGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8);
    const post = new THREE.Mesh(postGeo, MATERIALS.metal());
    post.position.y = 0.25;
    post.castShadow = true;
    group.add(post);

    // Lamp shade
    const shadeGeo = new THREE.ConeGeometry(0.15, 0.2, 16, 1, true);
    const shade = new THREE.Mesh(shadeGeo, new THREE.MeshStandardMaterial({
      color: 0xf0e8d0,
      side: THREE.DoubleSide,
      roughness: 0.7,
    }));
    shade.position.y = 0.55;
    group.add(shade);

    // Light
    const light = new THREE.PointLight(color, intensity, 8);
    light.position.y = 0.5;
    group.add(light);

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  createCeilingLight(x, y, z, color = 0xffeedd, intensity = 2.5) {
    const group = new THREE.Group();
    group.userData.roomObject = true;

    // Light fixture
    const fixtureGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.05, 16);
    const fixture = new THREE.Mesh(fixtureGeo, MATERIALS.metal());
    group.add(fixture);

    // Bulb
    const bulbGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffffee,
      emissive: 0xffffee,
      emissiveIntensity: 0.8,
    });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.y = -0.06;
    group.add(bulb);

    // Actual light
    const light = new THREE.PointLight(color, intensity, 14);
    light.position.y = -0.1;
    group.add(light);

    group.position.set(x, y, z);
    this._scene.add(group);
    return group;
  }

  createSafe(x, y, z, lockId) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.interactive = true;
    group.userData.interactionType = 'safe';
    group.userData.lockId = lockId;
    group.userData.locked = true;
    group.userData.displayName = 'Safe';

    // Safe body
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.5, 0.4);
    const body = new THREE.Mesh(bodyGeo, MATERIALS.metal());
    body.position.y = 0.25;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Door
    const doorGeo = new THREE.BoxGeometry(0.46, 0.46, 0.03);
    const door = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x666677, roughness: 0.4, metalness: 0.7 }));
    door.position.set(0, 0.25, 0.22);
    group.add(door);

    // Handle / dial
    const dialGeo = new THREE.TorusGeometry(0.06, 0.008, 8, 24);
    const dial = new THREE.Mesh(dialGeo, MATERIALS.metalGold());
    dial.position.set(0.1, 0.25, 0.24);
    group.add(dial);

    // Lock indicator
    const lockGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const lockLight = new THREE.Mesh(lockGeo, MATERIALS.emissiveRed());
    lockLight.position.set(-0.1, 0.35, 0.24);
    lockLight.userData.lockIndicator = true;
    group.add(lockLight);

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }

  createVase(x, y, z) {
    const group = new THREE.Group();
    group.userData.roomObject = true;
    group.userData.grabbable = true;
    group.userData.displayName = 'Vase';
    group.userData.emoji = '🏺';

    // Vase body (using lathe)
    const points = [
      new THREE.Vector2(0.08, 0),
      new THREE.Vector2(0.1, 0.05),
      new THREE.Vector2(0.12, 0.15),
      new THREE.Vector2(0.08, 0.25),
      new THREE.Vector2(0.06, 0.3),
      new THREE.Vector2(0.07, 0.32),
    ];
    const vaseGeo = new THREE.LatheGeometry(points, 16);
    const vase = new THREE.Mesh(vaseGeo, new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.6,
      metalness: 0.1,
    }));
    vase.castShadow = true;
    group.add(vase);

    group.position.set(x, y, z);
    this._scene.add(group);
    this._sceneManager.addInteractable(group);
    return group;
  }
}
