// Weapons: five original guns, each a data row plus one shared view model. The data
// is what the simulation reads (damage, spread, fire rate, price); the view model is
// only a few boxes parented to the camera, rebuilt per weapon from the same parts.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headDamage: 78, magSize: 12, reserve: 36,
    fireGap: 0.16, auto: false, reloadTime: 1.3,
    spreadStill: 0.004, spreadMove: 0.02, recoil: 0.011, pellets: 1,
    range: 60, barrel: 0.22, grip: 0.09,
  },
  smg: {
    id: 'smg', name: 'VK-9 Raptor', kind: 'smg', price: 1250,
    damage: 22, headDamage: 66, magSize: 28, reserve: 84,
    fireGap: 0.075, auto: true, reloadTime: 1.7,
    spreadStill: 0.006, spreadMove: 0.026, recoil: 0.008, pellets: 1,
    range: 55, barrel: 0.34, grip: 0.11,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', kind: 'rifle', price: 2700,
    damage: 33, headDamage: 99, magSize: 25, reserve: 75,
    fireGap: 0.1, auto: true, reloadTime: 2.1,
    spreadStill: 0.002, spreadMove: 0.028, recoil: 0.013, pellets: 1,
    range: 80, barrel: 0.46, grip: 0.13,
  },
  sniper: {
    id: 'sniper', name: 'Heron-12', kind: 'sniper', price: 4750,
    damage: 95, headDamage: 190, magSize: 5, reserve: 15,
    fireGap: 1.15, auto: false, reloadTime: 2.8,
    spreadStill: 0.0004, spreadMove: 0.05, recoil: 0.05, pellets: 1,
    range: 90, barrel: 0.62, grip: 0.16, scoped: true,
  },
  shotgun: {
    id: 'shotgun', name: 'Mule-12 Breacher', kind: 'shotgun', price: 1700,
    damage: 11, headDamage: 22, magSize: 6, reserve: 18,
    fireGap: 0.85, auto: false, reloadTime: 2.6,
    spreadStill: 0.02, spreadMove: 0.045, recoil: 0.032, pellets: 8,
    range: 30, barrel: 0.4, grip: 0.14,
  },
};

export const BUY_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];

export function createWeaponRig(camera) {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.signal), roughness: 0.45, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.7, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.5, metalness: 0.2 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.26), metal);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), dark);
  barrel.position.set(0, 0.02, -0.26);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), dark);
  stock.position.set(0, -0.015, 0.2);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.06), accent);
  sight.position.set(0, 0.065, -0.04);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.22, -0.23, -0.5);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.22, -0.2, -1.0);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 6);
  flashLight.position.set(0.22, -0.18, -0.7);
  camera.add(flashLight);

  let current = WEAPONS.rifle;
  const state = { mag: current.magSize, reserve: current.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  // Ammo is kept per weapon, so switching to the pistol and back does not refill it.
  const stash = {};

  function applyModel() {
    const scale = current.barrel / 0.46;
    barrel.scale.z = scale;
    barrel.position.z = -0.26 - (current.barrel - 0.46) * 0.4;
    receiver.scale.z = 0.7 + current.grip;
    sight.visible = current.kind !== 'sniper';
    model.position.x = current.kind === 'pistol' ? 0.19 : 0.22;
  }
  applyModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 28;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / current.reloadTime;
      model.rotation.x = -0.5 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const need = current.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get def() {
      return current;
    },
    step,
    equip(def, keepAmmo) {
      stash[current.id] = { mag: state.mag, reserve: state.reserve };
      current = def;
      const saved = stash[def.id];
      if (saved) {
        state.mag = saved.mag;
        state.reserve = saved.reserve;
      } else {
        state.mag = def.magSize;
        state.reserve = def.reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      applyModel();
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = current.fireGap;
      state.flash = 0.06;
      state.kick = 0.05 + current.recoil * 0.6;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === current.magSize || state.reserve === 0) return;
      state.reloadLeft = current.reloadTime;
    },
    spread(speed, moving) {
      const base = current.spreadStill + Math.min(1, speed / 5.4) * current.spreadMove;
      return moving ? base * 1.6 : base;
    },
    refillAmmo() {
      // A new round refills every weapon the player owns.
      for (const key of Object.keys(stash)) delete stash[key];
      state.mag = current.magSize;
      state.reserve = current.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
    },
  };
}
