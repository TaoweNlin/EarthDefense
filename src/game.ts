// M2：6 塔 5 敌、地形规则、升级/出售、5 波含 Boss 的完整关卡。
// 所有战场实体挂在 earthGroup 下（本地坐标 = 单位球面），随地球一起自转。

import * as THREE from 'three';
import type { GoldbergGrid, Cell } from './goldberg';
import type { LevelCfg, WaveCfg } from './levels';
import { sfx } from './sound';

const COL_CYAN = new THREE.Color('#22d3ee');
const COL_ROSE = new THREE.Color('#f43f5e');
const COL_AMBER = new THREE.Color('#fbbf24');

// ========== 塔定义 ==========

export type TowerKind = 'ground' | 'air' | 'support';

export interface TowerDef {
  key: string; name: string; sub: string; icon: string; cost: number;
  kind: TowerKind;
  range: number; damage: number; cooldown: number;
  desc: string;
}

export const TOWER_DEFS: TowerDef[] = [
  { key: 'pulse',     name: '脉冲炮',   sub: 'PULSE',   icon: '▲', cost: 70,  kind: 'ground',  range: 0.36, damage: 28, cooldown: 0.85, desc: '基础对地单体·便宜耐用' },
  { key: 'tesla',     name: '磁暴塔',   sub: 'TESLA',   icon: '◈', cost: 140, kind: 'ground',  range: 0.30, damage: 6,  cooldown: 0,    desc: '减速 40% + 电弧链击' },
  { key: 'laser',     name: '轨道激光', sub: 'O-LASER', icon: '║', cost: 170, kind: 'air',     range: 0.60, damage: 22, cooldown: 0,    desc: '对空持续射线·锁定增伤' },
  { key: 'missile',   name: '破片导弹', sub: 'FRAG-M',  icon: '✦', cost: 190, kind: 'air',     range: 0.55, damage: 80, cooldown: 4.0,  desc: '对空范围爆发' },
  { key: 'radar',     name: '雷达站',   sub: 'RADAR',   icon: '◍', cost: 120, kind: 'support', range: 0.40, damage: 0,  cooldown: 0,    desc: '射程内塔 +25% 射速' },
  { key: 'prism',     name: '汇聚棱镜', sub: 'PRISM',   icon: '◆', cost: 220, kind: 'ground',  range: 0.42, damage: 42, cooldown: 1.5,  desc: '相邻每塔 +45% 伤害' },
  { key: 'satellite', name: '防御卫星', sub: 'SAT-NET', icon: '✧', cost: 260, kind: 'air',     range: 0.55, damage: 16, cooldown: 0.55, desc: '部署轨道卫星环球巡航' },
];

const OCEAN_PLATFORM_COST = 60;   // 海上浮动平台附加费
const MOUNTAIN_RANGE_MUL = 1.25;  // 山地射程加成
const UPGRADE_DMG_MUL = 1.5;      // 每级伤害倍率
const SELL_REFUND = 0.6;
const MAX_LEVEL = 3;

// ========== 敌人定义 ==========

interface GroundDef { hp: number; speed: number; armor: number; reward: number; size: number }
// 割草导向：单体更慢更脆、奖励减半，靠数量堆战场密度
const GROUND_DEFS: Record<string, GroundDef> = {
  swarm:     { hp: 38,  speed: 0.058, armor: 0, reward: 8,  size: 0.02 },
  runner:    { hp: 30,  speed: 0.115, armor: 0, reward: 7,  size: 0.017 },
  armored:   { hp: 150, speed: 0.04,  armor: 8, reward: 20, size: 0.03 },
  splitter:  { hp: 55,  speed: 0.06,  armor: 0, reward: 9,  size: 0.023 },  // 死后裂变
  swarmling: { hp: 16,  speed: 0.09,  armor: 0, reward: 3,  size: 0.012 }, // 裂变产物
};

// 全局刷怪倍率：拉长每艘运输舰的倾泻时间，堆战场密度
const HORDE_MUL = 1.5;

// 空中单位（立体防御的主角，只能被防空火力击落）
const WING_HP = 14;            // 飞行蜂群：极脆、极多，给防空当割草靶
const WING_REWARD = 4;
const WING_SPEED = 0.055;      // 角速度 rad/s，缓慢推进
const WING_ALT = 1.18;         // 巡航高度：拉高一点，空层视觉更分明
const WING_IMPACT_DAMAGE = 2;
const DIVER_HP = 60;
const DIVER_REWARD = 22;
const DIVER_IMPACT_DAMAGE = 20;   // 撞击城市伤害
const GUNSHIP_HP = 170;
const GUNSHIP_REWARD = 48;
const GUNSHIP_HOVER = 1.16;       // 悬停高度
const GUNSHIP_BOLT_DAMAGE = 4;
const GUNSHIP_BOLT_INTERVAL = 2.4;

const TRANSPORT_HP = 200; // 拉高在轨血量：激光不能轻易在落地前打爆整船，拦截需要专注火力
const TRANSPORT_REWARD = 45;   // 在轨击落 = 整船歼灭，重赏
const JAMMER_HP = 110;
const JAMMER_REWARD = 50;
const JAMMER_RADIUS = 1.32;
const JAM_ANGLE = 0.34;
const BOSS_HP = 950;
const BOSS_REWARD = 300;
const BOSS_RADIUS = 1.5;
const BOSS_DROP_INTERVAL = 11;

// ========== 关卡通用 ==========

const CITY_HP = 100;
const CITY_INCOME = 1.6;
const CITY_HIT_DAMAGE = 8; // 割草量级下单只渗透伤害调低
const CITY_NAMES = ['NOVA-1', 'KIRIN-2', 'AURUM-3', 'TERRA-4', 'ZENIT-5', 'HALO-6'];

// 遗迹词条（建在五边形格上随机获得）
export interface Perk { key: 'rapid' | 'power' | 'long' | 'siphon'; name: string }
const PERKS: Perk[] = [
  { key: 'rapid', name: '超频 · 射速 +25%' },
  { key: 'power', name: '增幅 · 伤害 +25%' },
  { key: 'long', name: '广域 · 射程 +15%' },
  { key: 'siphon', name: '汲能 · +1.5⚡/s' },
];

export interface GameStats {
  kills: number;        // 地面击杀
  intercepted: number;  // 在轨拦截（运输舰/干扰者/母舰）
  leaked: number;       // 攻入城市的单位
  citiesLost: number;
  duration: number;     // 秒
  stars: number;        // 1-3，失败为 0
}

type Phase = 'idle' | 'prewave' | 'active' | 'won' | 'lost';

// ========== 实体 ==========

interface City {
  cellId: number; hp: number; maxHp: number; alive: boolean; name: string; capital: boolean;
  group: THREE.Group; buildings: THREE.Group; beam: THREE.Mesh; base: THREE.Mesh;
  row: HTMLElement; bar: HTMLElement;
}

export interface Tower {
  def: TowerDef; level: number; cellId: number; invested: number;
  perk: Perk | null;
  group: THREE.Group; ring: THREE.Mesh | null; edges: THREE.LineSegments[];
  cooldown: number;
  // 轨道激光的锁定状态
  lockTarget: Orbital | null; lockT: number; beam: THREE.Mesh | null;
  jammed: boolean;
}

interface Unit {
  type: string; def: GroundDef;
  mesh: THREE.Mesh; path: number[]; seg: number; t: number;
  hp: number; alive: boolean; pos: THREE.Vector3; slowUntilFrame: boolean;
  offset: THREE.Vector3;  // 横向散布：避免同舱单位叠成一条线
  speedMul: number;       // 个体速度抖动
}

interface Satellite {
  towerCell: number; group: THREE.Group; line: THREE.Line;
  e1: THREE.Vector3; e2: THREE.Vector3; angle: number; cooldown: number;
}

type OrbitalKind = 'transport' | 'jammer' | 'boss' | 'diver' | 'gunship' | 'wing';
interface Orbital {
  kind: OrbitalKind; hp: number; maxHp: number; alive: boolean;
  group: THREE.Group; pos: THREE.Vector3;
  // transport 专用
  landCell: number; phase: 'orbit' | 'descend' | 'deploy' | 'done';
  theta: number; basisN: THREE.Vector3; basisU: THREE.Vector3;
  descendT: number; cargo: { type: string; n: number }; deployTimer: number;
  marker: THREE.Group | null; trail: THREE.Line | null;
  // jammer/boss 专用
  orbitAxis: THREE.Vector3; orbitAngle: number; dropTimer: number;
}

interface Fx { obj: THREE.Object3D; ttl: number; max: number; kind: 'laser' | 'ring' | 'flash' | 'beam' | 'arc' }

interface Projectile {
  mesh: THREE.Group; trail: THREE.Line;
  from: THREE.Vector3; to: THREE.Vector3; t: number;
  dmg: number; aoe: number;
}

// ========== 主类 ==========

export class Game {
  phase: Phase = 'idle';
  energy: number;
  /** 已发起的波数（连续进攻：下一波不等上一波清完） */
  launched = 0;
  private nextWaveT = 0;
  private time = 0;
  private battleTime = 0;
  stats: GameStats = { kills: 0, intercepted: 0, leaked: 0, citiesLost: 0, duration: 0, stars: 0 };
  private cityCenter = new THREE.Vector3(0, 1, 0);
  private laneCells: number[] = [];
  private laneMarkers: THREE.Group[] = [];
  satellites: Satellite[] = [];

  cities: City[] = [];
  towers: Tower[] = [];
  units: Unit[] = [];
  orbitals: Orbital[] = [];
  private fx: Fx[] = [];
  private projectiles: Projectile[] = [];
  private occupied = new Set<number>();
  private root = new THREE.Group();
  private markers: THREE.Group[] = [];
  /** 波前预告：登陆点 + 预定轨道平面 + 已显示的航迹线 */
  private pending: { cellId: number; marker: THREE.Group; u: THREE.Vector3; trail: THREE.Line }[] = [];

  private laserMat = new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(
    private earthGroup: THREE.Group,
    private grid: GoldbergGrid,
    private cfg: LevelCfg,
    private onEnd: (win: boolean, stats: GameStats) => void,
  ) {
    this.energy = cfg.startEnergy;
    earthGroup.add(this.root);
    this.spawnCities();
    this.updateHud();
    this.setWaveLabel();
  }

