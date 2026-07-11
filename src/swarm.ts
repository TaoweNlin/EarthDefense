// GPGPU 虫海：每只虫都是真实个体（几十万级）。
//
// 架构（位置/速度浮点纹理 + GPU ping-pong 积分）：
// - 每只虫的【位置】和【速度】各存进一张 1024×512 浮点纹理，GPUComputationRenderer
//   每帧在 GPU 上积分（位置 += 速度·dt；速度 += 受力·dt）——每只虫有自己的动量和轨迹。
// - 受力 = 朝所属蜂群"家点"的弹簧 + 低频湍流漂移 + 帧率无关阻尼（惯性、不振荡）。
// - 逻辑蜂群（骨架）仍是玩法实体：被瞄准、有血、被击杀。CPU 每帧把 ≤4096 个骨架写进
//   4096×4 骨架纹理：行0=位置+状态(血量比/隐藏)，行1=死亡/进场时刻，行2=平滑航向（统一朝向），
//   行3=死亡命中点（涟漪原点）。虫子的目标、减员、生死、朝向全部由骨架纹理驱动。
//
// 槽位模型：4096 槽 × 128 虫 = 524288。虫 i 永远映射到固定纹理像素、槽 floor(i/128)、序号 i%128。
// 逐虫静态属性（纹理 UV、槽号、序号）构造时一次性写死；addWing 只占槽 + 写骨架像素,
// 槽满时返回 false（调用方据此不创建逻辑单位，保证"可见容量 = 逻辑容量"）。

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

/** 逻辑蜂群需要暴露给虫海的最小接口（Orbital 结构子集） */
export interface SwarmParent {
  group: { position: THREE.Vector3; visible: boolean };
  alive: boolean;
  phase: string;
  hp: number;
  maxHp: number;
  hit?: { x: number; y: number; z: number }; // 致死命中点，死亡涟漪原点
}

const TEX_W = 1024;
const TEX_H = 512;                 // 1024×512 = 524288 只虫
const SLOTS = 4096;                // 作战单位槽（每个是一小簇 → 中弹只散一小片）
const BUGS_PER_SLOT = 128;         // 每单位的虫数
const FADE = 0.5;                  // 单只虫的淡出时长
const RIPPLE = 1.5;                // 死亡涟漪：每单位距离的延迟秒数（近命中点先死）
const MAX_RIPPLE_DELAY = 0.4;      // 涟漪延迟封顶
const RANK_DELAY = 0.06;           // 序号错峰上限
// 槽位回收必须等最后一只虫淡完：派生自上面的常量，别手写数字
const RECYCLE_AFTER = FADE + MAX_RIPPLE_DELAY + RANK_DELAY + 0.1;
/** 簇半径：虫围绕蜂群"家点"的散布尺度。game.ts 的命中点采样从这里派生。 */
export const CLUSTER_RADIUS = 0.18;

// 骨架纹理 4 行的 v 坐标（单一来源，插值进所有着色器）
const ROWV = ['0.125', '0.375', '0.625', '0.875']; // 行0 位置+状态 / 行1 生死时刻 / 行2 航向 / 行3 命中点

interface Slot {
  owner: SwarmParent | null; deathAt: number;
  // 平滑航向（整团虫统一朝向）+ 上一帧位置
  hx: number; hy: number; hz: number; lx: number; ly: number; lz: number; hasLast: boolean;
}

// ---- GLSL 公用片段 ----
const HASH = /* glsl */ `
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // 低频相干流场：整片虫云一起缓慢涌动的来源
  vec3 flow(vec3 p, float t) {
    vec3 q = p * 3.0;
    return vec3(
      sin(q.y + t) + cos(q.z - t * 0.7),
      sin(q.z + t * 0.4) + cos(q.x + t * 0.9),
      sin(q.x - t * 0.6) + cos(q.y + t * 0.5));
  }
`;

