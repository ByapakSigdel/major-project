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
 * WebXR hand bone chain definitions.
 * Defines the proper parent→child hierarchy for each finger.
 * WebXR Generic Hand models store all bones FLAT under the Armature,
 * so we must re-parent them into chains for proper animation.
 */
const FINGER_CHAINS = {
  thumb:  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index:  ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring:   ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky:  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};

/**
 * Maps WebXR bone names to our standard naming convention.
 * Our convention: {finger}_{joint} where joint is mcp, pip, dip, tip
 * 
 * ANATOMY:
 *   MCP joint = knuckle (between metacarpal and proximal phalanx)
 *     → The PROXIMAL PHALANX bone rotates at this joint
 *   PIP joint = middle joint (between proximal and intermediate phalanx)
 *     → The INTERMEDIATE PHALANX bone rotates at this joint
 *   DIP joint = fingertip joint (between intermediate and distal phalanx)
 *     → The DISTAL PHALANX bone rotates at this joint
 * 
 *   The metacarpal bone barely moves in real hands and is NOT driven.
 * 
 * WebXR naming → our mapping:
 *   - Non-thumb fingers (4 bones + tip):
 *     metacarpal → meta (driven with small flexion for smooth deformation)
 *     phalanx-proximal → mcp (proximal bone rotates at MCP joint)
 *     phalanx-intermediate → pip (intermediate bone rotates at PIP joint)
 *     phalanx-distal → dip (distal bone rotates at DIP joint)
 *     tip → tip (end effector)
 * 
 *   - Thumb (3 bones + tip):
 *     metacarpal → mcp (thumb metacarpal is mobile, unlike fingers)
 *     phalanx-proximal → pip (proximal phalanx)
 *     phalanx-distal → dip (distal phalanx)
 *     tip → tip (end effector)
 */
const WEBXR_TO_STD = {
  'wrist':                              'wrist',
  // Thumb: metacarpal IS mobile (unique to thumb anatomy)
  'thumb-metacarpal':                   'thumb_mcp',
  'thumb-phalanx-proximal':             'thumb_pip',
  'thumb-phalanx-distal':               'thumb_dip',
  'thumb-tip':                          'thumb_tip',
  // Index: metacarpal gets small flexion for smooth joint deformation
  'index-finger-metacarpal':            'index_meta',
  'index-finger-phalanx-proximal':      'index_mcp',
  'index-finger-phalanx-intermediate':  'index_pip',
  'index-finger-phalanx-distal':        'index_dip',
  'index-finger-tip':                   'index_tip',
  // Middle
  'middle-finger-metacarpal':           'middle_meta',
  'middle-finger-phalanx-proximal':     'middle_mcp',
  'middle-finger-phalanx-intermediate': 'middle_pip',
  'middle-finger-phalanx-distal':       'middle_dip',
  'middle-finger-tip':                  'middle_tip',
  // Ring
  'ring-finger-metacarpal':             'ring_meta',
  'ring-finger-phalanx-proximal':       'ring_mcp',
  'ring-finger-phalanx-intermediate':   'ring_pip',
  'ring-finger-phalanx-distal':         'ring_dip',
  'ring-finger-tip':                    'ring_tip',
  // Pinky
  'pinky-finger-metacarpal':            'pinky_meta',
  'pinky-finger-phalanx-proximal':      'pinky_mcp',
  'pinky-finger-phalanx-intermediate':  'pinky_pip',
  'pinky-finger-phalanx-distal':        'pinky_dip',
  'pinky-finger-tip':                   'pinky_tip',
};

/**
 * Re-parent bones from a flat structure into proper parent→child chains.
 * 
 * WebXR Generic Hand models store all bones as siblings under an Armature.
 * Each bone has ABSOLUTE (world-space) position and quaternion.
 * We need to convert them to LOCAL transforms relative to their new parent.
 * 
 * Steps:
 * 1. Save each bone's world-space position and quaternion
 * 2. Detach from old parent (Armature)
 * 3. Attach to new parent (previous bone in chain)
 * 4. Compute local position and quaternion relative to new parent
 * 
 * @param {THREE.Bone[]} bones - All skeleton bones
 * @param {string} wristName - Name of the wrist bone
 */
