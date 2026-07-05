// 战役关卡配置。
// 设计原则：
// 1. 每关有明确目标（objective）与城市布局场景（cityLayout），不是纯随机撒点；
// 2. 敌人从固定的"进攻走廊"（lanes）登陆——开局即可见，玩家可针对性布防；
// 3. 波次是连续进攻：prewave = 距上一波【发起】的间隔，前一波未清完下一波就会压上来。

export interface WaveCfg {
  prewave: number;  // 距上一波发起的秒数（首波 = 开局布防时间）
  drops: { type: 'swarm' | 'runner' | 'armored' | 'splitter'; n: number }[];
  jammers?: number;
  divers?: number;    // 俯冲艇：不登陆，直接俯冲撞击城市
  gunships?: number;  // 炮舰：悬停在城市上空持续轰炸，只能防空打
  wings?: number;     // 飞行蜂群：成编队低空推进，防空割草靶
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
  endless?: boolean;      // 无尽模式：波次程序生成，难度递增
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
    seed: 20260705, cities: 2, cityLayout: 'cluster', cityCluster: 1.0,
    landingSpread: 0.85, lanes: 1, startEnergy: 280, towers: T1,
    waves: [
      { prewave: 20, drops: [{ type: 'swarm', n: 10 }] },
      { prewave: 26, drops: [{ type: 'swarm', n: 14 }] },
      { prewave: 28, drops: [{ type: 'swarm', n: 12 }, { type: 'swarm', n: 12 }] },
    ],
  },
  {
    id: 2, name: '疾风', sub: 'SWIFT RAID',
    flavor: '两条走廊轮番突击，高速单位直扑城市。', objective: '拦截高速突击 · 双走廊',
    seed: 31415926, cities: 2, cityLayout: 'cluster', cityCluster: 0.95,
    landingSpread: 1.0, lanes: 2, startEnergy: 300, towers: T2,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 12 }] },
      { prewave: 24, drops: [{ type: 'runner', n: 10 }] },
      { prewave: 24, drops: [{ type: 'swarm', n: 12 }, { type: 'runner', n: 8 }] },
      { prewave: 26, drops: [{ type: 'runner', n: 12 }, { type: 'swarm', n: 14 }] },
    ],
  },
  {
    id: 3, name: '天穹', sub: 'SKYWARD',
    flavor: '城市链沿赤道分布，敌舰自南北两极方向压入。', objective: '守卫赤道城市链 · 防空火力上线',
    seed: 27182818, cities: 3, cityLayout: 'equator', cityCluster: 0.85,
    landingSpread: 1.4, lanes: 2, startEnergy: 320, towers: T3,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 12 }] },
      { prewave: 24, drops: [{ type: 'swarm', n: 14 }, { type: 'runner', n: 8 }], wings: 8 },
      { prewave: 24, drops: [{ type: 'armored', n: 5 }, { type: 'swarm', n: 12 }], divers: 1, wings: 10 },
      { prewave: 26, drops: [{ type: 'armored', n: 7 }, { type: 'runner', n: 10 }, { type: 'swarm', n: 14 }], divers: 2, wings: 12 },
    ],
  },
  {
    id: 4, name: '静噪', sub: 'SILENT JAM',
    flavor: '干扰者将瘫痪其轨道下方的地面炮塔。', objective: '击落干扰者 · 保持火力网在线',
    seed: 16180339, cities: 3, cityLayout: 'cluster', cityCluster: 0.75,
    landingSpread: 1.6, lanes: 2, startEnergy: 320, towers: T4,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 14 }] },
      { prewave: 24, drops: [{ type: 'runner', n: 12 }], jammers: 1, wings: 8 },
      { prewave: 24, drops: [{ type: 'armored', n: 7 }, { type: 'swarm', n: 14 }] },
      { prewave: 24, drops: [{ type: 'swarm', n: 16 }, { type: 'runner', n: 10 }], jammers: 1, wings: 12 },
      { prewave: 26, drops: [{ type: 'armored', n: 9 }, { type: 'swarm', n: 14 }, { type: 'runner', n: 8 }], wings: 10 },
    ],
  },
  {
    id: 5, name: '中枢', sub: 'THE CORE',
    flavor: '整个星球只剩最后一座都会。敌军从四面八方合围。', objective: '孤城死守 · 敌军四面合围',
    seed: 14142135, cities: 1, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.1, lanes: 4, startEnergy: 340, towers: T5,
    waves: [
      { prewave: 18, drops: [{ type: 'armored', n: 7 }] },
      { prewave: 26, drops: [{ type: 'armored', n: 7 }, { type: 'swarm', n: 14 }], divers: 1 },
      { prewave: 26, drops: [{ type: 'armored', n: 9 }, { type: 'runner', n: 10 }], gunships: 1, wings: 10 },
      { prewave: 28, drops: [{ type: 'armored', n: 9 }, { type: 'armored', n: 7 }, { type: 'swarm', n: 16 }], divers: 2 },
      { prewave: 28, drops: [{ type: 'armored', n: 11 }, { type: 'runner', n: 12 }, { type: 'swarm', n: 18 }], gunships: 1, divers: 2, wings: 14 },
    ],
  },
  {
    id: 6, name: '流星雨', sub: 'METEOR FALL',
    flavor: '大量小型登陆舱多点着陆，裂变体死后仍会分裂扑城。', objective: '抵御疯狂登陆 · 四走廊多线',
    seed: 17320508, cities: 2, cityLayout: 'global', cityCluster: 0.4,
    landingSpread: 2.6, lanes: 4, startEnergy: 340, towers: T5,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 10 }, { type: 'swarm', n: 10 }] },
      { prewave: 22, drops: [{ type: 'splitter', n: 7 }, { type: 'swarm', n: 10 }] },
      { prewave: 22, drops: [{ type: 'runner', n: 10 }, { type: 'splitter', n: 7 }, { type: 'swarm', n: 10 }] },
      { prewave: 24, drops: [{ type: 'splitter', n: 9 }, { type: 'armored', n: 7 }, { type: 'swarm', n: 12 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'splitter', n: 7 }, { type: 'runner', n: 12 }, { type: 'swarm', n: 12 }, { type: 'swarm', n: 10 }], divers: 2, wings: 10 },
      { prewave: 26, drops: [{ type: 'splitter', n: 11 }, { type: 'armored', n: 9 }, { type: 'swarm', n: 14 }, { type: 'runner', n: 10 }], divers: 2, wings: 14 },
    ],
  },
  {
    id: 7, name: '寂静轨道', sub: 'DEAD ORBIT',
    flavor: '敌军空中力量全面展开：炮舰压顶、俯冲艇突袭。防御卫星已解锁。', objective: '夺回天空 · 立体防御',
    seed: 22360679, cities: 2, cityLayout: 'global', cityCluster: 0.2,
    landingSpread: 3.0, lanes: 3, startEnergy: 380, towers: T7,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 14 }], jammers: 1, wings: 10 },
      { prewave: 24, drops: [{ type: 'runner', n: 12 }], jammers: 1, divers: 2, wings: 12 },
      { prewave: 24, drops: [{ type: 'swarm', n: 18 }], jammers: 2, gunships: 1, wings: 14 },
      { prewave: 26, drops: [{ type: 'armored', n: 11 }], divers: 3, gunships: 1, wings: 14 },
      { prewave: 26, drops: [{ type: 'swarm', n: 18 }, { type: 'runner', n: 12 }], jammers: 2, divers: 2, gunships: 1, wings: 16 },
      { prewave: 28, drops: [{ type: 'armored', n: 13 }, { type: 'swarm', n: 18 }], divers: 3, gunships: 2, wings: 18 },
    ],
  },
  {
    id: 8, name: '母舰降临', sub: 'MOTHERSHIP',
    flavor: '决战。中枢与卫星城背靠背，母舰在高轨持续投放登陆舱。', objective: '守住双子都会 · 击落母舰',
    seed: 26457513, cities: 2, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.6, lanes: 5, startEnergy: 400, towers: T7,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 16 }, { type: 'runner', n: 10 }] },
      { prewave: 24, drops: [{ type: 'armored', n: 9 }, { type: 'splitter', n: 7 }], jammers: 1, divers: 1, wings: 10 },
      { prewave: 24, drops: [{ type: 'runner', n: 14 }, { type: 'swarm', n: 16 }], divers: 2, gunships: 1, wings: 12 },
      { prewave: 26, drops: [{ type: 'armored', n: 11 }, { type: 'splitter', n: 9 }], jammers: 2 },
      { prewave: 26, drops: [{ type: 'runner', n: 14 }, { type: 'swarm', n: 18 }], divers: 3, gunships: 1, wings: 16 },
      { prewave: 28, drops: [{ type: 'armored', n: 13 }, { type: 'splitter', n: 9 }, { type: 'swarm', n: 18 }], jammers: 1, gunships: 1, wings: 14 },
      { prewave: 30, drops: [{ type: 'armored', n: 11 }, { type: 'swarm', n: 18 }], divers: 3, wings: 18, boss: true },
    ],
  },
];

// ============ 无尽模式 ============

export const ENDLESS_LEVEL: LevelCfg = {
  id: 99, name: '无尽防线', sub: 'ENDLESS',
  flavor: '敌军的进攻永不停歇。坚守到最后一刻。',
  objective: '无尽防线 · 波次难度递增',
  seed: 88888888, cities: 2, cityLayout: 'cluster', cityCluster: 1.0,
  landingSpread: 1.5, lanes: 3, startEnergy: 360, towers: T7,
  waves: [], // 程序生成
  endless: true,
};

// ============ 进度与会话 ============

export interface Progress {
  unlocked: number;
  stars: Record<number, number>;
  tutorialDone: boolean;
  endlessBest: number;
}

const PROG_KEY = 'earthdef-progress';
const SESSION_KEY = 'earthdef-session';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (raw) return { unlocked: 1, stars: {}, tutorialDone: false, endlessBest: 0, ...JSON.parse(raw) };
  } catch { /* 损坏则重置 */ }
  return { unlocked: 1, stars: {}, tutorialDone: false, endlessBest: 0 };
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
