// Orientation math for the pose view. Pure functions, so tests/dashboard/pose.test.mjs can run
// them in Node. A quaternion is { w, x, y, z } and, as VQF defines it (src/orientation.h), rotates
// a vector from the board's IMU frame into a world frame whose z axis points up.

const DEG = 180 / Math.PI;

/** Hamilton product a ⊗ b: the rotation b followed by a. */
export function quatMultiply(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Rotates vector [x, y, z] by q (IMU frame in, world frame out). */
export function rotateVector(q, [x, y, z]) {
  const { w, x: qx, y: qy, z: qz } = q;
  return [
    (1 - 2 * (qy * qy + qz * qz)) * x + 2 * (qx * qy - w * qz) * y + 2 * (qx * qz + w * qy) * z,
    2 * (qx * qy + w * qz) * x + (1 - 2 * (qx * qx + qz * qz)) * y + 2 * (qy * qz - w * qx) * z,
    2 * (qx * qz - w * qy) * x + 2 * (qy * qz + w * qx) * y + (1 - 2 * (qx * qx + qy * qy)) * z,
  ];
}

/** Roll, pitch and yaw in degrees (Z-Y-X order: yaw about world up, then pitch, then roll). */
export function quatToEulerDegrees({ w, x, y, z }) {
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - z * x))); // rounding can step past ±1
  return {
    roll: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG,
    pitch: Math.asin(sinPitch) * DEG,
    yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG,
  };
}

/** The inverse of unit quaternion q. */
export function quatConjugate({ w, x, y, z }) {
  return { w, x: -x, y: -y, z: -z };
}

/**
 * How far the board has turned about world up since pose `from`, in degrees (-180..180]: the
 * twist of the rotation between the two poses (swing-twist decomposition). Tilting the board
 * leaves it unchanged, unlike Euler yaw, which near pitch ±90° turns a tiny tilt into a large
 * swing: steeply pitched and still, VQF's tilt following the accelerometer's slow creep read as
 * 0.08°/s of Euler yaw drift, while this stayed within 0.0001°/s.
 */
export function headingChangeDegrees(from, to) {
  const turn = quatMultiply(to, quatConjugate(from));
  const deg = 2 * Math.atan2(turn.z, turn.w) * DEG; // q and -q are one rotation, so wrap
  return deg > 180 ? deg - 360 : deg <= -180 ? deg + 360 : deg;
}

/** q turned by -yawDeg about world up: re-zeroes the heading, leaving roll and pitch alone. */
export function removeYaw(q, yawDeg) {
  const half = (-yawDeg / DEG) / 2;
  return quatMultiply({ w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) }, q);
}
