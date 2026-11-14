// EMBERLINE — Foundry Yard, a three.js tactical FPS for make.fun (threejs-fps-02).
// Node 22, standard library only. This program hands the game in: it copies the
// playable static files under game/ and the screenshots under screenshots/ into the
// output directory, then writes /output/dossier.json with the kit's vendored
// buildDossier, the summary the judge reads.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer caps the whole of /output at 1,000 entries and 64 MiB, shared by
// game/ (at most 993 entries, 48 MiB), screenshots/ (at most 4 files, 256 KiB
// each) and dossier.json. Rebuilding from a clean directory keeps a stale file
// from a previous run out of the submission, and keeps the two grader runs
// byte-identical.
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const gameSource = join(repoRoot, 'game');
const shotsSource = join(repoRoot, 'screenshots');
cpSync(gameSource, join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(shotsSource)) {
  cpSync(shotsSource, join(outputDir, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own (reference/gate.json): the dossier text is
// capped at 160 KiB, screenshots at 4 files of 256 KiB, game/ at 993 entries
// and 48 MiB. An entry over any of them is refused here first, not by the gate.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
