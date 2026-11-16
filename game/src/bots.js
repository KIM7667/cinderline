// The bot brain: perception on a staggered tick (sight through the world's
// own sight-blockers and smoke, hearing from gunfire), a memory of last-seen
// positions, A* travel over the yard's waypoint graph, and role behaviour —
// Wardens hold the sites and converge on a planted charge to defuse it,
// Striker teammates push the called site and hold it once the charge is down.
// In a fight a bot turns at a human rate, lets its aim settle, and fires in
// bursts through the same combat code the player uses.
import { stepBody } from './actor.js';
import { angleDelta, clamp } from './rng.js';
import { tryFire, startReload, finishReload, spreadFor, chestOf } from './combat.js';

const PERCEIVE_MS = 120;
const SIGHT_RANGE = 58;
const HEAR_RANGE = 21;

export function createBrain(role, post) {
  return {
    role, // 'hold' for Wardens, 'push' for Striker teammates
    post, // {x, z} the position this bot defends or rallies to
    path: [],
    pathIdx: 0,
    repathAt: 0,
    goalKey: '',
    nextPerceiveAt: Math.random() * PERCEIVE_MS,
    visible: null, // actor currently seen
    seenAt: new Map(), // enemy id -> {x, z, at}
    aimSince: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    strafeDir: 1,
    strafeUntil: 0,
    alertPos: null,
    alertAt: 0,
    blindUntil: 0,
    wantsDefuse: false,
    settleCrouch: false,
  };
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const node of nodes) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = node.id;
    }
  }
  return best;
}

// A* over the waypoint graph; returns the node ids to walk, start excluded.
function findPath(nodes, fromId, toId) {
  if (fromId === toId) return [toId];
  const open = new Map([[fromId, 0]]);
  const came = new Map();
  const cost = new Map([[fromId, 0]]);
  const target = nodes[toId];
  const heuristic = (id) => Math.hypot(nodes[id].x - target.x, nodes[id].z - target.z);
  while (open.size) {
    let current = null;
    let bestScore = Infinity;
    for (const [id, g] of open) {
      const f = g + heuristic(id);
      if (f < bestScore) {
        bestScore = f;
        current = id;
      }
    }
    if (current === toId) {
      const path = [current];
      let step = current;
      while (came.has(step)) {
        step = came.get(step);
        path.unshift(step);
      }
      path.shift();
      return path;
    }
    open.delete(current);
    for (const next of nodes[current].edges) {
      const stepCost = Math.hypot(nodes[next].x - nodes[current].x, nodes[next].z - nodes[current].z);
      const g = cost.get(current) + stepCost;
      if (g < (cost.get(next) ?? Infinity)) {
        cost.set(next, g);
        came.set(next, current);
        open.set(next, g);
      }
    }
  }
  return [toId];
}

function canSee(world, fx, from, toActor) {
  const dx = toActor.body.pos.x - from.body.pos.x;
  const dz = toActor.body.pos.z - from.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SIGHT_RANGE) return false;
  // facing: a bot sees a 200-degree cone, plus anything very close
  if (dist > 4) {
    const fx2 = -Math.sin(from.body.yaw);
    const fz2 = -Math.cos(from.body.yaw);
    const dot = (dx / dist) * fx2 + (dz / dist) * fz2;
    if (dot < -0.35) return false;
  }
  const eyeY = from.body.pos.y + from.body.eye;
  const targetY = toActor.body.pos.y + 1.15;
  if (world.segmentBlocked(from.body.pos.x, eyeY, from.body.pos.z, toActor.body.pos.x, targetY, toActor.body.pos.z)) return false;
  // smoke: a cloud whose sphere crosses the sight line blocks it
  for (const s of fx.smokes) {
    const t = clamp(((s.x - from.body.pos.x) * dx + (s.z - from.body.pos.z) * dz) / (dist * dist || 1), 0, 1);
    const px = from.body.pos.x + dx * t;
    const pz = from.body.pos.z + dz * t;
    if (Math.hypot(px - s.x, pz - s.z) < s.r * 0.85) return false;
  }
  return true;
}

function perceive(actor, ctx, now) {
  const brain = actor.brain;
  brain.visible = null;
  let bestDist = Infinity;
  for (const other of ctx.actors) {
    if (!other.alive || other.team === actor.team) continue;
    if (canSee(ctx.world, ctx.fx, actor, other)) {
      brain.seenAt.set(other.id, { x: other.body.pos.x, z: other.body.pos.z, at: now });
      const d = Math.hypot(other.body.pos.x - actor.body.pos.x, other.body.pos.z - actor.body.pos.z);
      if (d < bestDist) {
        bestDist = d;
        brain.visible = other;
      }
    }
  }
  if (brain.visible) {
    if (brain.aimTarget !== brain.visible.id) {
      brain.aimTarget = brain.visible.id;
      brain.aimSince = now;
    }
  } else {
    brain.aimTarget = null;
  }
}

