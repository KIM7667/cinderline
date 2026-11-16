// CINDERLINE — boot and the one loop. A fixed 60 Hz simulation (movement,
// bots, grenades, rounds) feeds a render at the display's rate. This file
// owns the shared context every module reads: the world, the actors, the
// match, and the event bus that turns combat facts into HUD, sound and bot
// hearing. It also stages the deterministic ?shot= frames the screenshots
// are taken from, so a screenshot is always the game's own code running.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createFx } from './fx.js';
import { createHud, BUY_KEYS } from './hud.js';
import { WEAPONS, GRENADES, createWeaponState } from './weapons.js';
import { createBody, buildSoldier, syncSoldier } from './actor.js';
import { createPlayerController } from './player.js';
import { createMatch, startMatch, updateRounds, updatePlanting, plantAt, buy } from './rounds.js';
import { stepBot, notifyNoise, applyFlash, setFlashHook } from './bots.js';
import { tryFire, startReload, finishReload, spreadFor, throwGrenade, stepGrenades } from './combat.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = shot ? mulberry32(seed * 7919) : mulberry32((Date.now() % 2147483647) | 0);

// ---- renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// filmic tone mapping is what makes the dusk grade read as a grade instead
// of flat-lit geometry: highlights roll off, the sodium lamps bloom warm
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera); // the view model hangs off the camera

const world = createWorld(scene);
const fx = createFx(scene);
const audio = createAudio();
const hud = createHud();
const match = createMatch();

// ---- actors -------------------------------------------------------------------
const NAMES = {
  attack: ['You', 'Rook', 'Sable', 'Fenn'],
  defend: ['Havoc', 'Mira', 'Talon', 'Ondine'],
};
const actors = [];
function makeActor(id, team, isPlayer) {
  const actor = {
    id,
    team,
    isPlayer,
    name: NAMES[team][id % 4],
    body: createBody(0, 0, 0),
    health: 100,
    armor: false,
    alive: true,
    diedAt: 0,
    weapons: { primary: null, sidearm: createWeaponState(WEAPONS.wasp) },
    current: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    hasCharge: false,
    homeSite: 'A',
    mesh: null,
    brain: null,
  };
  if (!isPlayer) {
    actor.mesh = buildSoldier(team);
    actor.mesh.head.userData.actor = actor;
    actor.mesh.torso.userData.actor = actor;
    scene.add(actor.mesh.group);
  }
  actors.push(actor);
  return actor;
}
const player = makeActor(0, 'attack', true);
makeActor(1, 'attack', false);
makeActor(2, 'attack', false);
makeActor(3, 'attack', false);
makeActor(4, 'defend', false);
makeActor(5, 'defend', false);
makeActor(6, 'defend', false);
makeActor(7, 'defend', false);

// The player has no visible mesh, but bot bullets need something to hit:
// two invisible boxes that track the body (head height follows the crouch).
const playerHit = {};
{
  const mat = new THREE.MeshBasicMaterial();
  playerHit.body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.4), mat);
  playerHit.head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), mat);
  playerHit.body.userData = { actor: player, part: 'body' };
  playerHit.head.userData = { actor: player, part: 'head' };
  playerHit.body.visible = false;
  playerHit.head.visible = false;
  scene.add(playerHit.body);
  scene.add(playerHit.head);
}

const hitMeshes = [...world.shootables, playerHit.body, playerHit.head];
for (const actor of actors) {
  if (actor.mesh) hitMeshes.push(actor.mesh.head, actor.mesh.torso);
}

const controller = createPlayerController(player, camera, scene);

// ---- shared context -------------------------------------------------------------
const ctx = {
  world,
  fx,
  audio,
  scene,
  actors,
  player,
  match,
  random,
  grenades: [],
  raycaster: new THREE.Raycaster(),
  hitMeshes,
  announce: (title, sub) => hud.announce(title, sub),
  onEvent: handleEvent,
};

function handleEvent(event) {
  const now = performance.now();
  if (event.type === 'shot') {
    // only the other team treats gunfire as information
    const others = actors.filter((a) => a.team !== event.actor.team);
    notifyNoise(others, event.pos, now);
  } else if (event.type === 'explosion') {
    notifyNoise(actors, event.pos, now, 36);
  } else if (event.type === 'damage') {
    if (event.target === player) {
      hud.damageFlash();
      audio.hurt();
    }
    if (event.attacker === player) {
      hud.hitmarker(event.part === 'head');
      audio.hit(event.part === 'head');
    }
  } else if (event.type === 'kill') {
    const { target, attacker, part } = event;
    target.deaths += 1;
    if (attacker && attacker !== target) {
      attacker.kills += 1;
      const reward = attacker.weapons[attacker.current]?.def.killReward ?? 300;
      attacker.money += reward;
    }
    hud.kill(`${attacker ? attacker.name : '—'} ▸ ${target.name}${part === 'head' ? ' ✕ head' : ''}`, attacker ? attacker.team : target.team);
    if (attacker === player) audio.kill();
    if (target === player) hud.announce('You are down', 'Your team fights on — watch them.');
  } else if (event.type === 'flash') {
    applyFlash(actors, world, event.pos, event.radius, now);
  }
}
setFlashHook((strength) => hud.flashOverlay(strength));

