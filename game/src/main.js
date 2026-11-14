// EMBERLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the match state, the spike, the shooting and the
// grenades; the modules own their own state. ?shot=start|play|buy|end with
// &seed=N sets up a deterministic frame for a capture, renders it twice, then
// freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';
import { createMap, MAP } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponRig, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch, FUSE_SECONDS } from './rounds.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const PLANT_SECONDS = 3.5;
const DEFUSE_SECONDS = 5;
const OVER_SECONDS = 4.5;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = makeRng(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.dusk);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.dusk), 26, 62);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const audio = createAudio();
const map = createMap(scene);
const effects = createEffects(scene);
const hud = createHud();
const match = createMatch();
const weapon = createWeaponRig(camera);
const player = createPlayer(map.colliders, MAP.spawns.vanguard[2]);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// Reused temporaries: the hot paths allocate nothing.
const cameraDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const playerBox = new THREE.Box3();
const boxHit = new THREE.Vector3();
const spikePos = new THREE.Vector3();

// The spike: carried by the player (Vanguard attack) or one Ember bot, planted at
// a site, then a fuse. `defenders` is the team that must stop or defuse it.
const spike = {
  state: 'carried', // carried | planted
  site: null,
  x: 0,
  z: 0,
  defenders: 'ember',
  fuse: FUSE_SECONDS,
  carrier: 'player',
};
const spikeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.22, 0.34),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.9, roughness: 0.4 }),
);
spikeMesh.visible = false;
spikeMesh.castShadow = true;
scene.add(spikeMesh);
const spikeLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 9);
scene.add(spikeLight);

const combat = {
  isPlayerEnemy(team) {
    return team !== 'vanguard';
  },
  playerSpeed() {
    return player.groundSpeed();
  },
  playerPos() {
    return player.state.position;
  },
  shootFrom(bot, from, dir, torsoDamage, headDamage) {
    raycaster.set(from, dir);
    const targets = map.shootables.concat(bots.hitMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = aimPoint.copy(from).addScaledVector(dir, 90);
    // The player is a box, not a mesh: test it by hand and compare distances.
    playerBox.min.set(player.state.position.x - 0.34, player.state.position.y, player.state.position.z - 0.34);
    playerBox.max.set(player.state.position.x + 0.34, player.state.position.y + player.state.height, player.state.position.z + 0.34);
    const playerHit = player.state.alive ? raycaster.ray.intersectBox(playerBox, boxHit) : null;
    const playerDist = playerHit ? boxHit.distanceTo(from) : Infinity;
    if (playerHit && (!hit || playerDist < hit.distance)) {
      const head = boxHit.y > player.state.position.y + player.state.height - 0.38;
      effects.tracer(from, boxHit);
      damagePlayer(head ? headDamage : torsoDamage, bot.name);
      return;
    }
    if (hit) {
      effects.tracer(from, hit.point);
      const target = hit.object.userData.bot;
      if (target) {
        const killed = bots.damage(target, hit.object.userData.part === 'head' ? headDamage : torsoDamage);
        effects.blood(hit.point);
        hud.killfeed(bot.name, target.name, hit.object.userData.part === 'head');
        if (killed) audio.kill();
      }
      return;
    }
    effects.tracer(from, end);
  },
  plantSpike(site, x, z) {
    spike.state = 'planted';
    spike.site = site;
    spike.x = x;
    spike.z = z;
    spike.defenders = match.attackingTeam() === 'vanguard' ? 'ember' : 'vanguard';
    spike.fuse = FUSE_SECONDS;
    spikeMesh.position.set(x, 0.14, z);
    spikeMesh.visible = true;
    spikeLight.position.set(x, 1.2, z);
    spikeLight.intensity = 10;
    hud.showBanner(`Spike planted at ${MAP.sites[site].name}! ${FUSE_SECONDS}s to detonation.`);
    hud.setSpike('planted', FUSE_SECONDS);
    audio.plantDone();
  },
  defuseSpike() {
    endRoundNow(match.defendingTeam(), 'Spike defused');
  },
  defuseProgress(fraction) {
    botDefuseFrac = fraction;
    botDefuseAt = performance.now();
  },
};

const bots = createBots(scene, map, rng, combat);

const body = player.state;
let elapsed = 0;
let overTimer = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let plantProgress = 0;
let defuseProgress = 0;
let botDefuseFrac = -1;
let botDefuseAt = 0;
let shake = 0;
let buyOpen = false;
let ownedPrimary = 'rifle';
let spectating = false;
let lastDryAt = 0;

function currentAttacker() {
  return match.attackingTeam();
}

function resetWorldForRound() {
  const attacker = currentAttacker();
  const spawnList = MAP.spawns.vanguard;
  const spawn = spawnList[2];
  player.reset(spawn, 0);
  bots.resetRound(attacker, match.state.round);
  spike.state = 'carried';
  spike.site = null;
  spike.defenders = attacker === 'vanguard' ? 'ember' : 'vanguard';
  spike.carrier = attacker === 'vanguard' ? 'player' : 'bot';
  spike.fuse = FUSE_SECONDS;
  spikeMesh.visible = false;
  spikeLight.intensity = 0;
  effects.clear();
  plantProgress = 0;
  defuseProgress = 0;
  buyOpen = false;
  hud.showBuy(false);
  hud.setProgress(null, 0);
  weapon.equip(WEAPONS[ownedPrimary], false);
  weapon.refillAmmo();
  spectating = false;
  hud.setSpike(spike.carrier === 'player' ? 'carried' : '', 0);
  syncCamera();
  hud.setHealth(100);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.def.name);
  hud.setGrenades(match.state.grenades);
  hud.setMoney(match.state.money);
  hud.setScore(match.state.wins.vanguard, match.state.wins.ember, match.state.round);
  hud.setAlive(bots.aliveCount('vanguard'), bots.aliveCount('ember'), true);
  hud.showBanner(match.state.banner, 4200);
}

