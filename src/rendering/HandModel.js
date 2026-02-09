/**
 * HandModel - Realistic procedural 3D hand with skeletal rigging
 * 
 * Two loading strategies:
 *   1. GLTF: If a .glb/.gltf file exists at /models/hand.glb, loads it
 *   2. Procedural fallback: Builds a high-quality hand from geometry
 * 
 * Bone naming convention (both paths produce the same map):
 *   wrist, palm,
 *   {thumb,index,middle,ring,pinky}_{mcp,pip,dip,tip}
 * 
 * The animation layer only depends on this bone map.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// ============================================================
//  GLTF Loader (preferred path)
// ============================================================

/**
 * Attempt to load a GLTF/GLB hand model.
 * The model's skeleton bones should contain names like:
 *   Hand, Thumb1, Thumb2, Thumb3, Index1, etc.
 * We map them to our standard naming.
 * 
 * @param {string} url - Path to .glb or .gltf file
 * @returns {Promise<{group, skeleton, bones, mesh}|null>}
 */
export async function loadGLTFHand(url) {
  const loader = new GLTFLoader();
  
  try {
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene;
    
    // Find the skinned mesh and skeleton
    let skinnedMesh = null;
    scene.traverse((child) => {
      if (child.isSkinnedMesh) {
        skinnedMesh = child;
      }
    });
    
    if (!skinnedMesh) {
      console.warn('GLTF model has no SkinnedMesh, falling back to procedural');
      return null;
    }
    
    // Build bone map by searching for common naming patterns
    const boneMap = {};
    const skeleton = skinnedMesh.skeleton;
    
    // Common bone name mappings (various rigging conventions)
    const namePatterns = {
      wrist:      [/wrist|hand|armature/i],
      palm:       [/palm|hand_?r?|metacarpal/i],
      thumb_mcp:  [/thumb.?(1|meta|mcp|proximal)/i],
      thumb_pip:  [/thumb.?(2|pip|intermediate|medial)/i],
      thumb_dip:  [/thumb.?(3|dip|distal)/i],
      thumb_tip:  [/thumb.?(4|tip|end)/i],
      index_mcp:  [/index.?(1|meta|mcp|proximal)/i],
      index_pip:  [/index.?(2|pip|intermediate|medial)/i],
      index_dip:  [/index.?(3|dip|distal)/i],
      index_tip:  [/index.?(4|tip|end)/i],
      middle_mcp: [/middle.?(1|meta|mcp|proximal)/i],
      middle_pip: [/middle.?(2|pip|intermediate|medial)/i],
      middle_dip: [/middle.?(3|dip|distal)/i],
      middle_tip: [/middle.?(4|tip|end)/i],
      ring_mcp:   [/ring.?(1|meta|mcp|proximal)/i],
      ring_pip:   [/ring.?(2|pip|intermediate|medial)/i],
      ring_dip:   [/ring.?(3|dip|distal)/i],
      ring_tip:   [/ring.?(4|tip|end)/i],
      pinky_mcp:  [/(pinky|little).?(1|meta|mcp|proximal)/i],
      pinky_pip:  [/(pinky|little).?(2|pip|intermediate|medial)/i],
      pinky_dip:  [/(pinky|little).?(3|dip|distal)/i],
      pinky_tip:  [/(pinky|little).?(4|tip|end)/i],
    };
    
    for (const bone of skeleton.bones) {
      for (const [stdName, patterns] of Object.entries(namePatterns)) {
        if (boneMap[stdName]) continue;
        for (const pat of patterns) {
          if (pat.test(bone.name)) {
            boneMap[stdName] = bone;
            break;
          }
        }
      }
    }
    
    // If we found at least the wrist and some fingers, use it
    const foundBones = Object.keys(boneMap).length;
    if (foundBones < 10) {
      console.warn(`Only found ${foundBones} bones in GLTF, need at least 10. Falling back.`);
      return null;
    }
    
    // Enable shadows
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.rotation.x = -Math.PI / 8;
    
    return { group: scene, skeleton, bones: boneMap, mesh: skinnedMesh };
  } catch (e) {
    console.log('No GLTF model found, using procedural hand:', e.message);
    return null;
  }
}

// ============================================================
//  Realistic procedural hand
// ============================================================

