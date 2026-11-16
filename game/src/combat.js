// Combat resolution shared by the player and the bots: hitscan fire with
// spread, recoil bloom and damage falloff; grenades as small simulated
// projectiles; and damage application with armour and head multipliers.
// Events (hit, kill, shot fired, grenade out, explosion) go through
// ctx.onEvent so the HUD, the round logic and bot hearing all hear the same
// facts the simulation produced.
import * as THREE from 'three';
import { damageAt, ARMOR_FACTOR } from './weapons.js';
import { clamp } from './rng.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();

export function eyeOf(actor) {
  return _target.set(actor.body.pos.x, actor.body.pos.y + actor.body.eye, actor.body.pos.z);
}

export function chestOf(actor) {
  return new THREE.Vector3(actor.body.pos.x, actor.body.pos.y + 1.05, actor.body.pos.z);
}

// Fire one pellet of a hitscan weapon. `dir` is the shooter's exact aim;
// spread (radians) is applied here from the weapon, the shooter's movement
// and the weapon's bloom, so player and bot fire obey identical rules.
export function firePellet(shooter, weaponState, origin, dir, spreadRad, ctx) {
  const def = weaponState.def;
  const spread = spreadRad + weaponState.bloom;
  _dir.copy(dir);
  _dir.x += (ctx.random() * 2 - 1) * spread;
  _dir.y += (ctx.random() * 2 - 1) * spread;
  _dir.z += (ctx.random() * 2 - 1) * spread;
  _dir.normalize();
  ctx.raycaster.set(origin, _dir);
  ctx.raycaster.far = 120;
  const hits = ctx.raycaster.intersectObjects(ctx.hitMeshes, false);
  // the first hit that is not the shooter's own body and not a corpse:
  // your own hitbox sits at the ray's origin and must never eat the bullet
  let hit = null;
  for (const candidate of hits) {
    const owner = candidate.object.userData.actor;
    if (owner === shooter) continue;
    if (owner && !owner.alive) continue;
    hit = candidate;
    break;
  }
  let end = null;
  if (hit) {
    end = hit.point;
    const target = hit.object.userData.actor;
    if (target && target.alive && target !== shooter) {
      const part = hit.object.userData.part || 'body';
      let dmg = damageAt(def, hit.distance);
      if (part === 'head') dmg *= def.headMult;
      applyDamage(target, dmg, part, shooter, ctx);
      ctx.fx.sparks(hit.point, 0xd84a3a, part === 'head' ? 10 : 6, 2.6);
    } else {
      ctx.fx.sparks(hit.point, 0xffc37a, 5, 2.4);
    }
  } else {
    end = _origin.copy(origin).addScaledVector(_dir, 90);
  }
  ctx.fx.tracer(origin, end);
  return hit;
}

// One trigger pull: consumes a round, fires every pellet, kicks bloom and
// recoil, plays the sound, and tells the world a shot was fired (bots hear
// it). Returns false when the weapon cannot fire (empty, reloading, too soon).
export function tryFire(shooter, weaponState, origin, dir, spreadRad, now, ctx) {
  const def = weaponState.def;
  if (now < weaponState.nextShotAt || now < weaponState.reloadingUntil) return false;
  if (weaponState.mag <= 0) {
    ctx.audio.dryFire();
    weaponState.nextShotAt = now + 300;
    startReload(shooter, weaponState, now, ctx);
    return false;
  }
  weaponState.mag -= 1;
  weaponState.nextShotAt = now + 60000 / def.rpm;
  weaponState.bloom = Math.min(0.028, weaponState.bloom + 0.004);
  for (let p = 0; p < def.pellets; p += 1) {
    firePellet(shooter, weaponState, origin, dir, spreadRad, ctx);
  }
  if (!shooter.isPlayer) {
    // a bot's flash sits at its gun; the player's is placed by main at the
    // view model's muzzle, which is offset from the eye
    _muzzleWorld.set(origin.x + dir.x * 0.6, origin.y - 0.12, origin.z + dir.z * 0.6);
    ctx.fx.muzzle(_muzzleWorld, def.kind === 'shotgun' ? 1.4 : 0.9);
  }
  ctx.audio.shot(def.kind);
  ctx.onEvent({ type: 'shot', actor: shooter, pos: { x: origin.x, z: origin.z } });
  return true;
}

export function startReload(shooter, weaponState, now, ctx) {
  if (weaponState.mag >= weaponState.def.mag || weaponState.reserve <= 0) return false;
  if (now < weaponState.reloadingUntil) return false;
  weaponState.reloadingUntil = now + weaponState.def.reloadMs;
  ctx.audio.reload();
  return true;
}

export function finishReload(weaponState) {
  const take = Math.min(weaponState.def.mag - weaponState.mag, weaponState.reserve);
  weaponState.mag += take;
  weaponState.reserve -= take;
  weaponState.reloadingUntil = 0;
}

// Damage with armour: armour halves the blow (ARMOR_FACTOR) on every part,
// the helmet included. Death is reported once, with the part that did it.
export function applyDamage(target, amount, part, attacker, ctx) {
  if (!target.alive) return;
  const final = target.armor ? amount * ARMOR_FACTOR : amount;
  target.health -= final;
  ctx.onEvent({ type: 'damage', target, attacker, amount: final, part });
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.diedAt = performance.now();
    ctx.onEvent({ type: 'kill', target, attacker, part });
  }
}

