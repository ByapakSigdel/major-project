/**
 * Check if scene rotation is being applied double for SkinnedMesh
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
  const skeleton = skinnedMesh.skeleton;
  
  console.log('=== HIERARCHY CHECK ===');
  console.log('Scene children:', scene.children.map(c => c.name || c.type));
  
  // Find the Armature
  let armature = null;
  scene.traverse(c => { if (c.name === 'Armature') armature = c; });
  if (armature) {
    console.log('Armature children:', armature.children.map(c => c.name || c.type));
    console.log('Armature parent:', armature.parent?.name || armature.parent?.type);
  }
  
  console.log('SkinnedMesh parent:', skinnedMesh.parent?.name);
  console.log('Wrist parent:', skeleton.bones[0].parent?.name);
  
  // Check if mesh is a sibling of the skeleton root
  console.log('\nMesh and skeleton root share parent?', skinnedMesh.parent === skeleton.bones[0].parent);
  
  // In attached mode, the skinning formula gives:
  // vertex_world = meshWorldMatrix * (boneWorldMatrix * boneInverse) * vertex_local
  // 
  // Since mesh and bones are both under the Armature, which is under scene:
  // meshWorldMatrix = sceneWorld * armatureLocal * meshLocal
  // boneWorldMatrix = sceneWorld * armatureLocal * ... * boneLocal
  //
  // At rest: boneWorldMatrix * boneInverse = Identity (by definition)
  // So vertex_world = meshWorldMatrix * vertex_local = sceneWorld * vertex_local
  // That's correct.
  //
  // When we rotate a bone:
  // boneWorldMatrix' = sceneWorld * armatureLocal * ... * (boneLocalRest * curlQuat)
  // boneWorldMatrix' * boneInverse = (sceneWorld * armatureLocal * ... * boneLocalRest * curlQuat) * inv(sceneWorld * armatureLocal * ... * boneLocalRest)
  //
  // The sceneWorld cancels out if it's applied consistently.
  // Actually no — boneInverse = inv(boneWorldMatrix_atBind)
  // At bind time, there was no scene rotation.
  // So boneInverse = inv(armatureLocal * ... * boneLocalRest)
  //
  // After scene rotation:
  // boneWorldMatrix' = sceneWorld * armatureLocal * ... * boneLocalRest * curlQuat
  // boneWorldMatrix' * boneInverse = sceneWorld * armatureLocal * ... * boneLocalRest * curlQuat * inv(armatureLocal * ... * boneLocalRest)
  //                                = sceneWorld * (armatureLocal * ... * boneLocalRest) * curlQuat * inv(armatureLocal * ... * boneLocalRest)
  //
  // Then meshWorldMatrix * this:
  // = (sceneWorld * armatureLocal * meshLocal) * sceneWorld * (armature...bone) * curl * inv(armature...bone)
  //
  // If meshLocal = Identity:
  // = sceneWorld * armatureLocal * sceneWorld * (armature...bone) * curl * inv(armature...bone)
  //
  // This has sceneWorld applied TWICE: once from the mesh transform and once from the bone transform.
  // That's the double-transform bug!
  
  // Actually wait — I need to check the Three.js source more carefully.
  // In WebGLRenderer.renderObject(), the modelViewMatrix is set to:
  //   object.modelViewMatrix = camera.matrixWorldInverse * object.matrixWorld
  // where object is the SkinnedMesh.
  //
  // Then in the shader:
  //   gl_Position = projectionMatrix * modelViewMatrix * skinned_position
  //
  // And skinned_position = bindMatrixInverse * sum(boneMatrix[i] * bindMatrix * position * weight[i])
  //
  // With bindMatrix = Identity:
  //   skinned_position = sum(boneMatrix[i] * position * weight[i])
  //
  // And boneMatrix[i] = bone.matrixWorld * boneInverse[i]
  //
  // So total: gl_Position = proj * view * meshWorld * (boneWorld * boneInv) * position
  //
  // CRITICAL: boneWorld is bone.matrixWorld which INCLUDES the scene rotation.
  //           meshWorld is mesh.matrixWorld which ALSO includes the scene rotation.
  //           boneInv does NOT include the scene rotation (it was computed at bind time).
  //
  // Therefore at rest:
  //   meshWorld * boneWorld * boneInv = meshWorld * sceneRot * boneWorld_orig * boneInv_orig
  //                                  = meshWorld * sceneRot * Identity
  //                                  = sceneRot * I * sceneRot  (since meshWorld = sceneRot for mesh under scene)
  //                                  = sceneRot²
  //
  // DOUBLE ROTATION! The scene rotation is applied twice!
  
  console.log('\n=== DOUBLE ROTATION PROOF ===');
  
  // Apply scene rotation
  scene.scale.set(10, 10, 10);
  scene.rotation.set(Math.PI, Math.PI / 2, 0);
  scene.updateMatrixWorld(true);
  
  const boneIdx = 0; // wrist
  const bone = skeleton.bones[boneIdx];
  const boneInv = skeleton.boneInverses[boneIdx];
  
  // boneMatrix = bone.matrixWorld * boneInverse
  const boneMat = new THREE.Matrix4().copy(bone.matrixWorld).multiply(boneInv);
  
  // meshWorld
  const meshWorld = skinnedMesh.matrixWorld.clone();
  
  // Final transform for a vertex: meshWorld * boneMat * vertex
  const finalTransform = new THREE.Matrix4().copy(meshWorld).multiply(boneMat);
  
  // A test vertex at (0.03, -0.05, 0) in local space
  const testVertex = new THREE.Vector3(0.03, -0.05, 0);
  const result = testVertex.clone().applyMatrix4(finalTransform);
  
  console.log('Test vertex local:', fmtVec(testVertex));
  console.log('Test vertex after skinning transform:', fmtVec(result));
  
  // What SHOULD happen: sceneRotation * scale * testVertex (applied once)
  const sceneOnly = new THREE.Matrix4();
  sceneOnly.compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, Math.PI/2, 0)),
    new THREE.Vector3(10, 10, 10)
  );
  const expected = testVertex.clone().applyMatrix4(sceneOnly);
  console.log('Expected (scene rotation applied once):', fmtVec(expected));
  
  // If double rotation, it would be sceneRotation² * scale² * testVertex
  const sceneDouble = new THREE.Matrix4().copy(sceneOnly).multiply(sceneOnly);
  const doubled = new THREE.Vector3(0.03, -0.05, 0).applyMatrix4(sceneDouble);
  console.log('If double rotation:', fmtVec(doubled));
  
  console.log('\nActual matches expected?', result.distanceTo(expected) < 0.1 ? 'YES' : 'NO (distance: ' + result.distanceTo(expected).toFixed(4) + ')');
  console.log('Actual matches doubled?', result.distanceTo(doubled) < 0.1 ? 'YES - DOUBLE TRANSFORM BUG!' : 'NO');
}

function fmtVec(v) {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

main().catch(console.error);