// Anatomical proportions (based on average adult male hand)
const PALM_WIDTH = 0.85;
const PALM_LENGTH = 1.1;
const PALM_DEPTH = 0.28;
const RADIAL_SEGMENTS = 20;  // Higher for smooth curves

const FINGER_CONFIG = {
  thumb:  {
    lengths: [0.34, 0.28, 0.24],
    radii:   [0.095, 0.085, 0.072],
    flatness: [0.78, 0.75, 0.72],  // cross-section flattening (1=circle, <1=oval)
    xOff: -0.42, yOff: 0.25,
    splayZ: -0.45, splayY: -0.5, rotX: 0.2,
  },
  index:  {
    lengths: [0.44, 0.30, 0.22],
    radii:   [0.072, 0.065, 0.055],
    flatness: [0.80, 0.77, 0.74],
    xOff: -0.26, yOff: PALM_LENGTH,
    splayZ: -0.05, splayY: 0, rotX: 0,
  },
  middle: {
    lengths: [0.48, 0.33, 0.24],
    radii:   [0.076, 0.069, 0.058],
    flatness: [0.80, 0.77, 0.74],
    xOff: -0.01, yOff: PALM_LENGTH + 0.02,
    splayZ: 0.0, splayY: 0, rotX: 0,
  },
  ring:   {
    lengths: [0.44, 0.30, 0.22],
    radii:   [0.072, 0.065, 0.054],
    flatness: [0.80, 0.77, 0.74],
    xOff: 0.22, yOff: PALM_LENGTH - 0.03,
    splayZ: 0.05, splayY: 0, rotX: 0,
  },
  pinky:  {
    lengths: [0.34, 0.24, 0.18],
    radii:   [0.062, 0.055, 0.046],
    flatness: [0.78, 0.75, 0.72],
    xOff: 0.40, yOff: PALM_LENGTH - 0.14,
    splayZ: 0.12, splayY: 0, rotX: 0,
  },
};

// ---- Materials ----

/** Realistic skin material with subsurface scattering approximation */
function createSkinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd4a07a,
    roughness: 0.45,
    metalness: 0.0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.7,
    sheen: 0.4,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xffc8a0),
    // Subsurface scattering approximation via transmission
    thickness: 0.8,
    transmission: 0.05,
    ior: 1.38,
    side: THREE.FrontSide,
  });
}

/** Slightly darker/warmer material for palm side and joint creases */
function createPalmMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xdba888,
    roughness: 0.55,
    metalness: 0.0,
    clearcoat: 0.03,
    sheen: 0.5,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0xffd0b0),
    thickness: 0.6,
    transmission: 0.03,
    ior: 1.38,
  });
}

/** Joint/crease material -- slightly redder, rougher */
function createJointMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xc89878,
    roughness: 0.6,
    metalness: 0.0,
    clearcoat: 0.02,
    sheen: 0.2,
    sheenColor: new THREE.Color(0xddaa88),
  });
}

/** Fingernail material -- glossy, translucent */
function createNailMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf0d8cc,
    roughness: 0.15,
    metalness: 0.02,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    transparent: true,
    opacity: 0.93,
    thickness: 0.3,
    transmission: 0.08,
    ior: 1.54,
  });
}

/** Nail bed (pinkish, under the nail) */
function createNailBedMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf0a8a0,
    roughness: 0.4,
    metalness: 0.0,
    transmission: 0.06,
    thickness: 0.2,
    ior: 1.38,
  });
}

/** Tendon/vein material -- very subtle, slightly raised and cooler-toned */
function createTendonMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xc8a080,
    roughness: 0.5,
    metalness: 0.0,
    clearcoat: 0.04,
    sheen: 0.15,
    sheenColor: new THREE.Color(0xccbb99),
  });
}

/** Crease/wrinkle line material */
function createCreaseMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xb08868,
    roughness: 0.75,
    metalness: 0.0,
  });
}

// ---- Geometry Builders ----

/**
 * Create a realistic finger segment with oval cross-section.
 * Uses lathe geometry for organic shape: wider dorsal, narrower palmar.
 * Includes smooth taper from base to tip.
 */
