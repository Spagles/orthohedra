import * as THREE from "https://esm.sh/three@0.172.0";
import { TrackballControls } from "https://esm.sh/three@0.172.0/examples/jsm/controls/TrackballControls.js";
import { computeBrinkSkeleton, computeBoundaryCubeFaces, logBrinkSkeleton } from "./brinkSkeleton.js";

const SIZE = 49;
const HALF = Math.floor(SIZE / 2);
const MIN = -HALF;
const MAX = HALF;
const MAX_INSTANCES = SIZE * SIZE * SIZE;

const app = document.getElementById('app');
const errorEl = document.getElementById('error');
const statusEl = document.getElementById('status');
const skeletonStatsEl = document.getElementById('skeletonStats');
const buildBtn = document.getElementById('buildBtn');
const destroyBtn = document.getElementById('destroyBtn');
const resetBtn = document.getElementById('resetBtn');
const renderModeInputs = document.querySelectorAll('input[name="renderMode"]');
const saveBtn = document.getElementById('saveBtn');
const saveAsBtn = document.getElementById('saveAsBtn');
const loadBtn = document.getElementById('loadBtn');

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

  const controls = new TrackballControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.minDistance = 1.8;
  controls.maxDistance = 120;
  controls.noPan = false;
  controls.rotateSpeed = 3.5;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;

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

  // Boundary cube faces: one unit quad per non-internal cube face (every
  // face except those sandwiched between two present cubes) — replaces
  // rendering whole green cubes. Faces are split into 3 meshes by their
  // normal axis (X/Y/Z) so each orientation's transparency can be
  // controlled independently: hiding one axis's skeleton edges (e.g. "no
  // red") should only make transparent the faces that LIE IN a plane
  // containing that axis (Y- and Z-normal faces, i.e. red-yellow and
  // red-blue planes) — the faces perpendicular to that axis (X-normal,
  // lying in the yellow-blue plane) stay solid.
  const FACE_MAX_INSTANCES = MAX_INSTANCES * 2; // at most 2 boundary faces per cube per axis
  const faceGeometry = new THREE.PlaneGeometry(1, 1);
  const cubeFaceMaterials = [0, 1, 2].map(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x57d6a5,
        roughness: 0.64,
        metalness: 0.05,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
      })
  );
  const cubeFaceMeshes = cubeFaceMaterials.map((material) => {
    const mesh = new THREE.InstancedMesh(faceGeometry, material, FACE_MAX_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  });

  // Per-instance metadata for the current boundary faces, one array per
  // axis mesh, indexed the same as that mesh's instances.
  let boundaryFaceInfoByAxis = [[], [], []];

  const faceTempMatrix = new THREE.Matrix4();
  const faceQuaternions = [
    [ // axis 0 (X): rotate the plane (default facing +Z) to face +X / -X
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
    ],
    [ // axis 1 (Y): rotate to face +Y / -Y
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    ],
    [ // axis 2 (Z): rotate to face +Z / -Z (identity / 180°)
      new THREE.Quaternion(),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
    ],
  ];

  function renderBoundaryCubeFaces(cubePositions) {
    const boundaryFaces = computeBoundaryCubeFaces(cubePositions);
    const byAxis = [[], [], []];
    for (const face of boundaryFaces) byAxis[face.axis].push(face);
    boundaryFaceInfoByAxis = byAxis;

    for (let axis = 0; axis < 3; axis++) {
      const mesh = cubeFaceMeshes[axis];
      const axisFaces = byAxis[axis];
      mesh.count = axisFaces.length;
      for (let i = 0; i < axisFaces.length; i++) {
        const { sign, center } = axisFaces[i];
        const signIdx = sign === 1 ? 0 : 1;
        faceTempMatrix.compose(
          new THREE.Vector3(center[0], center[1], center[2]),
          faceQuaternions[axis][signIdx],
          new THREE.Vector3(1, 1, 1)
        );
        mesh.setMatrixAt(i, faceTempMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // InstancedMesh caches a bounding sphere for raycasting that isn't
      // automatically invalidated when instances move or `count`
      // changes — recompute it here or hover/click detection can
      // intermittently miss instances outside the stale bounds.
      mesh.computeBoundingSphere();
    }
  }

  const hoverOutline = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, side: THREE.DoubleSide })
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
  let currentRenderMode = 'normal';

  function setRenderMode(mode) {
    currentRenderMode = mode;
    const hiddenAxis = AXIS_INDEX_BY_HIDDEN_COLOR[mode];
    for (let axis = 0; axis < 3; axis++) {
      skeletonEdgeMeshes[axis].visible = axis !== hiddenAxis;
      // A face's plane contains the hidden axis unless the face's own
      // normal IS that axis — e.g. hiding red (X) leaves X-normal faces
      // (the yellow-blue plane) solid, and makes Y-normal/Z-normal faces
      // (red-blue and red-yellow planes) transparent.
      const faceContainsHiddenAxis = hiddenAxis !== undefined && axis !== hiddenAxis;
      const material = cubeFaceMaterials[axis];
      material.opacity = faceContainsHiddenAxis ? 0.2 : 1;
      // A transparent material that still writes depth marks those pixels
      // as occupied at its own (nearer) depth; solid geometry drawn
      // afterward at a greater depth then fails the depth test there and
      // never gets rasterized, making it vanish instead of showing
      // through the transparent face. Only disable depth writes while
      // actually transparent, and make sure the opaque axis mesh renders
      // first (renderOrder 0) so its depth/color are already established
      // before the transparent ones (renderOrder 1) blend on top of it.
      material.depthWrite = !faceContainsHiddenAxis;
      cubeFaceMeshes[axis].renderOrder = faceContainsHiddenAxis ? 1 : 0;
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

  const STORAGE_KEY = 'cubes-editor:state';
  const RENDER_MODES = new Set(['normal', 'no-red', 'no-yellow', 'no-blue']);

  function currentStateJSON() {
    return JSON.stringify(
      {
        positions,
        renderMode: currentRenderMode,
        camera: {
          position: camera.position.toArray(),
          target: controls.target.toArray(),
        },
      },
      null,
      2
    );
  }

  function parseSavedState(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      const positions = Array.isArray(parsed.positions)
        ? parsed.positions.filter(
            (p) =>
              p &&
              Number.isInteger(p.x) &&
              Number.isInteger(p.y) &&
              Number.isInteger(p.z) &&
              inBounds(p.x, p.y, p.z)
          )
        : [];

      const renderMode = RENDER_MODES.has(parsed.renderMode) ? parsed.renderMode : 'normal';

      const isVector3Array = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));
      const cameraState =
        parsed.camera && isVector3Array(parsed.camera.position) && isVector3Array(parsed.camera.target)
          ? parsed.camera
          : null;

      return { positions, renderMode, camera: cameraState };
    } catch {
      return null;
    }
  }

  function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, currentStateJSON());
  }

  function loadFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSavedState(raw) : null;
  }

  // File save/load: uses the File System Access API when available (so a
  // plain "Save" after the first "Save As…"/"Load…" writes straight back
  // to the same file without re-prompting); falls back to a download-link
  // trigger and a hidden file input on browsers that lack it (e.g. Safari,
  // Firefox).
  const hasFileSystemAccess = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  let fileHandle = null;

  async function writeToFileHandle(handle) {
    const writable = await handle.createWritable();
    await writable.write(currentStateJSON());
    await writable.close();
  }

  async function saveAs() {
    if (hasFileSystemAccess) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'cubes.json',
          types: [{ description: 'Cubes Editor JSON', accept: { 'application/json': ['.json'] } }],
        });
        await writeToFileHandle(handle);
        fileHandle = handle;
      } catch (error) {
        if (error?.name !== 'AbortError') console.error('Save As failed:', error);
      }
      return;
    }

    const blob = new Blob([currentStateJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cubes.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    if (hasFileSystemAccess && fileHandle) {
      try {
        await writeToFileHandle(fileHandle);
        return;
      } catch (error) {
        console.error('Save failed, falling back to Save As:', error);
      }
    }
    await saveAs();
  }

  function applyLoadedState(state) {
    if (!state) return;

    for (const { x, y, z } of [...positions]) removeVoxel(x, y, z);
    for (const { x, y, z } of state.positions) addVoxel(x, y, z);

    const radio = [...renderModeInputs].find((input) => input.value === state.renderMode);
    if (radio) radio.checked = true;
    setRenderMode(state.renderMode);

    if (state.camera) {
      camera.position.fromArray(state.camera.position);
      controls.target.fromArray(state.camera.target);
      controls.update();
    }

    updateStatus(mode);
    saveToLocalStorage();
  }

  let fileInput = null;

  async function load() {
    if (hasFileSystemAccess) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Cubes Editor JSON', accept: { 'application/json': ['.json'] } }],
        });
        const file = await handle.getFile();
        const state = parseSavedState(await file.text());
        if (!state) {
          console.error('Load failed: file is not a valid cubes-editor save.');
          return;
        }
        fileHandle = handle;
        applyLoadedState(state);
      } catch (error) {
        if (error?.name !== 'AbortError') console.error('Load failed:', error);
      }
      return;
    }

    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'application/json';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        const state = parseSavedState(await file.text());
        if (!state) {
          console.error('Load failed: file is not a valid cubes-editor save.');
          return;
        }
        applyLoadedState(state);
      });
    }
    fileInput.click();
  }

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
    const V = skeleton.vertices.length;
    const E = skeleton.edges.length;
    const F = skeleton.faces.length;
    skeletonStatsEl.innerHTML = `Skeleton: V ${V}, E ${E}, F ${F}<br>Euler χ: ${V - E + F}`;
    renderBoundaryCubeFaces(positions);
    saveToLocalStorage();
  }

  function reset() {
    for (const { x, y, z } of [...positions]) removeVoxel(x, y, z);
    addVoxel(0, 0, 0);
    updateStatus(mode);
  }

  function addVoxel(x, y, z) {
    if (!inBounds(x, y, z) || hasVoxel(x, y, z)) return false;

    const idx = positions.length;
    const pos = { x, y, z };
    positions.push(pos);
    occupied.set(key(x, y, z), idx);

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
    }

    positions.pop();
    occupied.delete(removeKey);
    updateBrinkSkeleton();
    return true;
  }

  // Restore previously saved state, if any: render mode and camera first
  // (so the position-restoring addVoxel calls below, which each trigger a
  // save, re-persist the already-correct values instead of clobbering
  // them with defaults), then the assembly itself. With nothing saved,
  // fall back to a single cube centered in the 49x49x49 build volume.
  const saved = loadFromLocalStorage();

  if (saved?.camera) {
    camera.position.fromArray(saved.camera.position);
    controls.target.fromArray(saved.camera.target);
    controls.update();
  }

  const radioForMode = (mode) => [...renderModeInputs].find((input) => input.value === mode);
  const initialRenderMode = saved?.renderMode ?? 'normal';
  const initialRadio = radioForMode(initialRenderMode);
  if (initialRadio) initialRadio.checked = true;
  setRenderMode(initialRenderMode);

  if (saved?.positions?.length) {
    for (const { x, y, z } of saved.positions) addVoxel(x, y, z);
  } else {
    addVoxel(0, 0, 0);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let mode = 'build';
  let downX = 0;
  let downY = 0;

  function setMode(nextMode) {
    mode = nextMode;
    buildBtn.classList.toggle('active', mode === 'build');
    destroyBtn.classList.toggle('active', mode === 'destroy');
    updateStatus(mode);
  }

  function getIntersection(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(cubeFaceMeshes, false);
  }

  function handleEdit(clientX, clientY) {
    const hits = getIntersection(clientX, clientY);
    if (!hits.length) return;

    const hit = hits[0];
    const id = hit.instanceId;
    if (id === undefined || id === null) return;

    const axis = cubeFaceMeshes.indexOf(hit.object);
    const info = boundaryFaceInfoByAxis[axis]?.[id];
    if (!info) return;
    const { x, y, z } = positions[info.cubeIndex];

    if (mode === 'destroy') {
      if (removeVoxel(x, y, z)) updateStatus(mode);
      return;
    }

    const nx = x + (info.axis === 0 ? info.sign : 0);
    const ny = y + (info.axis === 1 ? info.sign : 0);
    const nz = z + (info.axis === 2 ? info.sign : 0);

    if (addVoxel(nx, ny, nz)) updateStatus(mode);
  }

  buildBtn.addEventListener('click', () => setMode('build'));
  destroyBtn.addEventListener('click', () => setMode('destroy'));
  resetBtn.addEventListener('click', () => reset());

  saveBtn.addEventListener('click', () => save());
  saveAsBtn.addEventListener('click', () => saveAs());
  loadBtn.addEventListener('click', () => load());

  renderModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        setRenderMode(input.value);
        saveToLocalStorage();
      }
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

    hits[0].object.getMatrixAt(hits[0].instanceId, hoverOutline.matrix);
    hoverOutline.matrix.decompose(hoverOutline.position, hoverOutline.quaternion, hoverOutline.scale);
    // Nudge along the face normal so the (coplanar) outline doesn't z-fight
    // with the boundary face quad it's highlighting.
    hoverOutline.translateZ(0.002);
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
    // Unlike OrbitControls, TrackballControls caches the canvas's screen
    // rect for its rotate/pan/zoom math and needs to be told explicitly
    // when it changes, or dragging becomes misaligned with the cursor.
    controls.handleResize();
  });

  updateStatus(mode);

  // OrbitControls fires "change" continuously while dragging or during
  // damped inertial settling — debounce so camera moves don't spam
  // localStorage writes on every frame, only once motion has settled.
  let cameraSaveTimeout = null;
  controls.addEventListener('change', () => {
    clearTimeout(cameraSaveTimeout);
    cameraSaveTimeout = setTimeout(saveToLocalStorage, 300);
  });

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
