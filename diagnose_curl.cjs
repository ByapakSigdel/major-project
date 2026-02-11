/**
 * Diagnostic script: Determine correct curl axis and sign for the WebXR hand model.
 * 
 * Loads the actual GLB, re-parents bones (same as HandModel.js), then simulates
 * rotating the index finger proximal phalanx (index_mcp) around each axis (±X, ±Y, ±Z)
 * and reports where the fingertip ends up in SCENE SPACE (after scene rotation).
 * 
 * "Correct curl" means the fingertip moves toward the palm (scene +Z direction,
 * since palm faces camera at +Z).
 */

const THREE = require('three');
const { GLTFLoader } = require('three/addons/loaders/GLTFLoader.js');
const fs = require('fs');
const path = require('path');

// --- Re-parent logic (copied from HandModel.js) ---
const FINGER_CHAINS = {
  thumb:  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index:  ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring:   ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky:  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};

const WEBXR_TO_STD = {
  'wrist':                              'wrist',
  'thumb-metacarpal':                   'thumb_mcp',
  'thumb-phalanx-proximal':             'thumb_pip',
  'thumb-phalanx-distal':               'thumb_dip',
  'thumb-tip':                          'thumb_tip',
  'index-finger-metacarpal':            null,
  'index-finger-phalanx-proximal':      'index_mcp',
  'index-finger-phalanx-intermediate':  'index_pip',
  'index-finger-phalanx-distal':        'index_dip',
  'index-finger-tip':                   'index_tip',
  'middle-finger-metacarpal':           null,
  'middle-finger-phalanx-proximal':     'middle_mcp',
  'middle-finger-phalanx-intermediate': 'middle_pip',
  'middle-finger-phalanx-distal':       'middle_dip',
  'middle-finger-tip':                  'middle_tip',
  'ring-finger-metacarpal':             null,
  'ring-finger-phalanx-proximal':       'ring_mcp',
  'ring-finger-phalanx-intermediate':   'ring_pip',
  'ring-finger-phalanx-distal':         'ring_dip',
  'ring-finger-tip':                    'ring_tip',
  'pinky-finger-metacarpal':            null,
  'pinky-finger-phalanx-proximal':      'pinky_mcp',
  'pinky-finger-phalanx-intermediate':  'pinky_pip',
  'pinky-finger-phalanx-distal':        'pinky_dip',
  'pinky-finger-tip':                   'pinky_tip',
};

function reparentBones(bones, wristName = 'wrist') {
  const byName = {};
  for (const bone of bones) byName[bone.name] = bone;
  
  const wristBone = byName[wristName];
  if (!wristBone) { console.warn('No wrist bone'); return; }
  
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
  
  for (const [finger, chain] of Object.entries(FINGER_CHAINS)) {
    let parent = wristBone;
    for (const boneName of chain) {
      const bone = byName[boneName];
      if (!bone) continue;
      if (bone.parent) bone.parent.remove(bone);
      parent.add(bone);
      parent = bone;
    }
  }
  
  const parentInvQuat = new THREE.Quaternion();
  const deltaPos = new THREE.Vector3();
  
  for (const bone of bones) {
    const world = worldTransforms[bone.name];
    if (!world) continue;
    if (bone.parent && bone.parent.isBone && worldTransforms[bone.parent.name]) {
      const parentWorld = worldTransforms[bone.parent.name];
      parentInvQuat.copy(parentWorld.quat).invert();
      bone.quaternion.copy(parentInvQuat).multiply(world.quat);
      deltaPos.copy(world.pos).sub(parentWorld.pos);
      deltaPos.applyQuaternion(parentInvQuat);
      deltaPos.divide(parentWorld.scale);
      bone.position.copy(deltaPos);
    }
  }
}

