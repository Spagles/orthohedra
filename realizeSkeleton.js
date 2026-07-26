// Realize an "abstract brink skeleton" — a graph of vertices, edges, and
// faces with NO coordinates — into a concrete brink skeleton by assigning
// integer (x, y, z) coordinates to every vertex that satisfy the brink
// skeleton requirements:
//
//   R1. Every edge is axis-aligned: its endpoints differ in exactly one
//       coordinate.
//   R2. Every face is planar and axis-aligned: all its vertices share one
//       fixed coordinate, and its edges alternate between the two in-plane
//       axes around the cycle.
//
// The abstract input mirrors computeBrinkSkeleton's output with coordinates
// stripped:
//
//   { vertexCount: number,
//     edges:  Array<[vertexIdx, vertexIdx]>,
//     faces:  Array<edgeIdx[]> }   // each face is a cycle of edge indices
//
// and this returns a concrete skeleton { vertices: [[x,y,z],...], edges,
// faces } (the edges/faces are passed through unchanged), or throws if the
// abstract graph is not realizable.
//
// The algorithm is two constraint-propagation passes plus a greedy value
// assignment:
//
//   Pass 1 — axis per edge. Around each face cycle, consecutive edges use
//     the two different in-plane axes and every-other edge uses the same
//     axis. Seed one edge with axis 0 and propagate "consecutive-in-a-face
//     => different axis" across the whole graph (faces glued where they
//     share an edge). The third axis emerges wherever two already-known,
//     different axes meet. Contradiction => not realizable.
//
//   Pass 2 — coordinate value per axis. For a fixed axis a, two vertices
//     share their a-coordinate iff joined by a path of non-a edges (moving
//     along a non-a edge never changes coordinate a). Union-find those into
//     "a-slabs". Edges that DO run along a connect distinct slabs, but they
//     do NOT fix the gap between them (on a grid line, paired extremal
//     vertices may sit any distance apart). So the only hard constraint is
//     that along-a-adjacent slabs get distinct values; give every slab a
//     distinct integer via a running counter (BFS over the slab adjacency,
//     continued across components), which is compact and keeps every
//     along-a edge non-degenerate. The remaining mirror/stretch freedom of
//     the abstract graph is resolved compactly here.
//
// A final validity check confirms all vertices are distinct and every edge
// is axis-aligned — catching abstract graphs that pass local checks but
// have no consistent global embedding.

const AXES = [0, 1, 2];

// --- tiny union-find ---
function makeUF(n) {
  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
    return ra !== rb;
  }
  return { find, union };
}

/**
 * @param {{ vertexCount: number, edges: Array<[number,number]>, faces: Array<number[]> }} abstract
 * @returns {{ vertices: Array<[number,number,number]>, edges: Array<[number,number]>, faces: Array<number[]> }}
 */
