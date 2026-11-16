// CINDERLINE's entry program (Node 22, standard library only).
//
// The game itself is the static site in game/ — plain ES modules and the
// vendored three.js 0.187.0, no build step. This program hands it in: it
// copies game/ and screenshots/ next to itself into the output directory
// (/output in the grader, $MAKEFUN_OUTPUT_DIR elsewhere) and writes
// dossier.json there with the kit's buildDossier, byte for byte the summary
// the judge reads. Run it locally the same way the grader does:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Play the game with `node serve.ts`, then http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own: at most 4 screenshots of 256 KiB, at most
// 993 files and 48 MiB under game/, and the dossier text capped at 160 KiB.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
