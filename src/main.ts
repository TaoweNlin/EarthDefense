import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildGoldberg, type Cell } from './goldberg';

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

// ---------- Goldberg 网格 ----------
const grid = buildGoldberg(8, 20260705);

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

// ---------- 轨道环 ----------
const orbitGroup = new THREE.Group();
scene.add(orbitGroup);
const orbitRings: THREE.Line[] = [];
{
  const configs = [
    { r: 1.45, tilt: 0.42, color: COL_CYAN, opacity: 0.28 },
    { r: 1.62, tilt: -0.65, color: COL_CYAN, opacity: 0.2 },
    { r: 1.8, tilt: 1.1, color: COL_AMBER, opacity: 0.16 },
  ];
  for (const cfg of configs) {
    const pts: THREE.Vector3[] = [];
    const N = 256;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * cfg.r, 0, Math.sin(a) * cfg.r));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineDashedMaterial({
      color: cfg.color, transparent: true, opacity: cfg.opacity,
      dashSize: 0.045, gapSize: 0.03, depthWrite: false,
    });
    const line = new THREE.Line(g, m);
    line.computeLineDistances();
    line.rotation.x = cfg.tilt;
    orbitGroup.add(line);
    orbitRings.push(line);
  }
}

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

  const poly = cell.polygon.map((p) => p.clone().normalize().multiplyScalar(R * 1.006));
  // 扇形三角化填充
  const center = cell.center.clone().multiplyScalar(R * 1.006);
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
  tEl.textContent = cell.terrain === 'land' ? '陆地 LAND' : '海洋 OCEAN';
  tEl.className = cell.terrain === 'land' ? 'v-land' : '';
}

// ---------- 交互：拖拽旋转（带惯性）、滚轮缩放、悬停拾取 ----------
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

renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  velYaw = 0; velPitch = 0;
});
window.addEventListener('pointerup', () => (dragging = false));
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
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDistTarget = THREE.MathUtils.clamp(camDistTarget * (1 + Math.sign(e.deltaY) * 0.12), 1.7, 4.6);
}, { passive: false });

function orbitCamera(dYaw: number, dPitch: number) {
  camYaw += dYaw;
  camPitch = THREE.MathUtils.clamp(camPitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
}

function updateCamera() {
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

  // 轨道环缓慢转动 + 呼吸
  orbitRings.forEach((ring, i) => {
    ring.rotation.z += dt * (0.05 + i * 0.03) * (i % 2 ? -1 : 1);
    const m = ring.material as THREE.LineDashedMaterial;
    m.opacity = (0.16 + i * 0.05) * (0.8 + 0.2 * Math.sin(t * 1.3 + i * 2.1));
  });

  // 网格呼吸
  (gridLines.material as THREE.LineBasicMaterial).opacity = 0.04 + 0.015 * Math.sin(t * 0.9);

  // 悬停高亮脉冲
  if (hoverLine) hoverLineMat.opacity = 0.75 + 0.25 * Math.sin(t * 5);

  setHover(dragging ? null : pickCell());

  composer.render();
}
tick();
