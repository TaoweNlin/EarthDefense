// 战役关卡配置。
// 设计原则：
// 1. 每关有明确目标（objective）与城市布局场景（cityLayout），不是纯随机撒点；
// 2. 敌人从固定的"进攻走廊"（lanes）登陆——开局即可见，玩家可针对性布防；
// 3. 波次是连续进攻：prewave = 距上一波【发起】的间隔，前一波未清完下一波就会压上来。

export interface WaveCfg {
  prewave: number;  // 距上一波发起的秒数（首波 = 开局布防时间）
  drops: { type: 'swarm' | 'runner' | 'armored' | 'splitter' | 'crawler' | 'behemoth' | 'shrieker'; n: number }[];
  jammers?: number;
  divers?: number;    // 俯冲艇：不登陆，直接俯冲撞击城市
  gunships?: number;  // 炮舰：悬停在城市上空持续轰炸，只能防空打
  wings?: number;     // 飞行蜂群：成编队低空推进，防空割草靶
  boss?: boolean;
  tide?: boolean;     // 飞船潮：全向多波高潮，警报 + 红色天幕
}

export type CityLayout = 'cluster' | 'equator' | 'capital' | 'global';

export interface LevelCfg {
  id: number;
  chapter: number;        // 1 = 抵抗篇，2 = 怪潮篇
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
const T5 = ['pulse', 'tesla', 'laser', 'radar', 'missile', 'prism', 'gatling'];
const T7 = ['pulse', 'tesla', 'laser', 'radar', 'missile', 'prism', 'satellite', 'gatling', 'plasma'];
const T8 = [...T7, 'reactor'];             // 章节二起步：+经济塔
const T9 = [...T8, 'station'];             // 章节二后期：+轨道空间站

export const LEVELS: LevelCfg[] = [
  {
    id: 1, chapter: 1, name: '初阵', sub: 'FIRST CONTACT',
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
    id: 2, chapter: 1, name: '疾风', sub: 'SWIFT RAID',
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
    id: 3, chapter: 1, name: '天穹', sub: 'SKYWARD',
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
    id: 4, chapter: 1, name: '静噪', sub: 'SILENT JAM',
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
    id: 5, chapter: 1, name: '中枢', sub: 'THE CORE',
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
    id: 6, chapter: 1, name: '流星雨', sub: 'METEOR FALL',
    flavor: '大量小型登陆舱多点着陆，爬行者尸潮与裂变体轮番扑城。', objective: '抵御疯狂登陆 · 四走廊多线',
    seed: 17320508, cities: 2, cityLayout: 'global', cityCluster: 0.4,
    landingSpread: 2.6, lanes: 4, startEnergy: 340, towers: T5,
    waves: [
      { prewave: 18, drops: [{ type: 'crawler', n: 20 }, { type: 'swarm', n: 10 }] },
      { prewave: 22, drops: [{ type: 'splitter', n: 7 }, { type: 'crawler', n: 22 }] },
      { prewave: 22, drops: [{ type: 'runner', n: 10 }, { type: 'splitter', n: 7 }, { type: 'crawler', n: 24 }] },
      { prewave: 24, drops: [{ type: 'splitter', n: 9 }, { type: 'armored', n: 7 }, { type: 'swarm', n: 12 }], jammers: 1 },
      { prewave: 24, drops: [{ type: 'crawler', n: 26 }, { type: 'runner', n: 12 }, { type: 'swarm', n: 12 }, { type: 'swarm', n: 10 }], divers: 2, wings: 10 },
      { prewave: 26, drops: [{ type: 'splitter', n: 11 }, { type: 'armored', n: 9 }, { type: 'crawler', n: 28 }, { type: 'runner', n: 10 }], divers: 2, wings: 14 },
    ],
  },
  {
    id: 7, chapter: 1, name: '寂静轨道', sub: 'DEAD ORBIT',
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
    id: 8, chapter: 1, name: '母舰降临', sub: 'MOTHERSHIP',
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

  // ================= 章节二《怪潮篇》 =================
  // 亿万僵尸式：建设期攒防线 → 末日时钟倒数 → 飞船潮全向压境。
  {
    id: 9, chapter: 2, name: '尸潮初现', sub: 'FIRST TIDE',
    flavor: '爬行者的数量超出所有预估。能源反应堆已解锁——用地皮换经济。', objective: '割草防线 · 撑过首次飞船潮',
    seed: 61803398, cities: 2, cityLayout: 'cluster', cityCluster: 1.0,
    landingSpread: 1.1, lanes: 2, startEnergy: 360, towers: T8,
    waves: [
      { prewave: 22, drops: [{ type: 'crawler', n: 24 }] },
      { prewave: 24, drops: [{ type: 'crawler', n: 26 }, { type: 'swarm', n: 12 }] },
      { prewave: 24, drops: [{ type: 'crawler', n: 28 }, { type: 'runner', n: 10 }], wings: 10 },
      { prewave: 26, drops: [{ type: 'crawler', n: 30 }, { type: 'splitter', n: 8 }], wings: 12 },
      { prewave: 32, drops: [{ type: 'crawler', n: 34 }, { type: 'crawler', n: 30 }, { type: 'swarm', n: 16 }, { type: 'runner', n: 12 }], wings: 20, divers: 2, tide: true },
    ],
  },
  {
    id: 10, chapter: 2, name: '双重怪潮', sub: 'TWIN TIDES',
    flavor: '两次飞船潮之间只有喘息。攻城巨兽首次现身——它们只对你的塔感兴趣。', objective: '防线维护 · 顶住两次飞船潮',
    seed: 74161987, cities: 2, cityLayout: 'cluster', cityCluster: 0.9,
    landingSpread: 1.3, lanes: 3, startEnergy: 380, towers: T8,
    waves: [
      { prewave: 22, drops: [{ type: 'crawler', n: 26 }, { type: 'swarm', n: 12 }] },
      { prewave: 24, drops: [{ type: 'crawler', n: 28 }, { type: 'behemoth', n: 1 }], wings: 10 },
      { prewave: 30, drops: [{ type: 'crawler', n: 32 }, { type: 'swarm', n: 16 }, { type: 'runner', n: 12 }], wings: 16, divers: 2, tide: true },
      { prewave: 26, drops: [{ type: 'crawler', n: 28 }, { type: 'behemoth', n: 2 }], wings: 12 },
      { prewave: 26, drops: [{ type: 'splitter', n: 10 }, { type: 'armored', n: 8 }], jammers: 1, wings: 14 },
      { prewave: 32, drops: [{ type: 'crawler', n: 36 }, { type: 'crawler', n: 32 }, { type: 'behemoth', n: 2 }, { type: 'swarm', n: 18 }], wings: 22, divers: 3, tide: true },
    ],
  },
  {
    id: 11, chapter: 2, name: '尖啸孤堡', sub: 'SHRIEKING SIEGE',
    flavor: '尖啸者死亡时的嘶鸣会让整个尸潮陷入狂暴。孤城，无路可退。', objective: '孤城割草 · 优先点名尖啸者',
    seed: 30277563, cities: 1, cityLayout: 'capital', cityCluster: 1.0,
    landingSpread: 1.2, lanes: 4, startEnergy: 400, towers: T8,
    waves: [
      { prewave: 22, drops: [{ type: 'crawler', n: 28 }, { type: 'shrieker', n: 2 }] },
      { prewave: 24, drops: [{ type: 'crawler', n: 30 }, { type: 'shrieker', n: 3 }], wings: 12 },
      { prewave: 26, drops: [{ type: 'crawler', n: 32 }, { type: 'shrieker', n: 3 }, { type: 'behemoth', n: 1 }], wings: 14 },
      { prewave: 26, drops: [{ type: 'splitter', n: 10 }, { type: 'shrieker', n: 4 }, { type: 'runner', n: 12 }], gunships: 1, wings: 14 },
      { prewave: 34, drops: [{ type: 'crawler', n: 36 }, { type: 'crawler', n: 34 }, { type: 'shrieker', n: 5 }, { type: 'behemoth', n: 2 }], wings: 24, divers: 3, tide: true },
    ],
  },
  {
    id: 12, chapter: 2, name: '天空撕裂', sub: 'TORN SKY',
    flavor: '这次的潮汐来自天上。轨道空间站已解锁——把战争带回它们的高度。', objective: '空中割草 · 天幕不能失守',
    seed: 84147098, cities: 2, cityLayout: 'cluster', cityCluster: 0.85,
    landingSpread: 1.5, lanes: 3, startEnergy: 420, towers: T9,
    waves: [
      { prewave: 22, drops: [{ type: 'swarm', n: 14 }], wings: 16, divers: 2 },
      { prewave: 24, drops: [{ type: 'crawler', n: 28 }], jammers: 1, wings: 20, divers: 3 },
      { prewave: 26, drops: [{ type: 'runner', n: 14 }], gunships: 2, wings: 24, divers: 3 },
      { prewave: 26, drops: [{ type: 'crawler', n: 32 }, { type: 'shrieker', n: 3 }], jammers: 2, wings: 26, divers: 4 },
      { prewave: 34, drops: [{ type: 'crawler', n: 34 }, { type: 'swarm', n: 18 }, { type: 'behemoth', n: 2 }], wings: 34, divers: 5, gunships: 2, tide: true },
    ],
  },
  {
    id: 13, chapter: 2, name: '钢铁洪流', sub: 'IRON FLOOD',
    flavor: '重装与巨兽组成的破城锤，两次怪潮把它们送到你门口。', objective: '硬碰硬 · 防线换血也要站住',
    seed: 99999331, cities: 2, cityLayout: 'cluster', cityCluster: 0.8,
    landingSpread: 1.6, lanes: 4, startEnergy: 440, towers: T9,
    waves: [
      { prewave: 22, drops: [{ type: 'armored', n: 9 }, { type: 'crawler', n: 26 }] },
      { prewave: 26, drops: [{ type: 'armored', n: 11 }, { type: 'behemoth', n: 2 }], wings: 12 },
      { prewave: 32, drops: [{ type: 'armored', n: 13 }, { type: 'crawler', n: 32 }, { type: 'behemoth', n: 2 }, { type: 'shrieker', n: 3 }], wings: 18, divers: 3, tide: true },
      { prewave: 26, drops: [{ type: 'armored', n: 11 }, { type: 'splitter', n: 10 }], jammers: 2, wings: 16 },
      { prewave: 34, drops: [{ type: 'armored', n: 15 }, { type: 'crawler', n: 36 }, { type: 'behemoth', n: 3 }, { type: 'shrieker', n: 4 }], wings: 24, divers: 4, gunships: 2, tide: true },
    ],
  },
  {
    id: 14, chapter: 2, name: '终焉之潮', sub: 'FINAL TIDE',
    flavor: '潮汐母舰领衔的最后总攻。三次怪潮，一次终审。', objective: '终焉 · 在第三次怪潮中活下来',
    seed: 27182099, cities: 2, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.8, lanes: 5, startEnergy: 460, towers: T9,
    waves: [
      { prewave: 24, drops: [{ type: 'crawler', n: 30 }, { type: 'swarm', n: 14 }], wings: 12 },
      { prewave: 26, drops: [{ type: 'crawler', n: 32 }, { type: 'shrieker', n: 3 }, { type: 'behemoth', n: 2 }], jammers: 1, wings: 16 },
      { prewave: 32, drops: [{ type: 'crawler', n: 34 }, { type: 'armored', n: 11 }, { type: 'shrieker', n: 4 }], wings: 22, divers: 3, tide: true },
      { prewave: 26, drops: [{ type: 'splitter', n: 12 }, { type: 'runner', n: 14 }], jammers: 2, gunships: 2, wings: 18 },
      { prewave: 32, drops: [{ type: 'crawler', n: 36 }, { type: 'behemoth', n: 3 }, { type: 'shrieker', n: 4 }, { type: 'armored', n: 13 }], wings: 26, divers: 4, tide: true },
      { prewave: 30, drops: [{ type: 'armored', n: 13 }, { type: 'crawler', n: 34 }], jammers: 2, wings: 20, divers: 3 },
      { prewave: 36, drops: [{ type: 'crawler', n: 40 }, { type: 'crawler', n: 36 }, { type: 'behemoth', n: 4 }, { type: 'shrieker', n: 5 }, { type: 'armored', n: 15 }], wings: 36, divers: 5, gunships: 2, boss: true, tide: true },
    ],
  },
];

// ============ 无尽模式 ============

export const ENDLESS_LEVEL: LevelCfg = {
  id: 99, chapter: 1, name: '无尽防线', sub: 'ENDLESS',
  flavor: '敌军的进攻永不停歇。坚守到最后一刻。',
  objective: '无尽防线 · 波次难度递增',
  seed: 88888888, cities: 2, cityLayout: 'global', cityCluster: 0.8,
  landingSpread: 1.6, lanes: 3, startEnergy: 360, towers: T9,
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
