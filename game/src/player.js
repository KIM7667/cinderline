// The player's hands and eyes: mouse look with a separate recoil offset that
// recovers on its own clock, WASD movement through the shared body, a view
// model per weapon, the DMR's zoom, and a touch of head-bob. The body the
// world sees (actor.body) is the same one bots use — bots read its yaw to
// know where the player is looking, so look writes through to it every step.
import * as THREE from 'three';
import { stepBody } from './actor.js';
import { buildViewModel } from './weapons.js';
import { clamp, lerp } from './rng.js';

const SENS = 0.0021;
const PITCH_MAX = 1.45;

export function createPlayerController(actor, camera, scene) {
  const viewModels = new Map(); // weapon id -> {group, muzzle}
  let viewPitch = 0;
  let recoilPitch = 0;
  let recoilYaw = 0;
  let bobPhase = 0;
  let bobAmount = 0;
  let currentDef = null;
  let grenadeHand = null;
  let fov = 74;

  camera.rotation.order = 'YXZ';

  function showWeapon(def) {
    for (const vm of viewModels.values()) vm.group.visible = false;
    if (grenadeHand) grenadeHand.visible = false;
    currentDef = def;
    if (!def) return null;
    if (!viewModels.has(def.id)) {
      const vm = buildViewModel(def);
      camera.add(vm.group);
      viewModels.set(def.id, vm);
    }
    const vm = viewModels.get(def.id);
    vm.group.visible = true;
    return vm;
  }

  function showGrenade(kind) {
    for (const vm of viewModels.values()) vm.group.visible = false;
    if (!grenadeHand) {
      const color = kind === 'frag' ? 0x4a5548 : kind === 'flash' ? 0xd8d8d8 : 0x707880;
      grenadeHand = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 10, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }),
      );
      grenadeHand.position.set(0.22, -0.18, -0.4);
      camera.add(grenadeHand);
    }
    grenadeHand.visible = true;
    currentDef = null;
  }

  function look(dx, dy) {
    actor.body.yaw -= dx * SENS;
    viewPitch = clamp(viewPitch - dy * SENS, -PITCH_MAX, PITCH_MAX);
  }

  function kick(pitchAmount, yawAmount) {
    recoilPitch += pitchAmount;
    recoilYaw += yawAmount;
  }

  // One fixed step of movement + one frame of camera work. Movement runs on
  // the fixed clock; the camera sync runs per render frame from main.
  function stepMovement(dt, keys, colliders, canMove) {
    const body = actor.body;
    body.crouch = keys.has('ControlLeft') || keys.has('KeyC');
    const sprint = keys.has('ShiftLeft') && !body.crouch;
    let fx = 0;
    let fz = 0;
    if (canMove) {
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    // forward (-z when yaw=0) is (-sin, -cos); right is (cos, -sin)
    const wish = {
      x: (-sin * -fz + cos * fx) / len * (fx || fz ? 1 : 0),
      z: (-cos * -fz + -sin * fx) / len * (fx || fz ? 1 : 0),
    };
    if (!fx && !fz) { wish.x = 0; wish.z = 0; }
    const topSpeed = body.crouch ? 2.2 : sprint && fz < 0 ? 5.6 : 4.5;
    stepBody(body, colliders, wish, topSpeed, canMove && keys.has('Space'), dt);

    // recoil recovers toward zero; the view pitch the world sees includes it
    recoilPitch = lerp(recoilPitch, 0, 1 - Math.exp(-9 * dt));
    recoilYaw = lerp(recoilYaw, 0, 1 - Math.exp(-9 * dt));
    body.pitch = clamp(viewPitch + recoilPitch, -PITCH_MAX, PITCH_MAX);
    bobPhase += body.speed2d * dt * 1.6;
    bobAmount = lerp(bobAmount, body.grounded ? clamp(body.speed2d / 5, 0, 1) : 0, 1 - Math.exp(-8 * dt));
  }

  function syncCamera(aiming) {
    const body = actor.body;
    const bobY = Math.sin(bobPhase * 2) * 0.028 * bobAmount;
    camera.position.set(body.pos.x, body.pos.y + body.eye + bobY, body.pos.z);
    camera.rotation.set(body.pitch, body.yaw + recoilYaw, 0);
    const targetFov = aiming && currentDef ? 74 / currentDef.zoom : 74;
    fov = lerp(fov, targetFov, 0.35);
    if (Math.abs(fov - camera.fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // the view model breathes with the bob and slides when the trigger kicks
    const vm = currentDef ? viewModels.get(currentDef.id) : null;
    if (vm) {
      vm.group.position.y = -0.22 + Math.sin(bobPhase * 2) * 0.006 * bobAmount;
      vm.group.position.z = -0.45 + clamp(recoilPitch * 1.4, 0, 0.09);
    }
  }

  function muzzleWorld(out) {
    const vm = currentDef ? viewModels.get(currentDef.id) : null;
    if (vm) return vm.muzzle.getWorldPosition(out);
    return out.set(actor.body.pos.x, actor.body.pos.y + actor.body.eye, actor.body.pos.z);
  }

  function aimAt(point) {
    const body = actor.body;
    const dx = point.x - body.pos.x;
    const dy = point.y - (body.pos.y + body.eye);
    const dz = point.z - body.pos.z;
    body.yaw = Math.atan2(-dx, -dz);
    viewPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_MAX, PITCH_MAX);
    recoilPitch = 0;
    recoilYaw = 0;
    body.pitch = viewPitch;
  }

  return {
    showWeapon,
    showGrenade,
    look,
    kick,
    stepMovement,
    syncCamera,
    muzzleWorld,
    aimAt,
    get viewPitch() { return viewPitch; },
    set viewPitch(v) { viewPitch = v; },
  };
}