function reparentBones(bones, wristName = 'wrist') {
  // Build name → bone lookup
  const byName = {};
  for (const bone of bones) {
    byName[bone.name] = bone;
  }

  const wristBone = byName[wristName];
  if (!wristBone) {
    console.warn('No wrist bone found for re-parenting');
    return;
  }

  // Save world transforms BEFORE any re-parenting
  const worldTransforms = {};
  for (const bone of bones) {
    bone.updateWorldMatrix(true, false);
    worldTransforms[bone.name] = {
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    };
    bone.matrixWorld.decompose(
      worldTransforms[bone.name].pos,
      worldTransforms[bone.name].quat,
      worldTransforms[bone.name].scale
    );
  }

  // Re-parent each finger chain: wrist → metacarpal → proximal → ... → tip
  for (const [finger, chain] of Object.entries(FINGER_CHAINS)) {
    let parent = wristBone;

    for (const boneName of chain) {
      const bone = byName[boneName];
      if (!bone) {
        console.warn(`Missing bone: ${boneName}`);
        continue;
      }

      // Detach from old parent and attach to new parent
      if (bone.parent) {
        bone.parent.remove(bone);
      }
      parent.add(bone);

      parent = bone;
    }
  }

  // Now recompute LOCAL transforms from world transforms.
  // For each bone, localQuat = parentWorldQuat^-1 * worldQuat
  // and localPos = parentWorldQuat^-1 * (worldPos - parentWorldPos)
  const parentInvQuat = new THREE.Quaternion();
  const deltaPos = new THREE.Vector3();

  for (const bone of bones) {
    const world = worldTransforms[bone.name];
    if (!world) continue;

    if (bone.parent && bone.parent.isBone && worldTransforms[bone.parent.name]) {
      const parentWorld = worldTransforms[bone.parent.name];

      // Local quaternion = inverse(parentWorldQuat) * worldQuat
      parentInvQuat.copy(parentWorld.quat).invert();
      bone.quaternion.copy(parentInvQuat).multiply(world.quat);

      // Local position = inverse(parentWorldQuat) * (worldPos - parentWorldPos)
      // Also need to account for parent scale
      deltaPos.copy(world.pos).sub(parentWorld.pos);
      deltaPos.applyQuaternion(parentInvQuat);
      // Divide by parent scale
      deltaPos.divide(parentWorld.scale);
      bone.position.copy(deltaPos);
    }
    // Wrist and other root-level bones keep their original transforms
  }

  console.log('Bones re-parented into hierarchical chains');
}

