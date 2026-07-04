// Goldberg 多面体网格：细分二十面体后取对偶。
// 频率 f=8 → 10*f*f+2 = 642 个格子（630 六边形 + 12 五边形）。

import * as THREE from 'three';
import { fbm } from './noise';

export type Terrain = 'ocean' | 'land';

export interface Cell {
  id: number;
  center: THREE.Vector3;      // 单位球面上的格子中心
  polygon: THREE.Vector3[];   // 按顺序排列的顶点（单位球面上）
  neighbors: number[];
  terrain: Terrain;
  isPentagon: boolean;
}

export interface GoldbergGrid {
  cells: Cell[];
  /** 所有格子边界线段（去重后），成对存放 [a0,b0, a1,b1, ...] */
  gridEdges: THREE.Vector3[];
  /** 海陆分界线段（大陆轮廓），成对存放 */
  coastEdges: THREE.Vector3[];
}

const PHI = (1 + Math.sqrt(5)) / 2;

function icosahedron(): { verts: THREE.Vector3[]; faces: [number, number, number][] } {
  const v = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ].map((a) => new THREE.Vector3(a[0], a[1], a[2]).normalize());
  const f: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { verts: v, faces: f };
}

export function buildGoldberg(frequency: number, seed = 1337): GoldbergGrid {
  const ico = icosahedron();
  const f = frequency;

  // --- 1. 细分：为每个二十面体面生成重心网格点，跨面去重 ---
  const verts: THREE.Vector3[] = [];
  const vertKey = new Map<string, number>();

  function addVert(p: THREE.Vector3): number {
    const k = `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
    let idx = vertKey.get(k);
    if (idx === undefined) {
      idx = verts.length;
      verts.push(p.clone());
      vertKey.set(k, idx);
    }
    return idx;
  }

  const faces: [number, number, number][] = [];

  for (const [ia, ib, ic] of ico.faces) {
    const A = ico.verts[ia], B = ico.verts[ib], C = ico.verts[ic];
    // grid[i][j]：i 行（0..f），每行 i+1 个点
    const grid: number[][] = [];
    for (let i = 0; i <= f; i++) {
      const row: number[] = [];
      for (let j = 0; j <= i; j++) {
        // p = A + (B-A)*i/f + (C-B)*j/f  的重心形式
        const a = (f - i) / f;
        const b = (i - j) / f;
        const c = j / f;
        const p = new THREE.Vector3()
          .addScaledVector(A, a)
          .addScaledVector(B, b)
          .addScaledVector(C, c)
          .normalize();
        row.push(addVert(p));
      }
      grid.push(row);
    }
    for (let i = 0; i < f; i++) {
      for (let j = 0; j <= i; j++) {
        faces.push([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1]]);
        if (j < i) faces.push([grid[i][j], grid[i + 1][j + 1], grid[i][j + 1]]);
      }
    }
  }

  // --- 2. 面重心（投影回球面），顶点→面邻接 ---
  const centroids: THREE.Vector3[] = faces.map(([a, b, c]) =>
    new THREE.Vector3().add(verts[a]).add(verts[b]).add(verts[c]).divideScalar(3).normalize()
  );

  const vertFaces: number[][] = verts.map(() => []);
  faces.forEach((face, fi) => {
    for (const vi of face) vertFaces[vi].push(fi);
  });

  // 边 → 两侧面，用于网格线与邻接
  const edgeFaces = new Map<string, { v1: number; v2: number; faces: number[] }>();
  faces.forEach((face, fi) => {
    for (let e = 0; e < 3; e++) {
      const v1 = face[e], v2 = face[(e + 1) % 3];
      const k = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      let rec = edgeFaces.get(k);
      if (!rec) {
        rec = { v1: Math.min(v1, v2), v2: Math.max(v1, v2), faces: [] };
        edgeFaces.set(k, rec);
      }
      rec.faces.push(fi);
    }
  });

  // --- 3. 对偶：每个原顶点 → 一个格子，多边形 = 周围面重心按角度排序 ---
  const cells: Cell[] = verts.map((v, vi) => {
    const fs = vertFaces[vi];
    const n = v.clone();
    // 切平面基
    const ref = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(n, ref).normalize();
    const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
    const sorted = fs
      .map((fi) => {
        const d = centroids[fi].clone().sub(v);
        return { fi, ang: Math.atan2(d.dot(e2), d.dot(e1)) };
      })
      .sort((a, b) => a.ang - b.ang)
      .map((o) => centroids[o.fi].clone());

    // 地形：fbm 噪声 + 轻微纬度调制，阈值取陆地占比约 35%
    const nv = fbm(v.x, v.y, v.z, seed);
    const terrain: Terrain = nv > 0.495 ? 'land' : 'ocean';

    return {
      id: vi,
      center: v.clone(),
      polygon: sorted,
      neighbors: [],
      terrain,
      isPentagon: fs.length === 5,
    };
  });

  // --- 4. 邻接 ---
  for (const rec of edgeFaces.values()) {
    if (rec.faces.length !== 2) continue;
    cells[rec.v1].neighbors.push(rec.v2);
    cells[rec.v2].neighbors.push(rec.v1);
  }

  // --- 5. 地形平滑：两轮邻居多数投票，消除单格小岛/内湖 ---
  for (let pass = 0; pass < 2; pass++) {
    const next = cells.map((c) => {
      let landCount = c.terrain === 'land' ? 1.5 : 0;
      for (const ni of c.neighbors) if (cells[ni].terrain === 'land') landCount++;
      return landCount > (c.neighbors.length + 1.5) / 2 ? 'land' : 'ocean';
    });
    cells.forEach((c, i) => (c.terrain = next[i] as Terrain));
  }

  // --- 6. 网格线 + 海岸线 ---
  const gridEdges: THREE.Vector3[] = [];
  const coastEdges: THREE.Vector3[] = [];
  for (const rec of edgeFaces.values()) {
    if (rec.faces.length !== 2) continue;
    const a = centroids[rec.faces[0]];
    const b = centroids[rec.faces[1]];
    gridEdges.push(a.clone(), b.clone());
    if (cells[rec.v1].terrain !== cells[rec.v2].terrain) {
      coastEdges.push(a.clone(), b.clone());
    }
  }

  return { cells, gridEdges, coastEdges };
}