// Gunfire and explosions are information: enemies within earshot turn toward
// the noise. Called by the main loop for every combat event.
export function notifyNoise(actors, pos, now, radius = HEAR_RANGE) {
  for (const actor of actors) {
    if (!actor.alive || actor.isPlayer || !actor.brain) continue;
    const d = Math.hypot(actor.body.pos.x - pos.x, actor.body.pos.z - pos.z);
    if (d < radius) {
      actor.brain.alertPos = { x: pos.x, z: pos.z };
      actor.brain.alertAt = now;
    }
  }
}

// A flash blinds actors looking toward it with a clear line to it.
export function applyFlash(actors, world, pos, radius, now) {
  for (const actor of actors) {
    if (!actor.alive) continue;
    const dx = pos.x - actor.body.pos.x;
    const dz = pos.z - actor.body.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius) continue;
    const fx2 = -Math.sin(actor.body.yaw);
    const fz2 = -Math.cos(actor.body.yaw);
    const dot = dist > 0.5 ? (dx / dist) * fx2 + (dz / dist) * fz2 : 1;
    if (dot < 0.15) continue;
    if (world.segmentBlocked(actor.body.pos.x, actor.body.pos.y + actor.body.eye, actor.body.pos.z, pos.x, pos.y, pos.z)) continue;
    const strength = (1 - dist / radius) * (0.4 + dot * 0.6);
    if (actor.brain) actor.brain.blindUntil = now + 900 + strength * 2400;
    if (actor.isPlayer && ctxFlashHook) ctxFlashHook(strength);
  }
}
let ctxFlashHook = null;
export function setFlashHook(fn) {
  ctxFlashHook = fn;
}

function moveAlong(actor, ctx, goal, speed, dt, now) {
  const brain = actor.brain;
  const goalKey = `${goal.x.toFixed(1)},${goal.z.toFixed(1)}`;
  if (brain.goalKey !== goalKey || now > brain.repathAt) {
    brain.goalKey = goalKey;
    brain.repathAt = now + 1600;
    const from = nearestNode(ctx.world.nodes, actor.body.pos.x, actor.body.pos.z);
    const to = nearestNode(ctx.world.nodes, goal.x, goal.z);
    brain.path = findPath(ctx.world.nodes, from, to);
    brain.pathIdx = 0;
  }
  let tx = goal.x;
  let tz = goal.z;
  if (brain.pathIdx < brain.path.length) {
    const node = ctx.world.nodes[brain.path[brain.pathIdx]];
    tx = node.x;
    tz = node.z;
    if (Math.hypot(tx - actor.body.pos.x, tz - actor.body.pos.z) < 1.4) {
      brain.pathIdx += 1;
      if (brain.pathIdx < brain.path.length) {
        const next = ctx.world.nodes[brain.path[brain.pathIdx]];
        tx = next.x;
        tz = next.z;
      }
    }
  }
  return stepToward(actor, tx, tz, speed, dt);
}

function stepToward(actor, tx, tz, speed, dt) {
  const dx = tx - actor.body.pos.x;
  const dz = tz - actor.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.25) {
    stepBody(actor.body, actor.colliders, { x: 0, z: 0 }, 0, false, dt);
    return true;
  }
  const wish = { x: dx / dist, z: dz / dist };
  // face the walk direction when not fighting
  if (!actor.brain.visible) turnToward(actor, Math.atan2(-dx, -dz), 6, dt);
  stepBody(actor.body, actor.colliders, wish, speed, false, dt);
  return false;
}

function turnToward(actor, targetYaw, rate, dt) {
  const delta = angleDelta(actor.body.yaw, targetYaw);
  const maxTurn = rate * dt;
  actor.body.yaw += clamp(delta, -maxTurn, maxTurn);
  return Math.abs(delta) < 0.05;
}

