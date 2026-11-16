// The match: first to 7 rounds, at most 13. Each round is buy (12 s) → live
// (100 s) → maybe planted (35 s fuse) → round end (5 s). The Strikers win a
// round by eliminating the Wardens or detonating the breach charge on a
// site; the Wardens win by elimination, by the clock, or by defusing.
// Economy is Counter-Strike-shaped: kills pay the killer, wins pay the team,
// losers still get paid enough to force the next buy decision.
import { WEAPONS, GRENADES, ARMOR_PRICE, createWeaponState } from './weapons.js';
import { createBody } from './actor.js';
import { createBrain } from './bots.js';

export const ROUNDS_TO_WIN = 7;
export const MAX_ROUNDS = 13;
const BUY_MS = 12000;
const ROUND_MS = 100000;
const FUSE_MS = 35000;
const PLANT_MS = 3200;
const DEFUSE_MS = 5000;
const END_MS = 5200;

const WIN_PAY = 2800;
const LOSE_PAY = 1900;
const PLANT_PAY = 300;

export function createMatch() {
  return {
    phase: 'buy',
    round: 0,
    score: { attack: 0, defend: 0 },
    phaseEndsAt: 0,
    targetSite: 'A',
    planted: null, // {site, x, z, detonatesAt, handle}
    planting: null, // {actor, until}
    defusing: null, // {actor, until}
    lastBeepAt: 0,
    over: false,
    winner: null,
    endReason: '',
  };
}

function giveBotKit(actor, round) {
  actor.weapons.sidearm = createWeaponState(WEAPONS.wasp);
  if (round === 1) {
    actor.weapons.primary = null;
    actor.armor = false;
  } else {
    const primaries = ['longline', 'ratter', 'longline', 'mule'];
    actor.weapons.primary = createWeaponState(WEAPONS[primaries[actor.id % primaries.length]]);
    actor.armor = round >= 3;
  }
  actor.current = actor.weapons.primary ? 'primary' : 'sidearm';
  actor.grenades = { frag: 0, flash: actor.id % 2 === 0 ? 1 : 0, smoke: 0 };
}

// Defender posts watch the site doors; Striker posts stage at the called
// site's edge, so teammates push in and then hold angles around the plant.
function assignPosts(ctx) {
  const { world, actors, match, random } = ctx;
  const site = world.sites[match.targetSite];
  const other = world.sites[match.targetSite === 'A' ? 'B' : 'A'];
  const defendPosts = {
    A: [{ x: -24, z: -31, yaw: 2.6 }, { x: -34.5, z: -21.5, yaw: -0.7 }],
    B: [{ x: 24, z: -31, yaw: -2.6 }, { x: 34, z: -25.5, yaw: 0.7 }],
  };
  let aIdx = 0;
  let bIdx = 0;
  for (const actor of actors) {
    if (actor.isPlayer) continue;
    if (actor.team === 'defend') {
      const mine = actor.homeSite === match.targetSite;
      const post = mine
        ? defendPosts[match.targetSite][aIdx++ % 2]
        : defendPosts[match.targetSite === 'A' ? 'B' : 'A'][bIdx++ % 2];
      actor.brain = createBrain('hold', { x: post.x, z: post.z });
      actor.brain.postYaw = post.yaw;
      actor.brain.settleCrouch = actor.id % 2 === 0;
    } else {
      const jitter = (random() - 0.5) * 5;
      actor.brain = createBrain('push', { x: site.x + jitter, z: site.z + 3 + (random() - 0.5) * 4 });
      actor.brain.postYaw = Math.PI;
    }
  }
  void other;
}

export function startMatch(ctx) {
  const { match, actors } = ctx;
  match.score.attack = 0;
  match.score.defend = 0;
  match.round = 0;
  match.over = false;
  match.winner = null;
  for (const actor of actors) {
    actor.money = 800;
    actor.weapons.primary = null;
    actor.armor = false;
    actor.grenades = { frag: 0, flash: 0, smoke: 0 };
    actor.kills = 0;
    actor.deaths = 0;
  }
  startRound(ctx);
}

