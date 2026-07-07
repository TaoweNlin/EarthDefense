import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildGoldberg, type Cell } from './goldberg';
import { Game, TOWER_DEFS, type GameStats } from './game';
import { LEVELS, ENDLESS_LEVEL, loadProgress, saveProgress, getSession, setSession } from './levels';
import { sfx } from './sound';

// ---------- 关卡会话 ----------
const progress = loadProgress();
// 开发者后门：?unlock=all 解锁全部关卡（写入存档后建议去掉参数刷新）
if (new URLSearchParams(location.search).get('unlock') === 'all') {
  progress.unlocked = LEVELS.length;
  saveProgress(progress);
}
const session = getSession();
const isEndless = session.level === ENDLESS_LEVEL.id;
const levelId = isEndless ? ENDLESS_LEVEL.id
  : Math.min(Math.max(1, session.level), progress.unlocked, LEVELS.length);
const level = isEndless ? ENDLESS_LEVEL : LEVELS[levelId - 1];

// ---------- 常量 ----------
const COL_CYAN = new THREE.Color('#22d3ee');
const COL_AMBER = new THREE.Color('#fbbf24');
const COL_DEEP = new THREE.Color('#0a1628');
const R = 1; // 地球半径

// ---------- 基础场景 ----------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050810');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.55, 3.1);
camera.lookAt(0, 0, 0);

// 地球整体挂在一个 group 上，旋转 group 而不是相机
const earthGroup = new THREE.Group();
scene.add(earthGroup);

// ---------- 星空 ----------
{
  const N = 1600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(28 + Math.random() * 30);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.25 + Math.random() * 0.55;
    const tint = Math.random() < 0.18 ? COL_CYAN : new THREE.Color(1, 1, 1);
    col.set([tint.r * b, tint.g * b, tint.b * b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, sizeAttenuation: true, transparent: true });
  scene.add(new THREE.Points(g, m));
}

// ---------- 地球本体：深蓝半透明 + 菲涅尔边缘辉光 ----------
const earthMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: true,
  uniforms: {
    uColor: { value: COL_DEEP },
    uRim: { value: COL_CYAN },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uRim;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 4.5);
      vec3 col = uColor * 0.55 + uRim * fres * 0.9;
      float alpha = 0.92 + fres * 0.08;
      gl_FragColor = vec4(col, alpha);
    }
  `,
});
const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), earthMat);
earthMesh.renderOrder = 1;
earthGroup.add(earthMesh);

// ---------- 大气层薄壳（背面渲染的渐变辉光） ----------
{
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uRim: { value: COL_CYAN } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRim;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float glow = pow(max(dot(vNormal, vView), 0.0), 5.0);
        gl_FragColor = vec4(uRim, glow * 0.13);
      }
    `,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 64, 64), atmoMat);
  atmo.renderOrder = 8;
  earthGroup.add(atmo);
}

// ---------- Goldberg 网格（行星布局由关卡种子决定；无尽模式每次随机行星） ----------
const mapSeed = isEndless ? (Math.floor(Math.random() * 0x7fffffff) || 1) : level.seed;
const grid = buildGoldberg(8, mapSeed);

function lineSegments(points: THREE.Vector3[], radius: number, color: THREE.Color, opacity: number): THREE.LineSegments {
  const pos = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    const q = p.clone().normalize().multiplyScalar(radius);
    pos.set([q.x, q.y, q.z], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  return new THREE.LineSegments(g, m);
}

// 全球格网：极淡
const gridLines = lineSegments(grid.gridEdges, R * 1.002, COL_CYAN, 0.045);
gridLines.renderOrder = 3;
earthGroup.add(gridLines);

// 大陆轮廓：明亮
const coastLines = lineSegments(grid.coastEdges, R * 1.004, COL_CYAN, 0.95);
coastLines.renderOrder = 4;
earthGroup.add(coastLines);

// 陆地填充：淡青色半透明面，让大陆形状一眼可辨
{
  const pos: number[] = [];
  for (const c of grid.cells) {
    if (c.terrain !== 'land') continue;
    const center = c.center.clone().multiplyScalar(R * 1.0025);
    const poly = c.polygon.map((p) => p.clone().normalize().multiplyScalar(R * 1.0025));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      pos.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#134d63'), transparent: true, opacity: 0.55,
    depthWrite: false,
  });
  const landMesh = new THREE.Mesh(g, m);
  landMesh.renderOrder = 2;
  earthGroup.add(landMesh);
}