const IDX = /* glsl */ `
  #define ROW0 ${ROWV[0]}
  #define ROW1 ${ROWV[1]}
  #define ROW3 ${ROWV[3]}
  float bugIndex() { return floor(gl_FragCoord.y) * ${TEX_W}.0 + floor(gl_FragCoord.x); }
  vec4 skelRow(float slot, float row) {
    return texture2D(uSkel, vec2((slot + 0.5) / ${SLOTS}.0, row));
  }
`;

// 位置积分着色器
const POS_SHADER = /* glsl */ `
  uniform sampler2D uSkel;
  uniform float uDt;
  ${HASH}
  ${IDX}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texPosition, uv);
    vec4 vel = texture2D(texVelocity, uv);
    float index = bugIndex();
    float slot = floor(index / ${BUGS_PER_SLOT}.0);
    vec4 s0 = skelRow(slot, ROW0);   // xyz=蜂群位置, w=血量比/隐藏(-1)
    vec4 s1 = skelRow(slot, ROW1);   // x=死亡时刻, y=进场时刻
    float state = s0.w, death = s1.x, birth = s1.y;

    // 出生重置：在所属蜂群附近散开显形（虫与作战单位同位，塔打中就死）
    if (birth > 0.0 && pos.w != birth) {
      vec3 off = (hash33(vec3(index) + 1.7) - 0.5) * 0.3;
      gl_FragColor = vec4(s0.xyz + off, birth);
      return;
    }
    // 未激活/已回收：冻结
    if (state <= 0.0 && death <= 0.0) { gl_FragColor = pos; return; }

    gl_FragColor = vec4(pos.xyz + vel.xyz * uDt, pos.w);
  }
`;

// 速度积分着色器（受力 = 弹簧归位 + 低频湍流 + 帧率无关阻尼）
const VEL_SHADER = /* glsl */ `
  uniform sampler2D uSkel;
  uniform float uTime;
  uniform float uDt;
  uniform float uSeek;
  uniform float uTurb;
  uniform float uDamp;
  uniform float uMaxSpeed;
  ${HASH}
  ${IDX}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texPosition, uv);
    vec4 vel = texture2D(texVelocity, uv);
    float index = bugIndex();
    float slot = floor(index / ${BUGS_PER_SLOT}.0);
    vec4 s0 = skelRow(slot, ROW0);
    vec4 s1 = skelRow(slot, ROW1);
    float state = s0.w, death = s1.x, birth = s1.y;
    vec3 wingPos = s0.xyz;

    if (birth > 0.0 && pos.w != birth) {
      gl_FragColor = vec4((hash33(vec3(index) + 7.0) - 0.5) * 0.04, 0.0);
      return;
    }
    if (state <= 0.0 && death <= 0.0) { gl_FragColor = vec4(0.0); return; }

    // 阻尼按 dt 归一（以 60fps 为基准），任何刷新率下手感一致
    float damp60 = uDt * 60.0;
    vec3 v = vel.xyz;
    if (death > 0.0) {
      // 死亡：所有虫立即向命中点外炸散（没有一只僵住），近命中点推力更大 → 先被撕开
      vec3 impact = skelRow(slot, ROW3).xyz;
      vec3 outDir = pos.xyz - impact;
      float dist = length(outDir);
      v += (outDir / max(dist, 1e-4)) * (2.4 / (1.0 + dist * 5.0)) * uDt;
      v *= pow(0.95, damp60); // 轻阻尼，保持飞出的动量
    } else {
      // 存活：贴住蜂群的稳定"家点"，弹簧+强阻尼平滑归位（略过阻尼，不振荡）
      vec3 goff = (hash33(vec3(index) + 9.1) - 0.5) * 2.0;
      vec3 goal = wingPos + goff * ${CLUSTER_RADIUS.toFixed(2)};
      vec3 spring = (goal - pos.xyz) * uSeek;
      vec3 turb = flow(pos.xyz * 0.5, uTime * 0.4) * uTurb; // 低频相干漂移
      v += (spring + turb) * uDt;
      v *= pow(uDamp, damp60);
    }
    float sp = length(v);
    if (sp > uMaxSpeed) v *= uMaxSpeed / sp;

    gl_FragColor = vec4(v, 0.0);
  }
`;