export function realizeAbstractSkeleton(abstract) {
  const { vertexCount, edges, faces } = abstract;
  const E = edges.length;

  // ===================================================================
  // Pass 1: assign an axis (0/1/2) to every edge via face alternation.
  // ===================================================================
  // Step 1a — collapse "forced same-axis" edges. Around a face cycle
  // [e0, e1, e2, ...] the edges alternate between the face's two in-plane
  // axes, so every OTHER edge shares an axis: (e0,e2,e4,...) are one axis,
  // (e1,e3,e5,...) the other. Union those into same-axis classes. (A face
  // must have an even length for this to be consistent — an odd cycle
  // can't alternate between two axes and close up.)
  const sameAxisUF = makeUF(E);
  for (const face of faces) {
    const n = face.length;
    if (n < 3) throw new Error('Face with fewer than 3 edges is not realizable.');
    if (n % 2 !== 0) {
      throw new Error(`Face of odd length ${n} cannot alternate between two axes.`);
    }
    for (let i = 0; i < n; i++) {
      sameAxisUF.union(face[i], face[(i + 2) % n]);
    }
  }

  // Step 1b — build a graph on same-axis CLASSES whose edges mean "must be
  // a different axis": consecutive edges within any face. Two distinct
  // classes joined here must get different axis labels.
  const classDiff = new Map(); // classRep -> Set(classRep)
  function ensureClass(c) {
    if (!classDiff.has(c)) classDiff.set(c, new Set());
    return classDiff.get(c);
  }
  for (let e = 0; e < E; e++) ensureClass(sameAxisUF.find(e));
  for (const face of faces) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const ca = sameAxisUF.find(face[i]);
      const cb = sameAxisUF.find(face[(i + 1) % n]);
      if (ca === cb) {
        // A face forced two consecutive edges into the same axis-class:
        // impossible for an alternating cycle.
        throw new Error('Face alternation collapsed two consecutive edges to one axis.');
      }
      ensureClass(ca).add(cb);
      ensureClass(cb).add(ca);
    }
  }

  // Step 1c — 3-color the class-diff graph. Each class picks the lowest
  // axis not used by an already-colored differing neighbor. This graph is
  // 3-colorable exactly when the abstract skeleton is axis-realizable; if a
  // class finds all three axes blocked, no realization exists.
  const classAxis = new Map();
  for (const startClass of classDiff.keys()) {
    if (classAxis.has(startClass)) continue;
    classAxis.set(startClass, 0);
    const queue = [startClass];
    while (queue.length > 0) {
      const c = queue.shift();
      const myAxis = classAxis.get(c);
      for (const nb of classDiff.get(c)) {
        if (classAxis.has(nb)) {
          if (classAxis.get(nb) === myAxis) {
            throw new Error('Axis conflict: differing edge classes forced to same axis.');
          }
          continue;
        }
        const blocked = new Set();
        for (const nbnb of classDiff.get(nb)) {
          if (classAxis.has(nbnb)) blocked.add(classAxis.get(nbnb));
        }
        const choice = AXES.find((a) => !blocked.has(a));
        if (choice === undefined) {
          throw new Error('Not realizable: an edge class has no available axis (needs >3).');
        }
        classAxis.set(nb, choice);
        queue.push(nb);
      }
    }
  }

  const edgeAxis = new Array(E);
  for (let e = 0; e < E; e++) edgeAxis[e] = classAxis.get(sameAxisUF.find(e));

  // Re-validate every face: consecutive edges differ, and exactly two
  // distinct axes appear (planarity).
  for (const face of faces) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      if (edgeAxis[face[i]] === edgeAxis[face[(i + 1) % n]]) {
        throw new Error('Face alternation violated after assignment.');
      }
    }
    const axesInFace = new Set(face.map((ei) => edgeAxis[ei]));
    if (axesInFace.size !== 2) {
      throw new Error(`Face is not planar: uses ${axesInFace.size} axes, expected 2.`);
    }
  }

  // ===================================================================
  // Pass 2: assign an integer coordinate per axis to every vertex.
  // ===================================================================
  const coords = Array.from({ length: vertexCount }, () => [null, null, null]);

  for (const axis of AXES) {
    // Union vertices connected by edges NOT along `axis` — each class is
    // one "slab" sharing this axis-coordinate.
    const uf = makeUF(vertexCount);
    for (let ei = 0; ei < E; ei++) {
      if (edgeAxis[ei] === axis) continue;
      const [u, v] = edges[ei];
      uf.union(u, v);
    }

    // An edge ALONG `axis` joins two distinct slabs that must therefore get
    // DIFFERENT integer values. It does NOT fix the gap between them: on a
    // grid line the extremal vertices are paired consecutively but may sit
    // any distance apart (e.g. an L-shape has an edge from x=-0.5 straight
    // to x=1.5, skipping the x=0.5 that exists only on other lines). So the
    // only hard constraint along `axis` is: slabs joined by an along-axis
    // edge are distinct. We choose a compact assignment: give each slab a
    // distinct integer, consistent with an ordering derived from those
    // edges. Orient each connected component of the slab graph via BFS
    // (assigning increasing depth), which yields distinct values and keeps
    // every along-axis edge non-degenerate; the mirror/stretch freedom left
    // by the abstract graph is resolved compactly here.
    const slabAdj = new Map(); // slabRep -> Set(slabRep)
    function ensure(s) {
      if (!slabAdj.has(s)) slabAdj.set(s, new Set());
      return slabAdj.get(s);
    }
    const allSlabs = new Set();
    for (let vtx = 0; vtx < vertexCount; vtx++) {
      const s = uf.find(vtx);
      allSlabs.add(s);
      ensure(s);
    }
    for (let ei = 0; ei < E; ei++) {
      if (edgeAxis[ei] !== axis) continue;
      const [u, v] = edges[ei];
      const su = uf.find(u);
      const sv = uf.find(v);
      if (su === sv) {
        throw new Error(`Edge ${ei} runs along axis ${axis} but its endpoints share a slab.`);
      }
      ensure(su).add(sv);
      ensure(sv).add(su);
    }

    // Assign each slab a distinct integer. Within a connected component of
    // the slab graph, number slabs by BFS-discovery order starting at
    // `nextAvailable`; separate components continue the counter so no two
    // slabs (hence no two vertices differing only in `axis`) collide.
    const slabValue = new Map();
    let nextAvailable = 0;
    for (const startSlab of allSlabs) {
      if (slabValue.has(startSlab)) continue;
      const queue = [startSlab];
      slabValue.set(startSlab, nextAvailable++);
      while (queue.length > 0) {
        const s = queue.shift();
        for (const nb of ensure(s)) {
          if (slabValue.has(nb)) continue;
          slabValue.set(nb, nextAvailable++);
          queue.push(nb);
        }
      }
    }

    // Write this axis's coordinate onto every vertex from its slab.
    for (let vtx = 0; vtx < vertexCount; vtx++) {
      coords[vtx][axis] = slabValue.get(uf.find(vtx));
    }
  }

  // ===================================================================
  // Final validity check: R1 (edges axis-aligned) + distinct vertices.
  // ===================================================================
  for (let ei = 0; ei < E; ei++) {
    const [u, v] = edges[ei];
    const differing = AXES.filter((a) => coords[u][a] !== coords[v][a]);
    if (differing.length !== 1 || differing[0] !== edgeAxis[ei]) {
      throw new Error(
        `Realization failed: edge ${ei} is not aligned to its assigned axis.`
      );
    }
  }
  const seen = new Set();
  for (let vtx = 0; vtx < vertexCount; vtx++) {
    const k = coords[vtx].join(',');
    if (seen.has(k)) {
      throw new Error('Realization failed: two vertices landed at the same point.');
    }
    seen.add(k);
  }

  return {
    vertices: coords.map(([x, y, z]) => [x, y, z]),
    edges,
    faces,
  };
}

