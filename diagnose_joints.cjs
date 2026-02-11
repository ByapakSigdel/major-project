/**
 * Diagnostic: Dump bone positions to understand joint locations.
 * Shows where each bone sits in world space and local space,
 * and the parent-child hierarchy after re-parenting.
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
  if (!skinnedMesh) { console.error('No skinned mesh!'); return; }
  
  const skeleton = skinnedMesh.skeleton;
  const isFlat = skeleton.bones.every(b => b.parent === skeleton.bones[0].parent);
  console.log('Flat bone structure:', isFlat);
  
  // Print BEFORE re-parenting: raw world positions
  console.log('\n=== BEFORE RE-PARENTING: Raw bone world positions ===');
  scene.updateMatrixWorld(true);
  for (const bone of skeleton.bones) {
    const wp = new THREE.Vector3();
    bone.getWorldPosition(wp);
    console.log(`  ${bone.name.padEnd(45)} world=(${wp.x.toFixed(4)}, ${wp.y.toFixed(4)}, ${wp.z.toFixed(4)})  local=(${bone.position.x.toFixed(4)}, ${bone.position.y.toFixed(4)}, ${bone.position.z.toFixed(4)})`);
  }
  
  if (isFlat) reparentBones(skeleton.bones);
  
  scene.updateMatrixWorld(true);
  
  // Print AFTER re-parenting: verify world positions preserved, show local positions
  console.log('\n=== AFTER RE-PARENTING: Bone hierarchy and positions ===');
  
  for (const [finger, chain] of Object.entries(FINGER_CHAINS)) {
    console.log(`\n--- ${finger.toUpperCase()} ---`);
    console.log(`  Chain: wrist → ${chain.join(' → ')}`);
    
    for (let i = 0; i < chain.length; i++) {
      const boneName = chain[i];
      let bone = null;
      for (const b of skeleton.bones) {
        if (b.name === boneName) { bone = b; break; }
      }
      if (!bone) { console.log(`  ${boneName}: MISSING`); continue; }
      
      const wp = new THREE.Vector3();
      bone.getWorldPosition(wp);
      const parent = bone.parent ? bone.parent.name : 'none';
      
      // Compute bone length (distance to child)
      let boneLength = 0;
      if (i + 1 < chain.length) {
        let childBone = null;
        for (const b of skeleton.bones) {
          if (b.name === chain[i + 1]) { childBone = b; break; }
        }
        if (childBone) {
          const cp = new THREE.Vector3();
          childBone.getWorldPosition(cp);
          boneLength = wp.distanceTo(cp);
        }
      }
      
      console.log(`  ${boneName}`);
      console.log(`    parent: ${parent}`);
      console.log(`    local pos: (${bone.position.x.toFixed(5)}, ${bone.position.y.toFixed(5)}, ${bone.position.z.toFixed(5)})`);
      console.log(`    world pos: (${wp.x.toFixed(5)}, ${wp.y.toFixed(5)}, ${wp.z.toFixed(5)})`);
      console.log(`    bone length: ${boneLength.toFixed(5)}`);
    }
  }
  
  // Also show what bones map to what std names
  console.log('\n=== BONE MAPPING (WebXR → std) ===');
  const WEBXR_TO_STD = {
    'wrist': 'wrist',
    'thumb-metacarpal': 'thumb_mcp',
    'thumb-phalanx-proximal': 'thumb_pip',
    'thumb-phalanx-distal': 'thumb_dip',
    'thumb-tip': 'thumb_tip',
    'index-finger-metacarpal': null,
    'index-finger-phalanx-proximal': 'index_mcp',
    'index-finger-phalanx-intermediate': 'index_pip',
    'index-finger-phalanx-distal': 'index_dip',
    'index-finger-tip': 'index_tip',
    'middle-finger-metacarpal': null,
    'middle-finger-phalanx-proximal': 'middle_mcp',
    'middle-finger-phalanx-intermediate': 'middle_pip',
    'middle-finger-phalanx-distal': 'middle_dip',
    'middle-finger-tip': 'middle_tip',
    'ring-finger-metacarpal': null,
    'ring-finger-phalanx-proximal': 'ring_mcp',
    'ring-finger-phalanx-intermediate': 'ring_pip',
    'ring-finger-phalanx-distal': 'ring_dip',
    'ring-finger-tip': 'ring_tip',
    'pinky-finger-metacarpal': null,
    'pinky-finger-phalanx-proximal': 'pinky_mcp',
    'pinky-finger-phalanx-intermediate': 'pinky_pip',
    'pinky-finger-phalanx-distal': 'pinky_dip',
    'pinky-finger-tip': 'pinky_tip',
  };
  
  for (const [webxr, std] of Object.entries(WEBXR_TO_STD)) {
    const driven = std ? `→ ${std} (DRIVEN)` : '→ null (NOT DRIVEN)';
    console.log(`  ${webxr.padEnd(45)} ${driven}`);
  }
  
  // Now test: apply a 45° rotation to index_mcp (phalanx-proximal) and see where tip goes
  console.log('\n=== CURL TEST: Rotate index_mcp (phalanx-proximal) by -45° around X ===');
  
  const byName = {};
  for (const b of skeleton.bones) byName[b.name] = b;
  
  const indexProximal = byName['index-finger-phalanx-proximal'];
  if (indexProximal) {
    // Save rest
    const restQ = indexProximal.quaternion.clone();
    
    // Get tip position before
    const tipBone = byName['index-finger-tip'];
    scene.updateMatrixWorld(true);
    const tipBefore = new THREE.Vector3();
    tipBone.getWorldPosition(tipBefore);
    console.log(`  Tip BEFORE: (${tipBefore.x.toFixed(4)}, ${tipBefore.y.toFixed(4)}, ${tipBefore.z.toFixed(4)})`);
    
    // Apply -45° around X (what our code does)
    const curlQuat = new THREE.Quaternion();
    curlQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -45 * Math.PI / 180);
    indexProximal.quaternion.copy(restQ).multiply(curlQuat);
    scene.updateMatrixWorld(true);
    
    const tipAfterNeg = new THREE.Vector3();
    tipBone.getWorldPosition(tipAfterNeg);
    console.log(`  Tip AFTER -45° X: (${tipAfterNeg.x.toFixed(4)}, ${tipAfterNeg.y.toFixed(4)}, ${tipAfterNeg.z.toFixed(4)})`);
    console.log(`  Delta: (${(tipAfterNeg.x - tipBefore.x).toFixed(4)}, ${(tipAfterNeg.y - tipBefore.y).toFixed(4)}, ${(tipAfterNeg.z - tipBefore.z).toFixed(4)})`);
    
    // Reset and try +45°
    indexProximal.quaternion.copy(restQ);
    curlQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 45 * Math.PI / 180);
    indexProximal.quaternion.copy(restQ).multiply(curlQuat);
    scene.updateMatrixWorld(true);
    
    const tipAfterPos = new THREE.Vector3();
    tipBone.getWorldPosition(tipAfterPos);
    console.log(`  Tip AFTER +45° X: (${tipAfterPos.x.toFixed(4)}, ${tipAfterPos.y.toFixed(4)}, ${tipAfterPos.z.toFixed(4)})`);
    console.log(`  Delta: (${(tipAfterPos.x - tipBefore.x).toFixed(4)}, ${(tipAfterPos.y - tipBefore.y).toFixed(4)}, ${(tipAfterPos.z - tipBefore.z).toFixed(4)})`);
  }
  
  // Also test rotating the metacarpal (which we're NOT driving)
  console.log('\n=== CURL TEST: Rotate index METACARPAL by -45° around X ===');
  const indexMeta = byName['index-finger-metacarpal'];
  if (indexMeta) {
    // Reset everything first
    for (const b of skeleton.bones) {
      // Reset to rest... we need stored rest poses
    }
    
    const restQ = indexMeta.quaternion.clone();
    const tipBone = byName['index-finger-tip'];
    
    // Reset proximal
    const indexProx = byName['index-finger-phalanx-proximal'];
    // We'll just read current positions as "rest" since we didn't reset properly
    scene.updateMatrixWorld(true);
    
    // Actually let's reload to get clean state
    console.log('  (Note: metacarpal position/rotation info)');
    console.log(`  metacarpal local pos: (${indexMeta.position.x.toFixed(5)}, ${indexMeta.position.y.toFixed(5)}, ${indexMeta.position.z.toFixed(5)})`);
    console.log(`  metacarpal parent: ${indexMeta.parent ? indexMeta.parent.name : 'none'}`);
    
    const mp = new THREE.Vector3();
    indexMeta.getWorldPosition(mp);
    console.log(`  metacarpal world pos: (${mp.x.toFixed(5)}, ${mp.y.toFixed(5)}, ${mp.z.toFixed(5)})`);
  }
}

main().catch(console.error);
