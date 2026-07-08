// GPGPU 虫海：每只虫都是真实个体（几十万级）。
//
// 架构（位置/速度浮点纹理 + GPU ping-pong 积分）：
// - 每只虫的【位置】和【速度】各存进一张浮点纹理，GPUComputationRenderer 每帧在 GPU 上积分
//   （位置 += 速度·dt；速度 += 受力·dt）——这是"真个体"的根：每只虫有自己的动量和轨迹。
// - 受力 = 目标吸引（飞向所属逻辑蜂群/城市）+ 湍流流场（curl-like）+ 限速/阻尼（惯性）。
// - 逻辑蜂群（骨架）仍是玩法实体：被瞄准、有血、被击杀。CPU 每帧只把 ≤1024 个骨架的
//   位置/血量/生死时刻写进 1024×2 小纹理；虫子的目标、血量减员、生死由骨架纹理驱动。
//
// 槽位模型：1024 槽 × 512 虫。虫 i 永远映射到纹理固定像素、固定槽 floor(i/512)、序号 i%512。
// 逐虫静态属性（纹理 UV、槽号、序号、种子）在构造时一次性写死；addWing 只占槽 + 写骨架像素。

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

/** 逻辑蜂群需要暴露给虫海的最小接口（Orbital 结构子集） */
export interface SwarmParent {
  group: { position: THREE.Vector3; visible: boolean };
  alive: boolean;
  phase: string;
  hp: number;
  maxHp: number;
}

const TEX_W = 1024;
const TEX_H = 512;                 // 1024×512 = 524288 只虫
const SLOTS = 1024;
const BUGS_PER_SLOT = 512;
const FADE = 0.55;

interface Slot { owner: SwarmParent | null; deathAt: number; frontId: number }

// ---- GLSL 公用片段 ----
const HASH = /* glsl */ `
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // 廉价湍流流场：漩涡感，个体游动的来源
  vec3 flow(vec3 p, float t) {
    vec3 q = p * 3.0;
    return vec3(
      sin(q.y + t) + cos(q.z - t * 0.7),
      sin(q.z + t * 0.4) + cos(q.x + t * 0.9),
      sin(q.x - t * 0.6) + cos(q.y + t * 0.5));
  }
`;

// 骨架纹理 4 行：行0=蜂群位置+状态, 行1=死亡/进场时刻, 行2=目标D(城市方向), 行3=源点O(深空)
const ROW0 = 0.125, ROW1 = 0.375, ROW2 = 0.625, ROW3 = 0.875;
const IDX = /* glsl */ `
  #define ROW0 0.125
  #define ROW1 0.375
  #define ROW2 0.625
  #define ROW3 0.875
  float bugIndex() { return floor(gl_FragCoord.y) * ${TEX_W}.0 + floor(gl_FragCoord.x); }
  vec4 skelRow(float slot, float row) {
    return texture2D(uSkel, vec2((slot + 0.5) / ${SLOTS}.0, row));
  }
  // 出生面坐标系：给定槽，算出源点O、目标D、流向axis、垂直于流向的圆盘基 e1/e2
  void streamFrame(float slot, out vec3 O, out vec3 D, out vec3 axis, out vec3 e1, out vec3 e2) {
    D = skelRow(slot, ROW2).xyz;
    O = skelRow(slot, ROW3).xyz;
    axis = normalize(D - O + vec3(1e-5));
    vec3 up = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    e1 = normalize(cross(axis, up));
    e2 = cross(axis, e1);
  }
`;

// 位置积分着色器
const POS_SHADER = /* glsl */ `
  uniform sampler2D uSkel;
  uniform float uTime;
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

    vec3 O, D, axis, e1, e2;
    streamFrame(slot, O, D, axis, e1, e2);

    // 出生重置：从一个【巨大的圆盘面】均匀撒出（深空侧），之后各自朝目标飞 → 自然收束成漏斗
    if (birth > 0.0 && pos.w != birth) {
      vec3 rnd = hash33(vec3(index) + 1.7);
      float ang = rnd.x * 6.2831853;
      float rad = sqrt(rnd.y) * 0.75;             // 均匀圆盘，半径大 = 出生面大
      vec3 disc = (e1 * cos(ang) + e2 * sin(ang)) * rad;
      vec3 sp = O + disc + axis * (rnd.z * 0.5);  // 面 + 少量纵深，避免一层薄片
      gl_FragColor = vec4(sp, birth);
      return;
    }
    // 未激活/已回收：冻结
    if (state <= 0.0 && death <= 0.0) { gl_FragColor = pos; return; }

    // 直接积分，不绕回：虫从面飞向目标一次，抵达后由蜂群生命周期消散
    gl_FragColor = vec4(pos.xyz + vel.xyz * uDt, pos.w);
  }
`;

