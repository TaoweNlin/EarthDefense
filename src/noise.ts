// 简易 3D 值噪声 + fbm，用于生成风格化虚构大陆。无外部依赖。

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed + x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise3(px: number, py: number, pz: number, seed: number): number {
  const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
  const fx = smooth(px - x0), fy = smooth(py - y0), fz = smooth(pz - z0);

  let result = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w =
          (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        result += w * hash3(x0 + dx, y0 + dy, z0 + dz, seed);
      }
    }
  }
  return result;
}

/** fbm 分形噪声，输入单位球面坐标，输出 [0,1] 附近 */
export function fbm(x: number, y: number, z: number, seed = 1337): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.6;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise3(x * freq + 100, y * freq + 100, z * freq + 100, seed + o * 101);
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