/**
 * Attempt to load a GLTF/GLB hand model.
 * Handles both WebXR Generic Hand format (flat bones) and traditional
 * hierarchical rigs. Builds a standard bone map for the animator.
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
    
    const skeleton = skinnedMesh.skeleton;
    
    // Detect if this is a WebXR-style flat bone model
    // (all bones are siblings under a common parent, not hierarchical)
    const isFlat = skeleton.bones.length > 0 && skeleton.bones.every(
      b => b.parent === skeleton.bones[0].parent
    );
    
    if (isFlat) {
      console.log('Detected flat WebXR bone structure, re-parenting into chains...');
      reparentBones(skeleton.bones);
    }
    
    // Build bone map using WebXR naming convention
    const boneMap = {};
    
    for (const bone of skeleton.bones) {
      // Try direct WebXR name mapping first
      const stdName = WEBXR_TO_STD[bone.name];
      if (stdName && !boneMap[stdName]) {
        boneMap[stdName] = bone;
        continue;
      }
      
      // Fallback: try regex patterns for other naming conventions
      const fallbackPatterns = {
        wrist:       /^(wrist|hand)$/i,
        thumb_mcp:   /thumb.*(meta|mcp|1$)/i,
        thumb_pip:   /thumb.*(proximal|pip|2$)/i,
        thumb_dip:   /thumb.*(distal|dip|3$)/i,
        thumb_tip:   /thumb.*(tip|end|4$)/i,
        index_meta:  /index.*meta/i,
        index_mcp:   /index.*(proximal|mcp|1$)/i,
        index_pip:   /index.*(intermediate|pip|2$)/i,
        index_dip:   /index.*(distal|dip|3$)/i,
        index_tip:   /index.*(tip|end|4$)/i,
        middle_meta: /middle.*meta/i,
        middle_mcp:  /middle.*(proximal|mcp|1$)/i,
        middle_pip:  /middle.*(intermediate|pip|2$)/i,
        middle_dip:  /middle.*(distal|dip|3$)/i,
        middle_tip:  /middle.*(tip|end|4$)/i,
        ring_meta:   /ring.*meta/i,
        ring_mcp:    /ring.*(proximal|mcp|1$)/i,
        ring_pip:    /ring.*(intermediate|pip|2$)/i,
        ring_dip:    /ring.*(distal|dip|3$)/i,
        ring_tip:    /ring.*(tip|end|4$)/i,
        pinky_meta:  /(pinky|little).*meta/i,
        pinky_mcp:   /(pinky|little).*(proximal|mcp|1$)/i,
        pinky_pip:   /(pinky|little).*(intermediate|pip|2$)/i,
        pinky_dip:   /(pinky|little).*(distal|dip|3$)/i,
        pinky_tip:   /(pinky|little).*(tip|end|4$)/i,
      };
      
      for (const [name, pat] of Object.entries(fallbackPatterns)) {
        if (!boneMap[name] && pat.test(bone.name)) {
          boneMap[name] = bone;
          break;
        }
      }
    }
    
    // If we found at least the wrist and some fingers, use it
    const foundBones = Object.keys(boneMap).length;
    console.log(`Mapped ${foundBones} bones:`, Object.keys(boneMap).join(', '));
    if (foundBones < 10) {
      console.warn(`Only found ${foundBones} bones in GLTF, need at least 10. Falling back.`);
      return null;
    }
    
    // Enable shadows and apply skin material
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
           child.material = createSkinMaterial();
        }
      }
    });
    
    // WebXR models are in meters (~0.1m hand width).
    // Scale up to match our scene units (~1.0 unit hand width).
    //
    // IMPORTANT: We must NOT apply rotation/scale directly to the gltf scene
    // because it contains both the SkinnedMesh and the skeleton bones as siblings.
    // In Three.js "attached" bind mode, the vertex shader applies both the mesh's
    // world matrix AND the bone's world matrix. If both include the scene rotation,
    // the rotation gets applied TWICE (double-transform bug).
    //
    // Fix: wrap the gltf scene in a parent Group and apply transforms there.
    // This way the gltf scene's own matrix stays identity, so the mesh world
    // matrix and bone world matrices stay consistent with the bind-time inverses.
    const wrapper = new THREE.Group();
    wrapper.name = 'HandWrapper';
    wrapper.scale.set(10, 10, 10);
    
    // Orient the hand so fingers point UPWARD (+Y) with palm facing the camera (+Z).
    // The WebXR model native orientation:
    //   - Fingers extend along world -Y (downward)
    //   - Palm normal is along world +X (to the right)
    // 
    // Rotation of PI around X flips -Y to +Y (fingers point up).
    // Rotation of PI/2 around Y rotates +X to +Z (palm faces camera).
    // Combined: Euler(PI, PI/2, 0) in XYZ order.
    wrapper.rotation.set(Math.PI, Math.PI / 2, 0);
    wrapper.add(scene);
    
    return { group: wrapper, skeleton, bones: boneMap, mesh: skinnedMesh };
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

/** Unified skin material for cohesive hand appearance */
function createSkinMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
  });
}

/** Same unified skin material for palm (cohesive look) */
function createPalmMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
  });
}

/** Same unified material for joints */
function createJointMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
  });
}