// 速度积分着色器（受力 = 目标吸引 + 湍流 + 限速阻尼）
const VEL_SHADER = /* glsl */ `
  uniform sampler2D uSkel;
  uniform float uTime;
  uniform float uDt;
  uniform float uSeek;
  uniform float uTurb;
  uniform float uSep;
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

    vec3 O, D, axis, e1, e2;
    streamFrame(slot, O, D, axis, e1, e2);

    if (birth > 0.0 && pos.w != birth) {
      gl_FragColor = vec4(axis * 0.15, 0.0); // 出生即朝目标带初速度
      return;
    }
    if (state <= 0.0 && death <= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec3 v = vel.xyz;
    // 1) 汇聚：各自朝目标 D 飞
    vec3 toD = D - pos.xyz;
    float d = length(toD);
    vec3 seek = (d > 1e-4 ? toD / d : vec3(0.0)) * uSeek;
    // 2) 湍流：位置相干流场 → 整体涌动而非各自乱抖
    vec3 turb = flow(pos.xyz, uTime) * uTurb;
    // 3) 分离：体积不重叠——采样同区少数邻居，太近就互斥，收束成不规则管道而非塌成一点
    vec3 sep = vec3(0.0);
    for (int k = 0; k < 6; k++) {
      vec3 h = hash33(vec3(index * 0.017, float(k) * 4.13, floor(uTime * 20.0)));
      vec2 sUv = uv + (h.xy - 0.5) * vec2(64.0 / ${TEX_W}.0, 64.0 / ${TEX_H}.0);
      vec3 diff = pos.xyz - texture2D(texPosition, sUv).xyz;
      float dd = dot(diff, diff);
      if (dd < 0.0016 && dd > 1e-9) sep += diff * (1.0 / dd);
    }
    vec3 acc = seek + turb + sep * uSep;

    if (state <= 0.0 && death > 0.0) {
      acc += normalize(pos.xyz - D + vec3(1e-4)) * 0.5; // 死亡向外飘散
    }

    v += acc * uDt;
    float sp = length(v);
    if (sp > uMaxSpeed) v *= uMaxSpeed / sp;
    v *= 0.985;

    gl_FragColor = vec4(v, 0.0);
  }
`;