function endRoundNow(winner, reason) {
  if (!match.endRound(winner, reason)) return;
  buyOpen = false;
  hud.showBuy(false);
  if (winner === 'vanguard') audio.roundWin();
  else audio.roundLose();
  hud.showBanner(match.state.banner, 4200);
  hud.setScore(match.state.wins.vanguard, match.state.wins.ember, match.state.round);
  hud.setSpike('', 0);
  overTimer = OVER_SECONDS;
  if (match.state.matchOver) {
    hud.showOverlay('matchEnd', {
      winner: match.state.matchWinner,
      vanguard: match.state.wins.vanguard,
      ember: match.state.wins.ember,
      kills: match.state.kills,
      money: match.state.money,
    });
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function damagePlayer(amount, fromName) {
  if (!body.alive || match.state.phase !== 'live') return;
  body.health -= amount;
  hud.setHealth(body.health);
  hud.damage();
  audio.hurt();
  shake = Math.min(0.5, shake + 0.12);
  if (body.health > 0) return;
  body.health = 0;
  body.alive = false;
  match.onDeath();
  // If the player carried the spike, a living Vanguard bot picks it up.
  if (spike.state === 'carried' && spike.carrier === 'player') {
    const alive = bots.bots.filter((b) => b.alive && b.team === 'vanguard');
    if (alive.length > 0) {
      const next = alive[Math.floor(rng() * alive.length)];
      next.carrier = true;
      spike.carrier = 'bot';
      hud.setSpike('', 0);
    }
  }
  hud.setHealth(0);
  hud.setAlive(bots.aliveCount('vanguard'), bots.aliveCount('ember'), false);
  if (fromName) hud.killfeed(fromName, 'YOU', false);
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showOverlay('dead', null);
}

function syncCamera() {
  const sway = shake > 0 ? (rng() - 0.5) * shake * 0.05 : 0;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch + sway, body.yaw + sway, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function muzzleWorld() {
  camera.getWorldDirection(cameraDir);
  return muzzle.copy(camera.position).addScaledVector(cameraDir, 0.7);
}

function playerShoot() {
  const def = weapon.def;
  if (!weapon.takeRound()) return false;
  camera.getWorldDirection(cameraDir);
  const speed = player.groundSpeed();
  const spread = weapon.spread(speed, false);
  let hitSomething = false;
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    shotDir.copy(cameraDir);
    shotDir.x += (rng() * 2 - 1) * spread;
    shotDir.y += (rng() * 2 - 1) * spread;
    shotDir.z += (rng() * 2 - 1) * spread;
    shotDir.normalize();
    raycaster.set(camera.position, shotDir);
    const targets = map.shootables.concat(bots.hitMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = aimPoint.copy(camera.position).addScaledVector(shotDir, def.range);
    if (hit) {
      effects.tracer(muzzleWorld(), hit.point);
      const target = hit.object.userData.bot;
      if (target) {
        const head = hit.object.userData.part === 'head';
        const killed = bots.damage(target, head ? def.headDamage : def.damage);
        effects.blood(hit.point);
        hud.hitMarker(killed);
        hud.killfeed('YOU', target.name, head);
        if (killed) {
          match.onKill();
          hud.setMoney(match.state.money);
          audio.kill();
        } else {
          audio.hit();
        }
      }
      hitSomething = true;
    } else {
      effects.tracer(muzzleWorld(), end);
    }
  }
  weapon.pullTrigger();
  player.recoil(def.recoil * (0.8 + rng() * 0.4), (rng() * 2 - 1) * def.recoil * 0.25);
  audio.shot(def.kind);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setCrosshairGap(5 + spread * 900 + speed * 1.2);
  bots.hearShot(body.position, 'vanguard');
  return hitSomething;
}

function throwGrenade() {
  if (match.state.grenades <= 0 || match.state.phase !== 'live' || !body.alive) return;
  match.state.grenades -= 1;
  hud.setGrenades(match.state.grenades);
  audio.grenadePin();
  camera.getWorldDirection(cameraDir);
  const from = muzzle.copy(camera.position).addScaledVector(cameraDir, 0.5);
  effects.throwGrenade(map.colliders, from, cameraDir, (origin) => {
    audio.explosion();
    effects.explosion(origin);
    const dPlayer = Math.hypot(body.position.x - origin.x, body.position.z - origin.z);
    if (body.alive && dPlayer < effects.grenadeRadius()) {
      damagePlayer(Math.round(110 * (1 - dPlayer / effects.grenadeRadius()) + 10), null);
    }
    for (const bot of bots.bots) {
      if (!bot.alive || bot.team !== 'ember') continue;
      const d = Math.hypot(bot.position.x - origin.x, bot.position.z - origin.z);
      if (d >= effects.grenadeRadius()) continue;
      const killed = bots.damage(bot, Math.round(110 * (1 - d / effects.grenadeRadius()) + 10));
      if (killed) {
        match.onKill();
        hud.setMoney(match.state.money);
        hud.killfeed('YOU', bot.name, false);
        audio.kill();
      }
    }
    const dSpike = Math.hypot(spike.x - origin.x, spike.z - origin.z);
    if (spike.state === 'planted' && dSpike < 2) {
      // A grenade on the spike does not defuse it; the blast only buys time.
    }
    shake = Math.min(0.6, shake + 0.3);
  });
}

function tryBuy(itemId) {
  const result = match.buy(itemId);
  if (!result.ok) {
    audio.denied();
    hud.showBanner(result.why, 2200);
    return;
  }
  audio.buy();
  hud.setMoney(match.state.money);
  if (itemId === 'grenade') {
    hud.setGrenades(match.state.grenades);
  } else {
    ownedPrimary = itemId;
    weapon.equip(WEAPONS[itemId], false);
    hud.setWeapon(weapon.def.name);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  }
  hud.renderBuy(match.buyList(), match.state.money, ownedPrimary, match.state.grenades, tryBuy);
  hud.showBanner(`${result.what} bought.`, 1600);
}

function switchWeapon(id) {
  if (match.state.phase !== 'live' && match.state.phase !== 'freeze') return;
  if (id === 'pistol') {
    weapon.equip(WEAPONS.pistol, true);
  } else if (id === ownedPrimary) {
    weapon.equip(WEAPONS[ownedPrimary], false);
  } else {
    return;
  }
  hud.setWeapon(weapon.def.name);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    spectating = !body.alive;
    hud.hideOverlay();
    audio.unlock();
  } else if (buyOpen) {
    // The buy menu needs the cursor; no overlay while it is open.
  } else if (match.state.matchOver) {
    hud.showOverlay('matchEnd', {
      winner: match.state.matchWinner,
      vanguard: match.state.wins.vanguard,
      ember: match.state.wins.ember,
      kills: match.state.kills,
      money: match.state.money,
    });
  } else if (!body.alive) {
    hud.showOverlay('dead', null);
  } else if (match.state.phase === 'over') {
    hud.showOverlay('roundEnd', { winner: match.state.roundWinner, reason: match.state.roundReason });
  } else if (!buyOpen) {
    hud.showOverlay(started ? 'paused' : 'start', null);
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.matchOver) {
    match.resetMatch();
    ownedPrimary = 'rifle';
    resetWorldForRound();
    input.requestLock();
    return;
  }
  if (match.state.phase === 'over' && !match.state.matchOver) {
    match.nextRound();
    resetWorldForRound();
  }
  input.requestLock();
});

function step(dt) {
  elapsed += dt;
  shake = Math.max(0, shake - dt * 1.4);
  const ms = match.state;

  if (ms.phase === 'freeze') {
    ms.timeLeft -= dt;
    if (ms.timeLeft <= 0) {
      match.beginLive();
      buyOpen = false;
      hud.showBuy(false);
      hud.showBanner(ms.round % 2 === 1 ? 'Vanguard attacks — plant the spike!' : 'Ember attacks — defend the sites!', 3000);
      audio.beep();
    }
  } else if (ms.phase === 'live') {
    ms.timeLeft -= dt;
    if (spike.state === 'planted') {
      spike.fuse -= dt;
      spikeLight.intensity = 8 + Math.sin(elapsed * 9) * 4;
      spikeMesh.rotation.y += dt * 2;
      hud.setSpike('planted', spike.fuse);
      if (spike.fuse <= 0) {
        effects.explosion(spikePos.set(spike.x, 0.5, spike.z));
        audio.explosion();
        endRoundNow(currentAttacker(), 'Spike detonated');
      }
    }
    if (ms.phase === 'live' && ms.timeLeft <= 0 && spike.state !== 'planted') {
      endRoundNow(match.defendingTeam(), 'Time expired — the sites held');
    }
  } else if (ms.phase === 'over') {
    overTimer -= dt;
    if (overTimer <= 0 && !ms.matchOver) {
      match.nextRound();
      resetWorldForRound();
    }
  }

  // Player movement and actions run in freeze too (positioning, buying); firing
  // and planting only while live.
  player.step(dt, input.state.keys);
  weapon.step(dt);
  effects.step(dt);

  for (const code of input.drainPressed()) {
    if (code === 'KeyB' && ms.phase === 'freeze') {
      buyOpen = !buyOpen;
      hud.showBuy(buyOpen);
      if (buyOpen) {
        hud.renderBuy(match.buyList(), ms.money, ownedPrimary, ms.grenades, tryBuy);
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        input.requestLock();
      }
    } else if (code === 'KeyG') {
      throwGrenade();
    } else if (code === 'KeyR') {
      weapon.reload();
      audio.reload();
    } else if (code === 'Digit1' && buyOpen) {
      tryBuy('pistol');
    } else if (code === 'Digit2' && buyOpen) {
      tryBuy('smg');
    } else if (code === 'Digit3' && buyOpen) {
      tryBuy('shotgun');
    } else if (code === 'Digit4' && buyOpen) {
      tryBuy('rifle');
    } else if (code === 'Digit5' && buyOpen) {
      tryBuy('sniper');
    } else if (code === 'Digit6' && buyOpen) {
      tryBuy('grenade');
    } else if (code === 'Digit1' && !buyOpen) {
      switchWeapon('pistol');
    } else if (code === 'Digit2' && !buyOpen) {
      switchWeapon(ownedPrimary);
    }
  }

  // Plant / defuse: hold E in the right place.
  const wantUse = input.state.keys.has('KeyE');
  let progressLabel = null;
  let progressFrac = 0;
  if (ms.phase === 'live' && body.alive) {
    if (spike.state === 'carried' && spike.carrier === 'player' && currentAttacker() === 'vanguard') {
      const siteA = MAP.sites.A;
      const siteB = MAP.sites.B;
      const inA = Math.hypot(body.position.x - siteA.x, body.position.z - siteA.z) < siteA.radius;
      const inB = Math.hypot(body.position.x - siteB.x, body.position.z - siteB.z) < siteB.radius;
      if ((inA || inB) && wantUse) {
        plantProgress += dt;
        progressLabel = `PLANTING SPIKE — ${inA ? 'FURNACE' : 'SILO'}`;
        progressFrac = plantProgress / PLANT_SECONDS;
        if (plantProgress >= PLANT_SECONDS) {
          combat.plantSpike(inA ? 'A' : 'B', body.position.x, body.position.z);
          match.onPlant();
          hud.setMoney(ms.money);
          plantProgress = 0;
        }
      } else {
        plantProgress = Math.max(0, plantProgress - dt * 2);
      }
    } else if (spike.state === 'planted' && spike.defenders === 'vanguard') {
      const d = Math.hypot(body.position.x - spike.x, body.position.z - spike.z);
      if (d < 1.8 && wantUse) {
        defuseProgress += dt;
        progressLabel = 'DEFUSING SPIKE';
        progressFrac = defuseProgress / DEFUSE_SECONDS;
        if (defuseProgress >= DEFUSE_SECONDS) {
          match.onDefuse();
          combat.defuseSpike();
          defuseProgress = 0;
        }
      } else {
        defuseProgress = Math.max(0, defuseProgress - dt * 2);
      }
    }
  }
  if (!progressLabel && botDefuseFrac >= 0 && performance.now() - botDefuseAt < 250) {
    progressLabel = 'EMBER IS DEFUSING THE SPIKE';
    progressFrac = botDefuseFrac;
  }
  hud.setProgress(progressLabel, progressFrac);

  // Bots only act while the round is live; freeze time is for positioning.
  if (ms.phase === 'live') bots.step(dt, elapsed, body, body.alive, spike);

  // If the bot carrying the spike died, another living attacker picks it up.
  if (spike.state === 'carried' && spike.carrier === 'bot') {
    const hasCarrier = bots.bots.some((b) => b.alive && b.carrier);
    if (!hasCarrier) {
      const attackers = bots.bots.filter((b) => b.alive && b.team === currentAttacker());
      if (attackers.length > 0) attackers[Math.floor(rng() * attackers.length)].carrier = true;
    }
  }

  // Round end by elimination.
  if (ms.phase === 'live') {
    const vanguardAlive = bots.aliveCount('vanguard') + (body.alive ? 1 : 0);
    const emberAlive = bots.aliveCount('ember');
    if (emberAlive === 0) {
      endRoundNow('vanguard', 'Ember team eliminated');
    } else if (vanguardAlive === 0) {
      endRoundNow('ember', 'Vanguard team eliminated');
    }
  }

  // HUD, every step (the setters cache and skip unchanged writes).
  hud.setHealth(body.health);
  hud.setTimer(ms.timeLeft, ms.phase);
  hud.setScore(ms.wins.vanguard, ms.wins.ember, ms.round);
  hud.setAlive(bots.aliveCount('vanguard'), bots.aliveCount('ember'), body.alive);
  hud.setCrosshairGap(5 + weapon.spread(player.groundSpeed(), false) * 900 + player.groundSpeed() * 1.2);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (body.alive || spectating) player.look(look.x, look.y);
    if (input.state.firing && match.state.phase === 'live' && body.alive) {
      if (weapon.ready()) playerShoot();
      else if (weapon.state.mag === 0 && weapon.state.reserve > 0 && weapon.state.reloadLeft === 0) weapon.reload();
      else if (weapon.state.mag === 0 && now - lastDryAt > 300) {
        lastDryAt = now;
        audio.dryFire();
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  if (name === 'start') {
    body.position.set(0, 0, 13.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(30);
    syncCamera();
    hud.showOverlay('start', null);
  } else if (name === 'buy') {
    body.position.set(-2, 0, 12);
    body.yaw = 0.25;
    settle(10);
    syncCamera();
    buyOpen = true;
    hud.renderBuy(match.buyList(), match.state.money, ownedPrimary, match.state.grenades, tryBuy);
    hud.showBuy(true);
  } else if (name === 'play') {
    match.state.round = 3;
    match.state.wins.vanguard = 2;
    match.state.wins.ember = 1;
    match.state.money = 2450;
    match.state.phase = 'live';
    match.state.timeLeft = 72;
    body.position.set(0, 0, 5);
    body.yaw = 0;
    body.pitch = 0;
    // Stage the fight: two Ember bots down, one in the sights up mid.
    const ember = bots.bots.filter((b) => b.team === 'ember');
    bots.damage(ember[1], 500);
    bots.damage(ember[3], 500);
    ember[0].position.set(0.5, 0, -7);
    ember[0].yaw = Math.PI;
    ember[2].position.set(-6, 0, -2);
    settle(12);
    aimAt(new THREE.Vector3(0.5, 1.2, -7));
    playerShoot();
    settle(4);
    aimAt(new THREE.Vector3(0.5, 1.2, -7));
    playerShoot();
    settle(6);
    syncCamera();
    hud.hideBanner();
    hud.setScore(2, 1, 3);
    hud.setMoney(2450);
  } else if (name === 'end') {
    match.state.round = 2;
    match.state.wins.vanguard = 1;
    match.state.wins.ember = 1;
    match.state.phase = 'over';
    match.state.roundWinner = 'vanguard';
    match.state.roundReason = 'Ember team eliminated';
    match.state.timeLeft = 0;
    overTimer = 99;
    body.position.set(-8, 0, 8);
    body.yaw = -0.6;
    settle(10);
    syncCamera();
    hud.showOverlay('roundEnd', { winner: 'vanguard', reason: 'Ember team eliminated' });
    hud.setScore(1, 1, 2);
  }
  hud.setHealth(body.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      document.title = 'READY';
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetWorldForRound();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
