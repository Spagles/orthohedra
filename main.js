import * as THREE from "https://esm.sh/three@0.172.0";
import { OrbitControls } from "https://esm.sh/three@0.172.0/examples/jsm/controls/OrbitControls.js";
import { computeBrinkSkeleton, logBrinkSkeleton } from "./brinkSkeleton.js";

const SIZE = 49;
const HALF = Math.floor(SIZE / 2);
const MIN = -HALF;
const MAX = HALF;
const MAX_INSTANCES = SIZE * SIZE * SIZE;

const app = document.getElementById('app');
const errorEl = document.getElementById('error');
const statusEl = document.getElementById('status');
const buildBtn = document.getElementById('buildBtn');
const destroyBtn = document.getElementById('destroyBtn');
const renderModeInputs = document.querySelectorAll('input[name="renderMode"]');

async function main() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1020);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(3.2, 2.3, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  app.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.minDistance = 1.8;
  controls.maxDistance = 120;

  const hemiLight = new THREE.HemisphereLight(0xa8c7ff, 0x1f2a3f, 0.55);
  scene.add(hemiLight);

  // Attached to the camera (rather than the scene) so they move with
  // the viewer as the camera orbits, instead of staying fixed in world
  // space. A DirectionalLight shines toward `target`, which defaults
  // to the world origin — parent the target to the camera too (at its
  // local look-at point) so the light direction stays camera-relative.
  const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.2);
  keyLight.position.set(6, 9, 4);
  camera.add(keyLight);
  camera.add(keyLight.target);
  keyLight.target.position.set(0, 0, -1);

  const fillLight = new THREE.DirectionalLight(0xa8d7ff, 0.45);
  fillLight.position.set(-5, 3, -7);
  camera.add(fillLight);
  camera.add(fillLight.target);
  fillLight.target.position.set(0, 0, -1);

  scene.add(camera);

  const bounds = new THREE.Box3(
    new THREE.Vector3(MIN - 0.5, MIN - 0.5, MIN - 0.5),
    new THREE.Vector3(MAX + 0.5, MAX + 0.5, MAX + 0.5)
  );
  const boundsHelper = new THREE.Box3Helper(bounds, 0x3e4f8c);
  scene.add(boundsHelper);

  const grid = new THREE.GridHelper(SIZE + 1, SIZE + 1, 0x2f3d74, 0x22315f);
  grid.position.y = MIN - 0.5;
  scene.add(grid);

  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cubeMaterial = new THREE.MeshStandardMaterial({
    color: 0x57d6a5,
    roughness: 0.64,
    metalness: 0.05,
    transparent: true,
    opacity: 1,
  });
  const voxels = new THREE.InstancedMesh(cubeGeometry, cubeMaterial, MAX_INSTANCES);
  voxels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  voxels.frustumCulled = false;
  voxels.count = 0;
  scene.add(voxels);

  const hoverOutline = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
  );
  hoverOutline.visible = false;
  scene.add(hoverOutline);

  // Brink skeleton rendering: white spheres at vertices, and
  // cylinders for edges colored red/yellow/blue by their X/Y/Z axis.
  const SKELETON_VERTEX_RADIUS = (0.125 / 2) * 1.6; // diameter 1/8 of a cube edge, scaled 60% larger
  const SKELETON_EDGE_RADIUS = SKELETON_VERTEX_RADIUS * 0.4; // halved back down from the previous 2x

  const skeletonVertexGeometry = new THREE.SphereGeometry(SKELETON_VERTEX_RADIUS, 12, 8);
  const skeletonVertexMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const skeletonVertexMesh = new THREE.InstancedMesh(skeletonVertexGeometry, skeletonVertexMaterial, MAX_INSTANCES);
  skeletonVertexMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  skeletonVertexMesh.frustumCulled = false;
  skeletonVertexMesh.count = 0;
  scene.add(skeletonVertexMesh);

  // Unit-height cylinder along Y; scaled/rotated/positioned per edge.
  const skeletonEdgeGeometry = new THREE.CylinderGeometry(SKELETON_EDGE_RADIUS, SKELETON_EDGE_RADIUS, 1, 8);
  const AXIS_COLORS = [0xff3b30, 0xffd60a, 0x0a84ff]; // X: red, Y: yellow, Z: blue
  const skeletonEdgeMeshes = AXIS_COLORS.map((color) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const mesh = new THREE.InstancedMesh(skeletonEdgeGeometry, material, MAX_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  });

  // Render modes: "normal" shows opaque cubes and all three edge
  // colors; each "no-X" mode makes the cubes transparent and
  // hides that one axis's edges, so the remaining brink skeleton is
  // easier to see through the cube volume.
  const AXIS_INDEX_BY_HIDDEN_COLOR = { 'no-red': 0, 'no-yellow': 1, 'no-blue': 2 };

  function setRenderMode(mode) {
    const hiddenAxis = AXIS_INDEX_BY_HIDDEN_COLOR[mode];
    cubeMaterial.opacity = hiddenAxis === undefined ? 1 : 0.5;
    for (let axis = 0; axis < 3; axis++) {
      skeletonEdgeMeshes[axis].visible = axis !== hiddenAxis;
    }
  }

  const skeletonTempMatrix = new THREE.Matrix4();
  const skeletonEdgeQuaternions = [
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2), // Y-cylinder -> X
    new THREE.Quaternion(), // Y-cylinder -> Y (identity)
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), // Y-cylinder -> Z
  ];

  function renderBrinkSkeleton(skeleton) {
    skeletonVertexMesh.count = skeleton.vertices.length;
    for (let i = 0; i < skeleton.vertices.length; i++) {
      const [x, y, z] = skeleton.vertices[i];
      skeletonTempMatrix.makeTranslation(x, y, z);
      skeletonVertexMesh.setMatrixAt(i, skeletonTempMatrix);
    }
    skeletonVertexMesh.instanceMatrix.needsUpdate = true;

    const edgesByAxis = [[], [], []];
    for (const [vi, vj] of skeleton.edges) {
      const a = skeleton.vertices[vi];
      const b = skeleton.vertices[vj];
      const axis = a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2;
      edgesByAxis[axis].push([a, b]);
    }

    for (let axis = 0; axis < 3; axis++) {
      const mesh = skeletonEdgeMeshes[axis];
      const axisEdges = edgesByAxis[axis];
      mesh.count = axisEdges.length;
      for (let i = 0; i < axisEdges.length; i++) {
        const [a, b] = axisEdges[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const midX = (a[0] + b[0]) / 2;
        const midY = (a[1] + b[1]) / 2;
        const midZ = (a[2] + b[2]) / 2;
        skeletonTempMatrix.compose(
          new THREE.Vector3(midX, midY, midZ),
          skeletonEdgeQuaternions[axis],
          new THREE.Vector3(1, length, 1)
        );
        mesh.setMatrixAt(i, skeletonTempMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const occupied = new Map();
  const positions = [];
  const tempMatrix = new THREE.Matrix4();

  function key(x, y, z) {
    return `${x},${y},${z}`;
  }

  function inBounds(x, y, z) {
    return x >= MIN && x <= MAX && y >= MIN && y <= MAX && z >= MIN && z <= MAX;
  }

  function hasVoxel(x, y, z) {
    return occupied.has(key(x, y, z));
  }

  function updateStatus(mode) {
    statusEl.innerHTML = `Mode: ${mode === 'build' ? 'Build' : 'Destroy'}<br>Cubes: ${positions.length}`;
  }

  function updateBrinkSkeleton() {
    const skeleton = computeBrinkSkeleton(positions);
    logBrinkSkeleton(skeleton);
    renderBrinkSkeleton(skeleton);
  }

  function addVoxel(x, y, z) {
    if (!inBounds(x, y, z) || hasVoxel(x, y, z)) return false;

    const idx = positions.length;
    const pos = { x, y, z };
    positions.push(pos);
    occupied.set(key(x, y, z), idx);

    tempMatrix.makeTranslation(x, y, z);
    voxels.setMatrixAt(idx, tempMatrix);
    voxels.count = positions.length;
    voxels.instanceMatrix.needsUpdate = true;
    voxels.computeBoundingBox();
    voxels.computeBoundingSphere();
    updateBrinkSkeleton();
    return true;
  }

  function removeVoxel(x, y, z) {
    const removeKey = key(x, y, z);
    const removeIdx = occupied.get(removeKey);
    if (removeIdx === undefined) return false;

    const lastIdx = positions.length - 1;
    const lastPos = positions[lastIdx];

    if (removeIdx !== lastIdx) {
      positions[removeIdx] = lastPos;
      occupied.set(key(lastPos.x, lastPos.y, lastPos.z), removeIdx);
      tempMatrix.makeTranslation(lastPos.x, lastPos.y, lastPos.z);
      voxels.setMatrixAt(removeIdx, tempMatrix);
    }

    positions.pop();
    occupied.delete(removeKey);
    voxels.count = positions.length;
    voxels.instanceMatrix.needsUpdate = true;
    voxels.computeBoundingBox();
    voxels.computeBoundingSphere();
    updateBrinkSkeleton();
    return true;
  }

  // Initial cube centered in a 49x49x49 build volume.
  addVoxel(0, 0, 0);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const instanceMatrix = new THREE.Matrix4();
  const hitCenter = new THREE.Vector3();
  const localHit = new THREE.Vector3();

  let mode = 'build';
  let downX = 0;
  let downY = 0;

  function setMode(nextMode) {
    mode = nextMode;
    buildBtn.classList.toggle('active', mode === 'build');
    destroyBtn.classList.toggle('active', mode === 'destroy');
    updateStatus(mode);
  }

  function faceDirectionFromIntersection(intersection) {
    const id = intersection.instanceId;
    if (id === undefined || id === null) return null;

    voxels.getMatrixAt(id, instanceMatrix);
    hitCenter.setFromMatrixPosition(instanceMatrix);
    localHit.copy(intersection.point).sub(hitCenter);

    const ax = Math.abs(localHit.x);
    const ay = Math.abs(localHit.y);
    const az = Math.abs(localHit.z);

    if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(localHit.x), 0, 0);
    if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(localHit.y), 0);
    return new THREE.Vector3(0, 0, Math.sign(localHit.z));
  }

  function getIntersection(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(voxels, false);
  }

  function handleEdit(clientX, clientY) {
    const hits = getIntersection(clientX, clientY);
    if (!hits.length) return;

    const hit = hits[0];
    const id = hit.instanceId;
    if (id === undefined || id === null) return;

    voxels.getMatrixAt(id, instanceMatrix);
    hitCenter.setFromMatrixPosition(instanceMatrix);
    const x = Math.round(hitCenter.x);
    const y = Math.round(hitCenter.y);
    const z = Math.round(hitCenter.z);

    if (mode === 'destroy') {
      if (removeVoxel(x, y, z)) updateStatus(mode);
      return;
    }

    const dir = faceDirectionFromIntersection(hit);
    if (!dir) return;

    const nx = x + dir.x;
    const ny = y + dir.y;
    const nz = z + dir.z;

    if (addVoxel(nx, ny, nz)) updateStatus(mode);
  }

  buildBtn.addEventListener('click', () => setMode('build'));
  destroyBtn.addEventListener('click', () => setMode('destroy'));

  renderModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) setRenderMode(input.value);
    });
  });

  renderer.domElement.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    const hits = getIntersection(event.clientX, event.clientY);
    if (!hits.length || hits[0].instanceId === undefined || hits[0].instanceId === null) {
      hoverOutline.visible = false;
      return;
    }

    voxels.getMatrixAt(hits[0].instanceId, instanceMatrix);
    hitCenter.setFromMatrixPosition(instanceMatrix);
    hoverOutline.position.copy(hitCenter);
    hoverOutline.visible = true;
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    const dist = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (dist > 3) return;
    handleEdit(event.clientX, event.clientY);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  updateStatus(mode);
  setRenderMode('normal');

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((error) => {
  console.error(error);
  errorEl.style.display = 'grid';
  errorEl.textContent = `Startup failed: ${error?.message || error}`;
});
