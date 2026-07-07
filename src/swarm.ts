// GPU 虫海：50 万只级别的连续群体渲染。
//
// 架构（骨架纹理 + 顶点着色器求值）：
// - CPU 每帧只把 ≤1024 个逻辑蜂群（骨架）的位置/血量/死亡时间写进一张 1024×2 浮点纹理（16KB）；
// - 每只虫的骨架索引、插值比、相位等是【出生时写一次】的静态实例属性；
// - 位置在顶点着色器里现场求值：骨架A/B 插值 + 正弦摆动 + 静态体积偏移，
//   死亡淡出、血量减员、延迟进场全部由纹理状态驱动，CPU 零逐虫开销。
//
// 槽位模型：1024 个骨架槽，每槽固定拥有 512 只虫的实例区间。
// 蜂群生成 → 占一个槽并重写该区间属性；死亡 → 纹理写入死亡时间（着色器播放碎裂淡出）；
// 淡出结束 → 槽回收。instanceCount 随最高活跃槽收缩，空场时 GPU 零负担。

import * as THREE from 'three';

/** 逻辑蜂群需要暴露给虫海的最小接口（Orbital 结构子集） */
export interface SwarmParent {
  group: { position: THREE.Vector3; visible: boolean };
  alive: boolean;
  phase: string;
  hp: number;
  maxHp: number;
}

const SLOTS = 1024;
const BUGS_PER_SLOT = 512;
const FADE = 0.55;

interface Slot { owner: SwarmParent | null; deathAt: number }

const VERT = /* glsl */ `
  uniform sampler2D uSkel;
  uniform float uTime;
  attribute vec4 aP0; // slotA, slotB, blend, rank01
  attribute vec4 aP1; // phase, freq, amp, seed
  varying float vAlpha;

  vec4 skel(float slot, float row) {
    return texture2D(uSkel, vec2((slot + 0.5) / ${SLOTS}.0, row));
  }

  void main() {
    vec4 A = skel(aP0.x, 0.25);
    vec4 B = skel(aP0.y, 0.25);
    vec4 meta = skel(aP0.x, 0.75); // x = 死亡时刻
    float ph = aP1.x, fr = aP1.y, am = aP1.z, seed = aP1.w;

    // 骨架插值（B 不可用时收拢回 A）
    vec3 anchorB = B.w > 0.0 ? B.xyz : A.xyz;
    vec3 base = mix(A.xyz, anchorB, aP0.z);
    // 静态体积偏移：把虫从骨架线膨胀成有厚度的云
    vec3 offDir = normalize(vec3(sin(seed * 7.13), sin(seed * 3.71 + 1.7), cos(seed * 5.39)));
    float offMag = fract(seed * 0.731) ;
    base += offDir * (offMag * offMag * 0.055);
    // 有机摆动
    base += vec3(
      sin(uTime * fr + ph),
      sin(uTime * fr * 0.83 + ph * 2.1),
      cos(uTime * fr * 1.19 + ph)) * am;

    float scale = 1.0;
    vAlpha = 0.95;
    float state = A.w; // <0 隐藏（未进场）, 0 空/已亡, >0 血量比
    if (state <= 0.0) {
      if (meta.x > 0.0) {
        // 死亡碎裂：向外飘散、缩小、淡出
        float k = clamp(1.0 - (uTime - meta.x) / ${FADE}, 0.0, 1.0);
        scale = k;
        vAlpha = k * 0.95;
        base += offDir * (1.0 - k) * 0.07;
      } else {
        scale = 0.0;
      }
    } else if (aP0.w > state) {
      scale = 0.0; // 血量减员：高序号的虫先脱离
    }

    // 缓慢一致的翻滚
    float c1 = cos(uTime * 0.9 + ph * 0.3), s1 = sin(uTime * 0.9 + ph * 0.3);
    vec3 p = position * scale;
    p = vec3(c1 * p.x + s1 * p.z, p.y, -s1 * p.x + c1 * p.z);
    float c2 = cos(uTime * 0.7 + ph * 0.5), s2 = sin(uTime * 0.7 + ph * 0.5);
    p = vec3(p.x, c2 * p.y - s2 * p.z, s2 * p.y + c2 * p.z);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(base + p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor, vAlpha);
  }
`;

export class SwarmSea {
  private tex: THREE.DataTexture;
  private texData: Float32Array<ArrayBuffer>;
  private geo: THREE.InstancedBufferGeometry;
  private aP0: THREE.InstancedBufferAttribute;
  private aP1: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private slots: Slot[] = [];
  private freeSlots: number[] = [];
  private slotOf = new Map<SwarmParent, number>();
  private attrsDirty = false;
  private activeCount = 0;

