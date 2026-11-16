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

// ---- procedural surface textures -------------------------------------------
// Flat colours read as placeholders in a screenshot; these small canvas
// textures give every big surface a grain, a seam pattern and a stencil so
// the yard reads as a worked-in freight yard at a glance. All generated at
// boot from the seeded-free canvas API — no external assets, no build step.
function makeCanvas(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function speckle(g, size, n, alpha) {
  for (let i = 0; i < n; i += 1) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha + 0.02})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
}

const TEXTURES = {
  concrete: () => makeCanvas(256, (g, s) => {
    g.fillStyle = '#8b9096'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2600, 0.05);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    g.strokeRect(1, 1, s - 2, s - 2); // formwork panel seams
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i < 5; i += 1) g.fillRect(Math.random() * s, s * 0.6, 3, s * 0.4); // weather streaks
  }),
  wood: () => makeCanvas(256, (g, s) => {
    g.fillStyle = '#a87c50'; g.fillRect(0, 0, s, s);
    for (let p = 0; p < 4; p += 1) { // four planks with grain lines
      const y = (s / 4) * p;
      g.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.05})`; g.fillRect(0, y, s, s / 4);
      g.strokeStyle = 'rgba(60,35,15,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
      g.strokeStyle = 'rgba(90,55,25,0.35)'; g.lineWidth = 1;
      for (let i = 0; i < 7; i += 1) {
        const gy = y + 4 + Math.random() * (s / 4 - 8);
        g.beginPath(); g.moveTo(0, gy); g.bezierCurveTo(s * 0.3, gy + 2, s * 0.7, gy - 2, s, gy); g.stroke();
      }
    }
    g.strokeStyle = 'rgba(40,25,10,0.8)'; g.lineWidth = 6; g.strokeRect(0, 0, s, s); // crate frame
  }),
  metal: () => makeCanvas(256, (g, s) => {
    g.fillStyle = '#77828a'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1500, 0.05);
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2; g.strokeRect(6, 6, s - 12, s - 12);
    g.fillStyle = 'rgba(30,30,30,0.75)'; // rivets
    for (const [x, y] of [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]]) {
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(120,60,25,0.35)'; // rust bloom
    for (let i = 0; i < 6; i += 1) {
      g.beginPath(); g.arc(Math.random() * s, s - Math.random() * 40, 8 + Math.random() * 16, 0, Math.PI * 2); g.fill();
    }
  }),
  container: () => makeCanvas(512, (g, s) => {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, s, s); // tinted by the material colour
    for (let x = 0; x < s; x += 32) { // corrugation ribs, light/shadow pairs
      g.fillStyle = 'rgba(255,255,255,0.20)'; g.fillRect(x, 0, 9, s);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + 20, 0, 10, s);
    }
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, s - 46, s, 46); // road grime at the base
    speckle(g, s, 1800, 0.05);
    g.fillStyle = 'rgba(20,20,20,0.55)';
    g.font = `bold 44px system-ui, sans-serif`;
    g.fillText('KESTREL FREIGHT', 36, 84);
    g.font = `28px ui-monospace, monospace`;
    g.fillText('KFLU 2041 · MAX 24 000 KG', 36, 126);
  }),
  skyline: () => makeCanvas(256, (g, s) => {
    g.fillStyle = '#232a33'; g.fillRect(0, 0, s, s);
    for (let y = 14; y < s - 10; y += 22) { // a grid of windows, some lit
      for (let x = 12; x < s - 10; x += 20) {
        const lit = Math.random();
        g.fillStyle = lit < 0.28 ? 'rgba(255,196,110,0.95)' : lit < 0.36 ? 'rgba(170,210,255,0.8)' : 'rgba(10,12,16,0.9)';
        g.fillRect(x, y, 11, 13);
      }
    }
  }),
};

// The dusk sky as a painted dome: slate zenith melting into a sodium horizon
// with a low sun glow in the west and the first faint stars up top.
function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#1c2735');
  grad.addColorStop(0.45, '#2e3a47');
  grad.addColorStop(0.72, '#5a4a3c');
  grad.addColorStop(0.88, '#8a5f36');
  grad.addColorStop(1, '#6e4c2c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  // the setting sun: a warm bloom low in the west (u ≈ 0.78 of the wrap)
  const sun = g.createRadialGradient(800, 430, 8, 800, 430, 190);
  sun.addColorStop(0, 'rgba(255,214,150,0.95)');
  sun.addColorStop(0.25, 'rgba(255,170,90,0.55)');
  sun.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = sun;
  g.fillRect(560, 220, 480, 292);
  // thin dusk cloud bands
  for (let i = 0; i < 26; i += 1) {
    const y = 250 + Math.random() * 150;
    g.fillStyle = `rgba(30,26,30,${0.10 + Math.random() * 0.16})`;
    g.fillRect(Math.random() * 1024, y, 140 + Math.random() * 320, 3 + Math.random() * 6);
  }
  // early stars in the upper sky
  for (let i = 0; i < 130; i += 1) {
    g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * 1024, Math.random() * 150, 1.6, 1.6);
  }
  const texture = new THREE.CanvasTexture(canvas);
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

  const texMaterials = new Map();
  function texMaterial(kind, tint, rough = 0.9, metal = 0.05) {
    const key = `${kind}/${tint}/${rough}`;
    if (!texMaterials.has(key)) {
      if (!TEXTURES[kind].cached) TEXTURES[kind].cached = TEXTURES[kind]();
      texMaterials.set(key, new THREE.MeshStandardMaterial({
        map: TEXTURES[kind].cached, color: tint, roughness: rough, metalness: metal,
      }));
    }
    return texMaterials.get(key);
  }

  function addBox(cx, cz, w, d, h, color, { y = 0, rough = 0.9, sight = h >= 1.35, shoot = true, tex = null } = {}) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      tex ? texMaterial(tex, color, rough) : material(color, rough),
    );
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
  scene.fog = new THREE.Fog(new THREE.Color(0x4a4038), 55, 150);
  // the painted dusk dome sits inside the fog's far edge and ignores fog
  // itself, so the horizon keeps its sodium gradient instead of washing out
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(185, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(skyDome);
  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x3d3630, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.9);
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
  // a faint warm bounce from the west, where the sun is going down
  const bounce = new THREE.DirectionalLight(0xff9a50, 0.35);
  bounce.position.set(-30, 8, -20);
  scene.add(bounce);

  // distant skyline silhouettes outside the walls, windows lit for the dusk
  const skylineTex = TEXTURES.skyline();
  for (const [x, z, w, h, d] of [[-70, -70, 30, 26, 18], [40, -75, 42, 34, 20], [75, 10, 18, 22, 30], [-75, 20, 16, 18, 26], [0, -85, 60, 20, 14]]) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ map: skylineTex, color: 0x9aa4ae }),
    );
    block.position.set(x, h / 2, z);
    scene.add(block);
  }

  // ---- perimeter ----------------------------------------------------------
  const wallH = 5;
  addBox(0, -HALF, HALF * 2 + 2, 1, wallH, PALETTE.concreteDark, { tex: 'concrete' });
  addBox(0, HALF, HALF * 2 + 2, 1, wallH, PALETTE.concreteDark, { tex: 'concrete' });
  addBox(-HALF, 0, 1, HALF * 2, wallH, PALETTE.concreteDark, { tex: 'concrete' });
  addBox(HALF, 0, 1, HALF * 2, wallH, PALETTE.concreteDark, { tex: 'concrete' });

  // ---- Furnace Hall (site A, west) ---------------------------------------
  // Hall walls with two door gaps (south and east), a furnace block inside.
  addBox(-29, -36.5, 17, 1, 4.6, PALETTE.concrete, { tex: 'concrete' }); // north wall
  addBox(-37.5, -27, 1, 18, 4.6, PALETTE.concrete, { tex: 'concrete' }); // west wall
  addBox(-33.5, -18, 7, 1, 4.6, PALETTE.concrete, { tex: 'concrete' }); // south wall, west part (gap at x -27..-21)
  addBox(-20.5, -27, 1, 6, 4.6, PALETTE.concrete, { tex: 'concrete' }); // east wall, north part (gap z -24..-18)
  addBox(-29, -27, 4.5, 2.2, 3.1, PALETTE.furnace, { tex: 'metal' }); // the furnace
  addBox(-29, -27, 5.1, 2.8, 0.35, PALETTE.roof, { y: 3.1 }); // furnace cap
  // the furnace mouth glows — a lit firebox face and a warm light spill
  const firebox = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: 0xff6a22, emissiveIntensity: 2.6 }),
  );
  firebox.position.set(-29, 0.85, -25.88);
  scene.add(firebox);
  const furnaceLight = new THREE.PointLight(0xff7a30, 42, 15, 1.9);
  furnaceLight.position.set(-29, 1.6, -24.6);
  scene.add(furnaceLight);
  addBox(-24, -32, 2.2, 2.2, 1.1, PALETTE.crateWood, { tex: 'wood' }); // crates inside A
  addBox(-24, -32, 2.2, 2.2, 1.1, PALETTE.crateWood, { y: 1.1, tex: 'wood' });
  addBox(-34.5, -21.5, 2.2, 2.2, 1.1, PALETTE.crateMetal, { tex: 'metal' });

  // ---- Silo Yard (site B, east) -------------------------------------------
  addCylinder(24.5, -31, 2.3, 9.5, PALETTE.silo);
  addCylinder(33.5, -31, 2.3, 9.5, PALETTE.silo);
  addCylinder(29, -21.5, 2.3, 7.5, PALETTE.silo);
  addBox(29, -36.5, 15, 1, 3.4, PALETTE.concrete, { tex: 'concrete' }); // back wall
  addBox(20.5, -27, 1, 12, 3.4, PALETTE.concrete, { tex: 'concrete' }); // west fence wall (gap z -21..-15)
  addBox(37.5, -27, 1, 20, 3.4, PALETTE.concrete, { tex: 'concrete' }); // east wall
  addBox(24, -24, 2.2, 2.2, 1.1, PALETTE.crateWood, { tex: 'wood' });
  addBox(34, -25.5, 2.2, 2.2, 1.1, PALETTE.crateMetal, { tex: 'metal' });

  // ---- containers: mid doors and lane cover --------------------------------
  function container(cx, cz, rotY, color, level = 0) {
    // a 6x2.6x2.6 shipping container, rotated in 90-degree steps; `level`
    // stacks a second box on top of a ground one for the yard's stacks
    const along = Math.abs(Math.sin(rotY)) > 0.5;
    const w = along ? 2.6 : 6;
    const d = along ? 6 : 2.6;
    const mesh = addBox(cx, cz, w, d, 2.6, color, { rough: 0.65, sight: true, tex: 'container', y: level * 2.6 });
    mesh.position.y = level * 2.6 + 1.3;
    // ribbed top edge so it reads as a container, not a slab
    addBox(cx, cz, w === 6 ? 6.1 : 2.7, d === 6 ? 6.1 : 2.7, 0.14, PALETTE.roof, { y: level * 2.6 + 2.6, shoot: false });
    return mesh;
  }
  container(-3.6, -4, 0, PALETTE.containerA); // mid doors, west leaf
  container(3.6, -4, 0, PALETTE.containerB); // mid doors, east leaf (3 m gap between)
  container(-14, 8, Math.PI / 2, PALETTE.containerB); // plaza west
  container(14, 8, Math.PI / 2, PALETTE.containerA); // plaza east
  container(14, 8, Math.PI / 2, PALETTE.containerB, 1); // plaza east, stacked
  container(-29, 8, 0, PALETTE.containerA); // foundry lane cover
  container(-29, 8, 0, PALETTE.containerB, 1); // foundry lane, stacked
  container(29, 8, 0, PALETTE.containerB); // silo lane cover
  container(0, -24, 0, PALETTE.containerB); // crossway centre

  // ---- scattered cover ------------------------------------------------------
  const crateSpots = [
    [-8, 22], [6, 20], [-18, 26], [18, 27], [-6, -12], [9, -14], [-16, -6], [17, -8],
    [-38, 2], [38, 4], [-12, 36], [12, 37], [0, 30], [-24, -8], [24, -6], [-38, -38],
    [38, -38], [6, -30], [-6, -34],
  ];
  for (const [x, z] of crateSpots) {
    const wood = (x + z) % 2 === 0;
    addBox(x, z, 2.2, 2.2, 1.1, wood ? PALETTE.crateWood : PALETTE.crateMetal, { tex: wood ? 'wood' : 'metal' });
    if ((x * z) % 3 === 0) addBox(x, z, 2.2, 2.2, 1.1, PALETTE.crateWood, { y: 1.1, tex: 'wood' });
  }
  // low barriers on the long sightlines
  addBox(0, 16, 5, 0.8, 1.05, PALETTE.concrete, { sight: false, tex: 'concrete' });
  addBox(-29, 20, 5, 0.8, 1.05, PALETTE.concrete, { sight: false, tex: 'concrete' });
  addBox(29, 20, 5, 0.8, 1.05, PALETTE.concrete, { sight: false, tex: 'concrete' });

  // ---- yard dressing: barrels, sandbags, the gantry crane -------------------
  // Pure set dressing with honest colliders: barrels cluster where a yard
  // crew would stage fuel, sandbag lines harden the two lane mouths, and the
  // gantry crane that loads the containers crosses the plaza overhead.
  function addBarrel(cx, cz, color, stacked = false) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14),
      texMaterial('metal', color, 0.55, 0.4),
    );
    mesh.position.set(cx, (stacked ? 1.05 : 0) + 0.525, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({
      minX: cx - 0.42, maxX: cx + 0.42, minZ: cz - 0.42, maxZ: cz + 0.42,
      minY: stacked ? 1.05 : 0, maxY: (stacked ? 1.05 : 0) + 1.05, blocksSight: false,
    });
    shootables.push(mesh);
    return mesh;
  }
  const barrelSpots = [
    [-19.5, -14.5, 0], [-18.6, -14.9, 0], [-19.1, -13.7, 0], [-19.1, -14.3, 1],
    [19.5, -13.5, 0], [18.7, -13.9, 0], [19.2, -12.8, 0],
    [-41, 32, 0], [-40.2, 32.5, 0], [41.5, 30, 0], [40.7, 30.4, 0], [41.1, 29.4, 1],
    [-8.5, -27.5, 0], [8.5, 33.5, 0], [9.3, 33.9, 0],
  ];
  const barrelColors = [0x7a4a26, 0x3f6d6a, 0x6b7076, 0x8a3324];
  barrelSpots.forEach(([x, z, st], i) => addBarrel(x, z, barrelColors[i % barrelColors.length], st === 1));

  // sandbag lines: squat, rough, and low enough to shoot over (sight false)
  for (const [x, z, along] of [[-12, -17.5, 0], [12, -17.5, 0], [-29, 27.5, 1], [29, 27.5, 1], [0, 21.5, 1]]) {
    addBox(x, z, along ? 3.4 : 0.95, along ? 0.95 : 3.4, 0.78, 0x8a7a56, { sight: false, rough: 1 });
    addBox(x, z, along ? 2.6 : 0.8, along ? 0.8 : 2.6, 0.42, 0x7c6c4c, { y: 0.78, sight: false, rough: 1, shoot: false });
  }

  // the gantry crane: two legs and a beam over the mid doors, hook block hung
  addBox(-10.5, -4, 0.7, 0.7, 6.4, PALETTE.furnace, { tex: 'metal' });
  addBox(10.5, -4, 0.7, 0.7, 6.4, PALETTE.furnace, { tex: 'metal' });
  addBox(0, -4, 21.7, 0.8, 0.7, PALETTE.furnace, { y: 6.4, tex: 'metal', sight: false });
  addBox(4.5, -4, 0.9, 0.9, 0.8, PALETTE.roof, { y: 5.6, shoot: false, sight: false }); // trolley + hook block
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), material(PALETTE.roof, 0.6, 0.4));
  cable.position.set(4.5, 4.9, -4);
  scene.add(cable);

  // oil stains and scuff decals flat on the asphalt
  const stainMat = new THREE.MeshBasicMaterial({ color: 0x0c0d0f, transparent: true, opacity: 0.34, depthWrite: false });
  for (const [x, z, r] of [[-14, 14, 2.1], [10, -20, 1.6], [-29, -8, 1.8], [24, 18, 2.3], [0, 34, 1.5], [-36, -33, 1.4]]) {
    const stain = new THREE.Mesh(new THREE.CircleGeometry(r, 18), stainMat);
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(x, 0.012, z);
    scene.add(stain);
  }

  // charge-site ground rings: a painted, faintly glowing boundary so the
  // objective reads from across the yard (the HUD names the called site)
  for (const [cx, cz] of [[-29, -27], [29, -27]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.1, 6.55, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.trim, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.015, cz);
    scene.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 6.4, 9, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: PALETTE.trim, transparent: true, opacity: 0.045,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    pillar.position.set(cx, 4.5, cz);
    scene.add(pillar);
  }

  // dusk dust hanging in the work lights — a few hundred still motes
  {
    const n = 380;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * 88;
      pos[i * 3 + 1] = 0.3 + Math.random() * 5.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 88;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffd9a0, size: 0.07, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(dust);
  }

  // ---- lamp posts ------------------------------------------------------------
  const lampMat = new THREE.MeshStandardMaterial({ color: PALETTE.trim, emissive: PALETTE.lampGlow, emissiveIntensity: 1.35 });
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