// 陆地点阵：格子中心 + 多边形顶点
{
  const pts: number[] = [];
  for (const c of grid.cells) {
    if (c.terrain !== 'land') continue;
    const push = (p: THREE.Vector3, r: number) => {
      const q = p.clone().normalize().multiplyScalar(r);
      pts.push(q.x, q.y, q.z);
    };
    push(c.center, R * 1.004);
    for (const v of c.polygon) push(v, R * 1.003);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const m = new THREE.PointsMaterial({
    color: COL_CYAN, size: 0.012, transparent: true, opacity: 0.65,
    sizeAttenuation: true, depthWrite: false,
  });
  const landDots = new THREE.Points(g, m);
  landDots.renderOrder = 5;
  earthGroup.add(landDots);
}

// 五边形格子（遗迹位）：琥珀色小标记
{
  const pts: number[] = [];
  for (const c of grid.cells) {
    if (!c.isPentagon) continue;
    const q = c.center.clone().multiplyScalar(R * 1.006);
    pts.push(q.x, q.y, q.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const m = new THREE.PointsMaterial({
    color: COL_AMBER, size: 0.028, transparent: true, opacity: 0.9,
    sizeAttenuation: true, depthWrite: false,
  });
  const pentaDots = new THREE.Points(g, m);
  pentaDots.renderOrder = 6;
  earthGroup.add(pentaDots);
}

// 山地：整块格子凸起成高原（顶面 + 侧壁 + 发光棱线）
export const MOUNTAIN_TOP = 1.018;
{
  const fillPos: number[] = [];
  const edgePos: number[] = [];
  const push = (arr: number[], ...vs: THREE.Vector3[]) => {
    for (const v of vs) arr.push(v.x, v.y, v.z);
  };
  for (const c of grid.cells) {
    if (c.terrain !== 'mountain') continue;
    const poly = c.polygon.map((p) => p.clone().normalize());
    const top = poly.map((p) => p.clone().multiplyScalar(R * MOUNTAIN_TOP));
    const bot = poly.map((p) => p.clone().multiplyScalar(R * 1.0));
    const ctr = c.center.clone().multiplyScalar(R * MOUNTAIN_TOP);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      // 顶面扇形
      push(fillPos, ctr, top[i], top[j]);
      // 侧壁（两个三角形）
      push(fillPos, bot[i], bot[j], top[j]);
      push(fillPos, bot[i], top[j], top[i]);
      // 棱线：顶面轮廓 + 竖直棱
      push(edgePos, top[i], top[j]);
      push(edgePos, bot[i], top[i]);
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fillPos), 3));
  fg.computeVertexNormals();
  const fillMesh = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: new THREE.Color('#123c4c') }));
  fillMesh.renderOrder = 2;
  earthGroup.add(fillMesh);

  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePos), 3));
  const edgeLines = new THREE.LineSegments(eg,
    new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.45, depthWrite: false }));
  edgeLines.renderOrder = 5;
  earthGroup.add(edgeLines);
}

// 轨道线原则：不放装饰性轨道环，轨道线只用于传达实际信息
// （运输舰航迹、干扰者/母舰的环绕轨道，未来的卫星武器轨道）

// ---------- 悬停高亮 ----------
const hoverGroup = new THREE.Group();
earthGroup.add(hoverGroup);

const hoverFillMat = new THREE.MeshBasicMaterial({
  color: COL_CYAN, transparent: true, opacity: 0.18,
  side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
});
const hoverLineMat = new THREE.LineBasicMaterial({
  color: COL_CYAN, transparent: true, opacity: 1.0, depthWrite: false,
});

let hoverFill: THREE.Mesh | null = null;
let hoverLine: THREE.LineLoop | null = null;
let hoveredCell: Cell | null = null;