// ---- player actions ---------------------------------------------------------------
let selection = { kind: 'gun' }; // or {kind:'grenade', grenade:'frag'}
let buyOpen = false;
let firingPrev = false;

function currentWeaponState() {
  return player.weapons[player.current];
}

function selectGun(slot) {
  if (!player.weapons[slot]) return;
  player.current = slot;
  selection = { kind: 'gun' };
  controller.showWeapon(player.weapons[slot].def);
}

function selectGrenade(kind) {
  selection = { kind: 'grenade', grenade: kind };
  controller.showGrenade(kind);
}

function cycleGrenade() {
  const owned = Object.keys(GRENADES).filter((k) => player.grenades[k] > 0);
  if (!owned.length) return;
  if (selection.kind !== 'grenade') {
    selectGrenade(owned[0]);
    return;
  }
  const next = owned[(owned.indexOf(selection.grenade) + 1) % owned.length];
  selectGrenade(next);
}

const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

function playerFire(now) {
  const ws = currentWeaponState();
  if (!ws) return;
  camera.getWorldDirection(_fwd);
  _eye.copy(camera.position);
  const spread = spreadFor(ws, player.body.speed2d, player.body.grounded, player.body.crouch);
  if (tryFire(player, ws, _eye, _fwd, spread, now, ctx)) {
    controller.kick(ws.def.recoil, (random() - 0.5) * ws.def.recoil * 0.7);
    fx.muzzle(controller.muzzleWorld(_muzzle), ws.def.kind === 'shotgun' ? 1.5 : 1);
  }
}

function playerThrow(now) {
  const kind = selection.grenade;
  if (player.grenades[kind] <= 0) return;
  player.grenades[kind] -= 1;
  camera.getWorldDirection(_fwd);
  _eye.copy(camera.position);
  throwGrenade(player, kind, GRENADES[kind], _eye, _fwd, ctx);
  selectGun(player.current);
  void now;
}

function handlePressed(pressed, now) {
  if (pressed.has('KeyB') && match.phase === 'buy' && player.alive) {
    buyOpen = !buyOpen;
    hud.setBuyOpen(buyOpen, player);
  }
  if (buyOpen && match.phase === 'buy') {
    for (const [key, item] of BUY_KEYS) {
      if (pressed.has(key)) {
        const result = buy(ctx, item);
        if (result.ok) {
          audio.buy();
          if (WEAPONS[item]) selectGun(WEAPONS[item].slot);
        } else {
          audio.denied();
        }
        hud.announce(result.msg, '', 1300);
      }
    }
  }
  if (pressed.has('Enter') && match.phase === 'matchEnd') {
    startMatch(ctx);
    selectGun('sidearm');
    return;
  }
  if (!player.alive) return;
  if (pressed.has('Digit1')) selectGun('primary');
  if (pressed.has('Digit2')) selectGun('sidearm');
  if (pressed.has('Digit4')) cycleGrenade();
  if (pressed.has('KeyR')) {
    const ws = currentWeaponState();
    if (ws) startReload(player, ws, now, ctx);
  }
}

window.addEventListener('wheel', (event) => {
  if (!player.alive || shot) return;
  const other = player.current === 'primary' ? 'sidearm' : 'primary';
  if (player.weapons[other]) selectGun(other);
  void event;
});

// ---- the loop -----------------------------------------------------------------------
const input = createInput(renderer.domElement, onLockChange);
let started = false;

hud.onPlay = () => {
  audio.unlock();
  if (match.phase === 'matchEnd') {
    startMatch(ctx);
    selectGun('sidearm');
  }
  if (!shot) input.requestLock();
};

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (started && match.phase !== 'matchEnd') {
    hud.showOverlay('pause', 'Paused', 'The yard waits. Click to jump back in.', 'Resume');
  }
}

