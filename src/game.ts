// M2：6 塔 5 敌、地形规则、升级/出售、5 波含 Boss 的完整关卡。
// 所有战场实体挂在 earthGroup 下（本地坐标 = 单位球面），随地球一起自转。

import * as THREE from 'three';
import type { GoldbergGrid, Cell } from './goldberg';

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
  { key: 'pulse',   name: '脉冲炮',   sub: 'PULSE',   icon: '▲', cost: 100, kind: 'ground',  range: 0.36, damage: 26, cooldown: 0.85, desc: '基础对地单体' },
  { key: 'tesla',   name: '磁暴塔',   sub: 'TESLA',   icon: '◈', cost: 140, kind: 'ground',  range: 0.30, damage: 0,  cooldown: 0,    desc: '范围减速 40%' },
  { key: 'laser',   name: '轨道激光', sub: 'O-LASER', icon: '║', cost: 170, kind: 'air',     range: 0.60, damage: 30, cooldown: 0,    desc: '对空持续射线·锁定增伤' },
  { key: 'missile', name: '破片导弹', sub: 'FRAG-M',  icon: '✦', cost: 190, kind: 'air',     range: 0.55, damage: 80, cooldown: 4.0,  desc: '对空范围爆发' },
  { key: 'radar',   name: '雷达站',   sub: 'RADAR',   icon: '◍', cost: 120, kind: 'support', range: 0.40, damage: 0,  cooldown: 0,    desc: '射程内塔 +25% 射速' },
  { key: 'prism',   name: '汇聚棱镜', sub: 'PRISM',   icon: '◆', cost: 220, kind: 'ground',  range: 0.42, damage: 42, cooldown: 1.5,  desc: '相邻每塔 +45% 伤害' },
];

const OCEAN_PLATFORM_COST = 60;   // 海上浮动平台附加费
const MOUNTAIN_RANGE_MUL = 1.25;  // 山地射程加成
const UPGRADE_DMG_MUL = 1.5;      // 每级伤害倍率
const SELL_REFUND = 0.6;
const MAX_LEVEL = 3;

// ========== 敌人定义 ==========

interface GroundDef { hp: number; speed: number; armor: number; reward: number; size: number }
const GROUND_DEFS: Record<string, GroundDef> = {
  swarm:   { hp: 55,  speed: 0.085, armor: 0, reward: 16, size: 0.022 },
  runner:  { hp: 42,  speed: 0.155, armor: 0, reward: 15, size: 0.018 },
  armored: { hp: 170, speed: 0.055, armor: 8, reward: 32, size: 0.03 },
};

const TRANSPORT_HP = 130;
const TRANSPORT_REWARD = 45;   // 在轨击落 = 整船歼灭，重赏
const JAMMER_HP = 110;
const JAMMER_REWARD = 50;
const JAMMER_RADIUS = 1.32;
const JAM_ANGLE = 0.34;
const BOSS_HP = 950;
const BOSS_REWARD = 300;
const BOSS_RADIUS = 1.5;
const BOSS_DROP_INTERVAL = 11;

// ========== 关卡 ==========

const START_ENERGY = 320;
const CITY_HP = 100;
const CITY_INCOME = 1.6;
const CITY_HIT_DAMAGE = 15;
const CITY_NAMES = ['NOVA-1', 'KIRIN-2', 'AURUM-3', 'TERRA-4', 'ZENIT-5'];

interface WaveCfg {
  prewave: number;
  drops: { type: keyof typeof GROUND_DEFS; n: number }[];
  jammers?: number;
  boss?: boolean;
}
const WAVES: WaveCfg[] = [
  { prewave: 16, drops: [{ type: 'swarm', n: 5 }] },
  { prewave: 12, drops: [{ type: 'swarm', n: 5 }, { type: 'runner', n: 4 }] },
  { prewave: 13, drops: [{ type: 'armored', n: 3 }, { type: 'swarm', n: 6 }], jammers: 1 },
  { prewave: 14, drops: [{ type: 'runner', n: 5 }, { type: 'armored', n: 4 }, { type: 'swarm', n: 6 }], jammers: 1 },
  { prewave: 16, drops: [{ type: 'armored', n: 4 }, { type: 'swarm', n: 6 }], boss: true },
];