  constructor(parent: THREE.Object3D) {
    // 骨架纹理：行0 = 位置+状态，行1 = 死亡时刻
    this.texData = new Float32Array(new ArrayBuffer(SLOTS * 2 * 4 * 4));
    this.tex = new THREE.DataTexture(this.texData, SLOTS, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;

    // 单三角形线框（每只 3 条边，50 万只 ≈ 314 万顶点，GPU 可承受）
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0.009, 0, 0, -0.006, 0.007, 0, -0.006, -0.007, 0,
    ]), 3));
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', tri.getAttribute('position'));
    const total = SLOTS * BUGS_PER_SLOT;
    this.aP0 = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
    this.aP1 = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
    this.aP0.setUsage(THREE.DynamicDrawUsage);
    this.aP1.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aP0', this.aP0);
    this.geo.setAttribute('aP1', this.aP1);
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSkel: { value: this.tex },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#f43f5e') },
      },
      wireframe: true,
      transparent: true,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    parent.add(mesh);

    for (let s = SLOTS - 1; s >= 0; s--) {
      this.slots.push({ owner: null, deathAt: 0 });
      this.freeSlots.push(s);
    }
  }

  /** 注册一个逻辑蜂群：占一个骨架槽，重写它拥有的 512 只虫的静态属性 */
  addWing(w: SwarmParent, buddy: SwarmParent | null) {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return; // 槽满：静默降级
    this.slots[slot] = { owner: w, deathAt: 0 };
    this.slotOf.set(w, slot);
    const buddySlot = buddy ? (this.slotOf.get(buddy) ?? slot) : slot;

    const p0 = this.aP0.array as Float32Array;
    const p1 = this.aP1.array as Float32Array;
    const base = slot * BUGS_PER_SLOT;
    for (let k = 0; k < BUGS_PER_SLOT; k++) {
      const o = (base + k) * 4;
      p0[o] = slot;
      p0[o + 1] = buddySlot;
      p0[o + 2] = -0.2 + Math.random() * 1.4; // 插值比略越界：海面边缘的绒毛
      p0[o + 3] = k / BUGS_PER_SLOT;          // 减员序号
      p1[o] = Math.random() * Math.PI * 2;
      p1[o + 1] = 0.7 + Math.random() * 0.9;  // 摆动频率
      p1[o + 2] = 0.005 + Math.random() * 0.011; // 摆动幅度
      p1[o + 3] = Math.random() * 100;        // 体积偏移种子
    }
    // 初始隐藏（未进场）
    const t = slot * 4;
    this.texData[t + 3] = -1;
    this.texData[SLOTS * 4 + t] = 0;
    this.attrsDirty = true;
  }

  /** 每帧：同步骨架状态到纹理（CPU 成本与虫数无关，只与骨架数有关） */
  render(_dt: number, time: number) {
    let maxSlot = -1;
    for (let s = 0; s < SLOTS; s++) {
      const slot = this.slots[s];
      const t = s * 4;
      const mt = SLOTS * 4 + t;
      if (!slot.owner) {
        if (slot.deathAt > 0 && time > slot.deathAt + FADE + 0.1) {
          // 碎裂动画播完才回收槽位，避免复用打断淡出
          slot.deathAt = 0;
          this.texData[mt] = 0;
          this.freeSlots.push(s);
        }
        if (slot.deathAt > 0) maxSlot = s; // 淡出中仍需渲染
        continue;
      }
      const w = slot.owner;
      if (!w.alive || w.phase === 'done') {
        // 死亡：写入死亡时刻，着色器播放碎裂
        slot.deathAt = time;
        this.texData[t + 3] = 0;
        this.texData[mt] = time;
        this.slotOf.delete(w);
        slot.owner = null;
        maxSlot = s;
        continue;
      }
      const p = w.group.position;
      this.texData[t] = p.x;
      this.texData[t + 1] = p.y;
      this.texData[t + 2] = p.z;
      this.texData[t + 3] = w.group.visible ? Math.max(0.02, w.hp / w.maxHp) : -1;
      maxSlot = s;
    }
    this.tex.needsUpdate = true;
    this.geo.instanceCount = (maxSlot + 1) * BUGS_PER_SLOT;
    this.activeCount = this.geo.instanceCount;
    if (this.attrsDirty) {
      this.aP0.needsUpdate = true;
      this.aP1.needsUpdate = true;
      this.attrsDirty = false;
    }
    this.mat.uniforms.uTime.value = time;
  }

  /** 当前提交渲染的实例数（调试用） */
  count(): number { return this.activeCount; }
}