  /** 由主菜单/自动开始调用，正式进入布防倒计时 */
  start() {
    if (this.phase !== 'idle') return;
    this.phase = 'prewave';
    this.nextWaveT = this.waveAt(0).prewave;
    this.initLanes();
    this.prepareLandings();
    this.showCountdown(true);
    this.banner(this.cfg.name, `任务目标 // ${this.cfg.objective}`, true, 4200);
  }

  /** 波次配置：战役取表，无尽模式程序生成（难度随波数递增） */
  private waveAt(i: number): WaveCfg {
    if (!this.cfg.endless) return this.cfg.waves[i];
    const types = ['swarm', 'runner', 'armored', 'splitter'] as const;
    const drops: WaveCfg['drops'] = [];
    const nDrops = Math.min(2 + Math.floor(i / 2), 5);
    for (let d = 0; d < nDrops; d++) {
      const type = types[(i + d * 2) % types.length];
      const base = 7 + i * 1.2;
      drops.push({ type, n: Math.round(type === 'armored' ? base * 0.45 : base) });
    }
    return {
      prewave: i === 0 ? 18 : Math.max(15, 25 - i * 0.4),
      drops,
      jammers: i >= 2 && i % 3 === 2 ? Math.min(3, 1 + Math.floor(i / 7)) : 0,
      divers: i >= 3 ? Math.min(4, 1 + Math.floor(i / 4)) : 0,
      gunships: i >= 5 && i % 2 === 1 ? Math.min(2, 1 + Math.floor(i / 9)) : 0,
      wings: i >= 2 ? Math.min(22, 5 + i) : 0,
      boss: i > 0 && i % 10 === 9, // 每 10 波一艘母舰
    };
  }

  private totalWaves(): number {
    return this.cfg.endless ? Infinity : this.cfg.waves.length;
  }

