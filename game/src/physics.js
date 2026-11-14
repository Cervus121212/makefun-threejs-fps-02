// Shared AABB collision: move a standing body (a vertical box of given radius and
// height) one axis at a time against the map's colliders, so a wall never swallows it.
// One helper, used by the player and by every bot, so their collisions agree.
import * as THREE from 'three';

const probe = new THREE.Box3();

export function bodyOverlaps(colliders, x, y, z, radius, height, lift) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// pos and vel are THREE.Vector3 the caller owns. Returns whether the body stands on
// something after the move. Horizontal motion is blocked per axis; vertical motion
// lands on the top of whatever box it meets from above.
export function moveBody(colliders, pos, vel, dt, radius, height) {
  const nextX = pos.x + vel.x * dt;
  if (!bodyOverlaps(colliders, nextX, pos.y, pos.z, radius, height, 0.04)) {
    pos.x = nextX;
  } else {
    vel.x = 0;
  }
  const nextZ = pos.z + vel.z * dt;
  if (!bodyOverlaps(colliders, pos.x, pos.y, nextZ, radius, height, 0.04)) {
    pos.z = nextZ;
  } else {
    vel.z = 0;
  }
  pos.y += vel.y * dt;
  let grounded = false;
  const hit = bodyOverlaps(colliders, pos.x, pos.y, pos.z, radius, height, 0);
  if (hit) {
    if (vel.y <= 0) {
      pos.y = hit.max.y;
      vel.y = 0;
      grounded = true;
    } else {
      pos.y = hit.min.y - height;
      vel.y = 0;
    }
  }
  if (pos.y < 0) {
    pos.y = 0;
    vel.y = 0;
    grounded = true;
  }
  return grounded;
}

// Cheap segment test against the same colliders: does any box block the line from
// `from` to `to`? Used for line of sight. The direction and length are recomputed
// from the two points, so callers pass plain vectors and keep no raycaster.
const segDir = new THREE.Vector3();
const segRay = new THREE.Ray();

export function segmentBlocked(colliders, from, to) {
  segDir.subVectors(to, from);
  const len = segDir.length();
  if (len < 0.001) return false;
  segDir.multiplyScalar(1 / len);
  segRay.origin.copy(from);
  segRay.direction.copy(segDir);
  const hitPoint = new THREE.Vector3();
  for (let i = 0; i < colliders.length; i += 1) {
    const hit = segRay.intersectBox(colliders[i], hitPoint);
    if (hit && hitPoint.distanceToSquared(from) < len * len) return true;
  }
  return false;
}
