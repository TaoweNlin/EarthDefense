// 战役关卡配置。
// 设计原则：
// 1. 每关有明确目标（objective）与城市布局场景（cityLayout），不是纯随机撒点；
// 2. 敌人从固定的"进攻走廊"（lanes）登陆——开局即可见，玩家可针对性布防；
// 3. 波次是连续进攻：prewave = 距上一波【发起】的间隔，前一波未清完下一波就会压上来。

export interface WaveCfg {
  prewave: number;  // 距上一波发起的秒数（首波 = 开局布防时间）
  drops: { type: 'swarm' | 'runner' | 'armored' | 'splitter' | 'burrower'; n: number }[];
  jammers?: number;
  boss?: boolean;
}

export type CityLayout = 'cluster' | 'equator' | 'capital' | 'global';

export interface LevelCfg {
  id: number;
  name: string;
  sub: string;
  flavor: string;
  objective: string;      // 战役目标，开局横幅 + 菜单展示
  seed: number;
  cities: number;
  cityLayout: CityLayout;
  cityCluster: number;    // cluster/global 布局的聚集度 0..1
  landingSpread: number;  // 登陆走廊允许偏离防区中心的最大球面角
  lanes: number;          // 固定进攻走廊数量
  startEnergy: number;
  towers: string[];
  waves: WaveCfg[];
}

const T1 = ['pulse'];
const T2 = ['pulse', 'tesla'];
const T3 = ['pulse', 'tesla', 'laser', 'radar'];
const T4 = ['pulse', 'tesla', 'laser', 'radar', 'missile'];
const T5 = ['pulse', 'tesla', 'laser', 'radar', 'missile', 'prism'];
const T7 = ['pulse', 'tesla', 'laser', 'radar', 'missile', 'prism', 'satellite'];

