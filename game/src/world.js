// Kestrel Yard: an original dusk freight yard. Attackers ("Strikers") spawn at
// the south gate and push two lanes and a central plaza toward two charge
// sites — the Furnace Hall in the west and the Silo Yard in the east — while
// the Wardens hold them. Everything solid is an AABB in `colliders`; the same
// list drives movement collision, bullet raycasts (through the meshes) and
// bot line-of-sight, so the three can never disagree about the map.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HALF = 46; // the yard is 92 x 92 metres, walls at the edge

function groundTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const toPx = (v) => ((v + HALF) / (HALF * 2)) * size;
  g.fillStyle = '#4a4a4c';
  g.fillRect(0, 0, size, size);
  // asphalt wear: thousands of faint speckles
  for (let i = 0; i < 9000; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    g.fillRect(x, y, 2, 2);
  }
  // expansion joints
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  for (let i = 1; i < 6; i += 1) {
    g.beginPath(); g.moveTo((size / 6) * i, 0); g.lineTo((size / 6) * i, size); g.stroke();
    g.beginPath(); g.moveTo(0, (size / 6) * i); g.lineTo(size, (size / 6) * i); g.stroke();
  }
  // lane centrelines toward both sites
  g.strokeStyle = 'rgba(255,180,84,0.5)';
  g.lineWidth = 5;
  g.setLineDash([26, 20]);
  g.beginPath(); g.moveTo(toPx(-29), toPx(44)); g.lineTo(toPx(-29), toPx(-12)); g.stroke();
  g.beginPath(); g.moveTo(toPx(29), toPx(44)); g.lineTo(toPx(29), toPx(-12)); g.stroke();
  g.beginPath(); g.moveTo(toPx(0), toPx(44)); g.lineTo(toPx(0), toPx(-10)); g.stroke();
  g.setLineDash([]);
  // the two charge sites, painted as rings with their letters
  for (const [cx, cz, letter] of [[-29, -27, 'A'], [29, -27, 'B']]) {
    g.strokeStyle = '#ffb454';
    g.lineWidth = 7;
    g.beginPath(); g.arc(toPx(cx), toPx(cz), (6.5 / (HALF * 2)) * size, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,180,84,0.85)';
    g.font = `bold ${Math.round(size / 11)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, toPx(cx), toPx(cz));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const colliders = []; // {minX,maxX,minZ,maxZ,minY,maxY,blocksSight}
  const shootables = []; // meshes bullets can hit

  const materials = new Map();
  function material(color, rough = 0.9, metal = 0.05) {
    const key = `${color}/${rough}`;
    if (!materials.has(key)) {
      materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    }
    return materials.get(key);
  }

  function addBox(cx, cz, w, d, h, color, { y = 0, rough = 0.9, sight = h >= 1.35, shoot = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, rough));
    mesh.position.set(cx, y + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y, maxY: y + h, blocksSight: sight });
    if (shoot) shootables.push(mesh);
    return mesh;
  }

  function addCylinder(cx, cz, r, h, color) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), material(color, 0.6, 0.35));
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({ minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r, minY: 0, maxY: h, blocksSight: true });
    shootables.push(mesh);
    // a band near the top so the silos read as vessels, not pillars
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.5, 20), material(PALETTE.furnace, 0.7, 0.2));
    band.position.set(cx, h - 1.1, cz);
    scene.add(band);
    return mesh;
  }

  // ---- ground, sky, light -------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  shootables.push(ground);

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 55, 130);
  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x3d3630, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.6);
  sun.position.set(-38, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -58;
  sun.shadow.camera.right = 58;
  sun.shadow.camera.top = 58;
  sun.shadow.camera.bottom = -58;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // distant skyline silhouettes outside the walls
  for (const [x, z, w, h, d] of [[-70, -70, 30, 26, 18], [40, -75, 42, 34, 20], [75, 10, 18, 22, 30], [-75, 20, 16, 18, 26], [0, -85, 60, 20, 14]]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0x232a33 }));
    block.position.set(x, h / 2, z);
    scene.add(block);
  }

  // ---- perimeter ----------------------------------------------------------
  const wallH = 5;
  addBox(0, -HALF, HALF * 2 + 2, 1, wallH, PALETTE.concreteDark);
  addBox(0, HALF, HALF * 2 + 2, 1, wallH, PALETTE.concreteDark);
  addBox(-HALF, 0, 1, HALF * 2, wallH, PALETTE.concreteDark);
  addBox(HALF, 0, 1, HALF * 2, wallH, PALETTE.concreteDark);

  // ---- Furnace Hall (site A, west) ---------------------------------------
  // Hall walls with two door gaps (south and east), a furnace block inside.
  addBox(-29, -36.5, 17, 1, 4.6, PALETTE.concrete); // north wall
  addBox(-37.5, -27, 1, 18, 4.6, PALETTE.concrete); // west wall
  addBox(-33.5, -18, 7, 1, 4.6, PALETTE.concrete); // south wall, west part (gap at x -27..-21)
  addBox(-20.5, -27, 1, 6, 4.6, PALETTE.concrete); // east wall, north part (gap z -24..-18)
  addBox(-29, -27, 4.5, 2.2, 3.1, PALETTE.furnace); // the furnace
  addBox(-29, -27, 5.1, 2.8, 0.35, PALETTE.roof, { y: 3.1 }); // furnace cap
  addBox(-24, -32, 2.2, 2.2, 1.1, PALETTE.crateWood); // crates inside A
  addBox(-24, -32, 2.2, 2.2, 1.1, PALETTE.crateWood, { y: 1.1 });
  addBox(-34.5, -21.5, 2.2, 2.2, 1.1, PALETTE.crateMetal);

  // ---- Silo Yard (site B, east) -------------------------------------------
  addCylinder(24.5, -31, 2.3, 9.5, PALETTE.silo);
  addCylinder(33.5, -31, 2.3, 9.5, PALETTE.silo);
  addCylinder(29, -21.5, 2.3, 7.5, PALETTE.silo);
  addBox(29, -36.5, 15, 1, 3.4, PALETTE.concrete); // back wall
  addBox(20.5, -27, 1, 12, 3.4, PALETTE.concrete); // west fence wall (gap z -21..-15)
  addBox(37.5, -27, 1, 20, 3.4, PALETTE.concrete); // east wall
  addBox(24, -24, 2.2, 2.2, 1.1, PALETTE.crateWood);
  addBox(34, -25.5, 2.2, 2.2, 1.1, PALETTE.crateMetal);

  // ---- containers: mid doors and lane cover --------------------------------
  function container(cx, cz, rotY, color) {
    // a 6x2.6x2.6 shipping container, rotated in 90-degree steps
    const along = Math.abs(Math.sin(rotY)) > 0.5;
    const w = along ? 2.6 : 6;
    const d = along ? 6 : 2.6;
    const mesh = addBox(cx, cz, w, d, 2.6, color, { rough: 0.65, sight: true });
    mesh.position.y = 1.3;
    // ribbed top edge so it reads as a container, not a slab
    addBox(cx, cz, w === 6 ? 6.1 : 2.7, d === 6 ? 6.1 : 2.7, 0.14, PALETTE.roof, { y: 2.6, shoot: false });
    return mesh;
  }
  container(-3.6, -4, 0, PALETTE.containerA); // mid doors, west leaf
  container(3.6, -4, 0, PALETTE.containerB); // mid doors, east leaf (3 m gap between)
  container(-14, 8, Math.PI / 2, PALETTE.containerB); // plaza west
  container(14, 8, Math.PI / 2, PALETTE.containerA); // plaza east
  container(-29, 8, 0, PALETTE.containerA); // foundry lane cover
  container(29, 8, 0, PALETTE.containerB); // silo lane cover
  container(0, -24, 0, PALETTE.containerB); // crossway centre

  // ---- scattered cover ------------------------------------------------------
  const crateSpots = [
    [-8, 22], [6, 20], [-18, 26], [18, 27], [-6, -12], [9, -14], [-16, -6], [17, -8],
    [-38, 2], [38, 4], [-12, 36], [12, 37], [0, 30], [-24, -8], [24, -6], [-38, -38],
    [38, -38], [6, -30], [-6, -34],
  ];
  for (const [x, z] of crateSpots) {
    addBox(x, z, 2.2, 2.2, 1.1, (x + z) % 2 === 0 ? PALETTE.crateWood : PALETTE.crateMetal);
    if ((x * z) % 3 === 0) addBox(x, z, 2.2, 2.2, 1.1, PALETTE.crateWood, { y: 1.1 });
  }
  // low barriers on the long sightlines
  addBox(0, 16, 5, 0.8, 1.05, PALETTE.concrete, { sight: false });
  addBox(-29, 20, 5, 0.8, 1.05, PALETTE.concrete, { sight: false });
  addBox(29, 20, 5, 0.8, 1.05, PALETTE.concrete, { sight: false });

  // ---- lamp posts ------------------------------------------------------------
  const lampMat = new THREE.MeshStandardMaterial({ color: PALETTE.trim, emissive: PALETTE.lampGlow, emissiveIntensity: 2.2 });
  for (const [x, z] of [[-29, -27], [29, -27], [0, 2], [-40, 20], [40, 20]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.4, 8), material(PALETTE.roof, 0.6, 0.4));
    pole.position.set(x + 3.4, 2.7, z + 3.4);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat);
    head.position.set(x + 3.4, 5.5, z + 3.4);
    scene.add(head);
    const light = new THREE.PointLight(PALETTE.lampGlow, 60, 26, 1.8);
    light.position.set(x + 3.4, 5.3, z + 3.4);
    scene.add(light);
  }

  // ---- sites, spawns, waypoints ----------------------------------------------
  const sites = {
    A: { id: 'A', name: 'Furnace Hall', x: -29, z: -27, radius: 6.5 },
    B: { id: 'B', name: 'Silo Yard', x: 29, z: -27, radius: 6.5 },
  };
  const spawns = {
    attack: [
      { x: 0, z: 40, yaw: Math.PI }, // the player (yaw faces -z, into the yard)
      { x: -3.5, z: 41, yaw: Math.PI },
      { x: 3.5, z: 41, yaw: Math.PI },
      { x: -7, z: 39, yaw: Math.PI },
    ],
    defend: [
      { x: -25, z: -33, yaw: 0.6 },
      { x: -33, z: -21, yaw: 2.6 },
      { x: 25, z: -33, yaw: -0.6 },
      { x: 33, z: -21, yaw: -2.6 },
    ],
  };

  // Waypoint graph: bots travel node to node. Positions sit in open ground;
  // edges are listed by hand so routes follow the lanes a player would take.
  const nodeList = [
    [0, 38], [-10, 33], [10, 33], // 0-2 attacker spawn apron
    [-28, 30], [-28, 17], [-28, 3], // 3-5 foundry lane
    [28, 30], [28, 17], [28, 3], // 6-8 silo lane
    [0, 25], [0, 13], // 9-10 plaza approach
    [-9, 3], [9, 3], [0, -8], // 11-13 mid
    [-15, -14], [0, -15], [15, -14], // 14-16 crossway
    [-24, -15], [24, -15], // 17-18 site doors
    [-29, -20], [-24, -31], [-34, -31], // 19-21 inside A
    [29, -20], [24, -31], [34, -31], // 22-24 inside B
    [-14, -38], [14, -38], // 25-26 north corners
    [-29, -12], [29, -12], // 27-28 lane-to-crossway joints
  ];
  const edgePairs = [
    [0, 1], [0, 2], [1, 3], [2, 6], [1, 9], [2, 9], [9, 10], [10, 11], [10, 12],
    [3, 4], [4, 5], [5, 27], [6, 7], [7, 8], [8, 28],
    [11, 13], [12, 13], [13, 15], [11, 14], [12, 16],
    [14, 15], [15, 16], [14, 17], [16, 18], [17, 27], [18, 28],
    [17, 19], [19, 20], [19, 21], [20, 21], [20, 25], [21, 25],
    [18, 22], [22, 23], [22, 24], [23, 24], [23, 26], [24, 26],
    [27, 28], [5, 11], [8, 12], [15, 27], [15, 28],
  ];
  const nodes = nodeList.map(([x, z], id) => ({ id, x, z, edges: [] }));
  for (const [a, b] of edgePairs) {
    nodes[a].edges.push(b);
    nodes[b].edges.push(a);
  }

  // Segment vs the sight-blocking colliders (slab test per box). Eye heights
  // are handled by the caller passing real 3D endpoints.
  const _seg = { x: 0, y: 0, z: 0 };
  function segmentBlocked(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    for (const c of colliders) {
      if (!c.blocksSight) continue;
      let t0 = 0;
      let t1 = 1;
      // X slab
      if (Math.abs(dx) < 1e-9) {
        if (x1 < c.minX || x1 > c.maxX) continue;
      } else {
        let ta = (c.minX - x1) / dx;
        let tb = (c.maxX - x1) / dx;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) {
        if (y1 < c.minY || y1 > c.maxY) continue;
      } else {
        let ta = (c.minY - y1) / dy;
        let tb = (c.maxY - y1) / dy;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) {
        if (z1 < c.minZ || z1 > c.maxZ) continue;
      } else {
        let ta = (c.minZ - z1) / dz;
        let tb = (c.maxZ - z1) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      if (t0 <= t1 && t1 > 0.001 && t0 < 0.999) return true;
    }
    return false;
  }

  return { colliders, shootables, sites, spawns, nodes, segmentBlocked, _seg };
}