// 渲染顶点着色器：从纹理取位置，按速度定朝向，生死状态驱动缩放/透明
const RENDER_VERT = /* glsl */ `
  uniform sampler2D texPosition;
  uniform sampler2D texVelocity;
  uniform sampler2D uSkel;
  uniform float uTime;
  attribute vec2 aUv;    // 该虫在 GPGPU 纹理里的像素中心
  attribute vec2 aMeta;  // slot, rank01
  varying float vAlpha;

  vec4 skelRow(float slot, float row) {
    return texture2D(uSkel, vec2((slot + 0.5) / ${SLOTS}.0, row));
  }

  void main() {
    vec3 pos = texture2D(texPosition, aUv).xyz;
    vec3 vel = texture2D(texVelocity, aUv).xyz;
    float slot = aMeta.x, rank01 = aMeta.y;
    vec4 s0 = skelRow(slot, 0.125);   // ROW0 位置+状态
    vec4 s1 = skelRow(slot, 0.375);   // ROW1 死亡/进场时刻
    float state = s0.w, death = s1.x, birth = s1.y;

    float scale = 1.0; vAlpha = 0.95;
    if (state <= 0.0) {
      if (death > 0.0) { float k = clamp(1.0 - (uTime - death) / ${FADE}, 0.0, 1.0); scale = k; vAlpha = k * 0.95; }
      else scale = 0.0;
    } else {
      // 血量侵蚀带：边缘逐只剥落
      float erode = clamp((state - rank01) / 0.08, 0.0, 1.0);
      scale *= erode; vAlpha *= erode;
      // 出生显形
      if (birth > 0.0) { float g = clamp((uTime - birth) / 1.0, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g); scale *= g; vAlpha *= g; }
    }

    // 按速度朝向蝶形体（真实航向，tip = +z）
    vec3 fwd = length(vel) > 1e-4 ? normalize(vel) : vec3(0.0, 0.0, 1.0);
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
  private freeSlots: number[] = [];
  private slotOf = new Map<SwarmParent, number>();
  private activeCount = 0;
  // render() 复用的临时结构（避免每帧分配）
  private _fronts = new Map<number, { x: number; y: number; z: number; n: number }>();
  private _active: number[] = [];
  // 每个锋面的深空源点（锋面诞生时快照一次，固定不动）
  private frontOrigin = new Map<number, { x: number; y: number; z: number }>();

  constructor(parent: THREE.Object3D, renderer: THREE.WebGLRenderer) {
    // ---- 骨架纹理（CPU 每帧写，与虫数无关）：4 行 = 位置/状态 + 生死时刻 + 目标D + 源点O ----
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
      v.material.uniforms.uTime = { value: 0 };
      v.material.uniforms.uDt = { value: 0 };
    }
    this.velVar.material.uniforms.uSeek = { value: 1.4 };    // 汇聚力（朝目标）
    this.velVar.material.uniforms.uTurb = { value: 0.05 };  // 湍流涌动
    this.velVar.material.uniforms.uSep = { value: 0.0009 }; // 分离力（防重叠 → 管道）
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
      aMeta[i * 2 + 1] = (i % BUGS_PER_SLOT) / BUGS_PER_SLOT;
    }
    this.geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 2));
    this.geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(aMeta, 2));
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      uniforms: {
        texPosition: { value: null },
        texVelocity: { value: null },
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
      this.slots.push({ owner: null, deathAt: 0, frontId: 0 });
      this.freeSlots.push(s);
    }
  }

  /** 注册一个逻辑蜂群：占一个骨架槽。frontId 相同的蜂群会汇成同一个大群。 */
  addWing(w: SwarmParent, frontId: number) {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return; // 槽满：静默降级
    this.slots[slot] = { owner: w, deathAt: 0, frontId };
    this.slotOf.set(w, slot);
    const t = slot * 4;
    this.skelData[t + 3] = -1;            // state 隐藏
    this.skelData[SLOTS * 4 + t] = 0;     // 死亡时刻
    this.skelData[SLOTS * 4 + t + 1] = 0; // 进场时刻
  }

  /** 每帧：同步骨架 → 纹理，跑 GPGPU 积分，更新渲染 uniform。dt = 模拟步长（含倍速）。 */
  render(dt: number, time: number) {
    const fronts = this._fronts; fronts.clear();
    const active = this._active; active.length = 0;
    let maxSlot = -1;
    // 趟 1：写各槽状态，同时累加每个锋面的质心
    for (let s = 0; s < SLOTS; s++) {
      const slot = this.slots[s];
      const t = s * 4;
      const mt = SLOTS * 4 + t;
      if (!slot.owner) {
        if (slot.deathAt > 0 && time > slot.deathAt + FADE + 0.1) {
          slot.deathAt = 0;
          this.skelData[mt] = 0;
          this.skelData[mt + 1] = 0;
          this.freeSlots.push(s);
        }
        if (slot.deathAt > 0) maxSlot = s;
        continue;
      }
      const w = slot.owner;
      if (!w.alive || w.phase === 'done') {
        slot.deathAt = time;
        this.skelData[t + 3] = 0;
        this.skelData[mt] = time;
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
      if (w.group.visible) {
        let f = fronts.get(slot.frontId);
        if (!f) { f = { x: 0, y: 0, z: 0, n: 0 }; fronts.set(slot.frontId, f); }
        f.x += p.x; f.y += p.y; f.z += p.z; f.n++;
        active.push(s);
      }
    }
    // 趟 2：写目标D(行2=质心) 与 源点O(行3=锋面诞生时的深空方向，固定)
    const CROW = SLOTS * 2 * 4, OROW = SLOTS * 3 * 4;
    const ORIGIN_R = 2.9;
    for (const s of active) {
      const fid = this.slots[s].frontId;
      const f = fronts.get(fid)!;
      const cx = f.x / f.n, cy = f.y / f.n, cz = f.z / f.n;
      let o = this.frontOrigin.get(fid);
      if (!o) {
        const l = Math.hypot(cx, cy, cz) || 1;
        o = { x: (cx / l) * ORIGIN_R, y: (cy / l) * ORIGIN_R, z: (cz / l) * ORIGIN_R };
        this.frontOrigin.set(fid, o);
      }
      const ct = CROW + s * 4, ot = OROW + s * 4;
      this.skelData[ct] = cx; this.skelData[ct + 1] = cy; this.skelData[ct + 2] = cz;
      this.skelData[ot] = o.x; this.skelData[ot + 1] = o.y; this.skelData[ot + 2] = o.z;
    }
    // 清理已消失锋面的源点
    for (const k of this.frontOrigin.keys()) if (!fronts.has(k)) this.frontOrigin.delete(k);
    this.skelTex.needsUpdate = true;

    // GPGPU 积分（每帧一次，与倍速子步解耦；dt 已含倍速）
    const simDt = Math.min(0.05, Math.max(0, dt));
    for (const v of [this.posVar, this.velVar]) {
      v.material.uniforms.uTime.value = time;
      v.material.uniforms.uDt.value = simDt;
    }
    this.gpu.compute();

    this.mat.uniforms.texPosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.mat.uniforms.texVelocity.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    this.mat.uniforms.uTime.value = time;

    this.geo.instanceCount = (maxSlot + 1) * BUGS_PER_SLOT;
    this.activeCount = this.geo.instanceCount;
  }

  count(): number { return this.activeCount; }
}