function step(dt) {
  const now = performance.now();
  const canMove = match.phase !== 'roundEnd' && match.phase !== 'matchEnd';
  if (player.alive) {
    controller.stepMovement(dt, input.state.keys, world.colliders, canMove && (input.locked || !!shot));
  }
  // firing and reload completion (weapons stay holstered during buy phase)
  const ws = currentWeaponState();
  if (ws && ws.reloadingUntil && now >= ws.reloadingUntil) finishReload(ws);
  if (player.alive && input.locked && (match.phase === 'live' || match.phase === 'planted')) {
    if (selection.kind === 'grenade') {
      if (input.firing && !firingPrev) playerThrow(now);
    } else if (ws) {
      const wantFire = input.firing && (ws.def.auto || !firingPrev);
      if (wantFire) playerFire(now);
    }
  }
  firingPrev = input.firing;

  // bots think and move on the same fixed clock
  for (const actor of actors) {
    if (!actor.isPlayer) stepBot(actor, ctx, dt);
  }
  stepGrenades(ctx, dt);

  // the plant channel belongs to the round logic; the HUD shows its progress
  const plantProgress = updatePlanting(ctx, input.state.keys.has('KeyE'));
  if (plantProgress > 0) hud.setProgress(plantProgress, 'Planting the charge');
  else if (match.defuseProgress > 0) hud.setProgress(match.defuseProgress, 'Wardens are defusing');
  else hud.setProgress(0, '');

  updateRounds(ctx, dt);
  if (match.phase !== 'buy' && buyOpen) {
    buyOpen = false;
    hud.setBuyOpen(false, player);
  }
}

function syncMeshes(now) {
  for (const actor of actors) {
    if (!actor.mesh) continue;
    const sink = actor.alive ? 0 : clamp((now - actor.diedAt - 2600) / 2200, 0, 0.85);
    syncSoldier(actor.mesh, actor.body, !actor.alive, sink);
    actor.mesh.group.visible = actor.alive || now - actor.diedAt < 5200;
  }
  // player hitboxes track the body, head lower when crouched
  playerHit.body.position.set(player.body.pos.x, player.body.pos.y + 0.55, player.body.pos.z);
  playerHit.head.position.set(player.body.pos.x, player.body.pos.y + (player.body.crouch ? 1.02 : 1.5), player.body.pos.z);
}

const _specTarget = new THREE.Vector3();
function syncCamera() {
  if (player.alive) {
    controller.syncCamera(input.aiming && selection.kind === 'gun');
    return;
  }
  // spectate: ride behind the first living teammate
  const mate = actors.find((a) => a.team === 'attack' && a.alive && !a.isPlayer) || actors.find((a) => a.alive && !a.isPlayer);
  if (mate) {
    const back = 3.4;
    const fx2 = -Math.sin(mate.body.yaw);
    const fz2 = -Math.cos(mate.body.yaw);
    camera.position.set(mate.body.pos.x - fx2 * back, mate.body.pos.y + 2.3, mate.body.pos.z - fz2 * back);
    _specTarget.set(mate.body.pos.x + fx2 * 8, mate.body.pos.y + 1.2, mate.body.pos.z + fz2 * 8);
    camera.lookAt(_specTarget);
    camera.fov = 74;
    camera.updateProjectionMatrix();
  }
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive && (input.locked || shot)) controller.look(look.x, look.y);
    handlePressed(input.takePressed(), nowMs);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncMeshes(nowMs);
    syncCamera();
    fx.update(dt);
    hud.sync(match, player, nowMs, actors, world);
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- screenshot staging -------------------------------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  syncMeshes(performance.now());
}

function place(actor, x, z, yaw) {
  actor.body.pos.x = x;
  actor.body.pos.z = z;
  actor.body.pos.y = 0;
  actor.body.vel.x = 0;
  actor.body.vel.z = 0;
  actor.body.yaw = yaw;
}

