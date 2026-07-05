// 战役关卡配置：难度曲线 = 防区从一块大陆逐步扩展到全球。
// cityCluster 1 → 城市紧凑在一个区域；0 → 全球铺开。
// landingSpread = 登陆点允许偏离城市群中心的最大球面角（弧度），控制"转球压力"。

export interface WaveCfg {
  prewave: number;
  drops: { type: 'swarm' | 'runner' | 'armored'; n: number }[];
  jammers?: number;
  boss?: boolean;
}

export interface LevelCfg {
  id: number;
  name: string;
  sub: string;
  flavor: string;
  seed: number;
  cities: number;
  cityCluster: number;    // 0..1
  landingSpread: number;  // 弧度，π = 全球
  startEnergy: number;
  towers: string[];       // 已解锁塔 key
  waves: WaveCfg[];
}

const T = {
  basic: ['pulse'],
  l2: ['pulse', 'tesla'],
  l3: ['pulse', 'tesla', 'laser', 'radar'],
  l4: ['pulse', 'tesla', 'laser', 'radar', 'missile'],
  all: ['pulse', 'tesla', 'laser', 'radar', 'missile', 'prism'],
};

export const LEVELS: LevelCfg[] = [
  {
    id: 1, name: '初阵', sub: 'FIRST CONTACT',
    flavor: '敌军试探性登陆。守住这块大陆。',
    seed: 20260705, cities: 3, cityCluster: 1.0, landingSpread: 0.85,
    startEnergy: 280, towers: T.basic,
    waves: [
      { prewave: 20, drops: [{ type: 'swarm', n: 4 }] },
      { prewave: 14, drops: [{ type: 'swarm', n: 6 }] },
      { prewave: 14, drops: [{ type: 'swarm', n: 5 }, { type: 'swarm', n: 5 }] },
    ],
  },
  {
    id: 2, name: '疾风', sub: 'SWIFT RAID',
    flavor: '侦测到高速突击单位。磁暴塔已解锁。',
    seed: 31415926, cities: 3, cityCluster: 0.95, landingSpread: 1.0,
    startEnergy: 300, towers: T.l2,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 5 }] },
      { prewave: 12, drops: [{ type: 'runner', n: 4 }] },
      { prewave: 12, drops: [{ type: 'swarm', n: 5 }, { type: 'runner', n: 4 }] },
      { prewave: 13, drops: [{ type: 'runner', n: 6 }, { type: 'swarm', n: 6 }] },
    ],
  },
  {
    id: 3, name: '天穹', sub: 'SKYWARD',
    flavor: '轨道武器上线——在敌舰落地前击沉它们。',
    seed: 27182818, cities: 4, cityCluster: 0.85, landingSpread: 1.25,
    startEnergy: 320, towers: T.l3,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 5 }] },
      { prewave: 12, drops: [{ type: 'swarm', n: 6 }, { type: 'runner', n: 4 }] },
      { prewave: 13, drops: [{ type: 'armored', n: 2 }, { type: 'swarm', n: 5 }] },
      { prewave: 14, drops: [{ type: 'armored', n: 3 }, { type: 'runner', n: 5 }, { type: 'swarm', n: 6 }] },
    ],
  },
  {
    id: 4, name: '静噪', sub: 'SILENT JAM',
    flavor: '干扰者会瘫痪其轨道下方的地面塔。优先击落。',
    seed: 16180339, cities: 4, cityCluster: 0.75, landingSpread: 1.6,
    startEnergy: 320, towers: T.l4,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 6 }] },
      { prewave: 12, drops: [{ type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 13, drops: [{ type: 'armored', n: 3 }, { type: 'swarm', n: 6 }] },
      { prewave: 13, drops: [{ type: 'swarm', n: 7 }, { type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 14, drops: [{ type: 'armored', n: 4 }, { type: 'swarm', n: 6 }, { type: 'runner', n: 4 }] },
    ],
  },
  {
    id: 5, name: '铁流', sub: 'IRON TIDE',
    flavor: '重装部队集群推进。汇聚棱镜已解锁——塔阵的时代。',
    seed: 14142135, cities: 4, cityCluster: 0.6, landingSpread: 2.0,
    startEnergy: 340, towers: T.all,
    waves: [
      { prewave: 18, drops: [{ type: 'armored', n: 3 }] },
      { prewave: 12, drops: [{ type: 'armored', n: 3 }, { type: 'swarm', n: 6 }] },
      { prewave: 13, drops: [{ type: 'armored', n: 4 }, { type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 13, drops: [{ type: 'armored', n: 4 }, { type: 'armored', n: 3 }, { type: 'swarm', n: 7 }] },
      { prewave: 14, drops: [{ type: 'armored', n: 5 }, { type: 'runner', n: 6 }, { type: 'swarm', n: 8 }] },
    ],
  },
  {
    id: 6, name: '流星雨', sub: 'METEOR FALL',
    flavor: '多方向同时登陆。你的防线不再有正面。',
    seed: 17320508, cities: 5, cityCluster: 0.4, landingSpread: 2.6,
    startEnergy: 340, towers: T.all,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 6 }, { type: 'runner', n: 4 }] },
      { prewave: 12, drops: [{ type: 'swarm', n: 6 }, { type: 'armored', n: 3 }] },
      { prewave: 13, drops: [{ type: 'runner', n: 5 }, { type: 'runner', n: 5 }, { type: 'swarm', n: 6 }] },
      { prewave: 13, drops: [{ type: 'armored', n: 4 }, { type: 'swarm', n: 7 }], jammers: 1 },
      { prewave: 13, drops: [{ type: 'armored', n: 4 }, { type: 'runner', n: 6 }, { type: 'swarm', n: 7 }] },
      { prewave: 14, drops: [{ type: 'armored', n: 5 }, { type: 'armored', n: 4 }, { type: 'swarm', n: 8 }, { type: 'runner', n: 5 }] },
    ],
  },
  {
    id: 7, name: '寂静轨道', sub: 'DEAD ORBIT',
    flavor: '敌方干扰网全面展开。天空必须是你的。',
    seed: 22360679, cities: 5, cityCluster: 0.2, landingSpread: 3.0,
    startEnergy: 360, towers: T.all,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 6 }], jammers: 1 },
      { prewave: 12, drops: [{ type: 'armored', n: 4 }, { type: 'runner', n: 5 }], jammers: 1 },
      { prewave: 13, drops: [{ type: 'swarm', n: 8 }, { type: 'swarm', n: 6 }], jammers: 2 },
      { prewave: 13, drops: [{ type: 'armored', n: 5 }, { type: 'runner', n: 6 }] },
      { prewave: 13, drops: [{ type: 'armored', n: 4 }, { type: 'swarm', n: 8 }, { type: 'runner', n: 6 }], jammers: 2 },
      { prewave: 14, drops: [{ type: 'armored', n: 6 }, { type: 'armored', n: 4 }, { type: 'swarm', n: 8 }] },
    ],
  },
  {
    id: 8, name: '母舰降临', sub: 'MOTHERSHIP',
    flavor: '决战。全球多线防御，击落母舰。',
    seed: 26457513, cities: 5, cityCluster: 0.0, landingSpread: Math.PI,
    startEnergy: 380, towers: T.all,
    waves: [
      { prewave: 18, drops: [{ type: 'swarm', n: 7 }, { type: 'runner', n: 4 }] },
      { prewave: 12, drops: [{ type: 'armored', n: 4 }, { type: 'swarm', n: 6 }], jammers: 1 },
      { prewave: 13, drops: [{ type: 'runner', n: 6 }, { type: 'runner', n: 5 }, { type: 'swarm', n: 7 }] },
      { prewave: 13, drops: [{ type: 'armored', n: 5 }, { type: 'swarm', n: 8 }], jammers: 2 },
      { prewave: 13, drops: [{ type: 'armored', n: 5 }, { type: 'runner', n: 6 }, { type: 'swarm', n: 8 }] },
      { prewave: 14, drops: [{ type: 'armored', n: 6 }, { type: 'swarm', n: 9 }], jammers: 1 },
      { prewave: 16, drops: [{ type: 'armored', n: 5 }, { type: 'swarm', n: 8 }], boss: true },
    ],
  },
];

// ============ 进度与会话 ============

export interface Progress {
  unlocked: number;              // 已解锁到第几关
  stars: Record<number, number>; // 关卡 → 星数
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