// ---- grenades ---------------------------------------------------------------
// A thrown grenade is a point with velocity and gravity that bounces off the
// ground and the yard's boxes (axis reflection against the AABB it entered).
// On its fuse it becomes its effect: frag damage with a sight check, a flash
// that blinds whoever looks at it, or a smoke cloud that blocks sight lines.
export function throwGrenade(actor, kind, def, origin, dir, ctx) {
  const mesh = ctx.fx.grenadeMesh(kind);
  mesh.position.copy(origin);
  ctx.scene.add(mesh);
  const vel = dir.clone().multiplyScalar(13);
  vel.y += 3.2;
  const grenade = {
    kind, def, mesh, vel,
    pos: mesh.position,
    fuseAt: performance.now() + def.fuseMs,
    owner: actor,
    done: false,
  };
  ctx.grenades.push(grenade);
  ctx.audio.throwWhoosh();
  ctx.onEvent({ type: 'grenade', actor, kind });
  return grenade;
}

function bounce(grenade, colliders, dt) {
  const p = grenade.pos;
  grenade.vel.y -= 16 * dt;
  p.x += grenade.vel.x * dt;
  p.y += grenade.vel.y * dt;
  p.z += grenade.vel.z * dt;
  if (p.y < 0.09) {
    p.y = 0.09;
    grenade.vel.y = Math.abs(grenade.vel.y) * 0.35;
    grenade.vel.x *= 0.7;
    grenade.vel.z *= 0.7;
    if (Math.abs(grenade.vel.y) < 0.8) grenade.vel.y = 0;
  }
  for (const c of colliders) {
    if (p.x > c.minX - 0.09 && p.x < c.maxX + 0.09 && p.z > c.minZ - 0.09 && p.z < c.maxZ + 0.09 && p.y > c.minY && p.y < c.maxY + 0.09) {
      // entered a box: push out along the smallest penetration axis
      const dxl = p.x - (c.minX - 0.09);
      const dxr = (c.maxX + 0.09) - p.x;
      const dzl = p.z - (c.minZ - 0.09);
      const dzr = (c.maxZ + 0.09) - p.z;
      const min = Math.min(dxl, dxr, dzl, dzr);
      if (min === dxl) { p.x = c.minX - 0.09; grenade.vel.x = -Math.abs(grenade.vel.x) * 0.4; }
      else if (min === dxr) { p.x = c.maxX + 0.09; grenade.vel.x = Math.abs(grenade.vel.x) * 0.4; }
      else if (min === dzl) { p.z = c.minZ - 0.09; grenade.vel.z = -Math.abs(grenade.vel.z) * 0.4; }
      else { p.z = c.maxZ + 0.09; grenade.vel.z = Math.abs(grenade.vel.z) * 0.4; }
    }
  }
}

function detonate(grenade, ctx) {
  const { kind, def, pos } = grenade;
  ctx.scene.remove(grenade.mesh);
  if (kind === 'frag') {
    ctx.fx.explosion(pos);
    ctx.audio.frag();
    for (const actor of ctx.actors) {
      if (!actor.alive) continue;
      const dx = actor.body.pos.x - pos.x;
      const dz = actor.body.pos.z - pos.z;
      const dy = actor.body.pos.y + 0.9 - pos.y;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > def.radius) continue;
      // cover counts: a wall between the blast and the body negates it
      if (ctx.world.segmentBlocked(pos.x, pos.y + 0.2, pos.z, actor.body.pos.x, actor.body.pos.y + 0.9, actor.body.pos.z)) continue;
      const dmg = def.damage * (1 - dist / (def.radius * 1.25));
      if (dmg > 1) applyDamage(actor, dmg, 'body', grenade.owner, ctx);
    }
    ctx.onEvent({ type: 'explosion', pos: { x: pos.x, z: pos.z }, big: false });
  } else if (kind === 'flash') {
    ctx.fx.flashBang(pos);
    ctx.audio.flash();
    ctx.onEvent({ type: 'flash', pos: { x: pos.x, y: pos.y, z: pos.z }, radius: def.radius });
  } else if (kind === 'smoke') {
    ctx.fx.smokeCloud(new THREE.Vector3(pos.x, 1.1, pos.z), def.radius, def.lifeMs);
    ctx.audio.smoke();
  }
}

export function stepGrenades(ctx, dt) {
  const now = performance.now();
  for (const grenade of ctx.grenades) {
    if (grenade.done) continue;
    bounce(grenade, ctx.world.colliders, dt);
    if (now >= grenade.fuseAt) {
      grenade.done = true;
      detonate(grenade, ctx);
    }
  }
  for (let i = ctx.grenades.length - 1; i >= 0; i -= 1) {
    if (ctx.grenades[i].done) ctx.grenades.splice(i, 1);
  }
}

// Spread in radians for a shooter right now: weapon base, worse on the move
// or airborne, better crouched. Bots pass their own numbers; the player path
// and the bot path share this so the rules are visibly the same.
export function spreadFor(weaponState, speed2d, grounded, crouch) {
  const def = weaponState.def;
  const moveT = clamp(speed2d / 4.5, 0, 1);
  let deg = def.spreadDeg + (def.moveSpreadDeg - def.spreadDeg) * moveT;
  if (!grounded) deg += 2.2;
  if (crouch) deg *= 0.62;
  return (deg * Math.PI) / 180;
}