function setHover(cell: Cell | null) {
  if (cell === hoveredCell) return;
  hoveredCell = cell;
  if (hoverFill) { hoverGroup.remove(hoverFill); hoverFill.geometry.dispose(); hoverFill = null; }
  if (hoverLine) { hoverGroup.remove(hoverLine); hoverLine.geometry.dispose(); hoverLine = null; }

  const hud = document.getElementById('hud-cell')!;
  if (!cell) { hud.classList.remove('show'); return; }

  const hr = R * (cell.terrain === 'mountain' ? MOUNTAIN_TOP + 0.005 : 1.006);
  const poly = cell.polygon.map((p) => p.clone().normalize().multiplyScalar(hr));
  // 扇形三角化填充
  const center = cell.center.clone().multiplyScalar(hr);
  const pos: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    pos.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  hoverFill = new THREE.Mesh(fg, hoverFillMat);
  hoverFill.renderOrder = 7;
  hoverGroup.add(hoverFill);

  const lg = new THREE.BufferGeometry().setFromPoints(poly);
  hoverLine = new THREE.LineLoop(lg, hoverLineMat);
  hoverLine.renderOrder = 7;
  hoverGroup.add(hoverLine);

  hud.classList.add('show');
  document.getElementById('cell-id')!.textContent =
    `#${String(cell.id).padStart(3, '0')}${cell.isPentagon ? ' ◆遗迹位' : ''}`;
  const tEl = document.getElementById('cell-terrain')!;
  const info = game.cellInfo(cell.id);
  tEl.textContent = info === 'city' ? '城市 CITY'
    : info === 'tower' ? '防御塔 TOWER'
    : cell.terrain === 'mountain' ? '山地 MTN·远程射程+25%'
    : cell.terrain === 'land' ? '陆地 LAND' : '海洋 OCEAN·平台+60⚡';
  tEl.className = cell.terrain !== 'ocean' ? 'v-land' : '';
}

// ---------- 交互：拖拽旋转（带惯性）、滚轮缩放、悬停拾取 ----------
// ---------- 游戏逻辑 ----------
const game = new Game(earthGroup, grid, level, onGameEnd);
// 调试钩子（控制台可手动推进/检查状态）
(window as any).__game = game;
(window as any).__grid = grid;

// 关卡名显示在副标题
document.getElementById('hud-sub')!.innerHTML = (isEndless
  ? `${level.name} ${level.sub}`
  : `第 ${level.id} 关 · ${level.name} ${level.sub}`)
  + ` <span class="ok" id="status-text">ONLINE</span>`;

// ---------- 结算 ----------
function onGameEnd(win: boolean, stats: GameStats) {
  if (isEndless) {
    // 无尽模式：只记录坚守波数
    const survived = Math.max(0, game.launched - 1);
    progress.endlessBest = Math.max(progress.endlessBest, survived);
    saveProgress(progress);
    const ovE = document.getElementById('overlay')!;
    ovE.classList.add('show', 'lose');
    ovE.classList.remove('win');
    document.getElementById('ov-title')!.textContent = '防线终结';
    document.getElementById('ov-sub')!.textContent = 'ENDLESS RUN OVER';
    document.getElementById('ov-stars')!.textContent = '';
    const emm = Math.floor(stats.duration / 60), ess = stats.duration % 60;
    document.getElementById('ov-stats')!.innerHTML = `
      <span>坚守波数</span><b>${survived}</b>
      <span>历史最佳</span><b>${progress.endlessBest}</b>
      <span>地面击杀</span><b>${stats.kills}</b>
      <span>在轨拦截</span><b>${stats.intercepted}</b>
      <span>坚守时长</span><b>${emm}:${String(ess).padStart(2, '0')}</b>`;
    (document.getElementById('ov-next') as HTMLButtonElement).style.display = 'none';
    return;
  }
  if (win) {
    progress.stars[level.id] = Math.max(progress.stars[level.id] ?? 0, stats.stars);
    progress.unlocked = Math.max(progress.unlocked, Math.min(level.id + 1, LEVELS.length));
    saveProgress(progress);
  }
  const ov = document.getElementById('overlay')!;
  ov.classList.add('show', win ? 'win' : 'lose');
  ov.classList.remove(win ? 'lose' : 'win');
  document.getElementById('ov-title')!.textContent = win
    ? (level.id === LEVELS.length ? '地球安全了' : '防线守住了') : '防线崩溃';
  document.getElementById('ov-sub')!.textContent = win
    ? (level.id === LEVELS.length ? 'CAMPAIGN COMPLETE // HUMANITY ENDURES' : 'EARTH DEFENSE GRID HOLDS')
    : 'ORBITAL DEFENSE GRID LOST';
  document.getElementById('ov-stars')!.textContent = win
    ? '★'.repeat(stats.stars) + '☆'.repeat(3 - stats.stars) : '';
  const mm = Math.floor(stats.duration / 60), ss = stats.duration % 60;
  document.getElementById('ov-stats')!.innerHTML = `
    <span>地面击杀</span><b>${stats.kills}</b>
    <span>在轨拦截</span><b>${stats.intercepted}</b>
    <span>敌军渗透</span><b>${stats.leaked}</b>
    <span>城市损失</span><b>${stats.citiesLost}</b>
    <span>作战时长</span><b>${mm}:${String(ss).padStart(2, '0')}</b>`;
  const nextBtn = document.getElementById('ov-next') as HTMLButtonElement;
  nextBtn.style.display = win && level.id < LEVELS.length ? '' : 'none';
}
document.getElementById('ov-retry')!.addEventListener('click', () => {
  sfx.play('click'); setSession(level.id, true); location.reload();
});
document.getElementById('ov-next')!.addEventListener('click', () => {
  sfx.play('click'); setSession(level.id + 1, true); location.reload();
});
document.getElementById('ov-menu')!.addEventListener('click', () => {
  sfx.play('click'); setSession(level.id, false); location.reload();
});

