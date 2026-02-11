/**
 * Diagnostic: Analyze vertex skinning weights.
 * Shows which bones influence which parts of the mesh,
 * specifically looking at how palm/metacarpal vertices are weighted.
 */

const THREE = require('three');
const { GLTFLoader } = require('three/addons/loaders/GLTFLoader.js');
const fs = require('fs');
const path = require('path');

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
  const geometry = skinnedMesh.geometry;
  
  // Get skinning attributes
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const position = geometry.getAttribute('position');
  
  console.log(`Vertices: ${position.count}`);
  console.log(`Bones: ${skeleton.bones.length}`);
  console.log(`Bone names:`);
  skeleton.bones.forEach((b, i) => {
    console.log(`  [${i}] ${b.name}`);
  });
  
  // For each bone, count how many vertices it influences and what their Y-range is
  // (Y = finger length axis in raw model space, -Y = toward fingertip)
  const boneInfluence = {};
  for (let i = 0; i < skeleton.bones.length; i++) {
    boneInfluence[i] = { name: skeleton.bones[i].name, count: 0, totalWeight: 0, minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  }
  
  for (let v = 0; v < position.count; v++) {
    const vx = position.getX(v);
    const vy = position.getY(v);
    const vz = position.getZ(v);
    
    for (let j = 0; j < 4; j++) {
      const boneIdx = skinIndex.getComponent(v, j);
      const weight = skinWeight.getComponent(v, j);
      
      if (weight > 0.01) {
        const info = boneInfluence[boneIdx];
        if (info) {
          info.count++;
          info.totalWeight += weight;
          info.minY = Math.min(info.minY, vy);
          info.maxY = Math.max(info.maxY, vy);
          info.minX = Math.min(info.minX, vx);
          info.maxX = Math.max(info.maxX, vx);
          info.minZ = Math.min(info.minZ, vz);
          info.maxZ = Math.max(info.maxZ, vz);
        }
      }
    }
  }
  
  console.log('\n=== BONE INFLUENCE RANGES (raw model space) ===');
  console.log('(Y-axis = finger direction: +Y = toward wrist, -Y = toward fingertip)');
  console.log('');
  
  // Group by finger
  const fingerOrder = ['wrist', 'thumb', 'index', 'middle', 'ring', 'pinky'];
  
  for (const finger of fingerOrder) {
    console.log(`--- ${finger.toUpperCase()} ---`);
    for (const [idx, info] of Object.entries(boneInfluence)) {
      if (info.name.startsWith(finger) || (finger === 'wrist' && info.name === 'wrist')) {
        if (info.count > 0) {
          console.log(`  [${idx}] ${info.name.padEnd(45)} vertices=${String(info.count).padStart(4)}  totalWt=${info.totalWeight.toFixed(1).padStart(6)}  Y=[${info.minY.toFixed(4)}, ${info.maxY.toFixed(4)}]`);
        }
      }
    }
  }
  
  // Now let's look at the bone world positions to see where each bone "starts"
  scene.updateMatrixWorld(true);
  console.log('\n=== BONE WORLD POSITIONS (raw, before re-parenting) ===');
  console.log('(These are the joint locations - where the bone pivots)');
  for (const finger of fingerOrder) {
    console.log(`--- ${finger.toUpperCase()} ---`);
    for (const bone of skeleton.bones) {
      if (bone.name.startsWith(finger) || (finger === 'wrist' && bone.name === 'wrist')) {
        const wp = new THREE.Vector3();
        bone.getWorldPosition(wp);
        console.log(`  ${bone.name.padEnd(45)} Y=${wp.y.toFixed(4)} (joint pivot)`);
      }
    }
  }
  
  // KEY QUESTION: Does the proximal phalanx bone influence vertices
  // that are ABOVE (more +Y) its joint position?
  // If yes, that means the proximal phalanx has skinning weights on palm/metacarpal vertices
  console.log('\n=== KEY ANALYSIS: Do driven bones influence palm vertices? ===');
  const drivenBones = {
    'index-finger-phalanx-proximal': 'index_mcp',
    'middle-finger-phalanx-proximal': 'middle_mcp', 
    'ring-finger-phalanx-proximal': 'ring_mcp',
    'pinky-finger-phalanx-proximal': 'pinky_mcp',
  };
  
  for (const [boneName, stdName] of Object.entries(drivenBones)) {
    const boneIdx = skeleton.bones.findIndex(b => b.name === boneName);
    if (boneIdx < 0) continue;
    
    const bone = skeleton.bones[boneIdx];
    const wp = new THREE.Vector3();
    bone.getWorldPosition(wp);
    
    const info = boneInfluence[boneIdx];
    if (!info || info.count === 0) continue;
    
    const verticesAboveJoint = info.maxY > wp.y;
    const overshoot = info.maxY - wp.y;
    
    console.log(`  ${boneName} (mapped to ${stdName}):`);
    console.log(`    Joint pivot Y: ${wp.y.toFixed(4)}`);
    console.log(`    Vertex Y range: [${info.minY.toFixed(4)}, ${info.maxY.toFixed(4)}]`);
    console.log(`    Vertices extend ${overshoot.toFixed(4)} ABOVE joint? ${verticesAboveJoint ? 'YES - PROBLEM!' : 'No'}`);
  }
}

main().catch(console.error);
