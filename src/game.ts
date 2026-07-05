// M1 核心循环：波次 → 轨道运输舰 → 登陆 → 地面单位沿格子进军 → 攻城。
// 所有战场实体挂在 earthGroup 下（本地坐标 = 单位球面），随地球一起自转。

import * as THREE from 'three';
import type { GoldbergGrid, Cell } from './goldberg';

const COL_CYAN = new THREE.Color('#22d3ee');
const COL_ROSE = new THREE.Color('#f43f5e');
const COL_AMBER = new THREE.Color('#fbbf24');

// ---------- 数值 ----------
const START_ENERGY = 260;
const TOWER_COST = 100;
const TOWER_RANGE = 0.36;        // 球面角距离（弧度）
const TOWER_DAMAGE = 26;
const TOWER_COOLDOWN = 0.85;
const CITY_HP = 100;
const CITY_INCOME = 1.6;         // 每城每秒
const CITY_HIT_DAMAGE = 15;
const UNIT_HP = 55;
const UNIT_SPEED = 0.085;        // 弧度/秒
const KILL_REWARD = 16;
const PREWAVE_TIME = [16, 11, 11];
const WAVES = [
  { transports: 1, unitsPer: 5 },
  { transports: 2, unitsPer: 5 },
  { transports: 3, unitsPer: 6 },
];
const CITY_NAMES = ['NOVA-1', 'KIRIN-2', 'AURUM-3', 'TERRA-4', 'ZENIT-5'];

type Phase = 'prewave' | 'active' | 'won' | 'lost';

interface City {
  cellId: number; hp: number; alive: boolean; name: string;
  group: THREE.Group; core: THREE.Mesh; row: HTMLElement; bar: HTMLElement;
}
interface Tower {
  cellId: number; group: THREE.Group; ring: THREE.Mesh; cooldown: number;
}
interface Unit {
  mesh: THREE.Mesh; path: number[]; seg: number; t: number;
  hp: number; alive: boolean; pos: THREE.Vector3;
}
interface Transport {
  group: THREE.Group; landCell: number;
  phase: 'orbit' | 'descend' | 'deploy' | 'done';
  theta: number; basisN: THREE.Vector3; basisU: THREE.Vector3;
  descendT: number; unitsLeft: number; deployTimer: number;
  marker: THREE.Group;
}
interface Fx { obj: THREE.Object3D; ttl: number; max: number; kind: 'laser' | 'ring' }

export class Game {
  phase: Phase = 'prewave';
  energy = START_ENERGY;
  waveIdx = 0;
  private prewaveT = PREWAVE_TIME[0];
  private time = 0;

  private cities: City[] = [];
  private towers: Tower[] = [];
  private units: Unit[] = [];
  private transports: Transport[] = [];
  private fx: Fx[] = [];
  private occupied = new Set<number>();   // 城市 + 塔
  private root = new THREE.Group();

