# CINDERLINE

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/KIM7667/cinderline/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/KIM7667/cinderline/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS for [make.fun](https://make.fun/bounty/threejs-fps-02)'s
"Make the best three.js tactical FPS" bounty, $1,000 in USDC. Two teams of
four fight over the Kestrel Yard, an original dusk freight yard: the Strikers
carry a breach charge to one of two sites — the Furnace Hall or the Silo
Yard — and the Wardens hold them off. First to 7 rounds, money between
rounds, accuracy over speed.

## Play it

```sh
node serve.ts          # serves game/ on http://localhost:8080
```

Open the page in desktop Chrome, click to play. No build step, no network:
the game is plain ES modules with three.js 0.187.0 vendored in
`game/vendor/three/`, loaded through an import map.

- WASD move · Shift sprint · Ctrl/C crouch · Space jump · mouse look
- Click fire · R reload · 1/2 weapons · wheel swap · right-click DMR zoom
- B buy menu during the buy phase · hold E in the called site to plant
- 4 selects a grenade (frag / flash / smoke), click throws it

## The game

- **Rounds and economy.** 12-second buy phase, 100-second rounds, a
  35-second charge fuse, defuses, elimination wins, clock wins. Kills pay
  the killer; wins pay the team; losers still get paid enough to argue
  about the next buy. Five guns (P9 Wasp, VK-9 Ratter, Mule 12, AR-57
  Longline, Kestrel DMR), three grenades and a kevlar vest.
- **Gunplay.** Hitscan against separate head and body hitboxes, headshot
  multipliers, distance falloff, spread that punishes moving and jumping
  and rewards crouching and standing still, recoil bloom, tracers,
  hitmarkers, and fully synthesised WebAudio gunfire — no audio files.
- **Bots.** Seven bots share the player's body and combat code. Wardens
  hold site posts, scan, rotate on gunfire they hear, converge on a
  planted charge and defuse it; Striker teammates push the called site
  over a waypoint graph with A* and hold angles around the plant. Sight
  is tested against the map's real sight-blockers and through smoke.
- **Structure.** A fixed 60 Hz simulation kept apart from rendering;
  one module per job under `game/src/` (`world`, `actor`, `combat`,
  `bots`, `rounds`, `weapons`, `hud`, `fx`, `audio`, `input`, `player`);
  state lives in one shared context; no per-frame allocation in the hot
  loops.

## Hand it in

`main.ts` (Node 22, standard library only) copies `game/` and
`screenshots/` to the output directory and writes `dossier.json` with the
kit's `buildDossier`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The screenshots are the game's own deterministic `?shot=` frames
(`shots.json`), rendered by the game's code in a browser.