type Phase = 'prewave' | 'active' | 'won' | 'lost';

// ========== 实体 ==========

interface City {
  cellId: number; hp: number; alive: boolean; name: string;
  group: THREE.Group; buildings: THREE.Group; beam: THREE.Mesh; base: THREE.Mesh;
  row: HTMLElement; bar: HTMLElement;
}

export interface Tower {
  def: TowerDef; level: number; cellId: number; invested: number;
  group: THREE.Group; ring: THREE.Mesh | null; edges: THREE.LineSegments[];
  cooldown: number;
  // 轨道激光的锁定状态
  lockTarget: Orbital | null; lockT: number; beam: THREE.Line | null;
  jammed: boolean;
}

interface Unit {
  type: string; def: GroundDef;
  mesh: THREE.Mesh; path: number[]; seg: number; t: number;
  hp: number; alive: boolean; pos: THREE.Vector3; slowUntilFrame: boolean;
}

type OrbitalKind = 'transport' | 'jammer' | 'boss';
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

interface Fx { obj: THREE.Object3D; ttl: number; max: number; kind: 'laser' | 'ring' }

// ========== 主类 ==========

export class Game {
  phase: Phase = 'prewave';
  energy = START_ENERGY;
  waveIdx = 0;
  private prewaveT = WAVES[0].prewave;
  private time = 0;

  cities: City[] = [];
  towers: Tower[] = [];
  units: Unit[] = [];
  orbitals: Orbital[] = [];
  private fx: Fx[] = [];
  private occupied = new Set<number>();
  private root = new THREE.Group();
  private markers: THREE.Group[] = [];
  private pendingLandCells: number[] = [];

  private laserMat = new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(private earthGroup: THREE.Group, private grid: GoldbergGrid) {
    earthGroup.add(this.root);
    this.spawnCities();
    this.updateHud();
    this.setWaveLabel();
    this.showCountdown(true);
  }

  // ============ 城市 ============

  private spawnCities() {
    const land = this.grid.cells.filter((c) => c.terrain === 'land' && !c.isPentagon);
    const picked: Cell[] = [land[Math.floor(land.length * 0.37)]];
    while (picked.length < 5) {
      let best: Cell | null = null, bestD = -1;
      for (const c of land) {
        if (picked.includes(c)) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, c.center.angleTo(p.center));
        if (d > bestD) { bestD = d; best = c; }
      }
      picked.push(best!);
    }

