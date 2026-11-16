// One character controller for everybody: the player and every bot are the
// same body — an AABB with acceleration, friction, crouch and a small jump —
// so movement feel and collision can never diverge between them. Rendering
// lives in the mesh builder below; the simulation never touches three.js
// objects except to sync the mesh after a step.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp } from './rng.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
const HALF_W = 0.34; // body half width
const HEIGHT_STAND = 1.8;
const HEIGHT_CROUCH = 1.28;
const GRAVITY = 22;
const JUMP_SPEED = 6.4;
const STEP_UP = 0.0; // the yard is flat; crates are cover, not stairs

export function createBody(x, z, yaw) {
  return {
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    crouch: false,
    grounded: true,
    height: HEIGHT_STAND,
    eye: EYE_STAND,
    speed2d: 0,
  };
}

function collideAxis(body, colliders, axis, delta) {
  if (delta === 0) return;
  body.pos[axis] += delta;
  const minX = body.pos.x - HALF_W;
  const maxX = body.pos.x + HALF_W;
  const minZ = body.pos.z - HALF_W;
  const maxZ = body.pos.z + HALF_W;
  const feet = body.pos.y;
  const head = body.pos.y + body.height;
  for (const c of colliders) {
    if (c.maxY <= feet + STEP_UP || c.minY >= head) continue;
    if (maxX <= c.minX || minX >= c.maxX || maxZ <= c.minZ || minZ >= c.maxZ) continue;
    if (axis === 'x') {
      body.pos.x = delta > 0 ? c.minX - HALF_W - 0.001 : c.maxX + HALF_W + 0.001;
    } else {
      body.pos.z = delta > 0 ? c.minZ - HALF_W - 0.001 : c.maxZ + HALF_W + 0.001;
    }
    body.vel[axis] = 0;
    return;
  }
}

// Advance one body by dt. `wish` is the desired move direction in world space
// (unit length or zero), `runSpeed` the current top speed in m/s.
export function stepBody(body, colliders, wish, runSpeed, jump, dt) {
  body.height = body.crouch ? HEIGHT_CROUCH : HEIGHT_STAND;
  body.eye = body.crouch ? EYE_CROUCH : EYE_STAND;

  const accel = body.grounded ? 42 : 6;
  const friction = body.grounded ? 11 : 0.4;
  body.vel.x += wish.x * accel * dt;
  body.vel.z += wish.z * accel * dt;
  // friction, then clamp to the top speed in the wish direction's frame
  const damp = Math.max(0, 1 - friction * dt);
  if (wish.x === 0 && wish.z === 0) {
    body.vel.x *= damp;
    body.vel.z *= damp;
  }
  const speed = Math.hypot(body.vel.x, body.vel.z);
  if (speed > runSpeed) {
    body.vel.x = (body.vel.x / speed) * runSpeed;
    body.vel.z = (body.vel.z / speed) * runSpeed;
  }

  if (jump && body.grounded) {
    body.vel.y = JUMP_SPEED;
    body.grounded = false;
  }
  body.vel.y -= GRAVITY * dt;
  body.pos.y += body.vel.y * dt;
  if (body.pos.y <= 0) {
    body.pos.y = 0;
    body.vel.y = 0;
    body.grounded = true;
  }

  collideAxis(body, colliders, 'x', body.vel.x * dt);
  collideAxis(body, colliders, 'z', body.vel.z * dt);
  body.speed2d = Math.hypot(body.vel.x, body.vel.z);
  return body;
}

// The low-poly soldier every actor wears: boots, legs, a team-coloured torso,
// a helmeted head, and a gun that points where its owner aims. Head and torso
// are separate meshes because bullets treat them separately — userData.part
// says which, userData.actor points back to the owning actor record.
export function buildSoldier(team) {
  const group = new THREE.Group();
  const main = team === 'attack' ? PALETTE.attack : PALETTE.defend;
  const dark = team === 'attack' ? PALETTE.attackDark : PALETTE.defendDark;
  const matMain = new THREE.MeshStandardMaterial({ color: main, roughness: 0.8 });
  const matDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.85 });
  const matUniform = new THREE.MeshStandardMaterial({ color: PALETTE.uniform, roughness: 0.9 });
  const matSkin = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 0.7 });
  const matGun = new THREE.MeshStandardMaterial({ color: PALETTE.weapon, roughness: 0.5, metalness: 0.5 });

  function box(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  box(0.17, 0.52, 0.2, -0.13, 0.26, 0, matUniform); // legs
  box(0.17, 0.52, 0.2, 0.13, 0.26, 0, matUniform);
  box(0.19, 0.1, 0.24, -0.13, 0.05, 0.02, matDark); // boots
  box(0.19, 0.1, 0.24, 0.13, 0.05, 0.02, matDark);
  const torso = box(0.52, 0.62, 0.28, 0, 1.06, 0, matMain);
  torso.userData.part = 'body';
  box(0.54, 0.16, 0.3, 0, 0.82, 0, matDark); // belt / armour skirt
  box(0.13, 0.5, 0.16, -0.34, 1.08, 0, matMain); // arms
  box(0.13, 0.5, 0.16, 0.34, 1.08, 0, matMain);
  const head = box(0.3, 0.3, 0.3, 0, 1.56, 0, matSkin);
  head.userData.part = 'head';
  box(0.34, 0.12, 0.34, 0, 1.74, 0, matDark); // helmet
  box(0.34, 0.05, 0.1, 0, 1.66, -0.16, matDark); // helmet brim, faces -z

  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.78), matGun);
  barrel.position.set(0, 0, -0.3);
  gun.add(barrel);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.2), matGun);
  stock.position.set(0, -0.03, 0.12);
  gun.add(stock);
  gun.position.set(0.18, 1.24, -0.18);
  group.add(gun);

  return { group, head, torso, gun };
}

// Place a soldier mesh from its body state; dead actors tip over and sink.
export function syncSoldier(mesh, body, dead, sinkT) {
  mesh.group.position.set(body.pos.x, body.pos.y - (dead ? sinkT : 0), body.pos.z);
  // the model's front (gun, helmet brim) is its local -z; with rotation.y = yaw
  // that maps to the actor's forward (-sin yaw, -cos yaw), same as the camera.
  mesh.group.rotation.set(0, body.yaw, 0);
  if (dead) {
    mesh.group.rotation.x = -Math.PI / 2 + 0.06;
    mesh.group.position.y = 0.16 - sinkT;
  }
  // the gun pitches with the aim; the head follows a touch behind
  mesh.gun.rotation.x = body.pitch;
  mesh.head.rotation.x = clamp(body.pitch, -0.5, 0.5);
}