// 渲染顶点着色器：从位置纹理取位，按蜂群平滑航向统一朝向，生死状态驱动缩放/透明
const RENDER_VERT = /* glsl */ `
  uniform sampler2D texPosition;
  uniform sampler2D uSkel;
  uniform float uTime;
  attribute vec2 aUv;    // 该虫在 GPGPU 纹理里的像素中心
  attribute vec2 aMeta;  // slot, rank01（已预乘 0.92：满血时全簇满员）
  varying float vAlpha;

  vec4 skelRow(float slot, float row) {
    return texture2D(uSkel, vec2((slot + 0.5) / ${SLOTS}.0, row));
  }

  void main() {
    vec3 pos = texture2D(texPosition, aUv).xyz;
    float slot = aMeta.x, rank01 = aMeta.y;
    vec4 s0 = skelRow(slot, ${ROWV[0]});   // 位置+状态
    vec4 s1 = skelRow(slot, ${ROWV[1]});   // 死亡/进场时刻
    float state = s0.w, death = s1.x, birth = s1.y;

    float scale = 1.0; vAlpha = 0.95;
    if (state <= 0.0) {
      if (death > 0.0) {
        // 命中点涟漪淡出：近的先熄灭，往外一圈圈死；延迟封顶，不满显示滞留
        vec3 impact = skelRow(slot, ${ROWV[3]}).xyz;
        float delay = min(length(pos - impact) * ${RIPPLE.toFixed(1)}, ${MAX_RIPPLE_DELAY.toFixed(2)})
                    + rank01 * ${RANK_DELAY.toFixed(2)};
        float local = uTime - death - delay;
        float k = local <= 0.0 ? 1.0 : clamp(1.0 - local / ${FADE.toFixed(2)}, 0.0, 1.0);
        scale = k; vAlpha = k * 0.95;
      } else scale = 0.0;
    } else {
      // 血量侵蚀带：边缘逐只剥落（rank01 预乘 0.92，满血 state=1 时全员 erode=1）
      float erode = clamp((state - rank01) / 0.08, 0.0, 1.0);
      scale *= erode; vAlpha *= erode;
      // 出生显形
      if (birth > 0.0) { float g = clamp((uTime - birth) / 1.0, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g); scale *= g; vAlpha *= g; }
    }

    // 朝向：整团虫统一朝蜂群平滑航向（行2）飞；航向太小则回退朝星球
    vec3 head = skelRow(slot, ${ROWV[2]}).xyz;
    vec3 fwd = length(head) > 0.03 ? normalize(head)
             : (length(pos) > 1e-3 ? normalize(-pos) : vec3(0.0, 0.0, 1.0));
    vec3 up = abs(fwd.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(up, fwd));
    up = cross(fwd, right);
    vec3 lp = position * scale;
    vec3 world = pos + right * lp.x + up * lp.y + fwd * lp.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const RENDER_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor, vAlpha);
  }
`;

export class SwarmSea {
  private gpu: GPUComputationRenderer;
  private posVar: any;
  private velVar: any;
  private skelTex: THREE.DataTexture;
  private skelData: Float32Array<ArrayBuffer>;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private slots: Slot[] = [];
  private freeSlots: number[] = [];   // 维持降序，pop() 取最小空闲槽 → instanceCount 能随战场收缩
  private freeDirty = false;          // 回收后置脏，下次分配前重排一次
  private slotOf = new Map<SwarmParent, number>();
  private activeCount = 0;

