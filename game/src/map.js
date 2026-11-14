// Foundry Yard: an original 40 x 32 m industrial yard at dusk, three lanes, two
// plant sites. Vanguard spawns south, Ember north. The map is built from boxes,
// cylinders and one furnace, all of it also a collider and a bullet stop.
// Layout (metres, x east, z south):
//   perimeter walls, lane walls at x = +/-8 with a mid connector gap, a cross wall
//   at z = 0 with one door, site A "Furnace" north-west, site B "Silo" north-east.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  minX: -20,
  maxX: 20,
  minZ: -16,
  maxZ: 16,
  sites: {
    A: { name: 'Furnace', x: -14, z: -10, radius: 4.2 },
    B: { name: 'Silo', x: 14, z: -10, radius: 4.2 },
  },
  spawns: {
    vanguard: [
      [-6, 13.5], [-2, 14], [2, 14], [6, 13.5], [0, 11.5],
    ],
    ember: [
      [-6, -13.5], [-2, -14], [2, -14], [6, -13.5], [0, -11.5],
    ],
  },
};

// Waypoint graph bots walk: node = [x, z], edge = index pair. Lanes run south to
// north on the west (x -14), middle (x 0) and east (x 14); the connector at z 0
// links them, and each site has a ring of hold points.
const NODES = [
  [0, 13], [-14, 13], [14, 13], // 0-2 south: mid, west, east entries
  [0, 6], [-14, 6], [14, 6], // 3-5 south mid-lane
  [-4, 0], [4, 0], [0, -1], // 6-8 connector + mid door
  [-14, -2], [14, -2], // 9-10 north lane mouths
  [-14, -6], [14, -6], // 11-12 site approaches
  [-14, -10], [14, -10], // 13-14 site centres
  [-17, -8], [-11, -13], // 15-16 site A corners
  [17, -8], [11, -13], // 17-18 site B corners
  [0, -6], [0, -12], // 19-20 north mid
  [-8, -10], [8, -10], // 21-22 lane-wall gaps north
];
const EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 6], [3, 8], [4, 6], [5, 7], [6, 8], [7, 8],
  [6, 9], [7, 10], [8, 19], [9, 11], [10, 12], [11, 13], [12, 14],
  [13, 15], [13, 16], [14, 17], [14, 18], [13, 21], [14, 22],
  [11, 21], [12, 22], [19, 20], [20, 21], [20, 22], [9, 21], [10, 22],
  [0, 1], [0, 2], [1, 2], [19, 13], [19, 14], [3, 4], [3, 5], [4, 5],
];

function buildGraph() {
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return { nodes: NODES, adjacency };
}

// Breadth-first route between two nodes; the graph is tiny, so a fresh array per
// query is cheaper than keeping a cache warm.
export function findRoute(graph, from, to) {
  if (from === to) return [from];
  const prev = new Array(graph.nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of graph.adjacency[current]) {
      if (prev[next] !== -1) continue;
      prev[next] = current;
      if (next === to) {
        const route = [to];
        let step = to;
        while (step !== from) {
          step = prev[step];
          route.unshift(step);
        }
        return route;
      }
      queue.push(next);
    }
  }
  return [from, to];
}