    const listEl = document.getElementById('city-list')!;
    listEl.innerHTML = '';
    picked.forEach((cell, i) => {
      const group = new THREE.Group();
      const n = cell.center.clone();
      group.position.copy(n.clone().multiplyScalar(1.002));
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);

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

      const row = document.createElement('div');
      row.className = 'city-row';
      row.innerHTML = `<span class="city-name">${CITY_NAMES[i]}</span><span class="city-bar"><i></i></span>`;
      listEl.appendChild(row);

      this.occupied.add(cell.id);
      this.cities.push({
        cellId: cell.id, hp: CITY_HP, alive: true, name: CITY_NAMES[i],
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
    if (this.phase === 'won' || this.phase === 'lost') return { ok: false, reason: '战斗已结束', cost };
    if (this.occupied.has(cellId)) return { ok: false, reason: '区块已占用', cost };
    if (cell.terrain === 'mountain' && def.kind === 'ground')
      return { ok: false, reason: '山地仅可部署防空/雷达', cost };
    if (this.energy < cost) return { ok: false, reason: '能源不足', cost };
    return { ok: true, cost };
  }

  tryBuild(cellId: number, defKey: string): boolean {
    const check = this.canBuild(cellId, defKey);
    if (!check.ok) return false;
    const def = TOWER_DEFS.find((d) => d.key === defKey)!;
    const cell = this.grid.cells[cellId];
    this.energy -= check.cost;

    const group = this.buildTowerVisual(def, cell);
    group.scale.setScalar(0.01);
    this.root.add(group);

    this.occupied.add(cellId);
    this.towers.push({
      def, level: 1, cellId, invested: check.cost,
      group, ring: (group.userData.ring as THREE.Mesh) ?? null,
      edges: group.userData.edges as THREE.LineSegments[],
      cooldown: 0, lockTarget: null, lockT: 0, beam: null, jammed: false,
    });
    this.updateHud();
    return true;
  }

  upgradeCost(t: Tower): number {
    return Math.round(t.def.cost * 0.8) * t.level;
  }

  tryUpgrade(cellId: number): boolean {
    const t = this.towerAt(cellId);
    if (!t || t.level >= MAX_LEVEL) return false;
    const cost = this.upgradeCost(t);
    if (this.energy < cost) return false;
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
    return t.def.range * (mountain ? MOUNTAIN_RANGE_MUL : 1) + (t.level - 1) * 0.025;
  }

  towerDamage(t: Tower): number {
    let dmg = t.def.damage * Math.pow(UPGRADE_DMG_MUL, t.level - 1);
    if (t.def.key === 'prism') {
      const adj = this.grid.cells[t.cellId].neighbors
        .filter((nb) => this.towers.some((o) => o.cellId === nb)).length;
      dmg *= 1 + 0.45 * adj;
    }
    return dmg;
  }

  // ============ 塔的立体造型 ============

  private buildTowerVisual(def: TowerDef, cell: Cell): THREE.Group {
    const group = new THREE.Group();
    const n = cell.center.clone();
    group.position.copy(n);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);

    const fill = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d3644') });
    const edgeM = new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.9 });
    const edges: THREE.LineSegments[] = [];
    const addPart = (geo: THREE.BufferGeometry, y: number, ry = 0) => {
      const mesh = new THREE.Mesh(geo, fill);
      mesh.position.y = y; mesh.rotation.y = ry;
      group.add(mesh);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeM);
      e.position.y = y; e.rotation.y = ry;
      group.add(e);
      edges.push(e);
      return mesh;
    };

    let ring: THREE.Mesh | null = null;
    const mkRing = (r: number, y: number) => {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.0022, 8, 24),
        new THREE.MeshBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.8 }));
      m.position.y = y; m.rotation.x = Math.PI / 2;
      group.add(m);
      return m;
    };

    switch (def.key) {
      case 'pulse':
        addPart(new THREE.ConeGeometry(0.02, 0.055, 6), 0.03);
        ring = mkRing(0.017, 0.068);
        break;
      case 'tesla':
        addPart(new THREE.CylinderGeometry(0.008, 0.014, 0.05, 6), 0.025);
        ring = mkRing(0.02, 0.055);
        mkRing(0.014, 0.04);
        break;
      case 'laser':
        addPart(new THREE.CylinderGeometry(0.005, 0.011, 0.08, 6), 0.04);
        addPart(new THREE.OctahedronGeometry(0.012), 0.09);
        ring = mkRing(0.013, 0.02);
        break;
      case 'missile':
        addPart(new THREE.BoxGeometry(0.03, 0.02, 0.03), 0.012);
        addPart(new THREE.CylinderGeometry(0.005, 0.005, 0.035, 6), 0.04, 0.3);
        addPart(new THREE.CylinderGeometry(0.005, 0.005, 0.035, 6), 0.035, -0.4);
        break;
      case 'radar':
        addPart(new THREE.CylinderGeometry(0.004, 0.008, 0.045, 6), 0.022);
        ring = mkRing(0.02, 0.055);
        addPart(new THREE.ConeGeometry(0.018, 0.01, 16, 1, true), 0.055);
        break;
      case 'prism': {
        const geo = new THREE.OctahedronGeometry(0.02);
        geo.scale(1, 2.2, 1);
        addPart(geo, 0.05);
        ring = mkRing(0.016, 0.012);
        break;
      }
    }
    group.userData.ring = ring;
    group.userData.edges = edges;
    return group;
  }

  // ============ 主更新 ============

  update(dt: number) {
    this.time += dt;
    if (this.phase === 'won' || this.phase === 'lost') { this.animateIdle(dt); this.updateFx(dt); return; }

    const aliveCities = this.cities.filter((c) => c.alive).length;
    this.energy += aliveCities * CITY_INCOME * dt;

    if (this.phase === 'prewave') {
      this.prewaveT -= dt;
      document.getElementById('cd-val')!.textContent = Math.ceil(this.prewaveT).toString();
      if (this.prewaveT <= 0) this.startWave();
    }

    this.updateOrbitals(dt);
    this.updateUnits(dt);
    this.updateTowers(dt);
    this.updateFx(dt);
    this.animateIdle(dt);
    this.updateHud();

    if (this.phase === 'active' && this.waveCleared()) {
      this.waveIdx++;
      if (this.waveIdx >= WAVES.length) {
        this.endGame(true);
      } else {
        this.phase = 'prewave';
        this.prewaveT = WAVES[this.waveIdx].prewave;
        this.setWaveLabel();
        this.showCountdown(true);
        this.banner(`WAVE ${this.waveIdx + 1}`, '敌方登陆舱接近中 // INBOUND', false, 2600);
        this.prepareLandings();
      }
    }
  }

  private waveCleared(): boolean {
    return this.orbitals.every((o) => !o.alive || o.phase === 'done')
      && this.orbitals.every((o) => o.kind === 'transport' || !o.alive)
      && this.units.every((u) => !u.alive);
  }

  // ============ 波次与登陆 ============

  private prepareLandings() {
    const cfg = WAVES[this.waveIdx];
    const dist = this.bfsFromCities();
    const candidates = this.grid.cells.filter((c) =>
      c.terrain !== 'ocean' && !this.occupied.has(c.id) &&
      dist[c.id] >= 2 && dist[c.id] <= 5);
    const pool = candidates.length ? candidates : this.grid.cells.filter((c) => c.terrain !== 'ocean');
    this.pendingLandCells = [];
    for (let i = 0; i < cfg.drops.length; i++) {
      const pick = pool[Math.floor(this.rand() * pool.length)];
      this.pendingLandCells.push(pick.id);
      this.markers.push(this.spawnLandingMarker(pick.id));
    }
  }

  private spawnLandingMarker(cellId: number): THREE.Group {
    const cell = this.grid.cells[cellId];
    const g = new THREE.Group();
    const n = cell.center.clone();
    g.position.copy(n.clone().multiplyScalar(1.006));
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

  private startWave() {
    this.phase = 'active';
    this.showCountdown(false);
    this.banner(`WAVE ${this.waveIdx + 1}`, '敌袭 // HOSTILE INBOUND', false, 2600);
    if (!this.pendingLandCells.length) this.prepareLandings();

    const cfg = WAVES[this.waveIdx];
    cfg.drops.forEach((drop, i) => {
      this.spawnTransport(this.pendingLandCells[i], drop, i * 2.2, this.markers[i] ?? null);
    });
    this.markers = [];
    this.pendingLandCells = [];

    for (let j = 0; j < (cfg.jammers ?? 0); j++) this.spawnJammer();
    if (cfg.boss) this.spawnBoss();
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

  private spawnTransport(landCell: number, cargo: { type: string; n: number }, delay: number, marker: THREE.Group | null, skipOrbit = false) {
    const n = this.grid.cells[landCell].center.clone();
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize()
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

    // 轨迹线
    const trailPts: THREE.Vector3[] = [];
    if (!skipOrbit) {
      for (let i = 0; i <= 96; i++) {
        const th = -3.1 + (i / 96) * 3.1;
        const r = this.orbitRadius(th);
        trailPts.push(n.clone().multiplyScalar(Math.cos(th))
          .addScaledVector(u, Math.sin(th)).multiplyScalar(r));
      }
    } else {
      trailPts.push(n.clone().multiplyScalar(1.25));
    }
    trailPts.push(n.clone().multiplyScalar(1.03));
    const trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(trailPts),
      new THREE.LineDashedMaterial({
        color: COL_ROSE, transparent: true, opacity: 0.45,
        dashSize: 0.03, gapSize: 0.022, depthWrite: false,
      }));
    trail.computeLineDistances();
    trail.renderOrder = 8;
    this.root.add(trail);
    o.trail = trail;

    if (skipOrbit) {
      o.phase = 'descend';
      o.group.position.copy(n.clone().multiplyScalar(1.25));
      if (!o.marker) { o.marker = this.spawnLandingMarker(landCell); }
    }

    this.orbitals.push(o);
  }

  private spawnJammer() {
    const o = this.baseOrbital('jammer', JAMMER_HP);
    o.orbitAxis = new THREE.Vector3().randomDirection();
    o.orbitAngle = this.rand() * Math.PI * 2;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.012, 8, 20),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.9 }));
    o.group.add(ring);
    this.root.add(o.group);
    this.orbitals.push(o);
    this.banner('干扰者入轨', 'JAMMER IN ORBIT // 地面塔将被压制', false, 3000);
  }

  private spawnBoss() {
    const o = this.baseOrbital('boss', BOSS_HP);
    o.orbitAxis = new THREE.Vector3(0.3, 1, 0.2).normalize();
    o.orbitAngle = this.rand() * Math.PI * 2;
    o.dropTimer = 4;

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
    this.banner('母舰逼近', 'MOTHERSHIP DETECTED', false, 3400);
  }

  private orbitRadius(theta: number): number {
    return 1.55 - Math.max(0, (theta + 1.2) / 1.2) * 0.35;
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
            o.deployTimer = 0.65;
            this.spawnUnit(o.landCell, o.cargo.type);
          }
          if (o.cargo.n === 0) this.finishTransport(o, false);
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
      this.finishTransport(o, true);
    } else {
      o.alive = false;
      this.energy += o.kind === 'boss' ? BOSS_REWARD : JAMMER_REWARD;
      this.spawnRing(o.pos.clone(), COL_CYAN, o.kind === 'boss' ? 0.14 : 0.08);
      this.root.remove(o.group);
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
    else geo = new THREE.TetrahedronGeometry(def.size);
    const mat = new THREE.MeshBasicMaterial({
      color: type === 'armored' ? new THREE.Color('#c22343') : COL_ROSE,
      wireframe: true, transparent: true, opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const pos = this.grid.cells[fromCell].center.clone().multiplyScalar(1.02);
    mesh.position.copy(pos);
    this.root.add(mesh);
    this.units.push({ type, def, mesh, path, seg: 0, t: 0, hp: def.hp, alive: true, pos: pos.clone(), slowUntilFrame: false });
  }

  private updateUnits(dt: number) {
    // 磁暴塔减速场
    const teslas = this.towers.filter((t) => t.def.key === 'tesla' && !t.jammed);
    for (const u of this.units) {
      if (!u.alive) continue;
      let speed = u.def.speed;
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
      u.pos.copy(from).lerp(to, u.t).normalize().multiplyScalar(1.02);
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
    if (reward) this.energy += u.def.reward;
  }

  private hitCity(cellId: number) {
    const city = this.cities.find((c) => c.cellId === cellId);
    if (!city || !city.alive) return;
    city.hp -= CITY_HIT_DAMAGE;
    city.row.classList.add('hurt');
    setTimeout(() => city.row.classList.remove('hurt'), 600);
    const flash = document.getElementById('dmg-flash')!;
    flash.style.opacity = '1';
    setTimeout(() => (flash.style.opacity = '0'), 120);

    if (city.hp <= 0) {
      city.hp = 0;
      city.alive = false;
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
      if (!this.cities.some((c) => c.alive)) this.endGame(false);
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

      const towerN = this.grid.cells[tw.cellId].center;

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

      const range = this.towerRange(tw);

      if (tw.def.key === 'laser') {
        this.updateLaserTower(tw, towerN, range, rateMul, dt);
        continue;
      }
      if (tw.def.key === 'tesla' || tw.def.key === 'radar') continue; // 光环塔不攻击

      tw.cooldown -= dt * rateMul;
      if (tw.cooldown > 0) continue;

      if (tw.def.key === 'missile') {
        // 对空爆发：优先运输舰
        let target: Orbital | null = null;
        for (const o of this.orbitals) {
          if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
          if (towerN.angleTo(o.pos.clone().normalize()) > range) continue;
          if (!target || o.kind !== 'transport') target = o;
          if (o.kind === 'transport') { target = o; break; }
        }
        if (!target) continue;
        tw.cooldown = tw.def.cooldown;
        const dmg = this.towerDamage(tw);
        // 弹幕视觉：粗线 + 爆发环
        this.fireLine(towerN.clone().multiplyScalar(1.07), target.pos.clone(), 0.3);
        this.spawnRing(target.pos.clone(), COL_CYAN, 0.05);
        // 范围溅射：邻近轨道目标
        for (const o of this.orbitals) {
          if (!o.alive || o.phase === 'done' || !o.group.visible) continue;
          if (o.pos.distanceTo(target.pos) < 0.28) this.damageOrbital(o, dmg);
        }
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
      this.fireLine(towerN.clone().multiplyScalar(1.06), target.pos.clone(), 0.16);
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
    const ramp = 1 + (tw.lockT / 3) * 1.5; // 1 → 2.5
    this.damageOrbital(target, this.towerDamage(tw) * ramp * rateMul * dt);

    // 持续光束
    if (!tw.beam) {
      tw.beam = new THREE.Line(new THREE.BufferGeometry(), this.laserMat.clone());
      tw.beam.renderOrder = 9;
      this.root.add(tw.beam);
    }
    tw.beam.geometry.dispose();
    tw.beam.geometry = new THREE.BufferGeometry().setFromPoints([
      towerN.clone().multiplyScalar(1.09), target.pos.clone()]);
    (tw.beam.material as THREE.LineBasicMaterial).opacity = 0.5 + (tw.lockT / 3) * 0.5;
  }

  private clearLock(tw: Tower) {
    tw.lockTarget = null;
    tw.lockT = 0;
    if (tw.beam) { this.root.remove(tw.beam); tw.beam.geometry.dispose(); tw.beam = null; }
  }

  private fireLine(from: THREE.Vector3, to: THREE.Vector3, ttl: number) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from, to]), this.laserMat.clone());
    line.renderOrder = 9;
    this.root.add(line);
    this.fx.push({ obj: line, ttl, max: ttl, kind: 'laser' });
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
      if (f.kind === 'laser') {
        ((f.obj as THREE.Line).material as THREE.LineBasicMaterial).opacity = k;
      } else {
        f.obj.scale.setScalar(1 + (1 - k) * 2.2);
        ((f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = k * 0.9;
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
      c.bar.style.transform = `scaleX(${c.hp / CITY_HP})`;
    }
    document.querySelectorAll<HTMLElement>('.tower-card').forEach((card) => {
      const def = TOWER_DEFS.find((d) => d.key === card.dataset.key)!;
      card.classList.toggle('poor', this.energy < def.cost);
    });
  }

  private setWaveLabel() {
    document.getElementById('wave-val')!.textContent = `${this.waveIdx + 1}/${WAVES.length}`;
  }

  private showCountdown(show: boolean) {
    document.getElementById('countdown')!.classList.toggle('show', show);
    if (show && this.waveIdx === 0 && !this.pendingLandCells.length) this.prepareLandings();
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
    const ov = document.getElementById('overlay')!;
    ov.classList.add('show', win ? 'win' : 'lose');
    ov.classList.remove(win ? 'lose' : 'win');
    document.getElementById('ov-title')!.textContent = win ? '防线守住了' : '防线崩溃';
    document.getElementById('ov-sub')!.textContent = win
      ? 'EARTH DEFENSE GRID HOLDS' : 'ORBITAL DEFENSE GRID LOST';
    document.getElementById('status-text')!.textContent = win ? 'SECURED' : 'OFFLINE';
  }

  private seed = 987654321;
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}
