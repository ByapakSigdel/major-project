/**
 * Check bindMatrix and bindMode of the SkinnedMesh
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
  
  console.log('=== SKINNED MESH INFO ===');
  console.log('Name:', skinnedMesh.name);
  console.log('Bind mode:', skinnedMesh.bindMode);
  console.log('Bind matrix:');
  const bm = skinnedMesh.bindMatrix.elements;
  console.log(`  [${bm[0].toFixed(4)}, ${bm[4].toFixed(4)}, ${bm[8].toFixed(4)}, ${bm[12].toFixed(4)}]`);
  console.log(`  [${bm[1].toFixed(4)}, ${bm[5].toFixed(4)}, ${bm[9].toFixed(4)}, ${bm[13].toFixed(4)}]`);
  console.log(`  [${bm[2].toFixed(4)}, ${bm[6].toFixed(4)}, ${bm[10].toFixed(4)}, ${bm[14].toFixed(4)}]`);
  console.log(`  [${bm[3].toFixed(4)}, ${bm[7].toFixed(4)}, ${bm[11].toFixed(4)}, ${bm[15].toFixed(4)}]`);
  
  console.log('Bind matrix inverse:');
  const bmi = skinnedMesh.bindMatrixInverse.elements;
  console.log(`  [${bmi[0].toFixed(4)}, ${bmi[4].toFixed(4)}, ${bmi[8].toFixed(4)}, ${bmi[12].toFixed(4)}]`);
  console.log(`  [${bmi[1].toFixed(4)}, ${bmi[5].toFixed(4)}, ${bmi[9].toFixed(4)}, ${bmi[13].toFixed(4)}]`);
  console.log(`  [${bmi[2].toFixed(4)}, ${bmi[6].toFixed(4)}, ${bmi[10].toFixed(4)}, ${bmi[14].toFixed(4)}]`);
  console.log(`  [${bmi[3].toFixed(4)}, ${bmi[7].toFixed(4)}, ${bmi[11].toFixed(4)}, ${bmi[15].toFixed(4)}]`);
  
  // Check parent hierarchy
  console.log('\n=== MESH PARENT HIERARCHY ===');
  let node = skinnedMesh;
  while (node) {
    const pos = node.position;
    const rot = node.rotation;
    const scl = node.scale;
    console.log(`${node.name || node.type}: pos(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}) rot(${rot.x.toFixed(3)}, ${rot.y.toFixed(3)}, ${rot.z.toFixed(3)}) scale(${scl.x.toFixed(1)}, ${scl.y.toFixed(1)}, ${scl.z.toFixed(1)})`);
    node = node.parent;
  }
  
  // Check where the skinnedMesh is relative to the bones
  console.log('\n=== MESH vs BONES HIERARCHY ===');
  console.log('SkinnedMesh parent:', skinnedMesh.parent?.name || skinnedMesh.parent?.type);
  console.log('Wrist bone parent:', skinnedMesh.skeleton.bones[0].parent?.name || skinnedMesh.skeleton.bones[0].parent?.type);
  
  // Check if mesh and bones share the same ancestor
  console.log('\n=== Key Three.js SkinnedMesh skinning formula ===');
  console.log('In "attached" mode:');
  console.log('  gl_Position = projectionMatrix * viewMatrix * bindMatrix * boneMat * boneInverse * bindMatrixInverse * vertex');
  console.log('  where boneMat = boneWorldMatrix * inverseMeshWorldMatrix (... wait this might be wrong)');
  console.log('');
  console.log('Actually in Three.js r182:');
  console.log('  The vertex shader computes:');
  console.log('  skinned = bindMatrix * sum(weight * boneMatrix * boneInverse) * bindMatrixInverse * position');
  console.log('  where boneMatrix = bone.matrixWorld');
  console.log('');
  console.log('Let me check the actual Three.js skinning shader...');
  
  // In Three.js, for SkinnedMesh:
  // In the vertex shader (skinning_vertex.glsl):
  //   vec4 skinVertex = bindMatrix * vec4(position, 1.0);
  //   vec4 skinned = vec4(0.0);
  //   skinned += boneMatX * skinVertex * skinWeight.x;
  //   skinned += boneMatY * skinVertex * skinWeight.y;
  //   ...
  //   skinned = bindMatrixInverse * skinned;
  //   
  // And in the JS side, boneMatrices are computed as:
  //   boneMatrices[i] = bones[i].matrixWorld * boneInverses[i]
  //
  // WAIT - this is wrong! In attached mode, Three.js ALSO multiplies by
  // the inverse of the mesh's own world matrix:
  //   boneMatrices[i] = bones[i].matrixWorld * boneInverses[i]
  // But actually no, let me check the actual source...
  
  // Actually, in THREE.Skeleton.update():
  //   _offsetMatrix.multiplyMatrices(bone.matrixWorld, this.boneInverses[i]);
  //   _offsetMatrix.toArray(this.boneMatrices, i * 16);
  // 
  // Then in the shader, it uses bindMatrix and bindMatrixInverse:
  //   skinVertex = bindMatrix * position
  //   skinned = sum(boneMatrix[i] * skinVertex * weight[i])
  //   result = bindMatrixInverse * skinned
  //
  // So the full transform is:
  //   result = bindMatrixInverse * boneWorldMatrix * boneInverse * bindMatrix * position
  //
  // At rest pose: boneWorldMatrix = what bones had at bind time
  //   result = bindMatrixInverse * boneWorld_bind * boneInverse_bind * bindMatrix * position
  //          = bindMatrixInverse * Identity * bindMatrix * position
  //          = position  (in local mesh space)
  //
  // Then the mesh's own modelViewMatrix transforms to screen.
  
  console.log('\nFull skinning transform:');
  console.log('result_meshLocal = bindMatrixInverse * boneWorld * boneInverse * bindMatrix * vertex');
  console.log('result_world = meshWorldMatrix * result_meshLocal');
  console.log('');
  console.log('So when we apply scene rotation, meshWorldMatrix changes.');
  console.log('And boneWorld ALSO changes (bones are children of scene).');
  console.log('But boneInverse stays the same (computed at bind time).');
  console.log('');
  console.log('At rest after scene rotation:');
  console.log('result = meshWorld_rotated * bindMatInv * boneWorld_rotated * boneInv_original * bindMat * v');
  console.log('       = meshWorld_rotated * bindMatInv * sceneRot * boneWorld_orig * boneInv_orig * bindMat * v');
  console.log('       = meshWorld_rotated * bindMatInv * sceneRot * I * bindMat * v');
  console.log('');
  console.log('This is only = sceneRot * v  if  meshWorld_rotated = sceneRot  AND  bindMatInv * sceneRot * bindMat = I');
  console.log('which means bindMat should commute with sceneRot... which it does if bindMat = Identity');
  
  // Is bindMatrix identity?
  const isIdentity = bm[0] === 1 && bm[5] === 1 && bm[10] === 1 && bm[15] === 1 &&
    bm[1] === 0 && bm[2] === 0 && bm[3] === 0 && bm[4] === 0 && 
    bm[6] === 0 && bm[7] === 0 && bm[8] === 0 && bm[9] === 0 &&
    bm[11] === 0 && bm[12] === 0 && bm[13] === 0 && bm[14] === 0;
  console.log('\nbindMatrix is identity:', isIdentity);
}

main().catch(console.error);