// ---------- 教学（第 1 关，仅一次） ----------
let tutorialStep = -1;
let tutorialTimer = 0;
const TUTORIAL_STEPS = [
  '拖拽旋转地球，滚轮缩放视角',
  '按 [1] 选中脉冲炮，点击大陆格子部署防线',
  '玫红虚线是敌舰来袭航线，红圈是登陆点——把炮塔架在登陆点通往城市的路上',
  '敌人会沿地面走向城市，塔会自动开火。[空格] 可随时暂停布防',
];

// ---------- 主菜单 ----------
{
  const menu = document.getElementById('menu')!;
  const gridEl = document.getElementById('level-grid')!;
  const flavorEl = document.getElementById('menu-flavor')!;

  function renderChapter(ch: number) {
    gridEl.innerHTML = '';
    for (const lv of LEVELS) {
      if (lv.chapter !== ch) continue;
      const locked = lv.id > progress.unlocked;
      const stars = progress.stars[lv.id] ?? 0;
      const card = document.createElement('div');
      card.className = 'lv-card' + (locked ? ' locked' : '');
      card.innerHTML = `
        <div class="lv-num">MISSION ${String(lv.id).padStart(2, '0')}${locked ? ' 🔒' : ''}</div>
        <div class="lv-name">${lv.name}</div>
        <div class="lv-stars">${stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : locked ? '' : '未通关'}</div>`;
      card.addEventListener('mouseenter', () => { if (!locked) flavorEl.textContent = lv.flavor; });
      card.addEventListener('click', () => {
        if (locked) { sfx.play('deny'); return; }
        sfx.play('click');
        setSession(lv.id, true);
        location.reload();
      });
      gridEl.appendChild(card);
    }
  }
  const tabs = document.querySelectorAll<HTMLElement>('.ch-tab');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    sfx.play('click');
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    renderChapter(Number(tab.dataset.ch));
  }));
  // 默认展示进度所在的章节
  const curCh = !isEndless && level.chapter === 2 ? 2 : (progress.unlocked > 8 ? 2 : 1);
  tabs.forEach((t) => t.classList.toggle('active', Number(t.dataset.ch) === curCh));
  renderChapter(curCh);
  document.getElementById('menu-start')!.addEventListener('click', () => {
    sfx.play('click');
    if (levelId === progress.unlocked && !session.autostart && !isEndless) {
      // 直接在当前已加载的行星上开战
      menu.classList.remove('show');
      startBattle();
    } else {
      setSession(progress.unlocked, true);
      location.reload();
    }
  });
  // 无尽模式入口
  document.getElementById('endless-best')!.textContent =
    progress.endlessBest > 0 ? `· 最佳 ${progress.endlessBest} 波` : '';
  document.getElementById('menu-endless')!.addEventListener('click', () => {
    sfx.play('click');
    if (isEndless && !session.autostart) {
      menu.classList.remove('show');
      startBattle();
    } else {
      setSession(ENDLESS_LEVEL.id, true);
      location.reload();
    }
  });
  if (session.autostart) {
    setSession(levelId, false); // 消费一次性自动开始标记
    startBattle();
  } else {
    menu.classList.add('show');
    flavorEl.textContent = level.flavor;
  }
}