export function startRound(ctx) {
  const { match, actors, world, random } = ctx;
  match.round += 1;
  match.phase = 'buy';
  match.phaseEndsAt = performance.now() + BUY_MS;
  match.targetSite = random() < 0.5 ? 'A' : 'B';
  if (match.planted) ctx.scene.remove(match.planted.handle.group);
  match.planted = null;
  match.planting = null;
  match.defusing = null;
  ctx.grenades.length = 0;

  let ai = 0;
  let di = 0;
  for (const actor of actors) {
    const spawn = actor.team === 'attack' ? world.spawns.attack[ai++] : world.spawns.defend[di++];
    actor.body = createBody(spawn.x, spawn.z, spawn.yaw);
    actor.health = 100;
    actor.alive = true;
    actor.diedAt = 0;
    actor.hasCharge = false;
    if (actor.isPlayer) {
      actor.hasCharge = true;
      if (!actor.weapons.sidearm) actor.weapons.sidearm = createWeaponState(WEAPONS.wasp);
      if (actor.current === 'primary' && !actor.weapons.primary) actor.current = 'sidearm';
      // a dead player's kit is gone: fresh sidearm, no armour (set in endRound)
    } else {
      actor.homeSite = actor.id % 2 === 0 ? 'A' : 'B';
      giveBotKit(actor, match.round);
    }
    if (actor.mesh) actor.mesh.group.visible = true;
  }
  assignPosts(ctx);
  ctx.announce(`Round ${match.round}`, `Plant the charge at site ${match.targetSite} — or stop the push. Buy with B.`);
}

// One purchase for the player during the buy phase. Returns a message for
// the HUD either way; the caller plays the sound.
export function buy(ctx, itemId) {
  const { match, player } = ctx;
  if (match.phase !== 'buy') return { ok: false, msg: 'Buy phase is over' };
  if (itemId === 'armor') {
    if (player.armor) return { ok: false, msg: 'Armour already worn' };
    if (player.money < ARMOR_PRICE) return { ok: false, msg: 'Not enough money' };
    player.money -= ARMOR_PRICE;
    player.armor = true;
    return { ok: true, msg: 'Armour vest equipped' };
  }
  if (GRENADES[itemId]) {
    const def = GRENADES[itemId];
    if (player.grenades[itemId] >= 1) return { ok: false, msg: `Already carrying a ${def.name}` };
    if (player.money < def.price) return { ok: false, msg: 'Not enough money' };
    player.money -= def.price;
    player.grenades[itemId] += 1;
    return { ok: true, msg: `${def.name} in pocket` };
  }
  const def = WEAPONS[itemId];
  if (!def) return { ok: false, msg: 'Unknown item' };
  if (player.money < def.price) return { ok: false, msg: 'Not enough money' };
  player.money -= def.price;
  player.weapons[def.slot] = createWeaponState(def);
  player.current = def.slot;
  return { ok: true, msg: `${def.name} bought` };
}

function teamAlive(actors, team) {
  let n = 0;
  for (const a of actors) if (a.team === team && a.alive) n += 1;
  return n;
}

function endRound(ctx, winner, reason) {
  const { match, actors, audio } = ctx;
  match.phase = 'roundEnd';
  match.phaseEndsAt = performance.now() + END_MS;
  match.endReason = reason;
  match.score[winner] += 1;
  for (const actor of actors) {
    if (actor.team === winner) actor.money += WIN_PAY;
    else actor.money += LOSE_PAY;
    if (!actor.alive) {
      actor.weapons.primary = null;
      actor.armor = false;
      actor.current = 'sidearm';
      if (actor.weapons.sidearm) {
        actor.weapons.sidearm.mag = actor.weapons.sidearm.def.mag;
        actor.weapons.sidearm.reserve = actor.weapons.sidearm.def.reserve;
      }
    }
  }
  if (match.planted && winner !== 'attack') {
    match.planted.handle.group.visible = false;
  }
  const playerWon = ctx.player.team === winner;
  if (playerWon) audio.roundWin();
  else audio.roundLose();
  ctx.announce(
    winner === 'attack' ? 'Strikers take the round' : 'Wardens take the round',
    reason,
  );
  if (match.score.attack >= ROUNDS_TO_WIN || match.score.defend >= ROUNDS_TO_WIN || match.round >= MAX_ROUNDS) {
    match.over = true;
    match.winner = match.score.attack > match.score.defend ? 'attack' : 'defend';
  }
}

// The plant channel: the carrier (the player) holds the use key inside the
// called site. Bots never carry, so a dead carrier ends the plant threat.
export function updatePlanting(ctx, plantHeld) {
  const { match, player, world } = ctx;
  if (match.phase !== 'live' || !player.alive || !player.hasCharge) {
    match.planting = null;
    return 0;
  }
  const site = world.sites[match.targetSite];
  const inZone = Math.hypot(player.body.pos.x - site.x, player.body.pos.z - site.z) < site.radius;
  if (!inZone || !plantHeld || player.body.speed2d > 0.4) {
    match.planting = null;
    return 0;
  }
  const now = performance.now();
  if (!match.planting) match.planting = { actor: player, until: now + PLANT_MS, startedAt: now };
  if (now >= match.planting.until) {
    completePlant(ctx, site);
    return 0;
  }
  return 1 - (match.planting.until - now) / PLANT_MS;
}

