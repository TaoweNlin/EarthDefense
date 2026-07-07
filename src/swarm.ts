// 虫海系统：视觉层与逻辑层解耦的连续群体渲染。
//
// 原理（亲本对插值）：每只视觉虫绑定同一波次的两个逻辑蜂群（亲本 A/B），
// 位置 = 两亲本连线上的固定随机插值点 + 个体有机摆动。
// 逻辑蜂群构成"骨架"，上万只虫填充骨架之间的空隙——拉远看是一片连续涌动的海，
// 而不是一个个独立小团。无邻居查询、无状态积分，纯函数式求值，性能可控。
//
// 生命周期映射：
// - 亲本受伤 → 按血量比例让该亲本的虫逐只进入消散；
// - 亲本死亡/撞城 → 其余虫原地碎裂飘散 0.5s；
// - 亲本尚未进场（延迟）→ 虫隐藏。

import * as THREE from 'three';
import { InstancePool } from './instances';

/** 逻辑蜂群需要暴露给虫海的最小接口（Orbital 结构子集） */
export interface SwarmParent {
  group: { position: THREE.Vector3; visible: boolean };
  alive: boolean;
  phase: string;
  hp: number;
  maxHp: number;
}

const BUGS_PER_WING = 36;
const FADE_TIME = 0.5;

const _p = new THREE.Vector3();
const _scatter = new THREE.Vector3();

export class SwarmSea {
  private pool: InstancePool;
  private readonly cap: number;

  // 每只虫的静态属性（分配时确定）
  private pA: (SwarmParent | null)[];
  private pB: (SwarmParent | null)[];
  private blend: Float32Array;   // 亲本间插值位置 0..1
  private rank: Uint8Array;      // 在亲本中的序号（用于血量减员）
  private phase: Float32Array;   // 摆动相位
  private freq: Float32Array;    // 摆动频率
  private amp: Float32Array;     // 摆动幅度
  // 动态状态
  private lastX: Float32Array; private lastY: Float32Array; private lastZ: Float32Array;
  private fade: Float32Array;    // >0 = 消散剩余时间；-1 = 存活
  private free: number[] = [];
  private used: number[] = [];

  constructor(parent: THREE.Object3D, capacity = 32768) {
    this.cap = capacity;
    this.pool = new InstancePool(parent, new THREE.TetrahedronGeometry(0.0072), '#f43f5e', capacity);
    this.pA = new Array(capacity).fill(null);
    this.pB = new Array(capacity).fill(null);
    this.blend = new Float32Array(capacity);
    this.rank = new Uint8Array(capacity);
    this.phase = new Float32Array(capacity);
    this.freq = new Float32Array(capacity);
    this.amp = new Float32Array(capacity);
    this.lastX = new Float32Array(capacity);
    this.lastY = new Float32Array(capacity);
    this.lastZ = new Float32Array(capacity);
    this.fade = new Float32Array(capacity).fill(-1);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  /** 注册一个逻辑蜂群：分配一批视觉虫，buddy 为同波次此前生成的蜂群（骨架连线） */
  addWing(w: SwarmParent, buddy: SwarmParent | null) {
    for (let k = 0; k < BUGS_PER_WING; k++) {
      const i = this.free.pop();
      if (i === undefined) return; // 池满：静默降级
      this.pA[i] = w;
      // 2/3 的虫在骨架连线间填充，1/3 留在亲本身边保持核心密度
      this.pB[i] = buddy && Math.random() < 0.67 ? buddy : w;
      this.blend[i] = Math.random();
      this.rank[i] = k;
      this.phase[i] = Math.random() * Math.PI * 2;
      // 轻微呼吸式漂移：整体保持队形朝目标推进，而不是各自乱窜
      this.freq[i] = 0.7 + Math.random() * 0.9;
      this.amp[i] = 0.005 + Math.random() * 0.011;
      this.fade[i] = -1;
      this.used.push(i);
    }
  }

  /** 每帧：求值全部虫位置并写入实例缓冲（主循环每帧调用一次） */
  render(dt: number, time: number) {
    this.pool.begin();
    const used = this.used;
    for (let u = used.length - 1; u >= 0; u--) {
      const i = used[u];

      if (this.fade[i] >= 0) {
        // 消散：原地碎裂、向外飘散、缩小
        this.fade[i] -= dt;
        const fk = this.fade[i] / FADE_TIME;
        if (fk <= 0) {
          // 回收
          this.pA[i] = this.pB[i] = null;
          used[u] = used[used.length - 1];
          used.pop();
          this.free.push(i);
          continue;
        }
        _scatter.set(
          Math.sin(this.phase[i] * 7.1), Math.cos(this.phase[i] * 3.7), Math.sin(this.phase[i] * 5.3),
        ).normalize();
        _p.set(this.lastX[i], this.lastY[i], this.lastZ[i])
          .addScaledVector(_scatter, (1 - fk) * 0.06);
        this.pool.push(_p, time * 3 + this.phase[i], time * 2 + i, fk);
        continue;
      }

      const A = this.pA[i]!;
      // 亲本终结 → 进入消散
      if (!A.alive || A.phase === 'done') { this.fade[i] = FADE_TIME; continue; }
      // 血量减员：亲本每掉一格血，就有虫脱离编队消散
      const aliveBugs = Math.max(1, Math.ceil(BUGS_PER_WING * (A.hp / A.maxHp)));
      if (this.rank[i] >= aliveBugs) { this.fade[i] = FADE_TIME; continue; }
      // 尚未进场：隐藏但不消散
      if (!A.group.visible) continue;

      let B = this.pB[i]!;
      if (!B.alive || B.phase === 'done' || !B.group.visible) B = A; // 搭档没了就收拢回亲本
      // 骨架插值 + 有机摆动
      _p.copy(A.group.position).lerp(B.group.position, this.blend[i]);
      const ph = this.phase[i], fr = this.freq[i], am = this.amp[i];
      _p.x += Math.sin(time * fr + ph) * am;
      _p.y += Math.sin(time * fr * 0.83 + ph * 2.1) * am;
      _p.z += Math.cos(time * fr * 1.19 + ph) * am;
      this.lastX[i] = _p.x; this.lastY[i] = _p.y; this.lastZ[i] = _p.z;
      // 缓慢一致的翻滚：队形感来自克制的旋转
      this.pool.push(_p, time * 0.9 + ph * 0.3, time * 0.7 + ph * 0.5);
    }
    this.pool.end();
  }

  /** 当前存活视觉虫数（调试用） */
  count(): number { return this.used.length; }
}