function startBattle() {
  game.start();
  if (level.id === 1 && !progress.tutorialDone) {
    tutorialStep = 0;
    tutorialTimer = 0;
    showTutorial(TUTORIAL_STEPS[0]);
  }
}
function showTutorial(text: string | null) {
  const el = document.getElementById('tutorial')!;
  if (text) { el.textContent = text; el.classList.add('show'); }
  else el.classList.remove('show');
}
function updateTutorial(dt: number) {
  if (tutorialStep < 0) return;
  tutorialTimer += dt;
  let advance = false;
  if (tutorialStep === 0 && tutorialTimer > 5) advance = true;
  if (tutorialStep === 1 && game.towers.length > 0) advance = true;
  if (tutorialStep === 2 && (tutorialTimer > 9 || game.phase === 'active')) advance = true;
  if (tutorialStep === 3 && tutorialTimer > 8) advance = true;
  if (!advance) return;
  tutorialStep++;
  tutorialTimer = 0;
  if (tutorialStep >= TUTORIAL_STEPS.length) {
    tutorialStep = -1;
    showTutorial(null);
    progress.tutorialDone = true;
    saveProgress(progress);
  } else {
    showTutorial(TUTORIAL_STEPS[tutorialStep]);
  }
}

// ---------- 静音 ----------
{
  const btn = document.getElementById('mute-btn')!;
  const sync = () => {
    btn.textContent = sfx.muted ? '✕' : '♪';
    btn.classList.toggle('muted', sfx.muted);
  };
  btn.addEventListener('click', () => { sfx.toggleMute(); sync(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') { sfx.toggleMute(); sync(); }
  });
  sync();
}

// ---------- 建造模式（6 塔卡片） ----------
let selectedDef: string | null = null;
const buildHint = document.getElementById('build-hint')!;

// 生成建造卡
{
  const bar = document.getElementById('hud-build')!;
  TOWER_DEFS.forEach((def, i) => {
    const unlocked = level.towers.includes(def.key);
    const card = document.createElement('div');
    card.className = 'panel tower-card' + (unlocked ? '' : ' poor');
    card.dataset.key = def.key;
    card.dataset.locked = unlocked ? '' : '1';
    card.innerHTML = `
      <div class="tc-key">${unlocked ? i + 1 : '🔒'}</div>
      <div class="tc-icon">${def.icon}</div>
      <div class="tc-name">${def.name}</div>
      <div class="tc-sub">${unlocked ? def.sub : 'LOCKED'}</div>
      <div class="tc-cost">⚡ ${def.cost}</div>`;
    card.addEventListener('click', () => {
      if (!unlocked) { sfx.play('deny'); return; }
      sfx.play('click');
      selectDef(selectedDef === def.key ? null : def.key);
    });
    bar.appendChild(card);
  });
}

// 建造失败原因提示：短暂变红显示原因后恢复
let hintResetTimer: ReturnType<typeof setTimeout> | null = null;
function flashBuildHint(reason: string) {
  sfx.play('deny');
  buildHint.textContent = `⚠ ${reason}`;
  buildHint.style.color = '#f43f5e';
  buildHint.classList.add('show');
  if (hintResetTimer) clearTimeout(hintResetTimer);
  hintResetTimer = setTimeout(() => {
    buildHint.style.color = '';
    const def = TOWER_DEFS.find((d) => d.key === selectedDef);
    if (def) buildHint.textContent = `部署 ${def.name} // ${def.desc} · 右键取消`;
    else buildHint.classList.remove('show');
  }, 1400);
}

function selectDef(key: string | null) {
  selectedDef = key;
  document.querySelectorAll<HTMLElement>('.tower-card').forEach((c) =>
    c.classList.toggle('selected', c.dataset.key === key));
  const def = TOWER_DEFS.find((d) => d.key === key);
  if (def) buildHint.textContent = `部署 ${def.name} // ${def.desc} · 右键取消`;
  buildHint.classList.toggle('show', !!key);
  rangePreview.visible = false;
  if (key) selectTowerCell(null);
}

window.addEventListener('keydown', (e) => {
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(e.code);
  if (idx >= 0 && idx < TOWER_DEFS.length && level.towers.includes(TOWER_DEFS[idx].key)) {
    selectDef(selectedDef === TOWER_DEFS[idx].key ? null : TOWER_DEFS[idx].key);
  }
  if (e.code === 'Escape') { selectDef(null); selectTowerCell(null); }
  if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  if (e.code === 'KeyF') cycleSpeed();
});
window.addEventListener('contextmenu', (e) => { e.preventDefault(); selectDef(null); selectTowerCell(null); });

// ---------- 射程圈（建造预览 + 已选中塔） ----------
function makeRangeRing(color: string): THREE.LineLoop {
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
  ring.renderOrder = 8;
  ring.visible = false;
  earthGroup.add(ring);
  return ring;
}
const rangePreview = makeRangeRing('#22d3ee');
const selectedRing = makeRangeRing('#fbbf24');

function ringGeometry(n: THREE.Vector3, rangeRad: number): THREE.BufferGeometry {
  const ref = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(n, ref).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const pts: THREE.Vector3[] = [];
  const cr = Math.cos(rangeRad), sr = Math.sin(rangeRad);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(n.clone().multiplyScalar(cr)
      .addScaledVector(e1, sr * Math.cos(a))
      .addScaledVector(e2, sr * Math.sin(a))
      .multiplyScalar(1.008));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function updateRangePreview(cell: Cell | null) {
  const def = TOWER_DEFS.find((d) => d.key === selectedDef);
  if (!def || !cell) { rangePreview.visible = false; return; }
  const range = def.range * (cell.terrain === 'mountain' ? 1.25 : 1);
  rangePreview.geometry.dispose();
  rangePreview.geometry = ringGeometry(cell.center, range);
  (rangePreview.material as THREE.LineBasicMaterial).color.set(
    game.canBuild(cell.id, def.key).ok ? '#22d3ee' : '#f43f5e');
  rangePreview.visible = true;
}

// ---------- 塔选中面板 ----------
let selectedTowerCell: number | null = null;
const twPanel = document.getElementById('hud-tower')!;

function selectTowerCell(cellId: number | null) {
  selectedTowerCell = cellId;
  const tower = cellId !== null ? game.towerAt(cellId) : null;
  twPanel.classList.toggle('show', !!tower);
  selectedRing.visible = false;
  if (!tower) return;
  refreshTowerPanel();
  selectedRing.geometry.dispose();
  selectedRing.geometry = ringGeometry(grid.cells[tower.cellId].center, game.towerRange(tower));
  selectedRing.visible = tower.def.kind !== 'air' ? true : true;
}

function refreshTowerPanel() {
  const tower = selectedTowerCell !== null ? game.towerAt(selectedTowerCell) : null;
  if (!tower) { twPanel.classList.remove('show'); return; }
  document.getElementById('tw-name')!.textContent =
    `${tower.def.name} ${tower.def.sub} · LV.${tower.level}`;
  const dmg = Math.round(game.towerDamage(tower));
  const range = game.towerRange(tower).toFixed(2);
  const perkLine = tower.perk ? `<br><span style="color:var(--amber)">◆ ${tower.perk.name}</span>` : '';
  const hpColor = tower.hp < tower.maxHp * 0.4 ? 'var(--rose)' : 'var(--cyan)';
  const hpLine = `<br>结构 <b style="color:${hpColor}">${Math.ceil(tower.hp)}/${tower.maxHp}</b>`;
  document.getElementById('tw-stats')!.innerHTML =
    (tower.def.damage > 0
      ? `伤害 <b>${dmg}</b> · 射程 <b>${range}</b><br>${tower.def.desc}`
      : `射程 <b>${range}</b><br>${tower.def.desc}`) + hpLine + perkLine;
  const upBtn = document.getElementById('tw-upgrade') as HTMLButtonElement;
  const maxed = tower.level >= 3;
  upBtn.disabled = maxed || game.energy < game.upgradeCost(tower);
  document.getElementById('tw-upcost')!.textContent = maxed ? 'MAX' : String(game.upgradeCost(tower));
  document.getElementById('tw-sellval')!.textContent = String(Math.round(tower.invested * 0.6));
}

document.getElementById('tw-upgrade')!.addEventListener('click', () => {
  if (selectedTowerCell !== null && game.tryUpgrade(selectedTowerCell)) selectTowerCell(selectedTowerCell);
});
document.getElementById('tw-sell')!.addEventListener('click', () => {
  if (selectedTowerCell !== null) { game.sell(selectedTowerCell); selectTowerCell(null); }
});

// ---------- 暂停 ----------
let paused = false;
function setPaused(on: boolean) {
  paused = on;
  document.getElementById('paused')!.classList.toggle('show', on);
}

// ---------- 倍速（1×/2×/4×，按子步执行保证数值一致） ----------
let timeScale = 1;
function cycleSpeed() {
  timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 4 : 1;
  const btn = document.getElementById('speed-btn')!;
  btn.textContent = `${timeScale}×`;
  btn.classList.toggle('boost', timeScale > 1);
  sfx.play('click');
}
document.getElementById('speed-btn')!.addEventListener('click', cycleSpeed);

// ---------- 迷你地球仪 ----------
const mm = (() => {
  const container = document.getElementById('mm-canvas')!;
  const mmRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  mmRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mmRenderer.setSize(168, 168);
  container.appendChild(mmRenderer.domElement);

  const mmScene = new THREE.Scene();
  const mmCam = new THREE.PerspectiveCamera(42, 1, 0.1, 10);
  const mmRoot = new THREE.Group();
  mmScene.add(mmRoot);

  // 线框球 + 海岸线
  mmRoot.add(new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: COL_CYAN, wireframe: true, transparent: true, opacity: 0.08 })));
  {
    const pos = new Float32Array(grid.coastEdges.length * 3);
    grid.coastEdges.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mmRoot.add(new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: COL_CYAN, transparent: true, opacity: 0.5 })));
  }

  // 动态点集工厂
  function dynPoints(color: string, size: number, cap: number) {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(cap * 3);
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.setDrawRange(0, 0);
    const p = new THREE.Points(g, new THREE.PointsMaterial({
      color, size, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false }));
    mmRoot.add(p);
    return { arr, geo: g };
  }
  const cityDots = dynPoints('#fbbf24', 5, 8);
  const towerDots = dynPoints('#22d3ee', 3.5, 128);
  const threatDots = dynPoints('#f43f5e', 4.5, 256);
  const threatPool = Array.from({ length: 256 }, () => new THREE.Vector3());

  function update() {
    mmRoot.quaternion.copy(earthGroup.quaternion);
    mmCam.position.copy(camera.position).normalize().multiplyScalar(2.75);
    mmCam.lookAt(0, 0, 0);

    let n = 0;
    for (const c of game.cities) {
      if (!c.alive) continue;
      const p = grid.cells[c.cellId].center;
      cityDots.arr.set([p.x, p.y, p.z], n * 3); n++;
    }
    cityDots.geo.setDrawRange(0, n);
    cityDots.geo.attributes.position.needsUpdate = true;

    n = 0;
    for (const t of game.towers) {
      if (n >= 128) break;
      const p = grid.cells[t.cellId].center;
      towerDots.arr.set([p.x, p.y, p.z], n * 3); n++;
    }
    towerDots.geo.setDrawRange(0, n);
    towerDots.geo.attributes.position.needsUpdate = true;

    const cnt = game.threatPoints(threatPool);
    for (let i = 0; i < cnt; i++) {
      threatDots.arr.set([threatPool[i].x, threatPool[i].y, threatPool[i].z], i * 3);
    }
    threatDots.geo.setDrawRange(0, cnt);
    threatDots.geo.attributes.position.needsUpdate = true;

    mmRenderer.render(mmScene, mmCam);
  }
  return { update };
})();