/**
 * Strip coordinates from a concrete skeleton to produce an abstract one —
 * handy for round-trip testing realizeAbstractSkeleton against
 * computeBrinkSkeleton output.
 */
export function toAbstractSkeleton(skeleton) {
  return {
    vertexCount: skeleton.vertices.length,
    edges: skeleton.edges,
    faces: skeleton.faces,
  };
}

// ---------------------------------------------------------------------------
// Recover cube least-corners from a concrete brink skeleton by a direct
// parity solve.
//
// Convention: cubes are identified by their least (min-x,y,z) integer corner;
// skeleton vertices are integer lattice points. A cube with least corner c
// occupies [c, c+1] on each axis, so its 8 corners are c + {0,1}^3.
//
// Backbone fact (verified empirically over thousands of random assemblies):
// a corner point is a skeleton vertex iff an ODD number of the (up to 8)
// cubes touching it are solid. So solidity is a parity function of the
// skeleton's vertex set: a cube with least corner c is solid iff an odd
// number of skeleton vertices are componentwise <= c (i.e. <= its cube
// center c+0.5, which for integer vertices means <= c) — a 3D prefix-XOR.
// (Bounding by the max corner c+1 instead would count all of a full cube's
// own 8 vertices and always give even parity — wrong.)
//
// We evaluate that parity for every cell in the skeleton's bounding box and
// keep the solid ones. A direct solve (not a flood fill) is used precisely
// because a valid solid can be edge- or corner-connected only — e.g. two
// cubes touching at a single edge — which a face-adjacency flood fill would
// split, returning just the seed's component. The prefix-XOR is built once
// as a running table so each cell costs O(1).

/**
 * @param {{ vertices: Array<[number,number,number]>, edges: Array<[number,number]>, faces: Array<number[]> }} skeleton
 * @returns {Array<{x:number,y:number,z:number}>} cube least-corners (integer coords)
 */
export function fillCubesFromSkeleton(skeleton) {
  if (skeleton.vertices.length === 0) return [];

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const verts = skeleton.vertices.map((v) => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])]);
  for (const p of verts) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < lo[k]) lo[k] = p[k];
      if (p[k] > hi[k]) hi[k] = p[k];
    }
  }

  // Index the bounding box [lo, hi] on each axis as 0..size-1. Mark vertex
  // presence in a flat array, then build a 3D prefix-XOR table `pref` where
  // pref[x][y][z] = XOR of vertex-indicator over all q <= (x,y,z). A cube
  // with least corner c is solid iff pref at c is 1.
  const size = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const idx = (x, y, z) => (x * size[1] + y) * size[2] + z;
  const present = new Uint8Array(size[0] * size[1] * size[2]);
  for (const p of verts) present[idx(p[0] - lo[0], p[1] - lo[1], p[2] - lo[2])] = 1;

  // Running 3D prefix-XOR (inclusion–exclusion over the 7 lower neighbors).
  const pref = new Uint8Array(size[0] * size[1] * size[2]);
  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      for (let z = 0; z < size[2]; z++) {
        let acc = present[idx(x, y, z)];
        if (x > 0) acc ^= pref[idx(x - 1, y, z)];
        if (y > 0) acc ^= pref[idx(x, y - 1, z)];
        if (z > 0) acc ^= pref[idx(x, y, z - 1)];
        if (x > 0 && y > 0) acc ^= pref[idx(x - 1, y - 1, z)];
        if (x > 0 && z > 0) acc ^= pref[idx(x - 1, y, z - 1)];
        if (y > 0 && z > 0) acc ^= pref[idx(x, y - 1, z - 1)];
        if (x > 0 && y > 0 && z > 0) acc ^= pref[idx(x - 1, y - 1, z - 1)];
        pref[idx(x, y, z)] = acc & 1;
      }
    }
  }

  // A cube's least corner ranges over cells whose max corner c+1 stays within
  // the vertex bounding box, i.e. c in [lo, hi-1] on each axis (the last
  // index, size-1, is a vertex plane with no cube beyond it). Solid iff the
  // prefix-XOR at c is 1.
  const cubes = [];
  for (let x = 0; x < size[0] - 1; x++) {
    for (let y = 0; y < size[1] - 1; y++) {
      for (let z = 0; z < size[2] - 1; z++) {
        if (pref[idx(x, y, z)]) {
          cubes.push({ x: x + lo[0], y: y + lo[1], z: z + lo[2] });
        }
      }
    }
  }
  return cubes;
}
