// Bots: 5v5 teammates and opponents with routes, holds, reactions and a plant
// order. A bot is a small state machine — route, hold, engage, investigate, plant,
// defuse — driven by what it can see (a segment test against the map) and what it
// hears (shots reported to hearShot). Shooting is delegated to the combat object
// main.js passes in, so this file never touches the raycaster itself.
import * as THREE from 'three';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { moveBody, segmentBlocked } from './physics.js';
import { findRoute, nearestNode, MAP } from './map.js';
import { pick, shuffle } from './rng.js';

const NAMES = {
  vanguard: ['Kestrel', 'Bramble', 'Juno', 'Pike'],
  ember: ['Cinder', 'Vex', 'Rook', 'Sable', 'Hollow'],
};
const BOT_SPEED = 4.1;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE_HEIGHT = 1.55;
const SIGHT_RANGE = 42;
const HEAR_RANGE = 28;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;

const HOLD_NODES = {
  A: [15, 16, 13, 11],
  B: [17, 18, 14, 12],
};
const SITE_NODE = { A: 13, B: 14 };
const LANE_ENTRY = { west: 1, mid: 0, east: 2 };

export function createBots(scene, map, rng, combat) {
  const bots = [];
  const eyeTmp = new THREE.Vector3();
  const chestTmp = new THREE.Vector3();
  const dirTmp = new THREE.Vector3();
  const fromTmp = new THREE.Vector3();
  const aimTmp = new THREE.Vector3();

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.12, 0.55);

  function makeBot(team, index, spawn) {
    const isVanguard = team === 'vanguard';
    const name = NAMES[team][index % NAMES[team].length];
    const colour = new THREE.Color(TEAM_COLORS[team]);
    const torsoMat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.65, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.8 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, darkMat);
    head.position.y = 1.53;
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.14, 0.35, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.14, 0.35, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.22, 1.05, -0.25);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);

    const bot = {
      team, name, index, group, torso, head,
      position: group.position,
      velocity: new THREE.Vector3(),
      yaw: isVanguard ? Math.PI : 0,
      health: 100, alive: true,
      state: 'route',
      route: [], routeIndex: 0,
      holdNode: -1, holdTimer: 0,
      target: null, seenFor: 0, reactAt: 0,
      burstLeft: 0, burstTimer: 0, pauseTimer: 0,
      strafeDir: 1, strafeTimer: 0,
      investigateAt: null, investigateTimer: 0,
      plantProgress: 0, defuseProgress: 0,
      carrier: false, site: null, lane: null,
      fall: 0, speed: BOT_SPEED * (0.92 + rng() * 0.16),
      skill: 0.75 + rng() * 0.5,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    bots.push(bot);
    return bot;
  }

  function resetRound(attackingTeam, roundNumber) {
    const vanguardSpawns = MAP.spawns.vanguard;
    const emberSpawns = MAP.spawns.ember;
    bots.length = 0;
    // Remove old groups from the scene first.
    for (const child of scene.children.slice()) {
      if (child.userData && child.userData.isBotGroup) scene.remove(child);
    }
    const laneNames = shuffle(rng, ['west', 'mid', 'east']);
    const siteNames = shuffle(rng, ['A', 'B']);
    for (let i = 0; i < 4; i += 1) {
      const bot = makeBot('vanguard', i, vanguardSpawns[i]);
      bot.group.userData.isBotGroup = true;
      assignRole(bot, 'vanguard' === attackingTeam, laneNames[i % 3], siteNames[i % 2]);
    }
    for (let i = 0; i < 5; i += 1) {
      const bot = makeBot('ember', i, emberSpawns[i]);
      bot.group.userData.isBotGroup = true;
      assignRole(bot, 'ember' === attackingTeam, laneNames[(i + 1) % 3], siteNames[(i + 1) % 2]);
    }
    // The spike rides with the player when Vanguard attacks; when Ember attacks,
    // one Ember bot carries it and will try to plant.
    if (attackingTeam === 'ember') {
      const attackers = bots.filter((b) => b.team === attackingTeam);
      const carrier = pick(rng, attackers);
      carrier.carrier = true;
      return carrier;
    }
    return null;
  }

  function assignRole(bot, attacking, lane, site) {
    bot.site = site;
    bot.lane = lane;
    bot.carrier = false;
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    bot.investigateAt = null;
    const startNode = nearestNode(map.graph, bot.position.x, bot.position.z);
    if (attacking) {
      const entry = LANE_ENTRY[lane];
      const mid = nearestNode(map.graph, 0, 0);
      const routeToEntry = findRoute(map.graph, startNode, entry);
      const routeToSite = findRoute(map.graph, entry, SITE_NODE[site]);
      bot.route = routeToEntry.concat(routeToSite.slice(1));
      bot.state = 'route';
    } else {
      const hold = pick(rng, HOLD_NODES[site]);
      bot.holdNode = hold;
      bot.route = findRoute(map.graph, startNode, hold);
      bot.state = 'route';
    }
    bot.routeIndex = 0;
  }

  function eyeOf(bot) {
    return eyeTmp.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
  }

  function canSee(bot, targetPos) {
    eyeOf(bot);
    chestTmp.set(targetPos.x, targetPos.y + 1.1, targetPos.z);
    dirTmp.subVectors(chestTmp, eyeTmp);
    const dist = dirTmp.length();
    if (dist > SIGHT_RANGE) return false;
    if (segmentBlocked(map.colliders, eyeTmp, chestTmp)) return false;
    // Field of view: the target must be roughly in front of where the bot looks.
    dirTmp.multiplyScalar(1 / dist);
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    return forward.dot(dirTmp) > 0.15;
  }

  function nearestVisibleEnemy(bot, playerBody, playerAlive) {
    let best = null;
    let bestDist = Infinity;
    if (playerAlive && combat.isPlayerEnemy(bot.team)) {
      const d = bot.position.distanceTo(playerBody.position);
      if (d < bestDist && canSee(bot, playerBody.position)) {
        best = { kind: 'player', dist: d };
        bestDist = d;
      }
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      const d = bot.position.distanceTo(other.position);
      if (d >= bestDist) continue;
      if (canSee(bot, other.position)) {
        best = { kind: 'bot', bot: other, dist: d };
        bestDist = d;
      }
    }
    return best;
  }

  function faceToward(bot, x, z, dt, rate = 7) {
    const want = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function moveToward(bot, x, z, dt) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) return true;
    const nx = dx / len;
    const nz = dz / len;
    bot.velocity.x = nx * bot.speed;
    bot.velocity.z = nz * bot.speed;
    bot.velocity.y -= 21 * dt;
    bot.onGround = moveBody(map.colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
    faceToward(bot, x, z, dt);
    return false;
  }

  function startBurst(bot) {
    bot.burstLeft = 3 + Math.floor(rng() * 3);
    bot.burstTimer = 0;
  }

  function fireAt(bot, target, dt) {
    // Aim error grows with distance and with the target moving; skill shrinks it.
    const moving = target.kind === 'player'
      ? combat.playerSpeed()
      : Math.hypot(target.bot.velocity.x, target.bot.velocity.z);
    const spread = (0.016 + target.dist * 0.0009 + Math.min(1, moving / 5) * 0.02) / bot.skill;
    eyeOf(bot);
    const from = fromTmp.copy(eyeTmp);
    const aim = aimTmp.set(
      target.kind === 'player' ? combat.playerPos().x : target.bot.position.x,
      (target.kind === 'player' ? combat.playerPos().y : target.bot.position.y) + 1.15,
      target.kind === 'player' ? combat.playerPos().z : target.bot.position.z,
    );
    dirTmp.subVectors(aim, from).normalize();
    dirTmp.x += (rng() * 2 - 1) * spread;
    dirTmp.y += (rng() * 2 - 1) * spread;
    dirTmp.z += (rng() * 2 - 1) * spread;
    dirTmp.normalize();
    combat.shootFrom(bot, from, dirTmp, 17, 42);
    bot.burstLeft -= 1;
    bot.burstTimer = 0.13;
    if (bot.burstLeft <= 0) bot.pauseTimer = 0.6 + rng() * 0.9;
  }

  function stepBot(bot, dt, time, playerBody, playerAlive, spike) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.5;
      bot.group.position.y = -bot.fall * 0.1;
      return;
    }
    bot.group.rotation.x = 0;
    bot.group.position.y = bot.position.y;

    // Senses first: the closest enemy in sight decides everything else.
    const enemy = nearestVisibleEnemy(bot, playerBody, playerAlive);
    if (enemy) {
      if (!bot.target) {
        bot.reactAt = time + 0.35 + rng() * 0.4;
        bot.burstLeft = 0;
        bot.pauseTimer = 0;
      }
      bot.target = enemy;
      bot.seenFor += dt;
      bot.state = 'engage';
    } else if (bot.target) {
      bot.target = null;
      bot.seenFor = 0;
      bot.burstLeft = 0;
      bot.state = bot.holdNode >= 0 && bot.routeIndex >= bot.route.length ? 'hold' : 'route';
    }

    if (bot.state === 'engage' && bot.target) {
      const tx = bot.target.kind === 'player' ? playerBody.position.x : bot.target.bot.position.x;
      const tz = bot.target.kind === 'player' ? playerBody.position.z : bot.target.bot.position.z;
      faceToward(bot, tx, tz, dt, 9);
      // Strafe sideways while firing, changing direction every second or so.
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeDir = rng() < 0.5 ? -1 : 1;
        bot.strafeTimer = 0.7 + rng() * 0.8;
      }
      const side = bot.strafeDir;
      const sin = Math.sin(bot.yaw);
      const cos = Math.cos(bot.yaw);
      bot.velocity.x = cos * side * 1.6;
      bot.velocity.z = -sin * side * 1.6;
      bot.velocity.y -= 21 * dt;
      bot.onGround = moveBody(map.colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
      if (time >= bot.reactAt) {
        if (bot.pauseTimer > 0) {
          bot.pauseTimer -= dt;
        } else if (bot.burstLeft <= 0) {
          startBurst(bot);
        } else {
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0) fireAt(bot, bot.target, dt);
        }
      }
      return;
    }

    // Planting: the carrier stands in its site and holds still.
    if (bot.carrier && spike.state === 'carried' && bot.state === 'plant') {
      const site = MAP.sites[bot.site];
      const d = Math.hypot(bot.position.x - site.x, bot.position.z - site.z);
      if (d < site.radius * 0.8 && !bot.target) {
        bot.plantProgress += dt;
        if (bot.plantProgress >= PLANT_TIME) {
          combat.plantSpike(bot.site, bot.position.x, bot.position.z);
          bot.plantProgress = 0;
          bot.state = 'hold';
        }
        return;
      }
    }

    // A planted spike pulls every defender toward it.
    if (spike.state === 'planted' && bot.team === spike.defenders && bot.state !== 'defuse' && bot.state !== 'engage') {
      bot.state = 'defuse';
      bot.defuseProgress = 0;
      bot.route = findRoute(map.graph, nearestNode(map.graph, bot.position.x, bot.position.z), SITE_NODE[spike.site]);
      bot.routeIndex = 0;
    }

    // Defusing: stand on the planted spike.
    if (spike.state === 'planted' && bot.team === spike.defenders && bot.state === 'defuse') {
      const d = Math.hypot(bot.position.x - spike.x, bot.position.z - spike.z);
      if (d < 1.6 && !bot.target) {
        bot.defuseProgress += dt;
        combat.defuseProgress(bot.defuseProgress / DEFUSE_TIME);
        if (bot.defuseProgress >= DEFUSE_TIME) {
          combat.defuseSpike();
          bot.defuseProgress = 0;
          bot.state = 'hold';
        }
        return;
      }
      // Walk the route to the site, then close the last metres to the spike itself.
      if (bot.routeIndex < bot.route.length) {
        const node = map.graph.nodes[bot.route[bot.routeIndex]];
        if (moveToward(bot, node[0], node[1], dt)) bot.routeIndex += 1;
      } else {
        moveToward(bot, spike.x, spike.z, dt);
      }
      return;
    }

    // Route following: walk the waypoint list, then hold or plant.
    if (bot.state === 'route' || bot.state === 'plant') {
      if (bot.routeIndex < bot.route.length) {
        const node = map.graph.nodes[bot.route[bot.routeIndex]];
        if (moveToward(bot, node[0], node[1], dt)) bot.routeIndex += 1;
        return;
      }
      if (bot.carrier && spike.state === 'carried') {
        const site = MAP.sites[bot.site];
        const d = Math.hypot(bot.position.x - site.x, bot.position.z - site.z);
        if (d < site.radius) {
          bot.state = 'plant';
        } else {
          bot.route = findRoute(map.graph, nearestNode(map.graph, bot.position.x, bot.position.z), SITE_NODE[bot.site]);
          bot.routeIndex = 0;
        }
        return;
      }
      bot.state = 'hold';
      bot.holdTimer = 2 + rng() * 4;
      return;
    }

    // Hold: look around, rotate to a new hold point now and then.
    bot.holdTimer -= dt;
    bot.yaw += Math.sin(time * 0.4 + bot.index * 2.1) * dt * 0.4;
    if (bot.holdTimer <= 0) {
      const options = HOLD_NODES[bot.site];
      const next = pick(rng, options);
      if (next !== bot.holdNode) {
        bot.holdNode = next;
        bot.route = findRoute(map.graph, nearestNode(map.graph, bot.position.x, bot.position.z), next);
        bot.routeIndex = 0;
        bot.state = 'route';
      } else {
        bot.holdTimer = 3 + rng() * 4;
      }
    }
  }

  return {
    bots,
    resetRound,
    hearShot(position, team) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === team || bot.state === 'engage') continue;
        const d = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
        if (d < HEAR_RANGE && rng() < 0.6) {
          bot.investigateAt = { x: position.x, z: position.z };
          bot.investigateTimer = 6;
          if (bot.state === 'hold') {
            bot.route = [nearestNode(map.graph, position.x, position.z)];
            bot.routeIndex = 0;
            bot.state = 'route';
          }
        }
      }
    },
    step(dt, time, playerBody, playerAlive, spike) {
      for (const bot of bots) stepBot(bot, dt, time, playerBody, playerAlive, spike);
      for (const bot of bots) {
        bot.group.position.copy(bot.position);
        bot.group.rotation.y = bot.yaw;
      }
    },
    hitMeshes() {
      const meshes = [];
      for (const bot of bots) {
        if (bot.alive) meshes.push(bot.torso, bot.head);
      }
      return meshes;
    },
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.alive && bot.team === team) n += 1;
      return n;
    },
    damage(bot, amount) {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.health = 0;
      bot.fall = 0;
      return true;
    },
  };
}
