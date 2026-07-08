// InstancedMesh 渲染池：海量同类单位一次 draw call。
// 用法：每帧 begin() → 逐单位 push(pos, rx, ry) → end()。

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);

export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  private i = 0;
  private readonly capacity: number;

  constructor(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    color: THREE.Color | string,
    capacity: number,
    opacity = 0.95,
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity,
    });
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // 单位绕满整球，包围盒剔除只会误伤
    this.mesh.renderOrder = 6;
    parent.add(this.mesh);
  }

  begin() { this.i = 0; }

  push(pos: THREE.Vector3, rx: number, ry: number, scale = 1) {
    if (this.i >= this.capacity) return; // 超容量静默丢弃（保险丝在生成侧）
    _e.set(rx, ry, 0);
    _q.setFromEuler(_e);
    _s.setScalar(scale);
    _m.compose(pos, _q, _s);
    this.mesh.setMatrixAt(this.i++, _m);
  }

  end() {
    this.mesh.count = this.i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
