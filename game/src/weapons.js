// The armoury: five guns and three grenades, all original names, all numbers in
// one table so the balance is readable at a glance. Damage is per pellet inside
// the falloff start; past it, damage lerps down to `farScale` at `falloffEnd`.
// Head hits multiply by `headMult` before armour is applied.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  wasp: {
    id: 'wasp', name: 'P9 Wasp', kind: 'pistol', price: 0, slot: 'sidearm',
    damage: 26, headMult: 4, pellets: 1, rpm: 380, auto: false,
    mag: 12, reserve: 96, reloadMs: 1400, spreadDeg: 0.55, moveSpreadDeg: 1.6,
    recoil: 0.011, falloffStart: 14, falloffEnd: 42, farScale: 0.6,
    killReward: 300, zoom: 1,
  },
  ratter: {
    id: 'ratter', name: 'VK-9 Ratter', kind: 'smg', price: 1200, slot: 'primary',
    damage: 22, headMult: 4, pellets: 1, rpm: 750, auto: true,
    mag: 32, reserve: 128, reloadMs: 2100, spreadDeg: 1.0, moveSpreadDeg: 2.4,
    recoil: 0.008, falloffStart: 10, falloffEnd: 32, farScale: 0.5,
    killReward: 600, zoom: 1,
  },
  mule: {
    id: 'mule', name: 'Mule 12', kind: 'shotgun', price: 1100, slot: 'primary',
    damage: 9, headMult: 2, pellets: 8, rpm: 68, auto: false,
    mag: 6, reserve: 30, reloadMs: 2600, spreadDeg: 3.4, moveSpreadDeg: 4.2,
    recoil: 0.05, falloffStart: 5, falloffEnd: 18, farScale: 0.25,
    killReward: 900, zoom: 1,
  },
  longline: {
    id: 'longline', name: 'AR-57 Longline', kind: 'rifle', price: 2700, slot: 'primary',
    damage: 34, headMult: 4, pellets: 1, rpm: 600, auto: true,
    mag: 30, reserve: 120, reloadMs: 2300, spreadDeg: 0.65, moveSpreadDeg: 2.8,
    recoil: 0.013, falloffStart: 16, falloffEnd: 55, farScale: 0.65,
    killReward: 300, zoom: 1,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel DMR', kind: 'dmr', price: 3100, slot: 'primary',
    damage: 68, headMult: 3, pellets: 1, rpm: 240, auto: false,
    mag: 10, reserve: 50, reloadMs: 2500, spreadDeg: 0.12, moveSpreadDeg: 3.4,
    recoil: 0.03, falloffStart: 24, falloffEnd: 80, farScale: 0.8,
    killReward: 300, zoom: 2.2,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Pebble Frag', price: 300, fuseMs: 1600, radius: 6.5, damage: 92 },
  flash: { id: 'flash', name: 'Blink Flash', price: 200, fuseMs: 1200, radius: 16 },
  smoke: { id: 'smoke', name: 'Veil Smoke', price: 300, fuseMs: 900, radius: 3.4, lifeMs: 9000 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_FACTOR = 0.55; // armoured targets take 55% damage

export function damageAt(def, distance) {
  if (distance <= def.falloffStart) return def.damage;
  if (distance >= def.falloffEnd) return def.damage * def.farScale;
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage * (1 + (def.farScale - 1) * t);
}

// A runtime weapon: definition plus its live magazine state. One instance per
// actor per gun they own; switching weapons never loses ammo state.
export function createWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    nextShotAt: 0,
    reloadingUntil: 0,
    bloom: 0, // extra spread from sustained fire, decays in step()
  };
}