/** Fingernail material -- slightly lighter variant of skin */
function createNailMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
  });
}

/** Nail bed — same unified material */
function createNailBedMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
  });
}

/** Tendon/vein material — unified skin */
function createTendonMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
  });
}

/** Crease/wrinkle line material — unified skin */
function createCreaseMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xFFCBA4,
    roughness: 0.8,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
  });
}

// ---- Geometry Builders ----

/**
 * Create a volumetric finger segment using CylinderGeometry.
 * Each segment has a proper cylinder body with hemisphere caps for smooth joints.
 * radiusBase/radiusTop are clamped to a minimum of 0.015 to prevent thin-line rendering.
 */
function createRealisticFingerSegment(radiusBase, radiusTop, length, flatness, segments = RADIAL_SEGMENTS) {
  // Enforce minimum radius to prevent fingers rendering as thin lines
  const rBot = Math.max(0.015, radiusBase);
  const rTop = Math.max(0.015, radiusTop);

  // Main cylinder body for the finger segment
  const bodyGeo = new THREE.CylinderGeometry(rTop, rBot, length, segments, 4);
  // Position so bottom of cylinder is at y=0 (joint origin) and top at y=length
  bodyGeo.translate(0, length / 2, 0);
  // Apply slight flattening for oval cross-section (dorsal-palmar direction)
  bodyGeo.scale(1.0, 1.0, flatness);

  // Bottom cap (hemisphere at joint base)
  const capBotGeo = new THREE.SphereGeometry(rBot, segments, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  capBotGeo.scale(1.0, 0.6, flatness);

  // Top cap (hemisphere at segment tip)
  const capTopGeo = new THREE.SphereGeometry(rTop, segments, 6, 0, Math.PI * 2, 0, Math.PI / 2);
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
  palmMesh.renderOrder = 1;
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
      bodyMesh.renderOrder = 1;
      bone.add(bodyMesh);

      const capBotMesh = new THREE.Mesh(capBotGeo, skinMat);
      capBotMesh.castShadow = true;
      capBotMesh.renderOrder = 1;
      bone.add(capBotMesh);

      const capTopMesh = new THREE.Mesh(capTopGeo, skinMat);
      capTopMesh.castShadow = true;
      capTopMesh.renderOrder = 1;
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
//  Forearm + Wrist bridge geometry (for full-arm VR model)
// ============================================================

/**
 * Creates a forearm group containing:
 *   1. A tapered cylinder forearm (wider at elbow, narrower at wrist)
 *   2. A short wrist bridge cylinder connecting forearm to palm
 *
 * Dimensions are proportional to the procedural hand's palm
 * (PALM_LENGTH = 1.1, PALM_WIDTH = 0.85).
 *
 * The group's origin (0,0,0) is at the TOP of the wrist bridge,
 * i.e. the attachment point where the hand connects. The forearm
 * extends downward (-Y) from there.
 *
 * @returns {{ forearmGroup: THREE.Group, wristBridgeTop: THREE.Vector3 }}
 */
export function createForearmGroup() {
  const skinMat = createSkinMaterial();

  const forearmGroup = new THREE.Group();
  forearmGroup.name = 'ForearmGroup';

  // ---- Wrist bridge (short cylinder connecting forearm to palm) ----
  // Slightly wider than the palm's wrist connector, smooth transition
  const WRIST_RADIUS_TOP   = 0.22;   // where hand attaches (slightly wider than palm wrist)
  const WRIST_RADIUS_BOT   = 0.26;   // where forearm meets
  const WRIST_LENGTH        = 0.35;   // short bridging segment

  const wristGeo = new THREE.CylinderGeometry(
    WRIST_RADIUS_TOP, WRIST_RADIUS_BOT, WRIST_LENGTH, 20
  );
  const wristMesh = new THREE.Mesh(wristGeo, skinMat);
  wristMesh.name = 'WristBridge';
  wristMesh.position.set(0, -WRIST_LENGTH / 2, 0); // top at y=0, extends down
  wristMesh.castShadow = true;
  forearmGroup.add(wristMesh);

  // ---- Forearm (tapered cylinder, wider at elbow end) ----
  // 3-4x palm length = ~3.3 - 4.4 units. Using 3.8 for a good visual.
  const FOREARM_RADIUS_WRIST = 0.26;  // matches wrist bridge bottom
  const FOREARM_RADIUS_ELBOW = 0.38;  // wider at elbow (muscle bulk)
  const FOREARM_LENGTH        = 3.8;

  const forearmGeo = new THREE.CylinderGeometry(
    FOREARM_RADIUS_WRIST, FOREARM_RADIUS_ELBOW, FOREARM_LENGTH, 22
  );
  const forearmMesh = new THREE.Mesh(forearmGeo, skinMat);
  forearmMesh.name = 'Forearm';
  // Position so the top of the forearm meets the bottom of the wrist bridge
  forearmMesh.position.set(0, -WRIST_LENGTH - FOREARM_LENGTH / 2, 0);
  forearmMesh.castShadow = true;
  forearmGroup.add(forearmMesh);

  // ---- Anatomical details ----

  // Wrist bump (ulnar styloid — bony bump on the pinky/outer side of wrist)
  const ulnarGeo = new THREE.SphereGeometry(0.06, 8, 6);
  ulnarGeo.scale(1.3, 1.0, 0.9);
  const ulnarMesh = new THREE.Mesh(ulnarGeo, skinMat);
  ulnarMesh.position.set(0.24, -WRIST_LENGTH * 0.4, -0.02);
  ulnarMesh.castShadow = true;
  forearmGroup.add(ulnarMesh);

  // Radial styloid (bony bump on thumb side of wrist)
  const radialGeo = new THREE.SphereGeometry(0.05, 8, 6);
  radialGeo.scale(1.1, 1.0, 0.8);
  const radialMesh = new THREE.Mesh(radialGeo, skinMat);
  radialMesh.position.set(-0.22, -WRIST_LENGTH * 0.4, -0.02);
  radialMesh.castShadow = true;
  forearmGroup.add(radialMesh);

  // Subtle forearm muscle bulge (brachioradialis — upper 1/3)
  const muscleBulgeGeo = new THREE.SphereGeometry(0.18, 12, 8);
  muscleBulgeGeo.scale(1.0, 2.5, 0.8);
  const muscleBulge = new THREE.Mesh(muscleBulgeGeo, skinMat);
  muscleBulge.position.set(-0.12, -WRIST_LENGTH - FOREARM_LENGTH * 0.65, 0.06);
  muscleBulge.castShadow = true;
  forearmGroup.add(muscleBulge);

  // Tendon ridges on the back of the wrist (extensor tendons)
  for (let i = 0; i < 3; i++) {
    const tendonGeo = new THREE.CylinderGeometry(0.012, 0.012, WRIST_LENGTH + 0.3, 6);
    const tendonMesh = new THREE.Mesh(tendonGeo, skinMat);
    tendonMesh.position.set(-0.06 + i * 0.06, -WRIST_LENGTH * 0.5, -WRIST_RADIUS_TOP * 0.85);
    tendonMesh.castShadow = true;
    forearmGroup.add(tendonMesh);
  }

  return {
    forearmGroup,
    wristBridgeTop: new THREE.Vector3(0, 0, 0), // hand attaches here
  };
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
  let gltfResult = await loadGLTFHand(gltfPath);
  if (gltfResult) {
    console.log('Loaded GLTF hand model');
    return gltfResult;
  }
  
  // Try fallback to scene.gltf if the first one failed
  if (gltfPath !== '/models/scene.gltf') {
     console.log('First model failed, trying /models/scene.gltf');
     gltfResult = await loadGLTFHand('/models/scene.gltf');
     if (gltfResult) {
        console.log('Loaded GLTF hand model from /models/scene.gltf');
        return gltfResult;
     }
  }

  return createProceduralHand();
}