function stageShot(name) {
  startMatch(ctx);
  selectGun('sidearm');
  hud.hideOverlay();
  const now = performance.now();
  if (name === 'start') {
    // buy phase at the south gate, menu open, the yard ahead — the cover
    // frame shows the game itself, not the title screen. A mid-match purse
    // ($2,650) so the menu shows a real choice, not a wall of unaffordables.
    player.money = 2650;
    place(player, 0, 40, Math.PI);
    controller.aimAt(new THREE.Vector3(-8, 1.4, -10));
    buyOpen = true;
    hud.setBuyOpen(true, player);
    settle(6);
  } else if (name === 'play') {
    // combat at the mid doors: the player trades fire with Havoc in the gap
    // while a Veil smoke blooms on the crossway and the feed tells the story
    match.phase = 'live';
    match.phaseEndsAt = now + 76000;
    player.weapons.primary = createWeaponState(WEAPONS.longline);
    player.armor = true;
    selectGun('primary');
    place(player, 0, 12, Math.PI);
    place(actors[1], -10, 6, Math.PI * 0.8); // Rook pushes the plaza
    place(actors[2], 6, 22, Math.PI); // Sable covers behind
    place(actors[3], -16, 16, Math.PI * 0.9); // Fenn wide left
    const havoc = actors[4];
    place(havoc, 0.3, -9, 0.4); // a Warden framed in the mid doors gap
    havoc.health = 55;
    place(actors[6], 15, -13, -2.4); // Talon on the crossway
    settle(10);
    controller.aimAt(new THREE.Vector3(havoc.body.pos.x, 1.25, havoc.body.pos.z));
    hud.announce('', '', 0);
    syncCamera();
    playerFire(performance.now());
    settle(2);
    // dressing that survives the freeze: impact sparks on the door frame, a
    // smoke cloud eating the crossway, a live kill feed, a fresh hitmarker
    fx.sparks(new THREE.Vector3(1.4, 1.3, -6.5), 0xffc37a, 12, 4.2);
    fx.smokeCloud(new THREE.Vector3(6.5, 1.1, -12), 3.4, 9000);
    hud.kill('Rook ▸ Talon', 'attack');
    hud.kill('Havoc ▸ Sable', 'defend');
    hud.hitmarker(false);
  } else if (name === 'plant') {
    match.phase = 'live';
    match.phaseEndsAt = now + 40000;
    match.targetSite = 'A';
    player.weapons.primary = createWeaponState(WEAPONS.longline);
    selectGun('primary');
    // the charge goes down on A through the round logic's own plant path;
    // the player guards it from the hall's south door as Mira pushes in
    plantAt(ctx, world.sites.A, -27.5, -25.5);
    player.hasCharge = false;
    place(player, -23.5, -15.5, 2.9);
    place(actors[1], -33, -22, 2.8); // Rook watches from inside the hall
    place(actors[5], -21.5, -21, 2.45); // Mira pushes in to defuse
    settle(4);
    controller.aimAt(new THREE.Vector3(actors[5].body.pos.x, 1.2, actors[5].body.pos.z));
    hud.announce('', '', 0);
    // Mira is on the charge: the defuse bar is the frame's tension
    hud.setProgress(0.45, 'Defuse in progress');
    hud.kill('You ▸ Ondine', 'attack');
    syncCamera();
  } else {
    // 'end' is now the lane frame: down the silo lane toward site B in round
    // 9, Strikers up 5–3, trading shots with Talon at the silo mouth — the
    // map's long sightline, stacked containers and all, in one frame
    match.phase = 'live';
    match.phaseEndsAt = now + 50000;
    match.round = 9;
    match.score.attack = 5;
    match.score.defend = 3;
    match.targetSite = 'B';
    player.weapons.primary = createWeaponState(WEAPONS.longline);
    player.armor = true;
    selectGun('primary');
    // the sightline runs down the lane's east edge (x ≈ 34), clear of the
    // lane-cover container at (29, 8), all the way to the silo mouth
    place(player, 34, 26, Math.PI);
    place(actors[1], 29.5, 15, Math.PI * 1.05); // Rook crosses to the container
    place(actors[2], 37, 33, Math.PI); // Sable holds the rear
    const talon = actors[6];
    place(talon, 33.5, -10, 2.9); // Talon at the silo mouth, far down-lane
    talon.health = 70;
    place(actors[4], 24, -24, -2.2); // Havoc deep on B, by the silos
    settle(8);
    controller.aimAt(new THREE.Vector3(talon.body.pos.x, 1.25, talon.body.pos.z));
    hud.announce('', '', 0);
    syncCamera();
    playerFire(performance.now());
    settle(2);
    fx.sparks(new THREE.Vector3(32.6, 1.2, -11.5), 0xffc37a, 10, 3.6);
    hud.kill('Sable ▸ Mira', 'attack');
  }
  hud.sync(match, player, performance.now(), actors, world);
  // paint twice, then hold the frame for the capture
  let painted = 0;
  (function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  })();
}

// A read-only probe for local testing (the headless screenshot driver polls
// it to prove the simulation is alive); it exposes counts, never state.
window.__probe = () => ({
  phase: match.phase,
  round: match.round,
  score: { ...match.score },
  attackAlive: actors.filter((a) => a.team === 'attack' && a.alive).length,
  defendAlive: actors.filter((a) => a.team === 'defend' && a.alive).length,
  playerHealth: Math.round(player.health),
});

// ---- go ---------------------------------------------------------------------------------
startMatch(ctx);
selectGun('sidearm');
if (shot) stageShot(shot);
else requestAnimationFrame(frame);
