/**
 * Check if boneInverses are correct after re-parenting
 */
const THREE = require('three');
const { GLTFLoader } = require('three/addons/loaders/GLTFLoader.js');
const fs = require('fs');
const path = require('path');

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
  
  console.log('=== BEFORE RE-PARENTING ===');
  console.log('Skeleton bones:', skeleton.bones.length);
  console.log('BoneInverses:', skeleton.boneInverses.length);
  
  // Save the boneInverses BEFORE re-parenting
  const originalBoneInverses = skeleton.boneInverses.map(m => m.clone());
  
  // Save the bone world matrices BEFORE re-parenting
  scene.updateMatrixWorld(true);
  const originalWorldMatrices = {};
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i];
    originalWorldMatrices[bone.name] = bone.matrixWorld.clone();
  }
  
  // Re-parent
  const isFlat = skeleton.bones.every(b => b.parent === skeleton.bones[0].parent);
  console.log('Is flat:', isFlat);
  if (isFlat) reparentBones(skeleton.bones);
  
  // After re-parenting, check if bone world matrices are preserved
  scene.updateMatrixWorld(true);
  console.log('\n=== AFTER RE-PARENTING: World matrix preservation check ===');
  let maxError = 0;
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i];
    const origM = originalWorldMatrices[bone.name];
    const newM = bone.matrixWorld;
    
    // Compare matrices element by element
    let error = 0;
    for (let j = 0; j < 16; j++) {
      error += Math.abs(origM.elements[j] - newM.elements[j]);
    }
    maxError = Math.max(maxError, error);
    if (error > 0.01) {
      console.log(`  ${bone.name}: world matrix CHANGED! error=${error.toFixed(6)}`);
    }
  }
  console.log(`Max world matrix error: ${maxError.toFixed(6)} (should be ~0)`);
  
  // KEY CHECK: Are boneInverses still valid after re-parenting?
  // The boneInverse for bone i should be the inverse of that bone's world matrix at bind time.
  // If bones move but boneInverses don't update, the skinning will be wrong.
  console.log('\n=== BIND MATRIX CHECK ===');
  console.log('BoneInverses are the inverse of bone world matrices at bind time.');
  console.log('After re-parenting, the bone world matrices should be the same,');
  console.log('so boneInverses should still be valid.\n');
  
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i];
    const boneInv = skeleton.boneInverses[i];
    
    // boneInverse * boneWorldMatrix should = Identity
    const check = new THREE.Matrix4().copy(boneInv).multiply(bone.matrixWorld);
    
    // Extract position from the result (should be near zero)
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    check.decompose(pos, quat, scl);
    
    const posError = pos.length();
    const quatError = Math.abs(1 - quat.w) + Math.abs(quat.x) + Math.abs(quat.y) + Math.abs(quat.z);
    
    if (posError > 0.001 || quatError > 0.01) {
      console.log(`  ${bone.name}: boneInverse * worldMatrix != Identity!`);
      console.log(`    pos error: ${posError.toFixed(6)}, quat error: ${quatError.toFixed(6)}`);
      console.log(`    pos: ${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)}`);
      console.log(`    quat: ${quat.x.toFixed(4)}, ${quat.y.toFixed(4)}, ${quat.z.toFixed(4)}, ${quat.w.toFixed(4)}`);
    }
  }
  
  // Now simulate what happens to actual VERTICES when we rotate a bone
  console.log('\n=== VERTEX DEFORMATION TEST ===');
  console.log('Simulating +X rotation on index-finger-phalanx-proximal (index_mcp)');
  
  // Find some vertices influenced by this bone
  const boneIndex = skeleton.bones.findIndex(b => b.name === 'index-finger-phalanx-proximal');
  console.log(`Bone index: ${boneIndex}`);
  
  const geometry = skinnedMesh.geometry;
  const skinIndexAttr = geometry.getAttribute('skinIndex');
  const skinWeightAttr = geometry.getAttribute('skinWeight');
  const positionAttr = geometry.getAttribute('position');
  
  // Find vertices most influenced by this bone
  const influencedVerts = [];
  for (let vi = 0; vi < positionAttr.count; vi++) {
    for (let si = 0; si < 4; si++) {
      if (skinIndexAttr.getComponent(vi, si) === boneIndex && skinWeightAttr.getComponent(vi, si) > 0.5) {
        influencedVerts.push({
          index: vi,
          weight: skinWeightAttr.getComponent(vi, si),
          pos: new THREE.Vector3(positionAttr.getX(vi), positionAttr.getY(vi), positionAttr.getZ(vi))
        });
      }
    }
  }
  console.log(`Found ${influencedVerts.length} vertices with weight > 0.5 for this bone`);
  
  if (influencedVerts.length > 0) {
    // Pick a representative vertex
    const v = influencedVerts[Math.floor(influencedVerts.length / 2)];
    console.log(`\nRepresentative vertex ${v.index}: local pos = (${v.pos.x.toFixed(4)}, ${v.pos.y.toFixed(4)}, ${v.pos.z.toFixed(4)}), weight = ${v.weight.toFixed(3)}`);
    
    // Compute where this vertex ends up with and without rotation
    // vertex_world = boneMatrix * boneInverse * vertex_local (simplified for single bone influence)
    const boneWorldMatrix = skeleton.bones[boneIndex].matrixWorld.clone();
    const boneInverse = skeleton.boneInverses[boneIndex];
    
    // At rest: should be at original position
    const restTransform = new THREE.Matrix4().copy(boneWorldMatrix).multiply(boneInverse);
    const restVertexWorld = v.pos.clone().applyMatrix4(restTransform);
    
    // Apply scene transform to get final position
    scene.scale.set(10, 10, 10);
    scene.rotation.set(Math.PI, Math.PI / 2, 0);
    scene.updateMatrixWorld(true);
    
    const boneWorldMatrixScened = skeleton.bones[boneIndex].matrixWorld.clone();
    const restTransformScened = new THREE.Matrix4().copy(boneWorldMatrixScened).multiply(boneInverse);
    const restVertexScened = v.pos.clone().applyMatrix4(restTransformScened);
    console.log(`Rest vertex (scene space): (${restVertexScened.x.toFixed(4)}, ${restVertexScened.y.toFixed(4)}, ${restVertexScened.z.toFixed(4)})`);
    
    // Now rotate bone by +X 80deg
    const restQuat = skeleton.bones[boneIndex].quaternion.clone();
    const rotQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), 80 * Math.PI / 180);
    skeleton.bones[boneIndex].quaternion.copy(restQuat).multiply(rotQ);
    scene.updateMatrixWorld(true);
    
    const boneWorldMatrixCurled = skeleton.bones[boneIndex].matrixWorld.clone();
    const curledTransform = new THREE.Matrix4().copy(boneWorldMatrixCurled).multiply(boneInverse);
    const curledVertex = v.pos.clone().applyMatrix4(curledTransform);
    console.log(`+X 80° vertex (scene space): (${curledVertex.x.toFixed(4)}, ${curledVertex.y.toFixed(4)}, ${curledVertex.z.toFixed(4)})`);
    console.log(`  ΔZ = ${(curledVertex.z - restVertexScened.z).toFixed(4)} (positive = toward camera = toward palm = CORRECT)`);
    console.log(`  ΔY = ${(curledVertex.y - restVertexScened.y).toFixed(4)} (negative = downward = CORRECT)`);
    
    // Reset and try -X 80deg
    skeleton.bones[boneIndex].quaternion.copy(restQuat);
    const rotQneg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -80 * Math.PI / 180);
    skeleton.bones[boneIndex].quaternion.copy(restQuat).multiply(rotQneg);
    scene.updateMatrixWorld(true);
    
    const boneWorldMatrixCurledNeg = skeleton.bones[boneIndex].matrixWorld.clone();
    const curledTransformNeg = new THREE.Matrix4().copy(boneWorldMatrixCurledNeg).multiply(boneInverse);
    const curledVertexNeg = v.pos.clone().applyMatrix4(curledTransformNeg);
    console.log(`-X 80° vertex (scene space): (${curledVertexNeg.x.toFixed(4)}, ${curledVertexNeg.y.toFixed(4)}, ${curledVertexNeg.z.toFixed(4)})`);
    console.log(`  ΔZ = ${(curledVertexNeg.z - restVertexScened.z).toFixed(4)}`);
    console.log(`  ΔY = ${(curledVertexNeg.y - restVertexScened.y).toFixed(4)}`);
  }
}

main().catch(console.error);
