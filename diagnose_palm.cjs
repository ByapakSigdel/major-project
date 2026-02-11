/**
 * Check which direction the palm faces after scene rotation.
 */

const THREE = require('three');
const { GLTFLoader } = require('three/addons/loaders/GLTFLoader.js');
const fs = require('fs');
const path = require('path');

// Same re-parent code
const FINGER_CHAINS = {
  thumb:  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index:  ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring:   ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky:  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};

function reparentBones(bones, wristName = 'wrist') {
  const byName = {};
  for (const bone of bones) byName[bone.name] = bone;
  const wristBone = byName[wristName];
  if (!wristBone) return;
  
  const worldTransforms = {};
  for (const bone of bones) {
    bone.updateWorldMatrix(true, false);
    worldTransforms[bone.name] = {
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    };
    bone.matrixWorld.decompose(worldTransforms[bone.name].pos, worldTransforms[bone.name].quat, worldTransforms[bone.name].scale);
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

async function main() {
  const glbPath = path.join(__dirname, 'public/models/human_hand_base_mesh.glb');
  const data = fs.readFileSync(glbPath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', resolve, reject);
  });
  
  const scene = gltf.scene;
  let skinnedMesh = null;
  scene.traverse(c => { if (c.isSkinnedMesh) skinnedMesh = c; });
  const skeleton = skinnedMesh.skeleton;
  
  const isFlat = skeleton.bones.every(b => b.parent === skeleton.bones[0].parent);
  if (isFlat) reparentBones(skeleton.bones);
  
  // BEFORE scene transform
  scene.updateMatrixWorld(true);
  
  console.log('=== BEFORE SCENE ROTATION ===');
  const byName = {};
  for (const bone of skeleton.bones) byName[bone.name] = bone;
  
  const wrist = byName['wrist'];
  const indexTip = byName['index-finger-tip'];
  const middleMeta = byName['middle-finger-metacarpal'];
  
  let wp = new THREE.Vector3();
  wrist.getWorldPosition(wp);
  console.log('Wrist world:', fmtVec(wp));
  
  indexTip.getWorldPosition(wp);
  console.log('Index tip world:', fmtVec(wp));
  
  // Check which direction is "fingers" and which is "palm normal"
  const wristWP = new THREE.Vector3();
  wrist.getWorldPosition(wristWP);
  const tipWP = new THREE.Vector3();
  indexTip.getWorldPosition(tipWP);
  const fingerDir = new THREE.Vector3().subVectors(tipWP, wristWP).normalize();
  console.log('Finger direction (wrist→tip):', fmtVec(fingerDir));
  
  // Palm normal: cross product of finger direction and thumb direction
  const thumbTip = byName['thumb-tip'];
  const thumbWP = new THREE.Vector3();
  thumbTip.getWorldPosition(thumbWP);
  const thumbDir = new THREE.Vector3().subVectors(thumbWP, wristWP).normalize();
  const palmNormal = new THREE.Vector3().crossVectors(fingerDir, thumbDir).normalize();
  console.log('Palm normal (finger×thumb):', fmtVec(palmNormal));
  
  // NOW apply scene transform
  scene.scale.set(10, 10, 10);
  scene.rotation.set(Math.PI, Math.PI / 2, 0);
  scene.updateMatrixWorld(true);
  
  console.log('\n=== AFTER SCENE ROTATION (PI, PI/2, 0) + scale 10 ===');
  wrist.getWorldPosition(wp);
  console.log('Wrist world:', fmtVec(wp));
  indexTip.getWorldPosition(wp);
  console.log('Index tip world:', fmtVec(wp));
  
  wrist.getWorldPosition(wristWP);
  indexTip.getWorldPosition(tipWP);
  const fingerDirAfter = new THREE.Vector3().subVectors(tipWP, wristWP).normalize();
  console.log('Finger direction (wrist→tip):', fmtVec(fingerDirAfter));
  console.log('  Fingers point mostly +Y?', fingerDirAfter.y > 0.5 ? 'YES' : 'NO');
  
  thumbTip.getWorldPosition(thumbWP);
  const thumbDirAfter = new THREE.Vector3().subVectors(thumbWP, wristWP).normalize();
  const palmNormalAfter = new THREE.Vector3().crossVectors(fingerDirAfter, thumbDirAfter).normalize();
  console.log('Palm normal (finger×thumb):', fmtVec(palmNormalAfter));
  console.log('  Palm faces +Z (toward camera)?', palmNormalAfter.z > 0.5 ? 'YES' : 'NO, faces ' + (palmNormalAfter.z < -0.5 ? '-Z (away from camera!)' : 'elsewhere'));
  
  // Camera position for reference
  console.log('\nCamera is at (0, 1.5, 3), looking at (0, 0.5, 0)');
  console.log('So +Z is toward camera, -Z is away from camera');
  
  // Now check: when we apply +X rotation (current code), where does fingertip go?
  console.log('\n=== +X CURL: fingertip Z should INCREASE (toward palm/camera) ===');
  
  const WEBXR_TO_STD = {
    'index-finger-phalanx-proximal': 'index_mcp',
    'index-finger-phalanx-intermediate': 'index_pip', 
    'index-finger-phalanx-distal': 'index_dip',
    'index-finger-tip': 'index_tip',
  };
  
  const boneMap = {};
  for (const bone of skeleton.bones) {
    const std = WEBXR_TO_STD[bone.name];
    if (std) boneMap[std] = bone;
  }
  
  // Save rest poses
  const restPoses = {};
  for (const [name, bone] of Object.entries(boneMap)) {
    restPoses[name] = bone.quaternion.clone();
  }
  
  // At rest
  scene.updateMatrixWorld(true);
  const tipBone = boneMap['index_tip'];
  let restPos = new THREE.Vector3();
  tipBone.getWorldPosition(restPos);
  console.log(`  Rest: tip = ${fmtVec(restPos)}`);
  
  // Apply +X at 80°
  const angle = 80 * Math.PI / 180;
  for (const joint of ['index_mcp', 'index_pip', 'index_dip']) {
    const bone = boneMap[joint];
    if (!bone) continue;
    const rotQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), angle);
    bone.quaternion.copy(restPoses[joint]).multiply(rotQ);
  }
  scene.updateMatrixWorld(true);
  let curledPos = new THREE.Vector3();
  tipBone.getWorldPosition(curledPos);
  console.log(`  +X 80°: tip = ${fmtVec(curledPos)}`);
  console.log(`  ΔZ = ${(curledPos.z - restPos.z).toFixed(4)} (positive = toward camera/palm)`);
  console.log(`  ΔY = ${(curledPos.y - restPos.y).toFixed(4)} (negative = toward wrist)`);
  
  // Reset and try -X
  for (const [name, bone] of Object.entries(boneMap)) {
    bone.quaternion.copy(restPoses[name]);
  }
  for (const joint of ['index_mcp', 'index_pip', 'index_dip']) {
    const bone = boneMap[joint];
    if (!bone) continue;
    const rotQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -angle);
    bone.quaternion.copy(restPoses[joint]).multiply(rotQ);
  }
  scene.updateMatrixWorld(true);
  tipBone.getWorldPosition(curledPos);
  console.log(`  -X 80°: tip = ${fmtVec(curledPos)}`);
  console.log(`  ΔZ = ${(curledPos.z - restPos.z).toFixed(4)}`);
  console.log(`  ΔY = ${(curledPos.y - restPos.y).toFixed(4)}`);
}

function fmtVec(v) {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

main().catch(console.error);