// The first-person view model: a low, chunky gun built from boxes, parented to
// the camera. `kick` drives the recoil slide; the muzzle tip is where tracers
// and the flash sprite anchor. Each kind gets its furniture — a red-dot with a
// lit reticle on the rifle, a magnified optic on the DMR, a pump and tube on
// the shotgun — and every gun is held: a gloved support hand under the
// fore-end and a trigger hand on the grip, so the frame reads as a shooter
// and not a floating prop.
export function buildViewModel(def) {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: PALETTE.weapon, roughness: 0.55, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.weaponAccent, roughness: 0.4, metalness: 0.7 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.85, metalness: 0.1 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.95, metalness: 0 });
  const teamBand = new THREE.MeshStandardMaterial({
    color: PALETTE.attack, emissive: PALETTE.attack, emissiveIntensity: 0.55, roughness: 0.6,
  });
  const dotMat = new THREE.MeshStandardMaterial({
    color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 3.2,
  });

  function box(w, h, d, x, y, z, mat = body) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  function dot(x, y, z, r = 0.006) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), dotMat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  // the shooter's hands: trigger hand wrapped on the grip, support hand
  // cupped under the fore-end, team armband on the support wrist
  function hands(gripZ, foreZ) {
    const trigger = box(0.052, 0.085, 0.075, 0.004, -0.145, gripZ, glove);
    trigger.rotation.x = 0.35;
    const support = box(0.055, 0.07, 0.11, -0.006, -0.105, foreZ, glove);
    support.rotation.x = -0.25;
    const band = box(0.058, 0.045, 0.03, -0.006, -0.085, foreZ + 0.075, teamBand);
    band.rotation.x = -0.25;
  }

  if (def.kind === 'pistol') {
    box(0.055, 0.09, 0.24, 0, 0, -0.1); // slide + frame
    box(0.058, 0.03, 0.2, 0, 0.055, -0.1, accent); // slide top
    box(0.05, 0.11, 0.07, 0, -0.09, 0.0, grip);
    box(0.02, 0.035, 0.02, 0, 0.065, -0.2, accent); // front post
    dot(0, 0.078, -0.205, 0.005); // tritium front dot
    dot(-0.012, 0.078, 0.005, 0.004); // rear dots
    dot(0.012, 0.078, 0.005, 0.004);
    hands(0.02, -0.12);
  } else if (def.kind === 'shotgun') {
    box(0.07, 0.1, 0.62, 0, 0, -0.26); // barrel + receiver
    box(0.05, 0.05, 0.55, 0, -0.075, -0.26, accent); // magazine tube
    box(0.075, 0.06, 0.2, 0, -0.055, -0.34, grip); // pump
    box(0.055, 0.13, 0.08, 0, -0.1, 0.06, grip);
    box(0.02, 0.03, 0.02, 0, 0.065, -0.55, accent); // bead sight
    dot(0, 0.085, -0.55, 0.005);
    hands(0.08, -0.36);
  } else if (def.kind === 'dmr') {
    box(0.06, 0.09, 0.72, 0, 0, -0.3); // long barrel
    box(0.035, 0.035, 0.3, 0, 0.01, -0.52, accent); // muzzle brake
    box(0.055, 0.055, 0.24, 0, 0.095, -0.2, body); // scope tube
    box(0.065, 0.065, 0.05, 0, 0.095, -0.31, accent); // objective bell
    box(0.02, 0.03, 0.02, 0, 0.135, -0.2, accent); // turret
    dot(0, 0.095, -0.335, 0.007); // lit objective glint
    box(0.045, 0.1, 0.09, 0, -0.1, -0.08, grip);
    box(0.05, 0.16, 0.06, 0, -0.13, 0.14, body); // stock + cheek riser
    box(0.052, 0.04, 0.1, 0, -0.045, -0.38, grip); // bipod stub
    hands(0.14, -0.34);
  } else if (def.kind === 'smg') {
    box(0.06, 0.1, 0.42, 0, 0, -0.18); // receiver
    box(0.04, 0.04, 0.14, 0, 0.005, -0.42, accent); // suppressor
    box(0.05, 0.17, 0.06, 0, -0.12, -0.05, body); // long magazine
    box(0.05, 0.1, 0.07, 0, -0.09, 0.08, grip);
    box(0.045, 0.05, 0.09, 0, 0.075, -0.14, body); // reflex housing
    dot(0, 0.082, -0.16, 0.005);
    box(0.012, 0.1, 0.012, 0, -0.02, 0.2, accent); // wire stock strut
    hands(0.1, -0.26);
  } else {
    // rifle — the Longline, the screenshot gun: full furniture
    box(0.065, 0.1, 0.56, 0, 0, -0.22); // receiver + barrel shroud
    box(0.055, 0.07, 0.3, 0, -0.015, -0.36, grip); // vented handguard
    box(0.02, 0.02, 0.26, 0.036, -0.03, -0.36, accent); // handguard rail, right
    box(0.02, 0.02, 0.26, -0.036, -0.03, -0.36, accent); // handguard rail, left
    box(0.04, 0.045, 0.09, 0, 0.005, -0.52, accent); // muzzle brake
    box(0.05, 0.15, 0.07, 0, -0.12, -0.02, body); // magazine
    box(0.05, 0.05, 0.06, 0, -0.185, -0.015, accent); // magazine baseplate
    box(0.055, 0.1, 0.08, 0, -0.09, 0.1, grip); // pistol grip
    box(0.03, 0.04, 0.2, 0, 0.07, -0.3, accent); // carry rail
    box(0.05, 0.055, 0.1, 0, 0.085, -0.12, body); // red-dot housing
    box(0.056, 0.02, 0.106, 0, 0.118, -0.12, accent); // hood
    dot(0, 0.088, -0.15, 0.0055); // the dot itself
    box(0.045, 0.08, 0.05, 0, -0.06, -0.3, grip); // foregrip
    box(0.055, 0.09, 0.14, 0, -0.02, 0.24, body); // stock
    box(0.058, 0.11, 0.03, 0, -0.03, 0.31, grip); // butt pad
    box(0.02, 0.05, 0.03, 0.038, 0.01, 0.02, accent); // charging handle
    hands(0.12, -0.31);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, def.kind === 'pistol' ? -0.24 : def.kind === 'dmr' ? -0.68 : -0.52);
  group.add(muzzle);

  group.position.set(0.24, -0.22, -0.45);
  group.rotation.y = 0.03;
  return { group, muzzle };
}
