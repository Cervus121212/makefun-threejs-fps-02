// Transient combat effects: tracer lines, grenade throws, explosions and floating
// damage puffs. Everything is pooled and reused: nothing is allocated per shot in
// the hot path, and the arrays are fixed at construction.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { moveBody } from './physics.js';

const TRACER_COUNT = 24;
const TRACER_LIFE = 0.07;
const PARTICLE_COUNT = 160;
const GRENADE_RADIUS = 6;

export function createEffects(scene) {
  // Tracer pool: one Line per slot, two endpoints each, hidden when idle.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // Particle pool: one Points cloud, positions and per-particle velocity/life in
  // plain arrays, updated in place.
  const particleGeo = new THREE.BufferGeometry();
  const particlePos = new Float32Array(PARTICLE_COUNT * 3);
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.ember), size: 0.14, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  particles.visible = false;
  particles.frustumCulled = false;
  scene.add(particles);
  const particleVel = new Float32Array(PARTICLE_COUNT * 3);
  const particleLife = new Float32Array(PARTICLE_COUNT);
  let particleActive = 0;

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 18);
  scene.add(flashLight);
  let flashLeft = 0;

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.3 });

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function spawnParticles(origin, count, speed, up) {
    let spawned = 0;
    for (let i = 0; i < PARTICLE_COUNT && spawned < count; i += 1) {
      if (particleLife[i] > 0) continue;
      const j = i * 3;
      particlePos[j] = origin.x;
      particlePos[j + 1] = origin.y;
      particlePos[j + 2] = origin.z;
      const angle = Math.random() * Math.PI * 2;
      const tilt = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particleVel[j] = Math.cos(angle) * Math.cos(tilt) * s;
      particleVel[j + 1] = Math.sin(tilt) * s + up;
      particleVel[j + 2] = Math.sin(angle) * Math.cos(tilt) * s;
      particleLife[i] = 0.5 + Math.random() * 0.7;
      spawned += 1;
      particleActive += 1;
    }
    particles.visible = particleActive > 0;
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) {
        tracer.line.visible = false;
        tracer.line.material.opacity = 0;
      } else {
        tracer.line.material.opacity = tracer.life / TRACER_LIFE;
      }
    }
    if (particleActive > 0) {
      let alive = 0;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        if (particleLife[i] <= 0) continue;
        particleLife[i] -= dt;
        const j = i * 3;
        if (particleLife[i] <= 0) {
          particlePos[j + 1] = -100;
          continue;
        }
        particleVel[j + 1] -= 12 * dt;
        particlePos[j] += particleVel[j] * dt;
        particlePos[j + 1] += particleVel[j + 1] * dt;
        particlePos[j + 2] += particleVel[j + 2] * dt;
        if (particlePos[j + 1] < 0.03) {
          particlePos[j + 1] = 0.03;
          particleVel[j + 1] *= -0.3;
        }
        alive += 1;
      }
      particleActive = alive;
      particleGeo.attributes.position.needsUpdate = true;
      particles.visible = alive > 0;
    }
    if (flashLeft > 0) {
      flashLeft -= dt;
      flashLight.intensity = Math.max(0, flashLeft * 220);
      if (flashLeft <= 0) flashLight.intensity = 0;
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      const grounded = moveBody(g.colliders, g.mesh.position, g.vel, dt, 0.09, 0.18);
      if (grounded && Math.abs(g.vel.y) < 0.5) g.bounces += 1;
      if (g.fuse <= 0 || g.bounces >= 2) {
        g.mesh.position.y = Math.max(0.1, g.mesh.position.y);
        const origin = tmp.copy(g.mesh.position);
        spawnParticles(origin, 60, 7, 3);
        flashLight.position.copy(origin);
        flashLight.position.y += 0.5;
        flashLeft = 0.25;
        scene.remove(g.mesh);
        g.onExplode(origin);
        grenades.splice(i, 1);
      }
    }
  }

  return {
    step,
    tracer(from, to) {
      const slot = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
      const attr = slot.line.geometry.attributes.position;
      attr.array[0] = from.x;
      attr.array[1] = from.y;
      attr.array[2] = from.z;
      attr.array[3] = to.x;
      attr.array[4] = to.y;
      attr.array[5] = to.z;
      attr.needsUpdate = true;
      slot.line.visible = true;
      slot.life = TRACER_LIFE;
    },
    blood(point) {
      spawnParticles(point, 10, 2.5, 1.2);
    },
    explosion(point) {
      spawnParticles(point, 70, 8, 4);
      flashLight.position.copy(point);
      flashLight.position.y += 0.5;
      flashLeft = 0.3;
    },
    throwGrenade(colliders, from, direction, onExplode) {
      const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
      mesh.position.copy(from);
      scene.add(mesh);
      tmp2.copy(direction).multiplyScalar(13);
      grenades.push({
        mesh,
        colliders,
        vel: new THREE.Vector3(tmp2.x, tmp2.y + 3.5, tmp2.z),
        fuse: 2.1,
        bounces: 0,
        onExplode,
      });
    },
    grenadeRadius() {
      return GRENADE_RADIUS;
    },
    clear() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
      for (const tracer of tracers) {
        tracer.life = 0;
        tracer.line.visible = false;
      }
      particleLife.fill(0);
      particleActive = 0;
      particles.visible = false;
      flashLeft = 0;
      flashLight.intensity = 0;
    },
  };
}