// 相机绕地球做轨道运动：拖拽改变经纬角，星空/轨道环随之产生视差
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = false;
let lastX = 0, lastY = 0;
let velYaw = 0, velPitch = 0; // 惯性角速度
let camYaw = 0;
let camPitch = 0.18;
const PITCH_LIMIT = 1.45;
let camDist = 3.15;
let camDistTarget = 3.15;

let downX = 0, downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  downX = e.clientX; downY = e.clientY;
  velYaw = 0; velPitch = 0;
});
window.addEventListener('pointerup', (e) => {
  dragging = false;
  // 位移极小视为点击
  if (e.button === 0 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    const cell = pickCell();
    if (!cell) return;
    if (selectedDef) {
      const check = game.canBuild(cell.id, selectedDef);
      if (check.ok) game.tryBuild(cell.id, selectedDef);
      else flashBuildHint(check.reason ?? '无法建造');
    } else if (game.towerAt(cell.id)) {
      selectTowerCell(cell.id);
    } else {
      selectTowerCell(null);
    }
  }
});
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  const k = 0.0052 * (camDist / 3.15);
  orbitCamera(-dx * k, dy * k);
  velYaw = -dx * k; velPitch = dy * k;
});
// 视角模式：orbit = 环绕俯瞰；horizon = 贴地仰视（拉近到底后继续滚轮进入）
let viewMode: 'orbit' | 'horizon' = 'orbit';
const horizonDir = new THREE.Vector3(0, 0, 1); // 地表立足点方向
let hYaw = 0;
let hPitch = 0.5; // 仰角

renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (viewMode === 'horizon') {
    // 地表视角里滚轮缩小 = 返回轨道视角
    if (Math.sign(e.deltaY) > 0) {
      viewMode = 'orbit';
      camDistTarget = 2.2;
      camera.up.set(0, 1, 0);
    }
    return;
  }
  const zoomIn = Math.sign(e.deltaY) < 0;
  if (zoomIn && camDistTarget <= 1.72) {
    // 已在最近距离仍继续放大 → 切入地表仰视
    viewMode = 'horizon';
    horizonDir.copy(camera.position).normalize();
    hYaw = 0;
    hPitch = 0.22; // 默认贴着地平线，能同时看到地表与天幕
    return;
  }
  camDistTarget = THREE.MathUtils.clamp(camDistTarget * (1 + Math.sign(e.deltaY) * 0.12), 1.7, 7.5);
}, { passive: false });

function orbitCamera(dYaw: number, dPitch: number) {
  if (viewMode === 'horizon') {
    hYaw += dYaw * 1.6;
    hPitch = THREE.MathUtils.clamp(hPitch - dPitch * 1.6, 0.05, 1.5);
    return;
  }
  camYaw += dYaw;
  camPitch = THREE.MathUtils.clamp(camPitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
}

const _hE1 = new THREE.Vector3();
const _hE2 = new THREE.Vector3();
const _hLook = new THREE.Vector3();

function updateCamera() {
  if (viewMode === 'horizon') {
    // 贴地仰视：站在地表，看地平线与压过头顶的虫群
    const n = horizonDir;
    const ref = Math.abs(n.y) < 0.95 ? camera.up.set(0, 1, 0) : camera.up.set(1, 0, 0);
    _hE1.crossVectors(n, ref).normalize();
    _hE2.crossVectors(n, _hE1).normalize();
    camera.position.copy(n).multiplyScalar(1.045);
    _hLook.copy(_hE1).multiplyScalar(Math.cos(hYaw) * Math.cos(hPitch))
      .addScaledVector(_hE2, Math.sin(hYaw) * Math.cos(hPitch))
      .addScaledVector(n, Math.sin(hPitch));
    camera.up.copy(n);
    camera.lookAt(_hLook.add(camera.position));
    return;
  }
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  camera.position.set(
    Math.sin(camYaw) * cp * camDist,
    sp * camDist,
    Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(0, 0, 0);
}

function pickCell(): Cell | null {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(earthMesh, false);
  if (!hit.length) return null;
  // 转到地球本地坐标，找最近格子中心
  const local = earthGroup.worldToLocal(hit[0].point.clone()).normalize();
  let best: Cell | null = null;
  let bestDot = -2;
  for (const c of grid.cells) {
    const d = c.center.dot(local);
    if (d > bestDot) { bestDot = d; best = c; }
  }
  return best;
}

// ---------- 后期：Bloom ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 0.12);
composer.addPass(bloom);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 主循环 ----------
let panelRefreshT = 0;
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 惯性衰减
  if (!dragging && (Math.abs(velYaw) > 1e-5 || Math.abs(velPitch) > 1e-5)) {
    orbitCamera(velYaw, velPitch);
    const decay = Math.exp(-dt * 3.2);
    velYaw *= decay; velPitch *= decay;
  }
  // 地球始终缓慢自转（不影响相机视角）
  earthGroup.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dt * 0.015);

  // 缩放缓动 + 相机位置更新
  camDist += (camDistTarget - camDist) * Math.min(1, dt * 6);
  updateCamera();

  // 网格呼吸
  (gridLines.material as THREE.LineBasicMaterial).opacity = 0.04 + 0.015 * Math.sin(t * 0.9);

  // 悬停高亮脉冲
  if (hoverLine) hoverLineMat.opacity = 0.75 + 0.25 * Math.sin(t * 5);

  const hovered = dragging ? null : pickCell();
  setHover(hovered);
  updateRangePreview(hovered);

  // 倍速 = 多次子步更新，数值行为与 1× 完全一致
  if (!paused) {
    for (let s = 0; s < timeScale; s++) game.update(dt);
  } else {
    game.update(0);
  }
  game.renderInstances(); // 实例缓冲每帧只写一次（与子步数无关）
  mm.update();
  updateTutorial(dt);

  // 塔面板低频刷新（能源变化影响升级按钮可用性）
  panelRefreshT -= dt;
  if (panelRefreshT <= 0) { panelRefreshT = 0.25; refreshTowerPanel(); }

  composer.render();
}
tick();