export const LEVELS: LevelCfg[] = [
  {
    id: 1, name: '初阵', sub: 'FIRST CONTACT',
    flavor: '敌军从单一走廊试探性登陆。', objective: '守住殖民地 · 单走廊防御',
    seed: 20260705, cities: 3, cityLayout: 'cluster', cityCluster: 1.0,
    landingSpread: 0.85, lanes: 1, startEnergy: 280, towers: T1,
    waves: [
      { prewave: 20, drops: [{ type: 'swarm', n: 4 }] },
      { prewave: 26, drops: [{ type: 'swarm', n: 6 }] },
      { prewave: 28, drops: [{ type: 'swarm', n: 5 }, { type: 'swarm', n: 5 }] },
    ],
  },
  {
    id: 2, name: '疾风', sub: 'SWIFT RAID',
    flavor: '两条走廊轮番突击，高速单位直扑城市。', objective: '拦截高速突击 · 双走廊',
    seed: 31415926, cities: 3, cityLayout: 'cluster', cityCluster: 0.95,
    landingSpread: 1.0, lanes: 2, startEnergy: 300, towers: T2,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 5 }] },
      { prewave: 24, drops: [{ type: 'runner', n: 4 }] },
      { prewave: 24, drops: [{ type: 'swarm', n: 5 }, { type: 'runner', n: 4 }] },
      { prewave: 26, drops: [{ type: 'runner', n: 6 }, { type: 'swarm', n: 6 }] },
    ],
  },
  {
    id: 3, name: '天穹', sub: 'SKYWARD',
    flavor: '城市链沿赤道分布，敌舰自南北两极方向压入。', objective: '守卫赤道城市链 · 防空火力上线',
    seed: 27182818, cities: 4, cityLayout: 'equator', cityCluster: 0.85,
    landingSpread: 1.4, lanes: 2, startEnergy: 320, towers: T3,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 5 }] },
      { prewave: 24, drops: [{ type: 'swarm', n: 6 }, { type: 'runner', n: 4 }] },
      { prewave: 24, drops: [{ type: 'armored', n: 2 }, { type: 'swarm', n: 5 }] },
      { prewave: 26, drops: [{ type: 'armored', n: 3 }, { type: 'runner', n: 5 }, { type: 'swarm', n: 6 }] },
    ],
  },
  {
    id: 4, name: '静噪', sub: 'SILENT JAM',
    flavor: '干扰者将瘫痪其轨道下方的地面炮塔。', objective: '击落干扰者 · 保持火力网在线',
    seed: 16180339, cities: 4, cityLayout: 'cluster', cityCluster: 0.75,
    landingSpread: 1.6, lanes: 2, startEnergy: 320, towers: T4,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 6 }] },
      { prewave: 24, drops: [{ type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'armored', n: 3 }, { type: 'swarm', n: 6 }] },
      { prewave: 24, drops: [{ type: 'swarm', n: 7 }, { type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 26, drops: [{ type: 'armored', n: 4 }, { type: 'swarm', n: 6 }, { type: 'runner', n: 4 }] },
    ],
  },
  {
    id: 5, name: '中枢', sub: 'THE CORE',
    flavor: '中央都会是文明的心脏——它陷落即战败。重装集群正在逼近。', objective: '首都绝不能陷落 · 重装冲击',
    seed: 14142135, cities: 4, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.8, lanes: 3, startEnergy: 340, towers: T5,
    waves: [
      { prewave: 18, drops: [{ type: 'armored', n: 3 }] },
      { prewave: 26, drops: [{ type: 'armored', n: 3 }, { type: 'swarm', n: 6 }] },
      { prewave: 26, drops: [{ type: 'armored', n: 4 }, { type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 28, drops: [{ type: 'armored', n: 4 }, { type: 'armored', n: 3 }, { type: 'swarm', n: 7 }] },
      { prewave: 28, drops: [{ type: 'armored', n: 5 }, { type: 'runner', n: 6 }, { type: 'swarm', n: 8 }] },
    ],
  },
  {
    id: 6, name: '流星雨', sub: 'METEOR FALL',
    flavor: '大量小型登陆舱多点着陆，裂变体死后仍会分裂扑城。', objective: '抵御疯狂登陆 · 四走廊多线',
    seed: 17320508, cities: 5, cityLayout: 'global', cityCluster: 0.4,
    landingSpread: 2.6, lanes: 4, startEnergy: 340, towers: T5,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 4 }, { type: 'swarm', n: 4 }] },
      { prewave: 22, drops: [{ type: 'splitter', n: 3 }, { type: 'swarm', n: 4 }] },
      { prewave: 22, drops: [{ type: 'runner', n: 4 }, { type: 'splitter', n: 3 }, { type: 'swarm', n: 4 }] },
      { prewave: 24, drops: [{ type: 'splitter', n: 4 }, { type: 'armored', n: 3 }, { type: 'swarm', n: 5 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'splitter', n: 3 }, { type: 'runner', n: 5 }, { type: 'swarm', n: 5 }, { type: 'swarm', n: 4 }] },
      { prewave: 26, drops: [{ type: 'splitter', n: 5 }, { type: 'armored', n: 4 }, { type: 'swarm', n: 6 }, { type: 'runner', n: 4 }] },
    ],
  },
  {
    id: 7, name: '寂静轨道', sub: 'DEAD ORBIT',
    flavor: '敌方干扰网全面展开，掘地者会潜入地下规避炮火。防御卫星已解锁。', objective: '夺回天空 · 卫星火力网',
    seed: 22360679, cities: 5, cityLayout: 'global', cityCluster: 0.2,
    landingSpread: 3.0, lanes: 3, startEnergy: 380, towers: T7,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 6 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'burrower', n: 3 }, { type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'swarm', n: 8 }, { type: 'burrower', n: 3 }], jammers: 2 },
      { prewave: 26, drops: [{ type: 'armored', n: 5 }, { type: 'burrower', n: 4 }] },
      { prewave: 26, drops: [{ type: 'burrower', n: 4 }, { type: 'swarm', n: 8 }, { type: 'runner', n: 6 }], jammers: 2 },
      { prewave: 28, drops: [{ type: 'armored', n: 6 }, { type: 'burrower', n: 4 }, { type: 'swarm', n: 8 }] },
    ],
  },
  {
    id: 8, name: '母舰降临', sub: 'MOTHERSHIP',
    flavor: '决战。五条走廊全面进攻，母舰在高轨持续投放登陆舱。', objective: '击落母舰 · 终结战争',
    seed: 26457513, cities: 5, cityLayout: 'global', cityCluster: 0.0,
    landingSpread: Math.PI, lanes: 5, startEnergy: 400, towers: T7,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 7 }, { type: 'runner', n: 4 }] },
      { prewave: 24, drops: [{ type: 'armored', n: 4 }, { type: 'splitter', n: 3 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'runner', n: 6 }, { type: 'burrower', n: 3 }, { type: 'swarm', n: 7 }] },
      { prewave: 26, drops: [{ type: 'armored', n: 5 }, { type: 'splitter', n: 4 }], jammers: 2 },
      { prewave: 26, drops: [{ type: 'burrower', n: 4 }, { type: 'runner', n: 6 }, { type: 'swarm', n: 8 }] },
      { prewave: 28, drops: [{ type: 'armored', n: 6 }, { type: 'splitter', n: 4 }, { type: 'swarm', n: 8 }], jammers: 1 },
      { prewave: 30, drops: [{ type: 'armored', n: 5 }, { type: 'burrower', n: 4 }, { type: 'swarm', n: 8 }], boss: true },
    ],
  },
];

// ============ 进度与会话 ============

export interface Progress {
  unlocked: number;
  stars: Record<number, number>;
  tutorialDone: boolean;
}

const PROG_KEY = 'earthdef-progress';
const SESSION_KEY = 'earthdef-session';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (raw) return { unlocked: 1, stars: {}, tutorialDone: false, ...JSON.parse(raw) };
  } catch { /* 损坏则重置 */ }
  return { unlocked: 1, stars: {}, tutorialDone: false };
}

export function saveProgress(p: Progress) {
  localStorage.setItem(PROG_KEY, JSON.stringify(p));
}

export function getSession(): { level: number; autostart: boolean } {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { level: 1, autostart: false };
}

export function setSession(level: number, autostart: boolean) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ level, autostart }));
}