function createRealisticFingerSegment(radiusBase, radiusTop, length, flatness, segments = RADIAL_SEGMENTS) {
  const heightSegs = 8;
  const meshes = [];

  // Build a smooth capsule-like shape via merged BufferGeometry
  const positions = [];
  const normals = [];
  const indices = [];

  for (let row = 0; row <= heightSegs; row++) {
    const t = row / heightSegs;
    const y = t * length;
    // Smooth radius interpolation with slight bulge at midpoint
    const bulge = Math.sin(t * Math.PI) * 0.008;
    const r = THREE.MathUtils.lerp(radiusBase, radiusTop, t) + bulge;
    const flat = THREE.MathUtils.lerp(flatness, flatness * 0.97, t);

    for (let col = 0; col <= segments; col++) {
      const angle = (col / segments) * Math.PI * 2;
      // Oval cross section: flatten along z-axis (dorsal-palmar)
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r * flat;

      // Add slight dorsal ridge (back of finger is flatter/ridged)
      const dorsalFactor = Math.max(0, -Math.sin(angle));
      const xAdjusted = x + dorsalFactor * r * 0.03;
      const zAdjusted = z - dorsalFactor * r * flat * 0.06;

      positions.push(xAdjusted, y, zAdjusted);

      // Normal
      const nx = Math.cos(angle);
      const nz = Math.sin(angle) * flat;
      const nLen = Math.sqrt(nx * nx + nz * nz);
      normals.push(nx / nLen, 0, nz / nLen);
    }
  }

  // Build indices
  for (let row = 0; row < heightSegs; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * (segments + 1) + col;
      const b = a + 1;
      const c = a + (segments + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bodyGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  bodyGeo.setIndex(indices);
  bodyGeo.computeVertexNormals();

  // Bottom cap (hemisphere at joint)
  const capBotGeo = new THREE.SphereGeometry(radiusBase, segments, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  capBotGeo.scale(1.0, 0.6, flatness);

  // Top cap (hemisphere at fingertip side)
  const capTopGeo = new THREE.SphereGeometry(radiusTop, segments, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  capTopGeo.translate(0, length, 0);
  capTopGeo.scale(1.0, 0.6, flatness);

  return { bodyGeo, capBotGeo, capTopGeo };
}

/**
 * Create the pad (palmar cushion) on a finger segment.
 * This is the fleshy part on the palm side of each phalanx.
 */
function createFingerPad(radius, length, flatness) {
  const padGeo = new THREE.SphereGeometry(radius * 0.85, 12, 8);
  padGeo.scale(0.9, length * 0.35, flatness * 0.5);
  return padGeo;
}

/**
 * Build a realistic palm mesh.
 * Uses a combination of shapes for organic contour.
 */
function createPalmGeometry() {
  const hw = PALM_WIDTH / 2;

  // Trapezoidal palm (wider at fingers, narrower at wrist)
  const wristHW = hw * 0.82;
  const fingerHW = hw * 1.02;

  // Use a smooth Bezier-curved outline
  const shape = new THREE.Shape();
  shape.moveTo(-wristHW, 0);
  // Left side: slight curve outward for thenar eminence
  shape.bezierCurveTo(
    -wristHW - 0.06, PALM_LENGTH * 0.3,
    -fingerHW - 0.04, PALM_LENGTH * 0.7,
    -fingerHW, PALM_LENGTH
  );
  // Top (finger base): slight arch
  shape.bezierCurveTo(
    -fingerHW * 0.5, PALM_LENGTH + 0.03,
    fingerHW * 0.5, PALM_LENGTH + 0.03,
    fingerHW, PALM_LENGTH
  );
  // Right side: straighter
  shape.bezierCurveTo(
    fingerHW + 0.02, PALM_LENGTH * 0.7,
    wristHW + 0.02, PALM_LENGTH * 0.3,
    wristHW, 0
  );
  // Bottom (wrist): slight curve
  shape.bezierCurveTo(
    wristHW * 0.5, -0.03,
    -wristHW * 0.5, -0.03,
    -wristHW, 0
  );

  const extrudeSettings = {
    depth: PALM_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 5,
    curveSegments: 16,
  };

  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.translate(0, 0, -PALM_DEPTH / 2);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Create a realistic fingernail with curved shape, cuticle, and lunula.
 */
function createFingernail(radius, length, nailMat, nailBedMat) {
  const meshes = [];
  const nailW = radius * 1.7;
  const nailH = length * 0.42;
  const nailDepth = radius * 0.12;

  // Curved nail surface (slight convex shape)
  const nailShape = new THREE.Shape();
  nailShape.moveTo(-nailW / 2, 0);
  nailShape.lineTo(-nailW / 2, nailH * 0.65);
  nailShape.quadraticCurveTo(-nailW / 2, nailH, -nailW / 3, nailH);
  nailShape.quadraticCurveTo(0, nailH * 1.12, nailW / 3, nailH);
  nailShape.quadraticCurveTo(nailW / 2, nailH, nailW / 2, nailH * 0.65);
  nailShape.lineTo(nailW / 2, 0);
  nailShape.quadraticCurveTo(nailW / 4, -0.003, 0, -0.005);
  nailShape.quadraticCurveTo(-nailW / 4, -0.003, -nailW / 2, 0);

  const nailExtrudeSettings = {
    depth: nailDepth,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 12,
  };

  const nailGeo = new THREE.ExtrudeGeometry(nailShape, nailExtrudeSettings);
  const nailMesh = new THREE.Mesh(nailGeo, nailMat);
  nailMesh.position.set(0, length * 0.48, -radius * 0.88);
  nailMesh.castShadow = true;
  meshes.push(nailMesh);

  // Nail bed (pinkish surface under the nail)
  const bedGeo = new THREE.PlaneGeometry(nailW * 0.88, nailH * 0.88, 4, 4);
  const bedMesh = new THREE.Mesh(bedGeo, nailBedMat);
  bedMesh.position.set(0, length * 0.50, -radius * 0.85);
  meshes.push(bedMesh);

  // Lunula (whitish half-moon at nail base)
  const lunulaGeo = new THREE.CircleGeometry(nailW * 0.25, 12, 0, Math.PI);
  const lunulaMat = new THREE.MeshStandardMaterial({
    color: 0xf8f0ee,
    roughness: 0.25,
    metalness: 0.0,
    transparent: true,
    opacity: 0.7,
  });
  const lunulaMesh = new THREE.Mesh(lunulaGeo, lunulaMat);
  lunulaMesh.position.set(0, length * 0.48 + 0.005, -radius * 0.86);
  meshes.push(lunulaMesh);

  // Cuticle (thin ridge at nail base)
  const cuticleGeo = new THREE.TorusGeometry(nailW * 0.42, 0.004, 4, 16, Math.PI);
  const cuticleMat = new THREE.MeshStandardMaterial({ color: 0xc8a090, roughness: 0.6 });
  const cuticleMesh = new THREE.Mesh(cuticleGeo, cuticleMat);
  cuticleMesh.rotation.z = Math.PI;
  cuticleMesh.position.set(0, length * 0.47, -radius * 0.87);
  meshes.push(cuticleMesh);

  return meshes;
}

/**
 * Create joint wrinkle lines (multiple crease marks at each knuckle).
 */
function createJointCreases(radius, flatness, creaseMat) {
  const meshes = [];
  const creaseCount = 3;

  for (let i = 0; i < creaseCount; i++) {
    const offset = (i - 1) * 0.012;
    const creaseRadius = radius * (1.01 + i * 0.005);
    const creaseGeo = new THREE.TorusGeometry(creaseRadius, 0.003, 3, 20, Math.PI * 0.8);
    const crease = new THREE.Mesh(creaseGeo, creaseMat);
    crease.rotation.x = Math.PI / 2;
    crease.rotation.z = Math.PI / 2 + (i - 1) * 0.1;
    crease.position.set(0, 0.005 + offset, radius * flatness * 0.3);
    meshes.push(crease);
  }

  return meshes;
}

/**
 * Create tendons on the back of the hand (subtle ridges running to each finger).
 */
function createTendons(palmBone, tendonMat) {
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  const meshes = [];

  for (const finger of fingers) {
    const cfg = FINGER_CONFIG[finger];
    const tendonLength = PALM_LENGTH * 0.7;
    const tendonGeo = new THREE.CylinderGeometry(0.012, 0.008, tendonLength, 6);
    tendonGeo.translate(0, tendonLength / 2 + PALM_LENGTH * 0.15, 0);

    const tendon = new THREE.Mesh(tendonGeo, tendonMat);
    tendon.position.set(cfg.xOff, 0, -PALM_DEPTH / 2 - 0.065);
    tendon.castShadow = true;
    meshes.push(tendon);
  }

  return meshes;
}

/**
 * Create subtle vein details on the back of the hand.
 */
function createVeins(tendonMat) {
  const meshes = [];

  // Main vein paths (simplified — just a few key veins)
  const veinPaths = [
    { start: [0.05, 0.1], end: [-0.15, 0.7], radius: 0.008 },
    { start: [0.15, 0.05], end: [0.25, 0.65], radius: 0.007 },
    { start: [-0.10, 0.2], end: [0.05, 0.75], radius: 0.006 },
    { start: [0.28, 0.15], end: [0.35, 0.55], radius: 0.005 },
  ];

  for (const vein of veinPaths) {
    const dx = vein.end[0] - vein.start[0];
    const dy = vein.end[1] - vein.start[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dx, dy);

    const veinGeo = new THREE.CylinderGeometry(vein.radius * 0.7, vein.radius, len, 5);
    const veinMesh = new THREE.Mesh(veinGeo, tendonMat);
    veinMesh.position.set(
      (vein.start[0] + vein.end[0]) / 2,
      (vein.start[1] + vein.end[1]) / 2,
      -PALM_DEPTH / 2 - 0.068
    );
    veinMesh.rotation.z = -angle;
    meshes.push(veinMesh);
  }

  return meshes;
}

/**
 * Create webbing between finger bases (the skin fold connecting adjacent fingers).
 */
function createFingerWebbing(skinMat) {
  const meshes = [];
  const adjacentPairs = [
    ['index', 'middle'],
    ['middle', 'ring'],
    ['ring', 'pinky'],
  ];

  for (const [f1, f2] of adjacentPairs) {
    const cfg1 = FINGER_CONFIG[f1];
    const cfg2 = FINGER_CONFIG[f2];

    const midX = (cfg1.xOff + cfg2.xOff) / 2;
    const midY = Math.min(cfg1.yOff, cfg2.yOff);
    const width = Math.abs(cfg2.xOff - cfg1.xOff) * 0.5;
    const height = 0.08;

    // Small curved sheet between fingers
    const webShape = new THREE.Shape();
    webShape.moveTo(-width / 2, 0);
    webShape.quadraticCurveTo(-width / 2, height, 0, height * 1.1);
    webShape.quadraticCurveTo(width / 2, height, width / 2, 0);
    webShape.lineTo(-width / 2, 0);

    const webGeo = new THREE.ShapeGeometry(webShape, 6);
    const webMesh = new THREE.Mesh(webGeo, skinMat);
    webMesh.position.set(midX, midY - 0.04, 0);
    webMesh.castShadow = true;
    meshes.push(webMesh);

    // Back side of webbing
    const webBack = webMesh.clone();
    webBack.rotation.y = Math.PI;
    webBack.position.set(midX, midY - 0.04, -0.005);
    meshes.push(webBack);
  }

  return meshes;
}

/**
 * Create palm lines (heart line, head line, life line).
 */
function createPalmLines(creaseMat) {
  const meshes = [];

  // Heart line (curves across upper palm)
  const heartPts = [
    new THREE.Vector3(-0.35, PALM_LENGTH * 0.72, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(-0.15, PALM_LENGTH * 0.78, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(0.10, PALM_LENGTH * 0.75, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(0.30, PALM_LENGTH * 0.68, PALM_DEPTH / 2 + 0.065),
  ];
  const heartCurve = new THREE.CatmullRomCurve3(heartPts);
  const heartGeo = new THREE.TubeGeometry(heartCurve, 20, 0.006, 4, false);
  meshes.push(new THREE.Mesh(heartGeo, creaseMat));

  // Head line (across middle palm)
  const headPts = [
    new THREE.Vector3(-0.33, PALM_LENGTH * 0.55, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(-0.10, PALM_LENGTH * 0.58, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(0.10, PALM_LENGTH * 0.53, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(0.35, PALM_LENGTH * 0.48, PALM_DEPTH / 2 + 0.065),
  ];
  const headCurve = new THREE.CatmullRomCurve3(headPts);
  const headGeo = new THREE.TubeGeometry(headCurve, 20, 0.005, 4, false);
  meshes.push(new THREE.Mesh(headGeo, creaseMat));

  // Life line (curves around thenar eminence)
  const lifePts = [
    new THREE.Vector3(-0.30, PALM_LENGTH * 0.78, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(-0.35, PALM_LENGTH * 0.60, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(-0.30, PALM_LENGTH * 0.35, PALM_DEPTH / 2 + 0.065),
    new THREE.Vector3(-0.18, PALM_LENGTH * 0.12, PALM_DEPTH / 2 + 0.065),
  ];
  const lifeCurve = new THREE.CatmullRomCurve3(lifePts);
  const lifeGeo = new THREE.TubeGeometry(lifeCurve, 20, 0.005, 4, false);
  meshes.push(new THREE.Mesh(lifeGeo, creaseMat));

  return meshes;
}

/**
 * Create a fingertip pad (the fleshy rounded pad at the fingertip).
 */
function createFingertipPad(radius, length, flatness, skinMat) {
  const padGeo = new THREE.SphereGeometry(radius * 1.05, 12, 10);
  padGeo.scale(1.0, 0.45, flatness * 0.65);
  const pad = new THREE.Mesh(padGeo, skinMat);
  pad.position.set(0, length * 0.7, radius * flatness * 0.35);
  pad.castShadow = true;
  return pad;
}

// ============================================================
//  Main hand builder
// ============================================================

/**
 * Build the complete realistic procedural hand.
 * @returns {{ group, skeleton, bones, mesh }}
 */
export function createProceduralHand() {
  const skinMat = createSkinMaterial();
  const palmMat = createPalmMaterial();
  const jointMat = createJointMaterial();
  const nailMat = createNailMaterial();
  const nailBedMat = createNailBedMaterial();
  const tendonMat = createTendonMaterial();
  const creaseMat = createCreaseMaterial();

  const group = new THREE.Group();
  group.name = 'HandRoot';

  const boneMap = {};
  const allBones = [];

  // ---- Wrist bone ----
  const wristBone = new THREE.Bone();
  wristBone.name = 'wrist';
  boneMap.wrist = wristBone;
  allBones.push(wristBone);

  // ---- Palm bone ----
  const palmBone = new THREE.Bone();
  palmBone.name = 'palm';
  palmBone.position.set(0, 0.05, 0);
  wristBone.add(palmBone);
  boneMap.palm = palmBone;
  allBones.push(palmBone);

  // ---- Palm mesh ----
  const palmGeo = createPalmGeometry();
  const palmMesh = new THREE.Mesh(palmGeo, skinMat);
  palmMesh.castShadow = true;
  palmMesh.receiveShadow = true;
  palmBone.add(palmMesh);

  // Palm back surface (smooth dorsal bulge)
  const backGeo = new THREE.SphereGeometry(0.30, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  backGeo.scale(1.35, 0.75, 0.55);
  const backMesh = new THREE.Mesh(backGeo, skinMat);
  backMesh.position.set(0, PALM_LENGTH * 0.48, -PALM_DEPTH / 2 - 0.03);
  backMesh.rotation.x = Math.PI;
  backMesh.castShadow = true;
  palmBone.add(backMesh);

  // Wrist connector (smooth transition to forearm)
  const wristGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.25, 18);
  const wristMesh = new THREE.Mesh(wristGeo, skinMat);
  wristMesh.position.set(0, -0.07, 0);
  wristMesh.castShadow = true;
  palmBone.add(wristMesh);

  // Wrist bump (ulnar styloid process — bony bump on pinky side)
  const ulnarBumpGeo = new THREE.SphereGeometry(0.04, 8, 6);
  ulnarBumpGeo.scale(1.2, 1.0, 0.8);
  const ulnarBump = new THREE.Mesh(ulnarBumpGeo, skinMat);
  ulnarBump.position.set(0.22, -0.02, -0.05);
  ulnarBump.castShadow = true;
  palmBone.add(ulnarBump);

  // Thenar eminence (thumb muscle bulge — prominent and rounded)
  const thenarGeo = new THREE.SphereGeometry(0.17, 14, 10);
  thenarGeo.scale(1.25, 1.6, 1.1);
  const thenarMesh = new THREE.Mesh(thenarGeo, palmMat);
  thenarMesh.position.set(-0.28, 0.32, 0.07);
  thenarMesh.castShadow = true;
  palmBone.add(thenarMesh);

  // Secondary thenar (smaller, lower)
  const thenar2Geo = new THREE.SphereGeometry(0.10, 10, 7);
  thenar2Geo.scale(1.1, 1.3, 0.8);
  const thenar2 = new THREE.Mesh(thenar2Geo, palmMat);
  thenar2.position.set(-0.32, 0.15, 0.06);
  thenar2.castShadow = true;
  palmBone.add(thenar2);

  // Hypothenar eminence (pinky side muscle pad)
  const hypoGeo = new THREE.SphereGeometry(0.11, 12, 8);
  hypoGeo.scale(1.0, 1.9, 0.95);
  const hypoMesh = new THREE.Mesh(hypoGeo, palmMat);
  hypoMesh.position.set(0.30, 0.28, 0.06);
  hypoMesh.castShadow = true;
  palmBone.add(hypoMesh);

  // Central palm pad
  const centralPadGeo = new THREE.SphereGeometry(0.15, 12, 8);
  centralPadGeo.scale(1.5, 1.0, 0.5);
  const centralPad = new THREE.Mesh(centralPadGeo, palmMat);
  centralPad.position.set(0.0, PALM_LENGTH * 0.45, PALM_DEPTH / 2 + 0.04);
  centralPad.castShadow = true;
  palmBone.add(centralPad);

  // ---- Tendons on back of hand ----
  const tendonMeshes = createTendons(palmBone, tendonMat);
  for (const t of tendonMeshes) palmBone.add(t);

  // ---- Veins on back of hand ----
  const veinMeshes = createVeins(tendonMat);
  for (const v of veinMeshes) palmBone.add(v);

  // ---- Palm lines (on palm surface) ----
  const palmLines = createPalmLines(creaseMat);
  for (const pl of palmLines) palmBone.add(pl);

  // ---- Finger webbing ----
  const webbingMeshes = createFingerWebbing(skinMat);
  for (const w of webbingMeshes) palmBone.add(w);

  // ---- Fingers ----
  for (const finger of FINGER_NAMES) {
    const cfg = FINGER_CONFIG[finger];
    const jointNames = ['mcp', 'pip', 'dip'];
    let parentBone = palmBone;

    for (let j = 0; j < 3; j++) {
      const bone = new THREE.Bone();
      const boneName = `${finger}_${jointNames[j]}`;
      bone.name = boneName;

      if (j === 0) {
        // MCP: attach at palm
        bone.position.set(cfg.xOff, cfg.yOff, 0);
        bone.rotation.z = cfg.splayZ;
        bone.rotation.y = cfg.splayY;
        bone.rotation.x = cfg.rotX;
      } else {
        bone.position.set(0, cfg.lengths[j - 1], 0);
      }

      parentBone.add(bone);
      boneMap[boneName] = bone;
      allBones.push(bone);

      // ---- Finger segment visual ----
      const rBot = cfg.radii[j];
      const rTop = cfg.radii[j] * 0.87;
      const len = cfg.lengths[j];
      const flat = cfg.flatness[j];

      const { bodyGeo, capBotGeo, capTopGeo } = createRealisticFingerSegment(rBot, rTop, len, flat);

      const bodyMesh = new THREE.Mesh(bodyGeo, skinMat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bone.add(bodyMesh);

      const capBotMesh = new THREE.Mesh(capBotGeo, jointMat);
      capBotMesh.castShadow = true;
      bone.add(capBotMesh);

      const capTopMesh = new THREE.Mesh(capTopGeo, skinMat);
      capTopMesh.castShadow = true;
      bone.add(capTopMesh);

      // Finger pad (fleshy palm side) on each segment
      const padGeo = createFingerPad(rBot, len, flat);
      const padMesh = new THREE.Mesh(padGeo, palmMat);
      padMesh.position.set(0, len * 0.5, rBot * flat * 0.5);
      padMesh.castShadow = true;
      bone.add(padMesh);

      // Joint creases (wrinkle lines at knuckles)
      if (j < 2) {
        const creases = createJointCreases(rBot, flat, creaseMat);
        for (const c of creases) bone.add(c);
      }

      // ---- Fingernail on the DIP (last) segment ----
      if (j === 2) {
        const nailParts = createFingernail(rTop, len, nailMat, nailBedMat);
        for (const part of nailParts) bone.add(part);

        // Fingertip pad
        const tipPad = createFingertipPad(rTop, len, flat, palmMat);
        bone.add(tipPad);
      }

      parentBone = bone;
    }

    // Tip bone (end effector — invisible, used for IK/tracking)
    const tipBone = new THREE.Bone();
    tipBone.name = `${finger}_tip`;
    tipBone.position.set(0, cfg.lengths[2], 0);
    parentBone.add(tipBone);
    boneMap[`${finger}_tip`] = tipBone;
    allBones.push(tipBone);
  }

  // ---- Knuckle ridges on palm back ----
  for (const finger of ['index', 'middle', 'ring', 'pinky']) {
    const cfg = FINGER_CONFIG[finger];
    // More realistic knuckle: flatter, wider bump
    const knuckleGeo = new THREE.SphereGeometry(cfg.radii[0] * 1.4, 12, 8);
    knuckleGeo.scale(1.1, 0.5, 0.75);
    const knuckleMesh = new THREE.Mesh(knuckleGeo, jointMat);
    knuckleMesh.position.set(cfg.xOff, cfg.yOff - 0.02, -PALM_DEPTH / 2 - 0.04);
    knuckleMesh.castShadow = true;
    palmBone.add(knuckleMesh);

    // Slight skin fold above each knuckle
    const foldGeo = new THREE.TorusGeometry(cfg.radii[0] * 1.2, 0.004, 3, 14, Math.PI * 0.7);
    const fold = new THREE.Mesh(foldGeo, creaseMat);
    fold.rotation.x = Math.PI / 2;
    fold.rotation.z = Math.PI / 2;
    fold.position.set(cfg.xOff, cfg.yOff + 0.01, -PALM_DEPTH / 2 - 0.04);
    palmBone.add(fold);
  }

  // ---- Metacarpal ridges (subtle bumps running from wrist to knuckles) ----
  for (const finger of ['index', 'middle', 'ring', 'pinky']) {
    const cfg = FINGER_CONFIG[finger];
    const ridgeLen = PALM_LENGTH * 0.4;
    const ridgeGeo = new THREE.CylinderGeometry(0.016, 0.010, ridgeLen, 6);
    ridgeGeo.translate(0, ridgeLen / 2, 0);
    const ridge = new THREE.Mesh(ridgeGeo, skinMat);
    ridge.position.set(cfg.xOff, cfg.yOff - ridgeLen - 0.05, -PALM_DEPTH / 2 - 0.055);
    ridge.castShadow = true;
    palmBone.add(ridge);
  }

  const skeleton = new THREE.Skeleton(allBones);
  group.add(wristBone);

  // Default view orientation
  group.rotation.x = -Math.PI / 8;
  group.position.y = -0.3;

  return { group, skeleton, bones: boneMap, mesh: group };
}

// ============================================================
//  Main entry point - synchronous, uses procedural hand
// ============================================================

/**
 * Create the hand model (synchronous).
 * Uses the high-quality procedural hand directly.
 * For GLTF loading, use loadGLTFHand() separately.
 * @returns {{group: THREE.Group, skeleton: THREE.Skeleton, bones: Object, mesh: THREE.Group}}
 */
export function createHandModel() {
  console.log('Using realistic procedural hand model');
  return createProceduralHand();
}

/**
 * Async version that tries GLTF first, falls back to procedural.
 * Use this if you have a .glb model available.
 * @param {string} [gltfPath='/models/hand.glb'] - Path to GLTF model
 * @returns {Promise<{group, skeleton, bones, mesh}>}
 */
export async function createHandModelAsync(gltfPath = '/models/hand.glb') {
  const gltfResult = await loadGLTFHand(gltfPath);
  if (gltfResult) {
    console.log('Loaded GLTF hand model');
    return gltfResult;
  }
  return createProceduralHand();
}