  // 共享几何/材质
  private unitGeo = new THREE.TetrahedronGeometry(0.022);
  private unitMat = new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.95 });
  private laserMat = new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(private earthGroup: THREE.Group, private grid: GoldbergGrid) {
    earthGroup.add(this.root);
    this.spawnCities();
    this.updateHud();
    this.setWaveLabel();
    this.showCountdown(true);
  }

  // ============ 初始化 ============

  private spawnCities() {
    const land = this.grid.cells.filter((c) => c.terrain === 'land' && !c.isPentagon);
    // 贪心最远点采样，城市彼此拉开
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
    picked.forEach((cell, i) => {
      const group = new THREE.Group();
      const n = cell.center.clone();
      group.position.copy(n.clone().multiplyScalar(1.005));
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);

      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.03),
        new THREE.MeshBasicMaterial({ color: COL_AMBER, wireframe: true, transparent: true, opacity: 0.95 }));
      core.position.y = 0.035;
      group.add(core);
      const base = new THREE.Mesh(
        new THREE.RingGeometry(0.032, 0.04, 32),
        new THREE.MeshBasicMaterial({ color: COL_AMBER, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
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
        group, core, row, bar: row.querySelector('i')!,
      });
    });
  }

  // ============ 对外接口 ============

  cellInfo(cellId: number): 'city' | 'tower' | null {
    if (this.cities.some((c) => c.cellId === cellId && c.alive)) return 'city';
    if (this.towers.some((t) => t.cellId === cellId)) return 'tower';
    return null;
  }

  canBuild(cellId: number): { ok: boolean; reason?: string } {
    const cell = this.grid.cells[cellId];
    if (this.phase === 'won' || this.phase === 'lost') return { ok: false, reason: '战斗已结束' };
    if (cell.terrain !== 'land') return { ok: false, reason: '海洋不可建造' };
    if (this.occupied.has(cellId)) return { ok: false, reason: '区块已占用' };
    if (this.energy < TOWER_COST) return { ok: false, reason: '能源不足' };
    return { ok: true };
  }

  tryBuild(cellId: number): boolean {
    if (!this.canBuild(cellId).ok) return false;
    this.energy -= TOWER_COST;

    const cell = this.grid.cells[cellId];
    const n = cell.center.clone();
    const group = new THREE.Group();
    group.position.copy(n.clone().multiplyScalar(1.0));
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.055, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d4a5c') }));
    cone.position.y = 0.03;
    group.add(cone);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cone.geometry),
      new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.9 }));
    edges.position.y = 0.03;
    group.add(edges);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.017, 0.0022, 8, 24),
      new THREE.MeshBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.8 }));
    ring.position.y = 0.068;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // 出生动画：从 0 缩放弹出
    group.scale.setScalar(0.01);
    this.root.add(group);
    this.occupied.add(cellId);
    this.towers.push({ cellId, group, ring, cooldown: 0 });
    this.updateHud();
    return true;
  }

  togglePause(): boolean {
    // 由 main 控制 timeScale，这里只是提供状态判定用
    return this.phase === 'prewave' || this.phase === 'active';
  }

  // ============ 主更新 ============

  update(dt: number) {
    this.time += dt;
    if (this.phase === 'won' || this.phase === 'lost') { this.animateIdle(dt); return; }

    // 经济
    const aliveCities = this.cities.filter((c) => c.alive).length;
    this.energy += aliveCities * CITY_INCOME * dt;

    if (this.phase === 'prewave') {
      this.prewaveT -= dt;
      document.getElementById('cd-val')!.textContent = Math.ceil(this.prewaveT).toString();
      if (this.prewaveT <= 0) this.startWave();
    }

    this.updateTransports(dt);
    this.updateUnits(dt);
    this.updateTowers(dt);
    this.updateFx(dt);
    this.animateIdle(dt);
    this.updateHud();

    // 波次结束判定
    if (this.phase === 'active'
      && this.transports.every((t) => t.phase === 'done')
      && this.units.every((u) => !u.alive)) {
      this.waveIdx++;
      if (this.waveIdx >= WAVES.length) {
        this.endGame(true);
      } else {
        this.phase = 'prewave';
        this.prewaveT = PREWAVE_TIME[this.waveIdx];
        this.setWaveLabel();
        this.showCountdown(true);
        this.banner(`WAVE ${this.waveIdx + 1}`, '敌方登陆舱接近中 // INBOUND', false, 2600);
        this.prepareLandings();
      }
    }
  }

  // ============ 波次 ============

  private pendingLandCells: number[] = [];

  private prepareLandings() {
    // 登陆点：距离任一存活城市 2~5 格的陆地格
    const cfg = WAVES[this.waveIdx];
    const dist = this.bfsFromCities();
    const candidates = this.grid.cells.filter((c) =>
      c.terrain === 'land' && !this.occupied.has(c.id) &&
      dist[c.id] >= 2 && dist[c.id] <= 5);
    const pool = candidates.length ? candidates : this.grid.cells.filter((c) => c.terrain === 'land');
    this.pendingLandCells = [];
    for (let i = 0; i < cfg.transports; i++) {
      const pick = pool[Math.floor(this.rand() * pool.length)];
      this.pendingLandCells.push(pick.id);
      this.spawnLandingMarker(pick.id);
    }
  }

  private markers: THREE.Group[] = [];

  private spawnLandingMarker(cellId: number) {
    const cell = this.grid.cells[cellId];
    const g = new THREE.Group();
    const n = cell.center.clone();
    g.position.copy(n.clone().multiplyScalar(1.006));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.045, 0.055, 40),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 7;
    g.add(ring);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.02, 24),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    inner.rotation.x = -Math.PI / 2;
    inner.renderOrder = 7;
    g.add(inner);
    this.root.add(g);
    this.markers.push(g);
  }

  private startWave() {
    this.phase = 'active';
    this.showCountdown(false);
    this.banner(`WAVE ${this.waveIdx + 1}`, '敌袭 // HOSTILE INBOUND', false, 2600);
    if (!this.pendingLandCells.length) this.prepareLandings();

    const cfg = WAVES[this.waveIdx];
    this.pendingLandCells.forEach((cellId, i) => {
      this.spawnTransport(cellId, cfg.unitsPer, i * 2.2);
    });
    this.pendingLandCells = [];
  }

  private spawnTransport(landCell: number, units: number, delay: number) {
    const n = this.grid.cells[landCell].center.clone();
    // 轨道平面：过登陆点上方的大圆
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize()
      .applyAxisAngle(n, this.rand() * Math.PI * 2);

    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.045),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, wireframe: true, transparent: true, opacity: 0.9 }));
    group.add(body);
    const glow = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.02),
      new THREE.MeshBasicMaterial({ color: COL_ROSE, transparent: true, opacity: 0.75 }));
    group.add(glow);
    group.visible = false;
    this.root.add(group);

    this.transports.push({
      group, landCell, phase: 'orbit',
      theta: -3.1 - delay * 0.35, basisN: n, basisU: u,
      descendT: 0, unitsLeft: units, deployTimer: 0,
      marker: this.markers[0], // 关联最早的 marker（近似即可）
    });
  }

  private updateTransports(dt: number) {
    for (const tr of this.transports) {
      if (tr.phase === 'done') continue;
      if (tr.phase === 'orbit') {
        tr.theta += dt * 0.55;
        if (tr.theta < -3.05) continue; // 延迟出场
        tr.group.visible = true;
        const r = 1.55 - Math.max(0, (tr.theta + 1.2) / 1.2) * 0.35; // 逐渐降轨
        const pos = tr.basisN.clone().multiplyScalar(Math.cos(tr.theta))
          .addScaledVector(tr.basisU, Math.sin(tr.theta)).multiplyScalar(r);
        tr.group.position.copy(pos);
        tr.group.rotation.y += dt * 2;
        if (tr.theta >= 0) { tr.phase = 'descend'; tr.descendT = 0; }
      } else if (tr.phase === 'descend') {
        tr.descendT += dt / 2.0;
        const k = Math.min(1, tr.descendT);
        const ease = 1 - Math.pow(1 - k, 3);
        const h = 1.2 - ease * 0.17; // 1.2 → 1.03
        tr.group.position.copy(tr.basisN.clone().multiplyScalar(h));
        tr.group.rotation.y += dt * 3;
        if (k >= 1) { tr.phase = 'deploy'; tr.deployTimer = 0.3; }
      } else if (tr.phase === 'deploy') {
        tr.deployTimer -= dt;
        tr.group.rotation.y += dt * 1.2;
        if (tr.deployTimer <= 0 && tr.unitsLeft > 0) {
          tr.unitsLeft--;
          tr.deployTimer = 0.65;
          this.spawnUnit(tr.landCell);
        }
        if (tr.unitsLeft === 0) {
          tr.phase = 'done';
          this.spawnRing(tr.group.position.clone(), COL_ROSE, 0.06);
          this.root.remove(tr.group);
          // 移除一个登陆标记
          const m = this.markers.shift();
          if (m) this.root.remove(m);
        }
      }
    }
  }

  // ============ 地面单位 ============

  private spawnUnit(fromCell: number) {
    const path = this.findPath(fromCell);
    if (!path || path.length < 2) return;
    const mesh = new THREE.Mesh(this.unitGeo, this.unitMat.clone());
    const pos = this.grid.cells[fromCell].center.clone().multiplyScalar(1.02);
    mesh.position.copy(pos);
    this.root.add(mesh);
    this.units.push({ mesh, path, seg: 0, t: 0, hp: UNIT_HP, alive: true, pos: pos.clone() });
  }

  private updateUnits(dt: number) {
    for (const u of this.units) {
      if (!u.alive) continue;
      const from = this.grid.cells[u.path[u.seg]].center;
      const to = this.grid.cells[u.path[u.seg + 1]].center;
      const segAngle = from.angleTo(to);
      u.t += (UNIT_SPEED * dt) / Math.max(segAngle, 1e-4);
      if (u.t >= 1) {
        u.seg++;
        u.t = 0;
        if (u.seg >= u.path.length - 1) {
          // 抵达城市
          this.hitCity(u.path[u.path.length - 1]);
          this.killUnit(u, false);
          continue;
        }
        // 目标城市可能已毁，重寻路
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
    this.units = this.units.filter((u) => u.alive || u.mesh.parent);
  }

  private killUnit(u: Unit, reward: boolean) {
    u.alive = false;
    this.root.remove(u.mesh);
    this.spawnRing(u.pos.clone(), reward ? COL_CYAN : COL_ROSE, 0.045);
    if (reward) this.energy += KILL_REWARD;
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
      (city.core.material as THREE.MeshBasicMaterial).color.set('#57343c');
      this.spawnRing(city.group.position.clone(), COL_ROSE, 0.09);
      if (!this.cities.some((c) => c.alive)) this.endGame(false);
    }
  }

  // ============ 塔 ============

  private updateTowers(dt: number) {
    for (const tw of this.towers) {
      // 出生弹出
      if (tw.group.scale.x < 1) {
        tw.group.scale.setScalar(Math.min(1, tw.group.scale.x + dt * 4));
      }
      tw.ring.rotation.z += dt * 1.6;
      tw.cooldown -= dt;
      if (tw.cooldown > 0) continue;

      const origin = this.grid.cells[tw.cellId].center;
      let target: Unit | null = null;
      let bestProgress = -1;
      for (const u of this.units) {
        if (!u.alive) continue;
        if (origin.angleTo(u.pos) > TOWER_RANGE) continue;
        const progress = u.seg + u.t;
        if (progress > bestProgress) { bestProgress = progress; target = u; }
      }
      if (!target) continue;

      tw.cooldown = TOWER_COOLDOWN;
      target.hp -= TOWER_DAMAGE;
      // 激光
      const from = origin.clone().multiplyScalar(1.06);
      const geo = new THREE.BufferGeometry().setFromPoints([from, target.pos.clone()]);
      const line = new THREE.Line(geo, this.laserMat.clone());
      line.renderOrder = 9;
      this.root.add(line);
      this.fx.push({ obj: line, ttl: 0.16, max: 0.16, kind: 'laser' });

      if (target.hp <= 0) this.killUnit(target, true);
    }
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
    // 城市呼吸 + 登陆标记脉冲
    for (const c of this.cities) {
      if (!c.alive) continue;
      c.core.rotation.y += dt * 0.8;
      const s = 1 + 0.12 * Math.sin(this.time * 2.2);
      c.core.scale.setScalar(s);
    }
    this.markers.forEach((m, i) => {
      const k = 0.5 + 0.5 * Math.sin(this.time * 4 + i);
      m.children.forEach((ch) => {
        ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + k * 0.55;
      });
      m.scale.setScalar(1 + 0.15 * k);
    });
  }

  // ============ 寻路 ============

  /** BFS：从 fromCell 到最近存活城市的最短路（只走陆地；海洋成本高，仍可通过以防孤岛） */
  private findPath(fromCell: number): number[] | null {
    const targets = new Set(this.cities.filter((c) => c.alive).map((c) => c.cellId));
    if (!targets.size) return null;
    const prev = new Map<number, number>();
    const visited = new Set<number>([fromCell]);
    let frontier = [fromCell];
    let found = -1;
    while (frontier.length && found < 0) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const nb of this.grid.cells[id].neighbors) {
          if (visited.has(nb)) continue;
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

  // ============ HUD ============

  private updateHud() {
    document.getElementById('energy-val')!.textContent = Math.floor(this.energy).toString();
    for (const c of this.cities) {
      c.bar.style.transform = `scaleX(${c.hp / CITY_HP})`;
    }
    // 能源不足时建造卡变灰
    const card = document.getElementById('card-pulse')!;
    card.classList.toggle('poor', this.energy < TOWER_COST);
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

  // 确定性伪随机（避免每次热更新地图变化太大，也便于复盘）
  private seed = 987654321;
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}

export const TOWER_RANGE_RAD = TOWER_RANGE;