  /** 固定进攻走廊：整关的登陆都发生在这些走廊附近，开局即可见 */
  private initLanes() {
    const dist = this.bfsFromCities();
    let candidates = this.grid.cells.filter((c) =>
      c.terrain !== 'ocean' && !this.occupied.has(c.id) &&
      dist[c.id] >= 2 && dist[c.id] <= 6 &&
      c.center.angleTo(this.cityCenter) <= this.cfg.landingSpread);
    if (candidates.length < this.cfg.lanes) {
      candidates = this.grid.cells.filter((c) => c.terrain !== 'ocean' && dist[c.id] >= 2);
    }
    const picked: Cell[] = [candidates[Math.floor(this.rand() * candidates.length)]];
    while (picked.length < this.cfg.lanes) {
      let best: Cell | null = null, bestD = -1;
      for (const c of candidates) {
        if (picked.includes(c)) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, c.center.angleTo(p.center));
        if (d > bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      picked.push(best);
    }
    this.laneCells = picked.map((c) => c.id);

    // 走廊常驻标记：格子轮廓 + 内环，暗玫红，与临战登陆标记区分
    for (const c of picked) {
      const g = new THREE.Group();
      const lift = c.terrain === 'mountain' ? 1.024 : 1.005;
      const poly = c.polygon.map((p) => p.clone().normalize().multiplyScalar(lift));
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(poly),
        new THREE.LineBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.4, depthWrite: false }));
      outline.renderOrder = 7;
      g.add(outline);
      const n = c.center.clone();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.01, 0.017, 24),
        new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      ring.position.copy(n.clone().multiplyScalar(lift));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      ring.renderOrder = 7;
      g.add(ring);
      this.root.add(g);
      this.laneMarkers.push(g);
    }
  }

  // ============ 城市 ============

  /** 在候选集内做最远点采样 */
  private farthestPick(candidates: Cell[], count: number, seedCell?: Cell): Cell[] {
    const picked: Cell[] = [seedCell ?? candidates[Math.floor(this.rand() * candidates.length)]];
    while (picked.length < count) {
      let best: Cell | null = null, bestD = -1;
      for (const c of candidates) {
        if (picked.includes(c)) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, c.center.angleTo(p.center));
        if (d > bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      picked.push(best);
    }
    return picked;
  }

  /** 在候选集中找最接近指定方向的未选格 */
  private snapToCell(dir: THREE.Vector3, pool: Cell[], exclude: Cell[]): Cell {
    let best = pool[0], bestA = Infinity;
    for (const c of pool) {
      if (exclude.includes(c)) continue;
      const a = c.center.angleTo(dir);
      if (a < bestA) { bestA = a; best = c; }
    }
    return best;
  }

  private spawnCities() {
    const land = this.grid.cells.filter((c) => c.terrain === 'land' && !c.isPentagon);
    let picked: Cell[];

    switch (this.cfg.cityLayout) {
      case 'equator': {
        // 赤道城市链：沿赤道按经度等分排布，规则可读
        let belt = land.filter((c) => Math.abs(c.center.y) < 0.3);
        if (belt.length < this.cfg.cities * 3) belt = land.filter((c) => Math.abs(c.center.y) < 0.5);
        if (belt.length < this.cfg.cities) belt = land;
        const anchor = belt[Math.floor(this.rand() * belt.length)];
        picked = [anchor];
        // 链式排布：沿赤道同向逐段延伸，城市链集中在一个防区内
        for (let i = 1; i < this.cfg.cities; i++) {
          const dir = anchor.center.clone()
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.62);
          const spaced = belt.filter((c) =>
            picked.every((p) => c.center.angleTo(p.center) > 0.4));
          picked.push(this.snapToCell(dir, spaced.length ? spaced : belt, picked));
        }
        break;
      }
      case 'capital': {
        // 中心城场景：孤城（cities=1）或首都 + 环绕卫星城
        const anchor = land[Math.floor(this.rand() * land.length)];
        if (this.cfg.cities <= 1) { picked = [anchor]; break; }
        let around = land.filter((c) => c !== anchor && c.center.angleTo(anchor.center) <= 0.9);
        if (around.length < this.cfg.cities - 1) around = land.filter((c) => c !== anchor);
        picked = [anchor, ...this.farthestPick(around, this.cfg.cities - 1)];
        break;
      }
      case 'cluster': {
        // 防区聚集：主城 + 周边固定角距、等分方位的卫星城，布局规则
        const anchor = land[Math.floor(this.rand() * land.length)];
        picked = [anchor];
        const n = anchor.center.clone();
        const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const e1 = new THREE.Vector3().crossVectors(n, ref).normalize();
        const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
        const ringDist = 0.42;
        for (let i = 1; i < this.cfg.cities; i++) {
          const b = ((i - 1) / Math.max(1, this.cfg.cities - 1)) * Math.PI * 2 + 0.4;
          const dir = n.clone().multiplyScalar(Math.cos(ringDist))
            .addScaledVector(e1, Math.sin(ringDist) * Math.cos(b))
            .addScaledVector(e2, Math.sin(ringDist) * Math.sin(b));
          picked.push(this.snapToCell(dir, land, picked));
        }
        break;
      }
      default: {
        // global：受聚集度约束的铺开（cluster 越低越散，但不会到对跖点）
        const anchor = land[Math.floor(this.rand() * land.length)];
        const maxAngle = 0.55 + (1 - this.cfg.cityCluster) * (Math.PI * 0.62 - 0.55);
        let candidates = land.filter((c) => c.center.angleTo(anchor.center) <= maxAngle);
        if (candidates.length < this.cfg.cities) candidates = land;
        picked = this.farthestPick(candidates, this.cfg.cities, anchor);
      }
    }
    this.cityCenter = picked.reduce((v, c) => v.add(c.center), new THREE.Vector3()).normalize();

    const listEl = document.getElementById('city-list')!;
    listEl.innerHTML = '';
    picked.forEach((cell, i) => {
      const capital = this.cfg.cityLayout === 'capital' && i === 0;
      const group = new THREE.Group();
      const n = cell.center.clone();
      group.position.copy(n.clone().multiplyScalar(1.002));
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      if (capital) group.scale.setScalar(1.5); // 首都体量更大

      const buildings = new THREE.Group();
      const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#241a06') });
      const edgeMat = new THREE.LineBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.85 });
      const bCount = 7;
      for (let b = 0; b < bCount; b++) {
        const isMain = b === 0;
        const ang = (b / (bCount - 1)) * Math.PI * 2 + i * 1.3;
        const dist = isMain ? 0 : 0.016 + 0.007 * ((b * 7 + i * 3) % 3);
        const w = isMain ? 0.011 : 0.006 + 0.003 * ((b + i) % 2);
        const h = isMain ? 0.055 : 0.018 + 0.011 * ((b * 5 + i) % 3);
        const geo = new THREE.BoxGeometry(w, h, w);
        const mesh = new THREE.Mesh(geo, fillMat);
        mesh.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist);
        buildings.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
        edges.position.copy(mesh.position);
        buildings.add(edges);
      }
      group.add(buildings);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0035, 0.006, 0.14, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: COL_AMBER, transparent: true, opacity: 0.3,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
      beam.position.y = 0.07;
      beam.renderOrder = 8;
      group.add(beam);

      const base = new THREE.Mesh(
        new THREE.RingGeometry(0.034, 0.042, 6),
        new THREE.MeshBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      base.rotation.x = -Math.PI / 2;
      base.renderOrder = 6;
      group.add(base);

      this.root.add(group);

      const name = capital ? '★中枢 CORE' : CITY_NAMES[i];
      const maxHp = capital ? 200 : CITY_HP;
      const row = document.createElement('div');
      row.className = 'city-row';
      row.innerHTML = `<span class="city-name">${name}</span><span class="city-bar"><i></i></span>`;
      listEl.appendChild(row);

      this.occupied.add(cell.id);
      this.cities.push({
        cellId: cell.id, hp: maxHp, maxHp, alive: true, name, capital,
        group, buildings, beam, base, row, bar: row.querySelector('i')!,
      });
    });
  }

  // ============ 建造 / 升级 / 出售 ============

  cellInfo(cellId: number): 'city' | 'tower' | null {
    if (this.cities.some((c) => c.cellId === cellId && c.alive)) return 'city';
    if (this.towers.some((t) => t.cellId === cellId)) return 'tower';
    return null;
  }

  towerAt(cellId: number): Tower | null {
    return this.towers.find((t) => t.cellId === cellId) ?? null;
  }

  effectiveCost(def: TowerDef, cell: Cell): number {
    return def.cost + (cell.terrain === 'ocean' ? OCEAN_PLATFORM_COST : 0);
  }

  canBuild(cellId: number, defKey: string): { ok: boolean; reason?: string; cost: number } {
    const def = TOWER_DEFS.find((d) => d.key === defKey)!;
    const cell = this.grid.cells[cellId];
    const cost = this.effectiveCost(def, cell);
    if (!this.cfg.towers.includes(defKey)) return { ok: false, reason: '本关未解锁', cost };
    if (this.phase === 'won' || this.phase === 'lost') return { ok: false, reason: '战斗已结束', cost };
    if (this.occupied.has(cellId)) return { ok: false, reason: '区块已占用', cost };
    if (cell.terrain === 'mountain' && def.kind === 'ground')
      return { ok: false, reason: '山地仅可部署防空/雷达', cost };
    if (this.energy < cost) return { ok: false, reason: '能源不足', cost };
    return { ok: true, cost };
  }

  tryBuild(cellId: number, defKey: string): boolean {
    const check = this.canBuild(cellId, defKey);
    if (!check.ok) { sfx.play('deny'); return false; }
    const def = TOWER_DEFS.find((d) => d.key === defKey)!;
    const cell = this.grid.cells[cellId];
    this.energy -= check.cost;

    const group = this.buildTowerVisual(def, cell);
    group.scale.setScalar(0.01);
    this.root.add(group);

    // 遗迹词条：五边形格随机赋予
    let perk: Perk | null = null;
    if (cell.isPentagon) {
      perk = PERKS[Math.floor(this.rand() * PERKS.length)];
      this.spawnRing(cell.center.clone().multiplyScalar(1.012), COL_AMBER, 0.06);
      this.banner('遗迹共鸣', `RELIC BONUS // ${perk.name}`, true, 2600);
    }

    this.occupied.add(cellId);
    this.towers.push({
      def, level: 1, cellId, invested: check.cost, perk,
      group, ring: (group.userData.ring as THREE.Mesh) ?? null,
      edges: group.userData.edges as THREE.LineSegments[],
      cooldown: 0, lockTarget: null, lockT: 0, beam: null, jammed: false,
    });
    if (def.key === 'satellite') this.spawnSatellite(cellId);
    sfx.play('build');
    this.updateHud();
    return true;
  }

  /** 防御卫星：地面站发射一颗沿青色轨道环球巡航的攻击卫星 */
  private spawnSatellite(cellId: number) {
    const n = this.grid.cells[cellId].center.clone();
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize()
      .applyAxisAngle(n, this.rand() * Math.PI * 2);
    const axis = new THREE.Vector3().crossVectors(n, u).normalize();
    const line = this.makeOrbitLine(axis, 1.42, 0.35, COL_CYAN);

    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.02),
      new THREE.MeshBasicMaterial({ color: COL_CYAN, wireframe: true, transparent: true, opacity: 0.95 }));
    group.add(body);
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.002, 0.014),
        new THREE.MeshBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.55 }));
      panel.position.x = side * 0.03;
      group.add(panel);
    }
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.007, 8, 8),
      new THREE.MeshBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(core);
    this.root.add(group);

    this.satellites.push({ towerCell: cellId, group, line, e1: n, e2: u, angle: 0, cooldown: 0 });
  }

  private updateSatellites(dt: number) {
    for (const s of this.satellites) {
      s.angle += dt * 0.42;
      const pos = s.e1.clone().multiplyScalar(Math.cos(s.angle))
        .addScaledVector(s.e2, Math.sin(s.angle)).multiplyScalar(1.42);
      s.group.position.copy(pos);
      s.group.rotation.y += dt * 1.5;

      s.cooldown -= dt;
      if (s.cooldown > 0) continue;
      const tower = this.towerAt(s.towerCell);
      if (!tower) continue;
      let target: Orbital | null = null;
      let bestD = Infinity;
      for (const o of this.orbitals) {
        if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
        const d = o.pos.distanceTo(pos);
        if (d < 0.6 && d < bestD) { bestD = d; target = o; }
      }
      if (!target) continue;
      s.cooldown = tower.def.cooldown;
      this.fireLine(pos.clone(), target.pos.clone(), 0.12);
      this.spawnFlash(target.pos.clone(), COL_CYAN, 0.008, 0.12);
      sfx.play('shoot', 90);
      this.damageOrbital(target, this.towerDamage(tower));
    }
  }

  upgradeCost(t: Tower): number {
    return Math.round(t.def.cost * 0.8) * t.level;
  }

  tryUpgrade(cellId: number): boolean {
    const t = this.towerAt(cellId);
    if (!t || t.level >= MAX_LEVEL) return false;
    const cost = this.upgradeCost(t);
    if (this.energy < cost) { sfx.play('deny'); return false; }
    sfx.play('upgrade');
    this.energy -= cost;
    t.invested += cost;
    t.level++;
    // 等级视觉：基座加一圈发光环
    const lvRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.024 + t.level * 0.004, 0.0016, 6, 24),
      new THREE.MeshBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.85 }));
    lvRing.rotation.x = Math.PI / 2;
    lvRing.position.y = 0.004;
    t.group.add(lvRing);
    this.spawnRing(this.grid.cells[cellId].center.clone().multiplyScalar(1.01), COL_AMBER, 0.05);
    this.updateHud();
    return true;
  }

  sell(cellId: number) {
    const idx = this.towers.findIndex((t) => t.cellId === cellId);
    if (idx < 0) return;
    const t = this.towers[idx];
    sfx.play('sell');
    // 卫星站出售时回收在轨卫星
    if (t.def.key === 'satellite') {
      const si = this.satellites.findIndex((s) => s.towerCell === cellId);
      if (si >= 0) {
        this.root.remove(this.satellites[si].group);
        this.root.remove(this.satellites[si].line);
        this.satellites.splice(si, 1);
      }
    }
    this.energy += Math.round(t.invested * SELL_REFUND);
    if (t.beam) this.root.remove(t.beam);
    this.root.remove(t.group);
    this.occupied.delete(cellId);
    this.towers.splice(idx, 1);
    this.spawnRing(this.grid.cells[cellId].center.clone().multiplyScalar(1.01), COL_CYAN, 0.04);
    this.updateHud();
  }

  towerRange(t: Tower): number {
    const mountain = this.grid.cells[t.cellId].terrain === 'mountain';
    let r = t.def.range * (mountain ? MOUNTAIN_RANGE_MUL : 1) + (t.level - 1) * 0.025;
    if (t.perk?.key === 'long') r *= 1.15;
    return r;
  }

  towerDamage(t: Tower): number {
    let dmg = t.def.damage * Math.pow(UPGRADE_DMG_MUL, t.level - 1);
    if (t.def.key === 'prism') {
      const adj = this.grid.cells[t.cellId].neighbors
        .filter((nb) => this.towers.some((o) => o.cellId === nb)).length;
      dmg *= 1 + 0.45 * adj;
    }
    if (t.perk?.key === 'power') dmg *= 1.25;
    return dmg;
  }

  // ============ 塔的立体造型 ============

  private buildTowerVisual(def: TowerDef, cell: Cell): THREE.Group {
    const group = new THREE.Group();
    const n = cell.center.clone();
    // 山地格是凸起高原，塔要站在顶面上
    group.position.copy(n.clone().multiplyScalar(cell.terrain === 'mountain' ? 1.018 : 1.0));
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);

    const fill = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d3644') });
    const edgeM = new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.9 });
    const amberM = new THREE.MeshBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.9 });
    const glowM = new THREE.MeshBasicMaterial({
      color: COL_CYAN, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const edges: THREE.LineSegments[] = [];
    // 待机动画注册表
    const spin: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = [];
    const bob: { obj: THREE.Object3D; base: number; amp: number; freq: number }[] = [];

    const addPart = (geo: THREE.BufferGeometry, y: number, parent: THREE.Object3D = group, ry = 0) => {
      const mesh = new THREE.Mesh(geo, fill);
      mesh.position.y = y; mesh.rotation.y = ry;
      parent.add(mesh);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeM);
      e.position.y = y; e.rotation.y = ry;
      parent.add(e);
      edges.push(e);
      return mesh;
    };
    const mkRing = (r: number, y: number, tube = 0.0022) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24),
        new THREE.MeshBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.8 }));
      m.position.y = y; m.rotation.x = Math.PI / 2;
      group.add(m);
      return m;
    };

    let ring: THREE.Mesh | null = null;

    switch (def.key) {
      case 'pulse': {
        // 六棱炮塔 + 悬浮准星环 + 炮口聚能珠
        addPart(new THREE.ConeGeometry(0.02, 0.05, 6), 0.028);
        ring = mkRing(0.016, 0.062);
        const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), glowM.clone());
        muzzle.position.y = 0.062;
        group.add(muzzle);
        group.userData.muzzle = muzzle;
        bob.push({ obj: ring, base: 0.062, amp: 0.004, freq: 2.2 });
        break;
      }
      case 'tesla': {
        // 特斯拉线圈：柱体 + 三层错向旋转环 + 顶端电浆球
        addPart(new THREE.CylinderGeometry(0.007, 0.013, 0.055, 6), 0.028);
        const r1 = mkRing(0.019, 0.024, 0.0026);
        const r2 = mkRing(0.016, 0.038, 0.0026);
        const r3 = mkRing(0.013, 0.052, 0.0026);
        spin.push({ obj: r1, axis: 'z', speed: 1.4 }, { obj: r2, axis: 'z', speed: -2.0 }, { obj: r3, axis: 'z', speed: 2.8 });
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 10), glowM.clone());
        orb.position.y = 0.072;
        group.add(orb);
        group.userData.muzzle = orb;
        bob.push({ obj: orb, base: 0.072, amp: 0.005, freq: 3.1 });
        break;
      }
      case 'laser': {
        // 对空炮台：宽基座 + 长炮管 + 三片散热鳍 + 高速自旋晶体
        addPart(new THREE.CylinderGeometry(0.016, 0.02, 0.018, 6), 0.009);
        addPart(new THREE.CylinderGeometry(0.0045, 0.009, 0.085, 6), 0.055);
        for (let i = 0; i < 3; i++) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.03, 0.012), fill);
          fin.position.y = 0.03;
          fin.rotation.y = (i / 3) * Math.PI * 2;
          fin.translateZ(0.013);
          group.add(fin);
          const fe = new THREE.LineSegments(new THREE.EdgesGeometry(fin.geometry), edgeM);
          fe.position.copy(fin.position); fe.rotation.copy(fin.rotation);
          group.add(fe); edges.push(fe);
        }
        const crystal = addPart(new THREE.OctahedronGeometry(0.011), 0.108);
        spin.push({ obj: crystal, axis: 'y', speed: 4.5 });
        group.userData.muzzle = crystal;
        break;
      }
      case 'missile': {
        // 导弹阵地：装甲基座 + 可旋转四联发射架（弹头琥珀色）
        addPart(new THREE.BoxGeometry(0.032, 0.014, 0.032), 0.008);
        const rack = new THREE.Group();
        rack.position.y = 0.03;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.034, 6), fill);
          tube.position.set(Math.cos(a) * 0.011, 0, Math.sin(a) * 0.011);
          tube.rotation.x = -0.18;
          rack.add(tube);
          const te = new THREE.LineSegments(new THREE.EdgesGeometry(tube.geometry), edgeM);
          te.position.copy(tube.position); te.rotation.copy(tube.rotation);
          rack.add(te); edges.push(te);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.009, 6), amberM);
          tip.position.set(tube.position.x, 0.021, tube.position.z);
          tip.rotation.x = -0.18;
          rack.add(tip);
        }
        group.add(rack);
        spin.push({ obj: rack, axis: 'y', speed: 0.5 });
        group.userData.rack = rack;
        break;
      }
      case 'radar': {
        // 雷达站：支柱 + 持续旋转的碟形天线 + 琥珀馈源
        addPart(new THREE.CylinderGeometry(0.0035, 0.008, 0.04, 6), 0.02);
        const dishGroup = new THREE.Group();
        dishGroup.position.y = 0.048;
        const dish = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.35), fill);
        dish.rotation.x = Math.PI * 0.62;
        dishGroup.add(dish);
        const de = new THREE.LineSegments(new THREE.EdgesGeometry(dish.geometry), edgeM);
        de.rotation.copy(dish.rotation);
        dishGroup.add(de); edges.push(de);
        const feed = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), amberM);
        feed.position.set(0, 0.004, 0.012);
        dishGroup.add(feed);
        group.add(dishGroup);
        spin.push({ obj: dishGroup, axis: 'y', speed: 1.1 });
        ring = mkRing(0.018, 0.006);
        break;
      }
      case 'satellite': {
        // 卫星地面站：发射台 + 上仰天线 + 通讯环
        addPart(new THREE.BoxGeometry(0.03, 0.01, 0.03), 0.006);
        addPart(new THREE.CylinderGeometry(0.003, 0.006, 0.035, 6), 0.026);
        const dish = addPart(new THREE.ConeGeometry(0.014, 0.008, 12, 1, true), 0.048);
        dish.rotation.x = 0.5;
        ring = mkRing(0.019, 0.004, 0.0026);
        const uplink = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), glowM.clone());
        uplink.position.y = 0.052;
        group.add(uplink);
        bob.push({ obj: uplink, base: 0.052, amp: 0.005, freq: 2.6 });
        break;
      }
      case 'prism': {
        // 汇聚棱镜：反重力悬浮晶体 + 两颗环绕碎晶 + 地面聚能环
        const geo = new THREE.OctahedronGeometry(0.018);
        geo.scale(1, 2.3, 1);
        const crystal = addPart(geo, 0.055);
        spin.push({ obj: crystal, axis: 'y', speed: 1.2 });
        bob.push({ obj: crystal, base: 0.055, amp: 0.007, freq: 1.6 });
        const shards = new THREE.Group();
        shards.position.y = 0.05;
        for (let i = 0; i < 2; i++) {
          const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.005),
            new THREE.MeshBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.9 }));
          shard.position.set(Math.cos(i * Math.PI) * 0.024, 0, Math.sin(i * Math.PI) * 0.024);
          shards.add(shard);
        }
        group.add(shards);
        spin.push({ obj: shards, axis: 'y', speed: -2.4 });
        ring = mkRing(0.02, 0.004, 0.0028);
        group.userData.muzzle = crystal;
        break;
      }
    }
    group.userData.ring = ring;
    group.userData.edges = edges;
    group.userData.spin = spin;
    group.userData.bob = bob;
    return group;
  }

  // ============ 主更新 ============

  update(dt: number) {
    this.time += dt;
    if (this.phase === 'idle') { this.animateIdle(dt); return; }
    if (this.phase === 'won' || this.phase === 'lost') { this.animateIdle(dt); this.updateFx(dt); return; }
    this.battleTime += dt;

    const aliveCities = this.cities.filter((c) => c.alive).length;
    this.energy += aliveCities * CITY_INCOME * dt;
    // 汲能词条被动产能
    for (const t of this.towers) if (t.perk?.key === 'siphon') this.energy += 1.5 * dt;

    // 连续进攻调度：倒计时到点就发起下一波，不等上一波清完
    if (this.launched < this.totalWaves()) {
      this.nextWaveT -= dt;
      document.getElementById('cd-val')!.textContent = Math.max(0, Math.ceil(this.nextWaveT)).toString();
      if (this.nextWaveT <= 0) this.launchWave();
    }

    this.updateOrbitals(dt);
    this.updateUnits(dt);
    this.updateTowers(dt);
    this.updateSatellites(dt);
    this.updateProjectiles(dt);
    this.updateFx(dt);
    this.animateIdle(dt);
    this.updateHud();

    // 终局：全部波次已发起且战场清空（无尽模式没有胜利，只有败北记录）
    if (!this.cfg.endless && this.launched >= this.totalWaves() && this.fieldClear()) {
      this.endGame(true);
    }
  }

  private fieldClear(): boolean {
    return this.orbitals.every((o) => !o.alive || o.phase === 'done')
      && this.orbitals.every((o) => o.kind === 'transport' || !o.alive)
      && this.units.every((u) => !u.alive);
  }

  // ============ 波次与登陆 ============

  private prepareLandings() {
    if (this.launched >= this.totalWaves()) return;
    const cfg = this.waveAt(this.launched);
    if (!cfg) return;
    this.pending = [];
    for (let i = 0; i < cfg.drops.length; i++) {
      // 登陆点固定在进攻走廊内：走廊格本身或其相邻格
      const laneId = this.laneCells[(this.launched + i) % Math.max(1, this.laneCells.length)];
      const lane = this.grid.cells[laneId];
      const options = [lane, ...lane.neighbors.map((id) => this.grid.cells[id])]
        .filter((c) => c.terrain !== 'ocean' && !this.occupied.has(c.id));
      const pick = options.length ? options[Math.floor(this.rand() * options.length)] : lane;
      const n = pick.center.clone();
      // 预定轨道平面：预警阶段即确定并显示航迹
      const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(n, ref).normalize()
        .applyAxisAngle(n, this.rand() * Math.PI * 2);
      const marker = this.spawnLandingMarker(pick.id);
      this.markers.push(marker);
      this.pending.push({ cellId: pick.id, marker, u, trail: this.makeTransportTrail(n, u) });
    }
  }

  /** 运输舰航迹线：环绕段 + 降落段 */
  private makeTransportTrail(n: THREE.Vector3, u: THREE.Vector3): THREE.Line {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const th = -3.1 + (i / 96) * 3.1;
      const r = this.orbitRadius(th);
      pts.push(n.clone().multiplyScalar(Math.cos(th))
        .addScaledVector(u, Math.sin(th)).multiplyScalar(r));
    }
    pts.push(n.clone().multiplyScalar(1.03));
    const trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color: COL_ROSE, transparent: true, opacity: 0.45,
        dashSize: 0.03, gapSize: 0.022, depthWrite: false,
      }));
    trail.computeLineDistances();
    trail.renderOrder = 8;
    this.root.add(trail);
    return trail;
  }

  private spawnLandingMarker(cellId: number): THREE.Group {
    const cell = this.grid.cells[cellId];
    const g = new THREE.Group();
    const n = cell.center.clone();
    g.position.copy(n.clone().multiplyScalar(cell.terrain === 'mountain' ? 1.024 : 1.006));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const mk = (r0: number, r1: number, op: number) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 40),
        new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 7;
      g.add(ring);
    };
    mk(0.045, 0.055, 0.8);
    mk(0.008, 0.02, 0.5);
    this.root.add(g);
    return g;
  }

  private launchWave() {
    this.phase = 'active';
    if (!this.pending.length) this.prepareLandings();
    sfx.play('alarm');
    this.banner(`WAVE ${this.launched + 1}`, '敌袭 // HOSTILE INBOUND', false, 2600);

    const cfg = this.waveAt(this.launched);
    cfg.drops.forEach((drop, i) => {
      const p = this.pending[i];
      const cargo = { type: drop.type, n: Math.round(drop.n * HORDE_MUL) };
      this.spawnTransport(p.cellId, cargo, i * 2.2, p.marker, false, { u: p.u, trail: p.trail });
    });
    this.markers = [];
    this.pending = [];
    for (let j = 0; j < (cfg.jammers ?? 0); j++) this.spawnJammer();
    for (let d = 0; d < (cfg.divers ?? 0); d++) this.spawnDiver(d);
    for (let gs = 0; gs < (cfg.gunships ?? 0); gs++) this.spawnGunship();
    if (cfg.wings) {
      this.spawnWings(cfg.wings);
      this.banner('飞行蜂群来袭', 'WING SWARM INBOUND // 防空火力自由射击', false, 3000);
    }
    if (cfg.gunships) this.banner('炮舰压顶', 'GUNSHIP ON STATION // 仅防空可拦截', false, 3000);
    if (cfg.boss) this.spawnBoss();

    this.launched++;
    this.setWaveLabel();
    if (this.launched < this.totalWaves()) {
      // 立即预告下一波：倒计时 + 登陆标记 + 航迹线与当前战斗并存
      this.nextWaveT = this.waveAt(this.launched).prewave;
      this.prepareLandings();
      this.showCountdown(true);
    } else {
      this.showCountdown(false);
    }
  }

  private baseOrbital(kind: OrbitalKind, hp: number): Orbital {
    return {
      kind, hp, maxHp: hp, alive: true,
      group: new THREE.Group(), pos: new THREE.Vector3(),
      landCell: -1, phase: 'orbit', theta: 0,
      basisN: new THREE.Vector3(), basisU: new THREE.Vector3(),
      descendT: 0, cargo: { type: 'swarm', n: 0 }, deployTimer: 0,
      marker: null, trail: null,
      orbitAxis: new THREE.Vector3(0, 1, 0), orbitAngle: 0, dropTimer: 0,
    };
  }

  private spawnTransport(landCell: number, cargo: { type: string; n: number }, delay: number, marker: THREE.Group | null, skipOrbit = false, pre?: { u: THREE.Vector3; trail: THREE.Line }) {
    const n = this.grid.cells[landCell].center.clone();
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = pre?.u ?? new THREE.Vector3().crossVectors(n, ref).normalize()
      .applyAxisAngle(n, this.rand() * Math.PI * 2);

    const o = this.baseOrbital('transport', TRANSPORT_HP);
    o.landCell = landCell; o.cargo = { ...cargo };
    o.basisN = n; o.basisU = u;
    o.theta = skipOrbit ? 0 : -3.1 - delay * 0.35;
    o.marker = marker;

    const body = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.045),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.9 }));
    o.group.add(body);
    const glow = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.02),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.75 }));
    o.group.add(glow);
    o.group.visible = skipOrbit;
    this.root.add(o.group);

    // 轨迹线：预警阶段已创建的直接沿用；投放舱走短降落线
    if (pre) {
      o.trail = pre.trail;
    } else if (!skipOrbit) {
      o.trail = this.makeTransportTrail(n, u);
    } else {
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          n.clone().multiplyScalar(1.25), n.clone().multiplyScalar(1.03)]),
        new THREE.LineDashedMaterial({
          color: COL_ROSE, transparent: true, opacity: 0.45,
          dashSize: 0.03, gapSize: 0.022, depthWrite: false,
        }));
      trail.computeLineDistances();
      trail.renderOrder = 8;
      this.root.add(trail);
      o.trail = trail;
    }

    if (skipOrbit) {
      o.phase = 'descend';
      o.group.position.copy(n.clone().multiplyScalar(1.25));
      if (!o.marker) { o.marker = this.spawnLandingMarker(landCell); }
    }

    this.orbitals.push(o);
  }

  /** 环绕型轨道单位的轨道线：实际飞行圆轨道的虚线投影 */
  private makeOrbitLine(axis: THREE.Vector3, radius: number, opacity: number, color: THREE.Color = COL_ROSE): THREE.Line {
    const ref = Math.abs(axis.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(axis, ref).normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(e1.clone().multiplyScalar(Math.cos(a))
        .addScaledVector(e2, Math.sin(a)).multiplyScalar(radius));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color, transparent: true, opacity,
        dashSize: 0.035, gapSize: 0.025, depthWrite: false,
      }));
    line.computeLineDistances();
    line.renderOrder = 8;
    this.root.add(line);
    return line;
  }

  private spawnJammer() {
    const o = this.baseOrbital('jammer', JAMMER_HP);
    o.orbitAxis = new THREE.Vector3().randomDirection();
    o.orbitAngle = this.rand() * Math.PI * 2;
    o.trail = this.makeOrbitLine(o.orbitAxis, JAMMER_RADIUS, 0.3);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.012, 8, 20),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.9 }));
    o.group.add(ring);
    this.root.add(o.group);
    this.orbitals.push(o);
    sfx.play('jam');
    this.banner('干扰者入轨', 'JAMMER IN ORBIT // 地面塔将被压制', false, 3000);
  }

  private spawnBoss() {
    const o = this.baseOrbital('boss', BOSS_HP);
    o.orbitAxis = new THREE.Vector3(0.3, 1, 0.2).normalize();
    o.orbitAngle = this.rand() * Math.PI * 2;
    o.dropTimer = 4;
    o.trail = this.makeOrbitLine(o.orbitAxis, BOSS_RADIUS, 0.4);

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.95 }));
    o.group.add(core);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.006, 8, 32),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.6 }));
    o.group.add(halo);
    const inner = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.04),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.8 }));
    o.group.add(inner);
    this.root.add(o.group);
    this.orbitals.push(o);
    sfx.play('alarm', 0);
    this.banner('母舰逼近', 'MOTHERSHIP DETECTED', false, 3400);
  }

  private orbitRadius(theta: number): number {
    return 1.55 - Math.max(0, (theta + 1.2) / 1.2) * 0.35;
  }

  /** 俯冲艇：短暂绕行后直接俯冲撞击城市 */
  private spawnDiver(delay: number) {
    const targets = this.cities.filter((c) => c.alive);
    if (!targets.length) return;
    const city = targets[Math.floor(this.rand() * targets.length)];
    const n = this.grid.cells[city.cellId].center.clone();
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize()
      .applyAxisAngle(n, this.rand() * Math.PI * 2);

    const o = this.baseOrbital('diver', DIVER_HP);
    o.landCell = city.cellId;
    o.basisN = n; o.basisU = u;
    o.theta = -2.4 - delay * 0.4;

    const dart = new THREE.Mesh(
      new THREE.ConeGeometry(0.011, 0.048, 4),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.95 }));
    o.group.add(dart);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.007, 8, 8),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    o.group.add(core);
    o.group.visible = false;
    this.root.add(o.group);

    // 俯冲航迹：绕行弧线 + 直插城市
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const th = -2.4 + (i / 64) * 2.4;
      const r = 1.5 - Math.max(0, (th + 1.0) / 1.0) * 0.3;
      pts.push(n.clone().multiplyScalar(Math.cos(th)).addScaledVector(u, Math.sin(th)).multiplyScalar(r));
    }
    pts.push(n.clone().multiplyScalar(1.02));
    const trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color: COL_ROSE, transparent: true, opacity: 0.35,
        dashSize: 0.025, gapSize: 0.02, depthWrite: false,
      }));
    trail.computeLineDistances();
    trail.renderOrder = 8;
    this.root.add(trail);
    o.trail = trail;

    this.orbitals.push(o);
  }

  /** 飞行蜂群：从走廊外侧成编队低空飞向城市，防空的割草靶 */
  private spawnWings(count: number) {
    const targets = this.cities.filter((c) => c.alive);
    if (!targets.length || !this.laneCells.length) return;
    const lane = this.grid.cells[this.laneCells[Math.floor(this.rand() * this.laneCells.length)]];
    // 目标：距走廊最近的存活城市
    let city = targets[0];
    for (const c of targets) {
      if (this.grid.cells[c.cellId].center.angleTo(lane.center)
        < this.grid.cells[city.cellId].center.angleTo(lane.center)) city = c;
    }
    const cityDir = this.grid.cells[city.cellId].center.clone();
    // 出发点：沿"城市→走廊"方向再向外延伸，编队从走廊外侧压进来
    const startBase = cityDir.clone().lerp(lane.center, 1.7).normalize();
    const ref = Math.abs(startBase.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(startBase, ref).normalize();
    const e2 = new THREE.Vector3().crossVectors(startBase, e1).normalize();

    for (let i = 0; i < count; i++) {
      const o = this.baseOrbital('wing', WING_HP);
      o.landCell = city.cellId;
      // 编队横向抖动 + 纵向错峰
      const spread = (this.rand() - 0.5) * 0.22;
      const spread2 = (this.rand() - 0.5) * 0.22;
      o.basisN = startBase.clone().addScaledVector(e1, spread).addScaledVector(e2, spread2).normalize();
      o.basisU = cityDir.clone();
      o.orbitAngle = o.basisN.angleTo(o.basisU); // 总航程角
      o.theta = -i * 0.055;                      // 进度（负值 = 延迟出场）

      const body = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.013),
        new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.95 }));
      o.group.add(body);
      o.group.visible = false;
      this.root.add(o.group);
      this.orbitals.push(o);
    }
  }

  /** 炮舰：飞抵城市上空悬停，持续轰炸，只能被防空火力击落 */
  private spawnGunship() {
    const targets = this.cities.filter((c) => c.alive);
    if (!targets.length) return;
    const city = targets[Math.floor(this.rand() * targets.length)];
    const n = this.grid.cells[city.cellId].center.clone();
    // 悬停点略偏离城市正上方
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3().crossVectors(n, ref).normalize()
      .applyAxisAngle(n, this.rand() * Math.PI * 2);
    const hoverDir = n.clone().addScaledVector(tangent, 0.12).normalize();
    const startPos = hoverDir.clone().applyAxisAngle(tangent, 1.1).multiplyScalar(1.7);

    const o = this.baseOrbital('gunship', GUNSHIP_HP);
    o.landCell = city.cellId;
    o.basisN = startPos;         // 进场起点
    o.basisU = hoverDir;         // 悬停方向
    o.descendT = 0;
    o.dropTimer = 1.2;

    const hull = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.05),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.9 }));
    hull.scale.set(1.4, 0.5, 1.4);
    o.group.add(hull);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.005, 8, 24),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    o.group.add(ring);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 8, 8),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    o.group.add(core);
    o.group.position.copy(startPos);
    this.root.add(o.group);
    this.orbitals.push(o);
  }

  private updateOrbitals(dt: number) {
    for (const o of this.orbitals) {
      if (!o.alive || o.phase === 'done') continue;

      if (o.kind === 'transport') {
        if (o.phase === 'orbit') {
          o.theta += dt * 0.55;
          if (o.theta < -3.05) continue;
          o.group.visible = true;
          const r = this.orbitRadius(o.theta);
          o.group.position.copy(o.basisN.clone().multiplyScalar(Math.cos(o.theta))
            .addScaledVector(o.basisU, Math.sin(o.theta)).multiplyScalar(r));
          o.group.rotation.y += dt * 2;
          if (o.theta >= 0) { o.phase = 'descend'; o.descendT = 0; }
        } else if (o.phase === 'descend') {
          o.descendT += dt / 2.0;
          const k = Math.min(1, o.descendT);
          const ease = 1 - Math.pow(1 - k, 3);
          const startH = o.group.position.length() > 1.22 ? 1.25 : 1.2;
          o.group.position.copy(o.basisN.clone().multiplyScalar(startH - ease * (startH - 1.03)));
          o.group.rotation.y += dt * 3;
          if (k >= 1) { o.phase = 'deploy'; o.deployTimer = 0.3; }
        } else if (o.phase === 'deploy') {
          o.deployTimer -= dt;
          o.group.rotation.y += dt * 1.2;
          if (o.deployTimer <= 0 && o.cargo.n > 0) {
            o.cargo.n--;
            o.deployTimer = 0.32; // 快速倾泻，成群涌出
            this.spawnUnit(o.landCell, o.cargo.type);
          }
          if (o.cargo.n === 0) this.finishTransport(o, false);
        }
      } else if (o.kind === 'wing') {
        o.theta += (dt * WING_SPEED) / Math.max(o.orbitAngle, 0.2);
        if (o.theta < 0) continue; // 编队错峰
        o.group.visible = true;
        const k = Math.min(1, o.theta);
        const alt = WING_ALT + 0.008 * Math.sin(this.time * 3 + o.landCell + o.orbitAngle * 37);
        o.group.position.copy(o.basisN.clone().lerp(o.basisU, k).normalize().multiplyScalar(alt));
        o.group.rotation.x += dt * 2.6;
        o.group.rotation.y += dt * 3.4;
        if (k >= 1) {
          // 抵达城市上空：自杀式冲撞
          o.phase = 'done';
          o.alive = false;
          this.hitCity(o.landCell, WING_IMPACT_DAMAGE, false);
          this.spawnFlash(o.group.position.clone(), COL_ROSE, 0.012, 0.2);
          this.root.remove(o.group);
        }
      } else if (o.kind === 'diver') {
        if (o.phase === 'orbit') {
          o.theta += dt * 0.95;
          if (o.theta < -2.35) continue; // 编队错峰出场
          o.group.visible = true;
          const r = 1.5 - Math.max(0, (o.theta + 1.0) / 1.0) * 0.3;
          o.group.position.copy(o.basisN.clone().multiplyScalar(Math.cos(o.theta))
            .addScaledVector(o.basisU, Math.sin(o.theta)).multiplyScalar(r));
          o.group.rotation.y += dt * 5;
          if (o.theta >= 0) { o.phase = 'descend'; o.descendT = 0; }
        } else if (o.phase === 'descend') {
          // 高速俯冲
          o.descendT += dt / 0.9;
          const k = Math.min(1, o.descendT);
          o.group.position.copy(o.basisN.clone().multiplyScalar(1.2 - k * k * 0.18));
          o.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), o.basisN.clone().negate());
          if (k >= 1) {
            // 撞击城市
            o.phase = 'done';
            o.alive = false;
            this.hitCity(o.landCell, DIVER_IMPACT_DAMAGE, true);
            this.spawnFlash(o.group.position.clone(), COL_ROSE, 0.03, 0.35);
            this.spawnRing(o.group.position.clone(), COL_ROSE, 0.08);
            this.root.remove(o.group);
            if (o.trail) this.root.remove(o.trail);
          }
        }
      } else if (o.kind === 'gunship') {
        if (o.phase === 'orbit') {
          // 进场：从远轨滑向城市上空悬停点
          o.descendT += dt / 5;
          const k = Math.min(1, o.descendT);
          const ease = 1 - Math.pow(1 - k, 2);
          const hover = o.basisU.clone().multiplyScalar(GUNSHIP_HOVER);
          o.group.position.copy(o.basisN.clone().lerp(hover, ease));
          o.group.rotation.y += dt * 0.8;
          if (k >= 1) o.phase = 'deploy';
        } else if (o.phase === 'deploy') {
          // 悬停轰炸
          const bobK = 1 + 0.008 * Math.sin(this.time * 2.1);
          o.group.position.copy(o.basisU.clone().multiplyScalar(GUNSHIP_HOVER * bobK));
          o.group.rotation.y += dt * 0.8;
          const targetCity = this.cities.find((c) => c.cellId === o.landCell);
          if (!targetCity || !targetCity.alive) {
            // 目标已毁：转移到最近的存活城市上空
            const next = this.cities.find((c) => c.alive);
            if (next) {
              o.landCell = next.cellId;
              const n2 = this.grid.cells[next.cellId].center.clone();
              o.basisN = o.group.position.clone();
              o.basisU = n2;
              o.phase = 'orbit';
              o.descendT = 0;
            }
          } else {
            o.dropTimer -= dt;
            if (o.dropTimer <= 0) {
              o.dropTimer = GUNSHIP_BOLT_INTERVAL;
              const cityPos = this.grid.cells[o.landCell].center.clone().multiplyScalar(1.01);
              this.fireLine(o.group.position.clone(), cityPos, 0.3, COL_ROSE);
              this.spawnFlash(cityPos, COL_ROSE, 0.014, 0.2);
              this.hitCity(o.landCell, GUNSHIP_BOLT_DAMAGE, false);
              sfx.play('arc', 300);
            }
          }
        }
      } else {
        // jammer / boss：永续环绕，直到被击落
        const speed = o.kind === 'boss' ? 0.16 : 0.3;
        const radius = o.kind === 'boss' ? BOSS_RADIUS : JAMMER_RADIUS;
        o.orbitAngle += dt * speed;
        const ax = o.orbitAxis;
        const ref = Math.abs(ax.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const e1 = new THREE.Vector3().crossVectors(ax, ref).normalize();
        const e2 = new THREE.Vector3().crossVectors(ax, e1).normalize();
        o.group.position.copy(
          e1.clone().multiplyScalar(Math.cos(o.orbitAngle))
            .addScaledVector(e2, Math.sin(o.orbitAngle)).multiplyScalar(radius));
        o.group.rotation.x += dt * 0.8;
        o.group.rotation.y += dt * 1.1;

        if (o.kind === 'boss') {
          o.dropTimer -= dt;
          if (o.dropTimer <= 0) {
            o.dropTimer = BOSS_DROP_INTERVAL;
            this.bossDrop(o);
          }
        }
      }
      o.pos.copy(o.group.position);
    }
  }

  private bossDrop(boss: Orbital) {
    const dist = this.bfsFromCities();
    const pool = this.grid.cells.filter((c) =>
      c.terrain !== 'ocean' && !this.occupied.has(c.id) && dist[c.id] >= 1 && dist[c.id] <= 4);
    if (!pool.length) return;
    const pick = pool[Math.floor(this.rand() * pool.length)];
    this.spawnTransport(pick.id, { type: 'swarm', n: 3 }, 0, null, true);
    this.banner('登陆舱投放', 'DROP POD INBOUND', false, 1800);
  }

  private finishTransport(o: Orbital, shotDown: boolean) {
    o.phase = 'done';
    if (shotDown) {
      o.alive = false;
      this.energy += TRANSPORT_REWARD;
      this.spawnRing(o.pos.clone(), COL_CYAN, 0.07);
    } else {
      this.spawnRing(o.pos.clone(), COL_ROSE, 0.06);
    }
    this.root.remove(o.group);
    if (o.trail) this.root.remove(o.trail);
    if (o.marker) this.root.remove(o.marker);
  }

  damageOrbital(o: Orbital, dmg: number) {
    if (!o.alive || o.phase === 'done') return;
    o.hp -= dmg;
    if (o.hp > 0) return;
    if (o.kind === 'transport') {
      this.stats.intercepted++;
      sfx.play('intercept', 120);
      this.finishTransport(o, true);
    } else if (o.kind === 'wing') {
      // 蜂群算击杀（割草），不算拦截
      o.alive = false;
      this.stats.kills++;
      this.energy += WING_REWARD;
      sfx.play('explosion', 130);
      this.spawnRing(o.pos.clone(), COL_CYAN, 0.03);
      this.root.remove(o.group);
    } else {
      o.alive = false;
      this.stats.intercepted++;
      sfx.play('intercept', 120);
      const rewards: Record<OrbitalKind, number> = {
        transport: TRANSPORT_REWARD, jammer: JAMMER_REWARD, boss: BOSS_REWARD,
        diver: DIVER_REWARD, gunship: GUNSHIP_REWARD, wing: WING_REWARD,
      };
      this.energy += rewards[o.kind];
      this.spawnRing(o.pos.clone(), COL_CYAN, o.kind === 'boss' ? 0.14 : 0.08);
      this.root.remove(o.group);
      if (o.trail) this.root.remove(o.trail);
      if (o.kind === 'boss') this.banner('母舰击毁', 'MOTHERSHIP DESTROYED', true, 3000);
    }
  }

  // ============ 地面单位 ============

  private spawnUnit(fromCell: number, type: string) {
    const def = GROUND_DEFS[type];
    const path = this.findPath(fromCell);
    if (!path || path.length < 2) return;
    let geo: THREE.BufferGeometry;
    if (type === 'armored') geo = new THREE.OctahedronGeometry(def.size);
    else if (type === 'runner') geo = new THREE.ConeGeometry(def.size * 0.7, def.size * 2.2, 4);
    else if (type === 'splitter') geo = new THREE.IcosahedronGeometry(def.size, 0);
    else geo = new THREE.TetrahedronGeometry(def.size);
    const mat = new THREE.MeshBasicMaterial({
      color: type === 'armored' ? new THREE.Color('#c22343') : COL_ROSE,
      wireframe: true, transparent: true, opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const n0 = this.grid.cells[fromCell].center;
    // 横向散布：随机切向偏移，让同舱部队铺开成松散团
    const rt = new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
    const offset = new THREE.Vector3().crossVectors(n0, rt).normalize()
      .multiplyScalar(this.rand() * 0.024);
    const pos = n0.clone().add(offset).normalize().multiplyScalar(1.02);
    mesh.position.copy(pos);
    this.root.add(mesh);
    this.units.push({
      type, def, mesh, path, seg: 0, t: 0, hp: def.hp, alive: true, pos: pos.clone(),
      slowUntilFrame: false, offset, speedMul: 0.85 + this.rand() * 0.3,
    });
  }

  private updateUnits(dt: number) {
    // 磁暴塔减速场
    const teslas = this.towers.filter((t) => t.def.key === 'tesla' && !t.jammed);
    for (const u of this.units) {
      if (!u.alive) continue;
      let speed = u.def.speed * u.speedMul;
      for (const ts of teslas) {
        if (this.grid.cells[ts.cellId].center.angleTo(u.pos) < this.towerRange(ts)) {
          speed *= 0.6 - (ts.level - 1) * 0.08;
          u.slowUntilFrame = true;
          break;
        }
      }
      const from = this.grid.cells[u.path[u.seg]].center;
      const to = this.grid.cells[u.path[u.seg + 1]].center;
      const segAngle = from.angleTo(to);
      u.t += (speed * dt) / Math.max(segAngle, 1e-4);
      if (u.t >= 1) {
        u.seg++;
        u.t = 0;
        if (u.seg >= u.path.length - 1) {
          this.hitCity(u.path[u.path.length - 1]);
          this.killUnit(u, false);
          continue;
        }
        const targetCity = this.cities.find((c) => c.cellId === u.path[u.path.length - 1]);
        if (!targetCity || !targetCity.alive) {
          const np = this.findPath(u.path[u.seg]);
          if (np && np.length >= 2) { u.path = np; u.seg = 0; u.t = 0; }
          else { this.killUnit(u, false); continue; }
        }
      }
      u.pos.copy(from).lerp(to, u.t).add(u.offset).normalize().multiplyScalar(1.02);
      u.mesh.position.copy(u.pos);
      u.mesh.rotation.x += dt * 3.1;
      u.mesh.rotation.y += dt * 2.3;
    }
    this.units = this.units.filter((u) => u.alive);
  }

  private killUnit(u: Unit, reward: boolean) {
    u.alive = false;
    this.root.remove(u.mesh);
    this.spawnRing(u.pos.clone(), reward ? COL_CYAN : COL_ROSE, 0.045);
    if (reward) {
      this.energy += u.def.reward;
      this.stats.kills++;
      sfx.play('explosion', 90);
      // 裂变体：死后分裂出两只小蜂群继续扑城
      if (u.type === 'splitter') {
        const cell = u.path[Math.min(u.seg, u.path.length - 1)];
        this.spawnUnit(cell, 'swarmling');
        this.spawnUnit(cell, 'swarmling');
        this.spawnRing(u.pos.clone(), COL_ROSE, 0.06);
      }
    }
  }

  private hitCity(cellId: number, dmg = CITY_HIT_DAMAGE, countLeak = true) {
    const city = this.cities.find((c) => c.cellId === cellId);
    if (!city || !city.alive) return;
    if (countLeak) this.stats.leaked++;
    sfx.play('cityhit', 200);
    city.hp -= dmg;
    city.row.classList.add('hurt');
    setTimeout(() => city.row.classList.remove('hurt'), 600);
    const flash = document.getElementById('dmg-flash')!;
    flash.style.opacity = '1';
    setTimeout(() => (flash.style.opacity = '0'), 120);

    if (city.hp <= 0) {
      city.hp = 0;
      city.alive = false;
      this.stats.citiesLost++;
      city.row.classList.add('dead');
      city.buildings.traverse((obj) => {
        const mat = (obj as THREE.Mesh | THREE.LineSegments).material as THREE.MeshBasicMaterial | undefined;
        if (!mat) return;
        if (obj instanceof THREE.LineSegments) { mat.color.set('#6b2a35'); mat.opacity = 0.5; }
        else if (obj instanceof THREE.Mesh) mat.color.set('#140a08');
      });
      city.beam.visible = false;
      (city.base.material as THREE.MeshBasicMaterial).color.set('#6b2a35');
      (city.base.material as THREE.MeshBasicMaterial).opacity = 0.3;
      this.spawnRing(city.group.position.clone(), COL_ROSE, 0.09);
      // 首都陷落 = 直接战败；否则全灭才输
      if (city.capital || !this.cities.some((c) => c.alive)) this.endGame(false);
    }
  }

  // ============ 塔的战斗 ============

  private updateTowers(dt: number) {
    // 干扰者压制判定
    const jammers = this.orbitals.filter((o) => o.kind === 'jammer' && o.alive);
    // 雷达增益
    const radars = this.towers.filter((t) => t.def.key === 'radar' && !t.jammed);

    for (const tw of this.towers) {
      if (tw.group.scale.x < 1) tw.group.scale.setScalar(Math.min(1, tw.group.scale.x + dt * 4));
      if (tw.ring) tw.ring.rotation.z += dt * 1.6;
      // 待机动画：自旋部件 + 悬浮呼吸
      const ud = tw.group.userData;
      for (const s of (ud.spin ?? []) as { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[]) {
        s.obj.rotation[s.axis] += s.speed * dt;
      }
      for (const b of (ud.bob ?? []) as { obj: THREE.Object3D; base: number; amp: number; freq: number }[]) {
        b.obj.position.y = b.base + Math.sin(this.time * b.freq + tw.cellId) * b.amp;
      }

      const towerN = this.grid.cells[tw.cellId].center;
      const towerH = tw.group.position.length(); // 山地塔基座更高

      // 被干扰？（防空塔与雷达不受干扰，地面塔被压制）
      tw.jammed = false;
      if (tw.def.kind === 'ground') {
        for (const j of jammers) {
          if (j.pos.clone().normalize().angleTo(towerN) < JAM_ANGLE) { tw.jammed = true; break; }
        }
      }
      // 压制视觉：边线闪烁
      for (const e of tw.edges) {
        (e.material as THREE.LineBasicMaterial).opacity =
          tw.jammed ? 0.25 + 0.2 * Math.sin(this.time * 12) : 0.9;
      }
      if (tw.jammed) { this.clearLock(tw); continue; }

      let rateMul = 1;
      for (const r of radars) {
        if (r.cellId !== tw.cellId
          && this.grid.cells[r.cellId].center.angleTo(towerN) < this.towerRange(r)) {
          rateMul = 1 + 0.25 + (r.level - 1) * 0.1;
          break;
        }
      }
      if (tw.perk?.key === 'rapid') rateMul *= 1.25;

      const range = this.towerRange(tw);

      if (tw.def.key === 'laser') {
        this.updateLaserTower(tw, towerN, range, rateMul, dt);
        continue;
      }
      if (tw.def.key === 'tesla') {
        // 减速场 + 电弧链击：周期性劈向场内敌人并造成伤害
        tw.cooldown -= dt * rateMul;
        if (tw.cooldown <= 0) {
          const orbPos = towerN.clone().multiplyScalar(towerH + 0.072);
          const arcDmg = this.towerDamage(tw);
          let arcs = 0;
          for (const u of this.units) {
            if (!u.alive || arcs >= 2) continue;
            if (towerN.angleTo(u.pos) > this.towerRange(tw)) continue;
            this.spawnArc(orbPos, u.pos.clone());
            u.hp -= Math.max(1, arcDmg - u.def.armor * 0.5);
            if (u.hp <= 0) this.killUnit(u, true);
            arcs++;
          }
          if (arcs > 0) { this.spawnFlash(orbPos, COL_CYAN, 0.008, 0.14); sfx.play('arc', 250); }
          tw.cooldown = 0.38;
        }
        continue;
      }
      if (tw.def.key === 'radar') continue; // 增益塔不攻击
      if (tw.def.key === 'satellite') continue; // 攻击由在轨卫星执行

      tw.cooldown -= dt * rateMul;
      if (tw.cooldown > 0) continue;

      if (tw.def.key === 'missile') {
        // 对空爆发：优先运输舰，发射抛物线弹道
        let target: Orbital | null = null;
        for (const o of this.orbitals) {
          if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
          if (towerN.angleTo(o.pos.clone().normalize()) > range) continue;
          if (!target || o.kind !== 'transport') target = o;
          if (o.kind === 'transport') { target = o; break; }
        }
        if (!target) continue;
        tw.cooldown = tw.def.cooldown;
        const from = towerN.clone().multiplyScalar(towerH + 0.04);
        this.spawnFlash(from, COL_AMBER, 0.01, 0.15);
        sfx.play('missile', 150);
        this.launchMissile(from, target.pos.clone(), this.towerDamage(tw));
        continue;
      }

      // pulse / prism：对地
      let target: Unit | null = null;
      let bestProgress = -1;
      for (const u of this.units) {
        if (!u.alive) continue;
        if (towerN.angleTo(u.pos) > range) continue;
        const progress = u.seg + u.t;
        if (progress > bestProgress) { bestProgress = progress; target = u; }
      }
      if (!target) continue;
      tw.cooldown = tw.def.cooldown;
      const dmg = Math.max(1, this.towerDamage(tw) - target.def.armor);
      target.hp -= dmg;
      if (tw.def.key === 'prism') {
        // 汇聚棱镜：粗光束 + 双端爆闪 + 溅射（割草核心）
        const from = towerN.clone().multiplyScalar(towerH + 0.055);
        this.spawnBeam(from, target.pos.clone(), 0.006, COL_CYAN);
        this.spawnFlash(from, COL_AMBER, 0.012, 0.2);
        this.spawnFlash(target.pos.clone(), COL_CYAN, 0.016, 0.25);
        sfx.play('prism', 180);
        // 命中点范围溅射：清一片
        for (const u2 of this.units) {
          if (!u2.alive || u2 === target) continue;
          if (u2.pos.distanceTo(target.pos) < 0.075) {
            u2.hp -= Math.max(1, dmg * 0.6 - u2.def.armor);
            if (u2.hp <= 0) this.killUnit(u2, true);
          }
        }
      } else {
        // 脉冲炮：射线 + 枪口焰 + 命中闪
        const from = towerN.clone().multiplyScalar(towerH + 0.062);
        this.fireLine(from, target.pos.clone(), 0.14);
        this.spawnFlash(from, COL_CYAN, 0.007, 0.12);
        this.spawnFlash(target.pos.clone(), COL_ROSE, 0.01, 0.15);
        sfx.play('shoot', 80);
      }
      if (target.hp <= 0) this.killUnit(target, true);
    }
  }

  private updateLaserTower(tw: Tower, towerN: THREE.Vector3, range: number, rateMul: number, dt: number) {
    // 维持/寻找锁定目标
    if (tw.lockTarget && (!tw.lockTarget.alive || tw.lockTarget.phase === 'done'
      || towerN.angleTo(tw.lockTarget.pos.clone().normalize()) > range)) {
      this.clearLock(tw);
    }
    if (!tw.lockTarget) {
      for (const o of this.orbitals) {
        if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
        if (towerN.angleTo(o.pos.clone().normalize()) <= range) { tw.lockTarget = o; tw.lockT = 0; break; }
      }
    }
    const target = tw.lockTarget;
    if (!target) { this.clearLock(tw); return; }

    tw.lockT = Math.min(3, tw.lockT + dt);
    const ramp = 1 + (tw.lockT / 3) * 1.2; // 1 → 2.2
    this.damageOrbital(target, this.towerDamage(tw) * ramp * rateMul * dt);

    // 持续体积光柱：锁定越久越粗越亮
    if (!tw.beam) {
      tw.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: COL_CYAN, transparent: true, opacity: 0.6,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
      tw.beam.renderOrder = 9;
      this.root.add(tw.beam);
    }
    const from = towerN.clone().multiplyScalar(tw.group.position.length() + 0.108);
    const dir = target.pos.clone().sub(from);
    const len = dir.length();
    const radius = 0.0022 + (tw.lockT / 3) * 0.0045;
    tw.beam.position.copy(from).addScaledVector(dir, 0.5);
    tw.beam.scale.set(radius, len, radius);
    tw.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    (tw.beam.material as THREE.MeshBasicMaterial).opacity = 0.45 + (tw.lockT / 3) * 0.5;
    // 命中点火花
    if (this.rand() < dt * 8) this.spawnFlash(target.pos.clone(), COL_CYAN, 0.008 + (tw.lockT / 3) * 0.008, 0.12);
  }

  private clearLock(tw: Tower) {
    tw.lockTarget = null;
    tw.lockT = 0;
    if (tw.beam) { this.root.remove(tw.beam); tw.beam.geometry.dispose(); tw.beam = null; }
  }

  private fireLine(from: THREE.Vector3, to: THREE.Vector3, ttl: number, color?: THREE.Color) {
    const mat = this.laserMat.clone();
    if (color) mat.color.copy(color);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from, to]), mat);
    line.renderOrder = 9;
    this.root.add(line);
    this.fx.push({ obj: line, ttl, max: ttl, kind: 'laser' });
  }

  /** 短促的发光球闪光（枪口焰 / 命中爆闪） */
  private spawnFlash(pos: THREE.Vector3, color: THREE.Color, size: number, ttl = 0.18) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos);
    m.renderOrder = 9;
    this.root.add(m);
    this.fx.push({ obj: m, ttl, max: ttl, kind: 'flash' });
  }

  /** 一次性粗光束（棱镜），圆柱体 + 加色混合，随 ttl 变细淡出 */
  private spawnBeam(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: THREE.Color, ttl = 0.28) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, len, 6, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.renderOrder = 9;
    this.root.add(m);
    this.fx.push({ obj: m, ttl, max: ttl, kind: 'beam' });
  }

  /** 锯齿状电弧（磁暴塔） */
  private spawnArc(from: THREE.Vector3, to: THREE.Vector3, ttl = 0.16) {
    const pts: THREE.Vector3[] = [];
    const segs = 6;
    const dir = to.clone().sub(from);
    for (let i = 0; i <= segs; i++) {
      const p = from.clone().addScaledVector(dir, i / segs);
      if (i > 0 && i < segs) {
        p.add(new THREE.Vector3(
          (this.rand() - 0.5) * 0.02, (this.rand() - 0.5) * 0.02, (this.rand() - 0.5) * 0.02));
      }
      pts.push(p);
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts), this.laserMat.clone());
    line.renderOrder = 9;
    this.root.add(line);
    this.fx.push({ obj: line, ttl, max: ttl, kind: 'arc' });
  }

  /** 导弹弹道：抛物线飞行，落点结算范围伤害 */
  private launchMissile(from: THREE.Vector3, to: THREE.Vector3, dmg: number) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.004, 0.016, 6),
      new THREE.MeshBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.95 }));
    mesh.add(body);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 6, 6),
      new THREE.MeshBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.y = -0.01;
    mesh.add(flame);
    mesh.position.copy(from);
    this.root.add(mesh);

    const trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from, from]),
      new THREE.LineBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.renderOrder = 8;
    this.root.add(trail);

    this.projectiles.push({ mesh, trail, from: from.clone(), to: to.clone(), t: 0, dmg, aoe: 0.28 });
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      p.t = Math.min(1, p.t + dt * 2.2);
      // 抛物线：中点向外拱起
      const mid = p.from.clone().add(p.to).multiplyScalar(0.5).normalize()
        .multiplyScalar(Math.max(p.from.length(), p.to.length()) + 0.12);
      const a = p.from.clone().lerp(mid, p.t);
      const b = mid.clone().lerp(p.to, p.t);
      const pos = a.lerp(b, p.t);
      const prev = p.mesh.position.clone();
      p.mesh.position.copy(pos);
      const vel = pos.clone().sub(prev);
      if (vel.lengthSq() > 1e-10) {
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vel.normalize());
      }
      p.trail.geometry.dispose();
      p.trail.geometry = new THREE.BufferGeometry().setFromPoints([p.from, pos]);

      if (p.t >= 1) {
        // 命中：爆闪 + 冲击环 + 范围伤害
        this.spawnFlash(p.to, COL_CYAN, 0.02, 0.3);
        this.spawnRing(p.to.clone(), COL_CYAN, 0.06);
        for (const o of this.orbitals) {
          if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
          if (o.pos.distanceTo(p.to) < p.aoe) this.damageOrbital(o, p.dmg);
        }
        this.root.remove(p.mesh);
        this.root.remove(p.trail);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.t < 1);
  }

  // ============ 特效 ============

  private spawnRing(pos: THREE.Vector3, color: THREE.Color, size: number) {
    const n = pos.clone().normalize();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.55, size * 0.7, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(n.clone().multiplyScalar(Math.max(1.008, pos.length())));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    ring.renderOrder = 9;
    this.root.add(ring);
    this.fx.push({ obj: ring, ttl: 0.5, max: 0.5, kind: 'ring' });
  }

  private updateFx(dt: number) {
    for (const f of this.fx) {
      f.ttl -= dt;
      const k = Math.max(0, f.ttl / f.max);
      const mat = (f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      switch (f.kind) {
        case 'laser':
        case 'arc':
          mat.opacity = k;
          break;
        case 'flash':
          f.obj.scale.setScalar(1 + (1 - k) * 1.6);
          mat.opacity = k * 0.95;
          break;
        case 'beam':
          f.obj.scale.x = Math.max(0.05, k);
          f.obj.scale.z = Math.max(0.05, k);
          mat.opacity = k * 0.9;
          break;
        case 'ring':
          f.obj.scale.setScalar(1 + (1 - k) * 2.2);
          mat.opacity = k * 0.9;
          break;
      }
      if (f.ttl <= 0) this.root.remove(f.obj);
    }
    this.fx = this.fx.filter((f) => f.ttl > 0);
  }

  private animateIdle(dt: number) {
    this.cities.forEach((c, i) => {
      if (!c.alive) return;
      const k = 0.5 + 0.5 * Math.sin(this.time * 1.8 + i * 1.2);
      (c.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + k * 0.28;
      c.beam.scale.set(1 + k * 0.3, 1, 1 + k * 0.3);
      c.base.rotation.z += dt * 0.35;
    });
    this.markers.forEach((m, i) => {
      const k = 0.5 + 0.5 * Math.sin(this.time * 4 + i);
      m.children.forEach((ch) => {
        ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + k * 0.55;
      });
      m.scale.setScalar(1 + 0.15 * k);
    });
  }

  // ============ 寻路（优先陆地） ============

  private findPath(fromCell: number): number[] | null {
    const targets = new Set(this.cities.filter((c) => c.alive).map((c) => c.cellId));
    if (!targets.size) return null;
    const landOnly = this.bfsPath(fromCell, targets, true);
    if (landOnly) return landOnly;
    return this.bfsPath(fromCell, targets, false);
  }

  private bfsPath(fromCell: number, targets: Set<number>, landOnly: boolean): number[] | null {
    const prev = new Map<number, number>();
    const visited = new Set<number>([fromCell]);
    let frontier = [fromCell];
    let found = -1;
    while (frontier.length && found < 0) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const nb of this.grid.cells[id].neighbors) {
          if (visited.has(nb)) continue;
          if (landOnly && this.grid.cells[nb].terrain === 'ocean' && !targets.has(nb)) continue;
          visited.add(nb);
          prev.set(nb, id);
          if (targets.has(nb)) { found = nb; break; }
          next.push(nb);
        }
        if (found >= 0) break;
      }
      frontier = next;
    }
    if (found < 0) return null;
    const path = [found];
    while (path[0] !== fromCell) path.unshift(prev.get(path[0])!);
    return path;
  }

  private bfsFromCities(): number[] {
    const dist = new Array(this.grid.cells.length).fill(Infinity);
    let frontier: number[] = [];
    for (const c of this.cities) if (c.alive) { dist[c.cellId] = 0; frontier.push(c.cellId); }
    let d = 0;
    while (frontier.length) {
      const next: number[] = [];
      d++;
      for (const id of frontier) {
        for (const nb of this.grid.cells[id].neighbors) {
          if (dist[nb] <= d) continue;
          dist[nb] = d;
          next.push(nb);
        }
      }
      frontier = next;
    }
    return dist;
  }

  // ============ 迷你地球仪数据 ============

  threatPoints(out: THREE.Vector3[]): number {
    let n = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (n >= out.length) break;
      out[n++].copy(u.pos);
    }
    for (const o of this.orbitals) {
      if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
      if (n >= out.length) break;
      out[n++].copy(o.pos);
    }
    return n;
  }

  // ============ HUD ============

  private updateHud() {
    document.getElementById('energy-val')!.textContent = Math.floor(this.energy).toString();
    for (const c of this.cities) {
      c.bar.style.transform = `scaleX(${c.hp / c.maxHp})`;
    }
    document.querySelectorAll<HTMLElement>('.tower-card').forEach((card) => {
      if (card.dataset.locked) return; // 未解锁的卡保持置灰
      const def = TOWER_DEFS.find((d) => d.key === card.dataset.key)!;
      card.classList.toggle('poor', this.energy < def.cost);
    });
  }

  private setWaveLabel() {
    document.getElementById('wave-val')!.textContent = this.cfg.endless
      ? `${this.launched + 1}/∞`
      : `${Math.min(this.launched + 1, this.cfg.waves.length)}/${this.cfg.waves.length}`;
  }

  private showCountdown(show: boolean) {
    document.getElementById('countdown')!.classList.toggle('show', show);
  }

  private banner(main: string, sub: string, friendly: boolean, ms: number) {
    const b = document.getElementById('banner')!;
    document.getElementById('banner-main')!.textContent = main;
    document.getElementById('banner-sub')!.textContent = sub;
    b.classList.toggle('friendly', friendly);
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), ms);
  }

  private endGame(win: boolean) {
    this.phase = win ? 'won' : 'lost';
    sfx.play(win ? 'win' : 'lose');
    document.getElementById('status-text')!.textContent = win ? 'SECURED' : 'OFFLINE';
    // 评星：3★ 城市无损且总血量≥80%；2★ 至多损失 1 城；1★ 惨胜
    this.stats.duration = Math.round(this.battleTime);
    if (win) {
      const totalHp = this.cities.reduce((s, c) => s + c.hp, 0)
        / this.cities.reduce((s, c) => s + c.maxHp, 0);
      this.stats.stars = this.stats.citiesLost === 0 && totalHp >= 0.8 ? 3
        : this.stats.citiesLost <= 1 ? 2 : 1;
    } else {
      this.stats.stars = 0;
    }
    this.onEnd(win, this.stats);
  }

  private seed = 987654321;
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}