function completePlant(ctx, site) {
  const { player } = ctx;
  plantAt(ctx, site, player.body.pos.x, player.body.pos.z);
  player.hasCharge = false;
  player.money += PLANT_PAY;
  ctx.announce('Charge planted', `${FUSE_MS / 1000} seconds to detonation — Wardens are coming.`);
}

// Shared by the real plant channel and by screenshot staging, which needs a
// planted charge at an exact spot without three seconds of held key.
export function plantAt(ctx, site, x, z) {
  const { match, fx, audio } = ctx;
  match.phase = 'planted';
  match.phaseEndsAt = performance.now() + FUSE_MS;
  const handle = fx.chargeMesh();
  handle.group.position.set(x, 0, z);
  ctx.scene.add(handle.group);
  match.planted = { site: site.id, x, z, detonatesAt: match.phaseEndsAt, handle };
  match.planting = null;
  match.lastBeepAt = 0;
  audio.plantDone();
}

function updateDefusing(ctx) {
  const { match, actors } = ctx;
  if (match.phase !== 'planted') {
    match.defusing = null;
    return 0;
  }
  const now = performance.now();
  let candidate = null;
  for (const actor of actors) {
    if (actor.team === 'defend' && actor.alive && actor.brain && actor.brain.wantsDefuse) {
      candidate = actor;
      break;
    }
  }
  if (!candidate) {
    match.defusing = null;
    return 0;
  }
  if (!match.defusing || match.defusing.actor !== candidate) {
    match.defusing = { actor: candidate, until: now + DEFUSE_MS, startedAt: now };
  }
  if (now >= match.defusing.until) {
    match.planted.handle.group.visible = false;
    endRound(ctx, 'defend', 'The charge was defused.');
    return 0;
  }
  return 1 - (match.defusing.until - now) / DEFUSE_MS;
}

export function updateRounds(ctx, dt) {
  const { match, actors, audio } = ctx;
  const now = performance.now();
  const defuseProgress = updateDefusing(ctx);
  match.defuseProgress = defuseProgress;

  if (match.phase === 'buy') {
    if (now >= match.phaseEndsAt) {
      match.phase = 'live';
      match.phaseEndsAt = now + ROUND_MS;
      ctx.announce(`Site ${match.targetSite}`, 'Move. The clock is running.');
    }
    return;
  }
  if (match.phase === 'live') {
    if (teamAlive(actors, 'defend') === 0) return endRound(ctx, 'attack', 'Wardens eliminated.');
    if (teamAlive(actors, 'attack') === 0) return endRound(ctx, 'defend', 'Strikers eliminated.');
    if (now >= match.phaseEndsAt) return endRound(ctx, 'defend', 'The clock ran out — no plant.');
    return;
  }
  if (match.phase === 'planted') {
    const remain = match.planted.detonatesAt - now;
    // the beeper quickens as the fuse burns down
    const interval = remain < 6000 ? 240 : remain < 15000 ? 500 : 950;
    if (now - match.lastBeepAt > interval) {
      match.lastBeepAt = now;
      audio.beep(remain < 6000);
      match.planted.handle.setPulse(remain < 6000 ? 2.4 : 1.2);
    }
    if (teamAlive(actors, 'defend') === 0) {
      match.planted.handle.group.visible = false;
      return endRound(ctx, 'attack', 'Wardens eliminated.');
    }
    if (remain <= 0) {
      ctx.fx.explosion({ x: match.planted.x, y: 0.4, z: match.planted.z });
      audio.frag();
      match.planted.handle.group.visible = false;
      ctx.onEvent({ type: 'explosion', pos: { x: match.planted.x, z: match.planted.z }, big: true });
      return endRound(ctx, 'attack', 'The charge detonated.');
    }
    return;
  }
  if (match.phase === 'roundEnd') {
    if (now >= match.phaseEndsAt) {
      if (match.over) {
        match.phase = 'matchEnd';
        ctx.announce(
          match.winner === 'attack' ? 'Strikers win the match' : 'Wardens win the match',
          `Final score ${match.score.attack} — ${match.score.defend}. Press Enter to play again.`,
        );
      } else {
        startRound(ctx);
      }
    }
  }
}