export function nearestNode(graph, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const dx = graph.nodes[i][0] - x;
    const dz = graph.nodes[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const graph = buildGraph();

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'signal' ? 0.55 : 0.92,
      metalness: name === 'steel' ? 0.25 : 0.03,
    });
  }
  const siteMatA = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const siteMatB = siteMatA.clone();

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radiusTop, radiusBottom, height, x, y, z, material, segments = 20) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), mats[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 40 x 32 m, 5 m walls, open sky.
  box(40.4, 0.4, 32.4, 0, -0.2, 0, 'floor');
  box(0.4, 5, 32.4, -20.2, 2.5, 0, 'steel');
  box(0.4, 5, 32.4, 20.2, 2.5, 0, 'steel');
  box(40.4, 5, 0.4, 0, 2.5, -16.2, 'steel');
  box(40.4, 5, 0.4, 0, 2.5, 16.2, 'steel');

  // Lane walls at x = +/-8: solid from the north wall to z = -4 and from z = 4 to
  // the south wall, leaving the connector gap z in [-4, 4].
  for (const side of [-1, 1]) {
    box(0.4, 4.2, 12.4, side * 8, 2.1, -10, 'steel');
    box(0.4, 4.2, 12.4, side * 8, 2.1, 10, 'steel');
  }
  // Cross wall at z = 0 across mid, one door 3 m wide in the middle.
  box(5.5, 4.2, 0.4, -5.25, 2.1, 0, 'steel');
  box(5.5, 4.2, 0.4, 5.25, 2.1, 0, 'steel');
  box(3, 1.1, 0.4, 0, 3.65, 0, 'steel'); // lintel over the door

  // Site A: the Furnace — a big rust block with a chimney and a glow slit.
  box(4.5, 3.4, 2.2, -17.5, 1.7, -13.5, 'rust');
  cylinder(0.7, 0.9, 5.4, -17.5, 2.7, -14.5, 'steel');
  box(4.5, 0.25, 0.3, -17.5, 2.2, -12.35, 'ember', false);
  // Site B: the Silo — a tall cylinder with a catwalk ring.
  cylinder(2.4, 2.4, 5.2, 17.5, 2.6, -13.5, 'steel', 24);
  box(5, 0.3, 5, 17.5, 5.35, -13.5, 'rust', false);

  // Cover, lane by lane: crates to crouch behind, pillars to peek around, two
  // low platforms a jump can reach.
  box(2.2, 1.1, 1.2, -14, 0.55, 2, 'rust');
  box(1.2, 1.1, 2.2, -17.5, 0.55, -2, 'rust');
  box(1.2, 2.4, 1.2, -11, 1.2, -6, 'steel');
  box(2.2, 1.1, 1.2, 14, 0.55, 2, 'rust');
  box(1.2, 1.1, 2.2, 17.5, 0.55, -2, 'rust');
  box(1.2, 2.4, 1.2, 11, 1.2, -6, 'steel');
  box(1.6, 0.9, 1.6, -3.5, 0.45, 8, 'rust');
  box(1.6, 0.9, 1.6, 3.5, 0.45, 8, 'rust');
  box(1.2, 2.6, 1.2, -2.5, 1.3, -4, 'steel');
  box(1.2, 2.6, 1.2, 2.5, 1.3, -4, 'steel');
  box(2.4, 0.9, 2.4, 0, 0.45, -9, 'rust');
  box(3.2, 0.9, 1.4, -6, 0.45, 11, 'rust');
  box(3.2, 0.9, 1.4, 6, 0.45, 11, 'rust');
  box(1.1, 1.9, 1.1, -15.5, 0.95, -6.5, 'steel');
  box(1.1, 1.9, 1.1, 15.5, 0.95, -6.5, 'steel');
  // Site crates: plant cover inside each site ring.
  box(1.6, 1.1, 1.6, -12, 0.55, -12.5, 'rust');
  box(1.6, 1.1, 1.6, 12, 0.55, -12.5, 'rust');

  // Site rings: flat translucent discs on the floor marking where the spike goes.
  const ringA = new THREE.Mesh(new THREE.CircleGeometry(MAP.sites.A.radius, 40), siteMatA);
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(MAP.sites.A.x, 0.02, MAP.sites.A.z);
  group.add(ringA);
  const ringB = new THREE.Mesh(new THREE.CircleGeometry(MAP.sites.B.radius, 40), siteMatB);
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(MAP.sites.B.x, 0.02, MAP.sites.B.z);
  group.add(ringB);

  // Light: low amber sun from the north-west, cool blue fill from the south, and a
  // hemisphere gradient so the dusk palette reads at a glance.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.frost), new THREE.Color(PALETTE.dusk), 1.05);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.ember), 2.6);
  sun.position.set(-14, 18, -12);
  sun.target.position.set(2, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.frost), 0.7);
  fill.position.set(10, 12, 14);
  scene.add(fill);
  // Warm point lights over each site so the plant zones glow.
  const glowA = new THREE.PointLight(new THREE.Color(PALETTE.ember), 14, 12);
  glowA.position.set(MAP.sites.A.x, 3.2, MAP.sites.A.z);
  scene.add(glowA);
  const glowB = new THREE.PointLight(new THREE.Color(PALETTE.ember), 14, 12);
  glowB.position.set(MAP.sites.B.x, 3.2, MAP.sites.B.z);
  scene.add(glowB);

  return { colliders, shootables, group, graph, ringA, ringB };
}