// --- Load and analyze ---
async function main() {
  const glbPath = path.join(__dirname, 'public/models/human_hand_base_mesh.glb');
  const data = fs.readFileSync(glbPath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', resolve, reject);
  });
  
  const scene = gltf.scene;
  
  // Find skinned mesh
  let skinnedMesh = null;
  scene.traverse(c => { if (c.isSkinnedMesh) skinnedMesh = c; });
  if (!skinnedMesh) { console.error('No skinned mesh!'); return; }
  
  const skeleton = skinnedMesh.skeleton;
  
  // Check if flat
  const isFlat = skeleton.bones.every(b => b.parent === skeleton.bones[0].parent);
  console.log('Flat bone structure:', isFlat);
  
  if (isFlat) reparentBones(skeleton.bones);
  
  // Apply scene transform (same as HandModel.js)
  scene.scale.set(10, 10, 10);
  scene.rotation.set(Math.PI, Math.PI / 2, 0);
  scene.updateMatrixWorld(true);
  
  // Build bone map
  const boneMap = {};
  for (const bone of skeleton.bones) {
    const stdName = WEBXR_TO_STD[bone.name];
    if (stdName && !boneMap[stdName]) boneMap[stdName] = bone;
  }
  
  // Store rest poses
  const restPoses = {};
  for (const [name, bone] of Object.entries(boneMap)) {
    restPoses[name] = { quaternion: bone.quaternion.clone(), position: bone.position.clone() };
  }
  
  // Helper: get world position of a bone in scene space
  function getWorldPos(bone) {
    scene.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    bone.getWorldPosition(wp);
    return wp;
  }
  
  // --- Report rest pose positions ---
  console.log('\n=== REST POSE POSITIONS (scene space) ===');
  const wristPos = getWorldPos(boneMap['wrist']);
  console.log(`Wrist:      ${fmtVec(wristPos)}`);
  
  const palmBones = ['index_mcp', 'index_pip', 'index_dip', 'index_tip'];
  for (const name of palmBones) {
    if (boneMap[name]) console.log(`${name.padEnd(12)}: ${fmtVec(getWorldPos(boneMap[name]))}`);
  }
  
  console.log('\nPalm normal should be +Z (toward camera)');
  console.log('Fingers should point +Y (upward)');
  
  // --- Report the local frame of the index_mcp bone ---
  console.log('\n=== INDEX_MCP LOCAL AXES IN SCENE SPACE ===');
  const mcpBone = boneMap['index_mcp'];
  scene.updateMatrixWorld(true);
  const mcpWorldQuat = new THREE.Quaternion();
  mcpBone.getWorldQuaternion(mcpWorldQuat);
  
  const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(mcpWorldQuat);
  const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mcpWorldQuat);
  const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(mcpWorldQuat);
  
  console.log(`Local X → scene: ${fmtVec(localX)} (this is the flexion axis)`);
  console.log(`Local Y → scene: ${fmtVec(localY)}`);
  console.log(`Local Z → scene: ${fmtVec(localZ)}`);
  
  // --- Test rotations ---
  console.log('\n=== CURL TEST: Rotate index_mcp by 90° around each axis ===');
  console.log('Looking for: tip moves toward palm (+Z) and toward wrist (-Y)\n');
  
  const tipBone = boneMap['index_tip'];
  const restTipPos = getWorldPos(tipBone);
  console.log(`Rest tip position: ${fmtVec(restTipPos)}`);
  
  // Also get the palm center position for reference
  const middleMcp = boneMap['middle_mcp'];
  const palmCenter = getWorldPos(middleMcp);
  console.log(`Palm center (middle_mcp): ${fmtVec(palmCenter)}\n`);
  
  const axes = [
    { name: '+X', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI / 2 },
    { name: '-X', axis: new THREE.Vector3(1, 0, 0), angle: -Math.PI / 2 },
    { name: '+Y', axis: new THREE.Vector3(0, 1, 0), angle: Math.PI / 2 },
    { name: '-Y', axis: new THREE.Vector3(0, 1, 0), angle: -Math.PI / 2 },
    { name: '+Z', axis: new THREE.Vector3(0, 0, 1), angle: Math.PI / 2 },
    { name: '-Z', axis: new THREE.Vector3(0, 0, 1), angle: -Math.PI / 2 },
  ];
  
  // Test ONLY on index_mcp (the proximal phalanx bone)
  for (const { name, axis, angle } of axes) {
    // Reset all bones to rest
    for (const [bname, bone] of Object.entries(boneMap)) {
      bone.quaternion.copy(restPoses[bname].quaternion);
    }
    
    // Apply rotation: rest * rotation
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    mcpBone.quaternion.copy(restPoses['index_mcp'].quaternion).multiply(rotQuat);
    
    scene.updateMatrixWorld(true);
    const newTipPos = getWorldPos(tipBone);
    
    const deltaY = newTipPos.y - restTipPos.y;
    const deltaZ = newTipPos.z - restTipPos.z;
    
    const curlsTowardPalm = deltaZ > 0.1;
    const curlsDown = deltaY < -0.1;
    const isCorrectCurl = curlsTowardPalm && curlsDown;
    
    console.log(`${name.padEnd(3)}: tip → ${fmtVec(newTipPos)}  ΔY=${deltaY.toFixed(3)}  ΔZ=${deltaZ.toFixed(3)}  ${isCorrectCurl ? '✓ CORRECT CURL' : curlsTowardPalm ? '~ partial (toward palm but not down)' : ''}`);
  }
  
  // --- Now test with smaller angles (45°) to see if the curl is proportional ---
  console.log('\n=== PROGRESSIVE CURL TEST (best axis from above) ===');
  console.log('Testing +X and -X at 0°, 30°, 60°, 90° on ALL index joints simultaneously\n');
  
  for (const sign of ['+', '-']) {
    console.log(`--- ${sign}X rotation on index_mcp + index_pip + index_dip ---`);
    for (const deg of [0, 30, 60, 90]) {
      const angle = (sign === '+' ? 1 : -1) * deg * Math.PI / 180;
      
      // Reset all bones
      for (const [bname, bone] of Object.entries(boneMap)) {
        bone.quaternion.copy(restPoses[bname].quaternion);
      }
      
      // Apply to all 3 index joints
      for (const joint of ['index_mcp', 'index_pip', 'index_dip']) {
        const bone = boneMap[joint];
        if (!bone) continue;
        const rotQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), angle);
        bone.quaternion.copy(restPoses[joint].quaternion).multiply(rotQuat);
      }
      
      scene.updateMatrixWorld(true);
      const pos = getWorldPos(tipBone);
      console.log(`  ${deg.toString().padStart(3)}°: tip = ${fmtVec(pos)}  Y=${pos.y.toFixed(3)}  Z=${pos.z.toFixed(3)}`);
    }
    console.log('');
  }
  
  // --- Test the actual current code behavior ---
  console.log('\n=== SIMULATING CURRENT CODE (effectiveBend * maxAngle) ===');
  const DEG_TO_RAD = Math.PI / 180;
  const JOINT_MAX_ANGLES = { mcp: 80 * DEG_TO_RAD, pip: 90 * DEG_TO_RAD, dip: 65 * DEG_TO_RAD };
  const JOINT_DISTRIBUTION = { mcp: 0.85, pip: 1.0, dip: 0.75 };
  
  for (const bendValue of [0, 0.25, 0.5, 0.75, 1.0]) {
    // Reset all bones
    for (const [bname, bone] of Object.entries(boneMap)) {
      bone.quaternion.copy(restPoses[bname].quaternion);
    }
    
    for (const joint of ['mcp', 'pip', 'dip']) {
      const boneName = `index_${joint}`;
      const bone = boneMap[boneName];
      if (!bone) continue;
      
      const distribution = JOINT_DISTRIBUTION[joint] || 1.0;
      const effectiveBend = Math.min(1.0, bendValue * distribution);
      const curlAngle = effectiveBend * JOINT_MAX_ANGLES[joint]; // current code: positive
      
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), curlAngle);
      bone.quaternion.copy(restPoses[boneName].quaternion).multiply(rotQuat);
    }
    
    scene.updateMatrixWorld(true);
    const pos = getWorldPos(tipBone);
    console.log(`  bend=${bendValue.toFixed(2)}: tip = ${fmtVec(pos)}  (current code: +X)`);
  }
  
  console.log('\n=== SIMULATING NEGATIVE X (original code) ===');
  for (const bendValue of [0, 0.25, 0.5, 0.75, 1.0]) {
    for (const [bname, bone] of Object.entries(boneMap)) {
      bone.quaternion.copy(restPoses[bname].quaternion);
    }
    
    for (const joint of ['mcp', 'pip', 'dip']) {
      const boneName = `index_${joint}`;
      const bone = boneMap[boneName];
      if (!bone) continue;
      
      const distribution = JOINT_DISTRIBUTION[joint] || 1.0;
      const effectiveBend = Math.min(1.0, bendValue * distribution);
      const curlAngle = -effectiveBend * JOINT_MAX_ANGLES[joint]; // negative X
      
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), curlAngle);
      bone.quaternion.copy(restPoses[boneName].quaternion).multiply(rotQuat);
    }
    
    scene.updateMatrixWorld(true);
    const pos = getWorldPos(tipBone);
    console.log(`  bend=${bendValue.toFixed(2)}: tip = ${fmtVec(pos)}  (original code: -X)`);
  }
}

function fmtVec(v) {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

main().catch(console.error);