function engage(actor, ctx, now, dt) {
  const brain = actor.brain;
  const target = brain.visible;
  const dx = target.body.pos.x - actor.body.pos.x;
  const dz = target.body.pos.z - actor.body.pos.z;
  const dist = Math.hypot(dx, dz);
  const desiredYaw = Math.atan2(-dx, -dz);
  turnToward(actor, desiredYaw, 3.6, dt);
  const dy = target.body.pos.y + 1.12 - (actor.body.pos.y + actor.body.eye);
  actor.body.pitch = clamp(Math.atan2(dy, dist), -0.6, 0.6);

  // movement in a fight: close the distance when far, strafe in the mid band,
  // hold and crouch when set — stopping to shoot is what the game rewards
  let wish = { x: 0, z: 0 };
  let speed = 0;
  if (now > brain.strafeUntil) {
    brain.strafeDir = ctx.random() < 0.5 ? -1 : 1;
    brain.strafeUntil = now + 650 + ctx.random() * 800;
  }
  if (dist > 27) {
    wish = { x: dx / dist, z: dz / dist };
    speed = 4.1;
  } else if (dist > 7) {
    wish = { x: (-dz / dist) * brain.strafeDir, z: (dx / dist) * brain.strafeDir };
    speed = 2.0;
  }
  actor.body.crouch = dist > 16 && actor.team === 'defend' && speed === 0 ? brain.settleCrouch : false;
  stepBody(actor.body, actor.colliders, wish, speed, false, dt);

  // fire control: reaction delay, then bursts with pauses
  const weaponState = actor.weapons[actor.current];
  if (!weaponState) return;
  if (weaponState.mag === 0) {
    startReload(actor, weaponState, now, ctx);
    return;
  }
  if (now < brain.aimSince + 300) return; // reaction time
  if (brain.burstLeft <= 0) {
    if (now < brain.nextBurstAt) return;
    brain.burstLeft = 3 + Math.floor(ctx.random() * 3);
  }
  const aimTime = clamp((now - brain.aimSince) / 1300, 0, 1);
  const err = (1 - aimTime) * 0.42 + 0.05;
  const aimPoint = chestOf(target);
  if (dist < 15 && ctx.random() < 0.2) aimPoint.y = target.body.pos.y + 1.56;
  aimPoint.x += (ctx.random() * 2 - 1) * err;
  aimPoint.y += (ctx.random() * 2 - 1) * err * 0.6;
  aimPoint.z += (ctx.random() * 2 - 1) * err;
  const origin = { x: actor.body.pos.x, y: actor.body.pos.y + actor.body.eye, z: actor.body.pos.z };
  const dir = {
    x: aimPoint.x - origin.x,
    y: aimPoint.y - origin.y,
    z: aimPoint.z - origin.z,
  };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len; dir.y /= len; dir.z /= len;
  const spread = spreadFor(weaponState, actor.body.speed2d, actor.body.grounded, actor.body.crouch);
  if (tryFire(actor, weaponState, origin, dir, spread * 0.6, now, ctx)) {
    brain.burstLeft -= 1;
    if (brain.burstLeft <= 0) brain.nextBurstAt = now + 320 + ctx.random() * 420;
  }
}

export function stepBot(actor, ctx, dt) {
  const brain = actor.brain;
  const now = performance.now();
  if (!actor.alive) return;
  actor.colliders = ctx.world.colliders;

  // reloads finish on their own clock
  for (const slot of ['primary', 'sidearm']) {
    const ws = actor.weapons[slot];
    if (ws && ws.reloadingUntil && now >= ws.reloadingUntil) finishReload(ws);
  }
  if (now >= brain.nextPerceiveAt) {
    brain.nextPerceiveAt = now + PERCEIVE_MS;
    if (now >= brain.blindUntil) perceive(actor, ctx, now);
    else brain.visible = null;
  }

  const match = ctx.match;
  brain.wantsDefuse = false;
  if (match.phase !== 'live' && match.phase !== 'planted') {
    stepBody(actor.body, actor.colliders, { x: 0, z: 0 }, 0, false, dt);
    return;
  }
  if (brain.visible) {
    engage(actor, ctx, now, dt);
    return;
  }
  actor.body.crouch = false;

  // no visible enemy: work the role
  let goal = brain.post;
  let speed = 4.3;
  if (match.planted) {
    const charge = match.planted;
    if (actor.team === 'defend') {
      goal = { x: charge.x, z: charge.z };
      const d = Math.hypot(goal.x - actor.body.pos.x, goal.z - actor.body.pos.z);
      if (d < 1.7) {
        brain.wantsDefuse = true;
        stepBody(actor.body, actor.colliders, { x: 0, z: 0 }, 0, false, dt);
        turnToward(actor, Math.atan2(-(goal.x - actor.body.pos.x), -(goal.z - actor.body.pos.z)), 4, dt);
        return;
      }
    } else {
      // Striker teammates guard the planted charge from their posts
      goal = brain.post;
    }
  } else if (brain.alertPos && now - brain.alertAt < 6000) {
    goal = brain.alertPos;
    speed = 4.5;
  } else if (actor.team === 'attack') {
    goal = brain.post; // the push target near the called site, set by rounds
  }
  const arrived = moveAlong(actor, ctx, goal, speed, dt, now);
  if (arrived && actor.team === 'defend') {
    // settle at the post: slow scan across the likely approach
    brain.scanPhase = (brain.scanPhase || 0) + dt * 0.35;
    actor.body.yaw = brain.postYaw + Math.sin(brain.scanPhase) * 0.55;
    actor.body.crouch = brain.settleCrouch;
  }
}