  constructor(parent: THREE.Object3D, renderer: THREE.WebGLRenderer) {
    // ---- 骨架纹理（CPU 每帧写，与虫数无关）----
    this.skelData = new Float32Array(new ArrayBuffer(SLOTS * 4 * 4 * 4));
    this.skelTex = new THREE.DataTexture(this.skelData, SLOTS, 4, THREE.RGBAFormat, THREE.FloatType);
    this.skelTex.magFilter = THREE.NearestFilter;
    this.skelTex.minFilter = THREE.NearestFilter;
    this.skelTex.needsUpdate = true;

    // ---- GPGPU 位置/速度双纹理 ----
    this.gpu = new GPUComputationRenderer(TEX_W, TEX_H, renderer);
    this.gpu.setDataType(THREE.FloatType);
    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    this.posVar = this.gpu.addVariable('texPosition', POS_SHADER, pos0);
    this.velVar = this.gpu.addVariable('texVelocity', VEL_SHADER, vel0);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    for (const v of [this.posVar, this.velVar]) {
      v.material.uniforms.uSkel = { value: this.skelTex };
      v.material.uniforms.uDt = { value: 0 };
    }
    this.velVar.material.uniforms.uTime = { value: 0 };
    this.velVar.material.uniforms.uSeek = { value: 7.0 };    // 弹簧系数（配强阻尼 = 平滑归位）
    this.velVar.material.uniforms.uTurb = { value: 0.014 }; // 低频漂移（很轻的生命感）
    this.velVar.material.uniforms.uDamp = { value: 0.9 };   // 每 1/60s 的速度保留率（shader 内按 dt 归一）
    this.velVar.material.uniforms.uMaxSpeed = { value: 0.5 };
    const err = this.gpu.init();
    if (err) console.error('[swarm] GPGPU init:', err);

    // ---- 渲染实例：蝶形体（tip=+z）+ 逐虫静态属性（一次写死）----
    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0.01, 0.008, 0, -0.007, -0.008, 0, -0.007,   // 横翼
      0, 0, 0.01, 0, 0.008, -0.007, 0, -0.008, -0.007,   // 纵翼
    ]), 3));
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', body.getAttribute('position'));
    const total = TEX_W * TEX_H;
    const aUv = new Float32Array(total * 2);
    const aMeta = new Float32Array(total * 2);
    for (let i = 0; i < total; i++) {
      aUv[i * 2] = ((i % TEX_W) + 0.5) / TEX_W;
      aUv[i * 2 + 1] = (Math.floor(i / TEX_W) + 0.5) / TEX_H;
      aMeta[i * 2] = Math.floor(i / BUGS_PER_SLOT);
      // 预乘 0.92：满血 state=1.0 时最高序号也在侵蚀带之外（全簇满员出场）
      aMeta[i * 2 + 1] = ((i % BUGS_PER_SLOT) / BUGS_PER_SLOT) * 0.92;
    }
    this.geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 2));
    this.geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(aMeta, 2));
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      uniforms: {
        texPosition: { value: null },
        uSkel: { value: this.skelTex },
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
      this.slots.push({ owner: null, deathAt: 0, hx: 0, hy: 0, hz: 0, lx: 0, ly: 0, lz: 0, hasLast: false });
      this.freeSlots.push(s); // 降序入栈 → pop() 从 0 开始升序分配
    }
  }

  /** 注册一个逻辑蜂群：占一个骨架槽。返回 false = 槽满，调用方不应创建这只逻辑单位。 */
  addWing(w: SwarmParent): boolean {
    if (this.freeDirty) {
      // 回收会打乱顺序：重排为降序，让 pop() 始终取最小空闲槽（maxSlot 随战场收缩）
      this.freeSlots.sort((a, b) => b - a);
      this.freeDirty = false;
    }
    const slot = this.freeSlots.pop();
    if (slot === undefined) return false;
    this.slots[slot] = { owner: w, deathAt: 0, hx: 0, hy: 0, hz: 0, lx: 0, ly: 0, lz: 0, hasLast: false };
    this.slotOf.set(w, slot);
    const t = slot * 4;
    this.skelData[t + 3] = -1;            // state 隐藏
    this.skelData[SLOTS * 4 + t] = 0;     // 死亡时刻
    this.skelData[SLOTS * 4 + t + 1] = 0; // 进场时刻
    return true;
  }

  /** 每帧：同步骨架 → 纹理，跑 GPGPU 积分（子步），更新渲染 uniform。dt = 模拟步长（含倍速）。 */
  render(dt: number, time: number) {
    const CROW = SLOTS * 2 * 4; // 行2 = 蜂群平滑航向
    let maxSlot = -1;
    for (let s = 0; s < SLOTS; s++) {
      const slot = this.slots[s];
      const t = s * 4;
      const mt = SLOTS * 4 + t;
      if (!slot.owner) {
        // 回收等到整簇涟漪淡完（时限由 FADE/涟漪常量派生），否则尾部虫会半路突然消失
        if (slot.deathAt > 0 && time > slot.deathAt + RECYCLE_AFTER) {
          slot.deathAt = 0;
          this.skelData[mt] = 0;
          this.skelData[mt + 1] = 0;
          this.freeSlots.push(s);
          this.freeDirty = true;
        }
        if (slot.deathAt > 0) maxSlot = s;
        continue;
      }
      const w = slot.owner;
      if (!w.alive || w.phase === 'done') {
        slot.deathAt = time;
        this.skelData[t + 3] = 0;
        this.skelData[mt] = time;
        // 命中点写入行3：死亡涟漪从这里向外一圈圈撕开（无命中点则用当前位置）
        const ht = SLOTS * 3 * 4 + t;
        const h = w.hit;
        if (h) { this.skelData[ht] = h.x; this.skelData[ht + 1] = h.y; this.skelData[ht + 2] = h.z; }
        else { const p = w.group.position; this.skelData[ht] = p.x; this.skelData[ht + 1] = p.y; this.skelData[ht + 2] = p.z; }
        this.slotOf.delete(w);
        slot.owner = null;
        maxSlot = s;
        continue;
      }
      const p = w.group.position;
      this.skelData[t] = p.x;
      this.skelData[t + 1] = p.y;
      this.skelData[t + 2] = p.z;
      this.skelData[t + 3] = w.group.visible ? Math.max(0.02, w.hp / w.maxHp) : -1;
      if (w.group.visible && this.skelData[mt + 1] === 0) this.skelData[mt + 1] = time;
      maxSlot = s;
      // 平滑航向：由蜂群位移得到，整团虫统一朝这个方向飞
      if (w.group.visible) {
        if (slot.hasLast) {
          let dx = p.x - slot.lx, dy = p.y - slot.ly, dz = p.z - slot.lz;
          const dl = Math.hypot(dx, dy, dz);
          if (dl > 1e-6) {
            dx /= dl; dy /= dl; dz /= dl;
            slot.hx = slot.hx * 0.9 + dx * 0.1;
            slot.hy = slot.hy * 0.9 + dy * 0.1;
            slot.hz = slot.hz * 0.9 + dz * 0.1;
          }
        }
        slot.lx = p.x; slot.ly = p.y; slot.lz = p.z; slot.hasLast = true;
        const ct = CROW + t;
        this.skelData[ct] = slot.hx;
        this.skelData[ct + 1] = slot.hy;
        this.skelData[ct + 2] = slot.hz;
      }
    }

    // 空场早退：无活虫也无淡出中的尸体 → 跳过纹理上传与 GPGPU 计算（菜单/波间零开销）
    if (maxSlot < 0) {
      this.geo.instanceCount = 0;
      this.activeCount = 0;
      return;
    }

    this.skelTex.needsUpdate = true;

    // GPGPU 积分：dt 含倍速，按 ≤0.05 拆子步逐次 compute（最多 4 步），高倍速/低帧率不丢模拟时间
    let remain = Math.min(0.2, Math.max(0, dt));
    this.velVar.material.uniforms.uTime.value = time;
    do {
      const step = Math.min(0.05, remain);
      this.posVar.material.uniforms.uDt.value = step;
      this.velVar.material.uniforms.uDt.value = step;
      this.gpu.compute();
      remain -= step;
    } while (remain > 1e-4);

    this.mat.uniforms.texPosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.mat.uniforms.uTime.value = time;

    this.geo.instanceCount = (maxSlot + 1) * BUGS_PER_SLOT;
    this.activeCount = this.geo.instanceCount;
  }

  /** 提交渲染的实例数（含淡出/空洞槽的填充，非存活虫数；仅调试用） */
  count(): number { return this.activeCount; }
}
