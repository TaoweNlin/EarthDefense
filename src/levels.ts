// 战役关卡配置。
// 设计原则：
// 1. 每关有明确目标（objective）与城市布局场景（cityLayout），不是纯随机撒点；
// 2. 敌人从固定的"进攻走廊"（lanes）登陆——开局即可见，玩家可针对性布防；
// 3. 波次是连续进攻：prewave = 距上一波【发起】的间隔，前一波未清完下一波就会压上来。

export interface WaveCfg {
  prewave: number;  // 距上一波发起的秒数（首波 = 开局布防时间）
  drops: { type: 'swarm' | 'runner' | 'armored' | 'splitter' | 'crawler' | 'behemoth' | 'shrieker'; n: number; heavy?: boolean }[];
  jammers?: number;
  divers?: number;    // 俯冲艇：不登陆，直接俯冲撞击城市
  gunships?: number;  // 炮舰：悬停在城市上空持续轰炸，只能防空打
  wings?: number;     // 飞行蜂群：成编队低空推进，防空割草靶
  hives?: number;     // 虫巢母舰：远轨巨舰，持续倾泻立体虫群流
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
  towers: string[];       // 推荐出击编制（战前部署的默认勾选，长度 ≤ slots）
  slots: number;          // 出击编制上限：本关最多带几种塔
  waves: WaveCfg[];
  endless?: boolean;      // 无尽模式：波次程序生成，难度递增
  tuning?: EndlessTuning; // 无尽模式开局设置产生的调参
}

// ============ 军械库：塔的全局解锁进度 ============
// 打到第 N 关即永久解锁对应塔，之后任意关卡（含回刷旧关）都可编入出击编制。
// 新塔只需在此登记解锁关卡，并按需加入各关推荐编制；
// 后续的塔养成/改装系统也挂在军械库这一层（按 key 追加成长数据即可）。

export const TOWER_UNLOCKS: Record<string, number> = {
  pulse: 1, tesla: 2, laser: 3, radar: 3, missile: 4,
  prism: 5, gatling: 5, satellite: 7, plasma: 7,
  reactor: 9, station: 12,
};

/** 全局已解锁的塔（endless 模式开放全部） */
export function armoryFor(unlocked: number, endless: boolean): string[] {
  return Object.keys(TOWER_UNLOCKS)
    .filter((k) => endless || TOWER_UNLOCKS[k] <= unlocked);
}

// ============ 出击编制持久化（按关卡记忆上次的选择） ============

const LOADOUT_KEY = 'earthdef-loadouts';

export function loadLoadouts(): Record<number, string[]> {
  try {
    const raw = localStorage.getItem(LOADOUT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* 损坏则重置 */ }
  return {};
}

export function saveLoadout(levelId: number, towers: string[]) {
  const all = loadLoadouts();
  all[levelId] = towers;
  localStorage.setItem(LOADOUT_KEY, JSON.stringify(all));
}

/** 无尽模式调参（由开局的难度 × 虫潮规模设置合成） */
export interface EndlessTuning {
  countMul: number;   // 地面兵力倍率
  hpGrow: number;     // 每波血量膨胀率
  prewaveAdd: number; // 波间隔修正（秒）
  wingMul: number;    // 虫潮规模倍率
  energyAdd: number;  // 起始能源修正
  jammerAdd: number;  // 后期额外干扰者
}

export type EndlessDiff = 'easy' | 'normal' | 'hard';
export type EndlessSwarm = 'normal' | 'big' | 'max';

/** 难度：轻松 = 割草爽；残酷 = 资源规划与布局的考验 */
export const DIFF_PRESETS: Record<EndlessDiff, { label: string; desc: string; tun: Partial<EndlessTuning> }> = {
  easy:   { label: '轻松', desc: '割草解压 · 敌军血薄兵少、间隔宽裕',
    tun: { countMul: 0.7, hpGrow: 0.05, prewaveAdd: 6, energyAdd: 120, jammerAdd: 0 } },
  normal: { label: '标准', desc: '常规压力曲线',
    tun: { countMul: 1.0, hpGrow: 0.10, prewaveAdd: 0, energyAdd: 0, jammerAdd: 0 } },
  hard:   { label: '残酷', desc: '兵多血厚间隔短 · 考验资源规划与布局',
    tun: { countMul: 1.35, hpGrow: 0.14, prewaveAdd: -5, energyAdd: 0, jammerAdd: 1 } },
};

/** 虫潮规模：最大档后期波次会刷满 50 万只级别的虫海 */
export const SWARM_PRESETS: Record<EndlessSwarm, { label: string; desc: string; wingMul: number }> = {
  normal: { label: '适中',     desc: '虫潮作为战场点缀', wingMul: 1 },
  big:    { label: '大量',     desc: '天空经常被遮蔽',   wingMul: 2.5 },
  max:    { label: '铺天盖地', desc: '后期百万虫海淹没星球（性能要求高）', wingMul: 6 },
};

export interface EndlessCfg { diff: EndlessDiff; swarm: EndlessSwarm }
const ENDLESS_CFG_KEY = 'earthdef-endless-cfg';

export function loadEndlessCfg(): EndlessCfg {
  try {
    const raw = localStorage.getItem(ENDLESS_CFG_KEY);
    if (raw) return { diff: 'normal', swarm: 'normal', ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { diff: 'normal', swarm: 'normal' };
}

export function saveEndlessCfg(c: EndlessCfg) {
  localStorage.setItem(ENDLESS_CFG_KEY, JSON.stringify(c));
}

export function buildEndlessTuning(c: EndlessCfg): EndlessTuning {
  return {
    countMul: 1, hpGrow: 0.1, prewaveAdd: 0, energyAdd: 0, jammerAdd: 0,
    ...DIFF_PRESETS[c.diff].tun,
    wingMul: SWARM_PRESETS[c.swarm].wingMul,
  };
}

// 各关推荐编制：贴合关卡威胁构成的默认选择，玩家可在战前部署里自由调整。
const T1 = ['pulse'];
const T2 = ['pulse', 'tesla'];
const T3 = ['pulse', 'tesla', 'laser', 'radar'];
const T4 = ['pulse', 'tesla', 'laser', 'radar', 'missile'];
const R5 = ['pulse', 'gatling', 'laser', 'radar', 'missile', 'prism'];           // 重甲围城：棱镜爆发
const R6 = ['pulse', 'gatling', 'tesla', 'laser', 'missile', 'radar'];           // 尸潮多线：割草+减速
const R7 = ['pulse', 'gatling', 'plasma', 'laser', 'missile', 'satellite', 'radar']; // 空中全面展开
const R8 = ['pulse', 'tesla', 'prism', 'laser', 'missile', 'satellite', 'radar'];    // 母舰决战
const R9 = ['pulse', 'gatling', 'plasma', 'tesla', 'laser', 'missile', 'radar', 'reactor'];  // 虫潮起：+经济
const R10 = ['pulse', 'gatling', 'plasma', 'prism', 'laser', 'missile', 'radar', 'reactor']; // 巨兽拆塔
const R12 = ['pulse', 'gatling', 'laser', 'missile', 'satellite', 'station', 'radar', 'reactor']; // 天空撕裂
const R13 = ['pulse', 'gatling', 'prism', 'laser', 'missile', 'station', 'radar', 'reactor'];     // 钢铁洪流
const R14 = ['gatling', 'plasma', 'prism', 'laser', 'missile', 'satellite', 'station', 'reactor']; // 终焉

export const LEVELS: LevelCfg[] = [
  {
    id: 1, chapter: 1, name: '初阵', sub: 'FIRST CONTACT',
    flavor: '敌军从单一走廊试探性登陆。', objective: '守住殖民地 · 单走廊防御',
    seed: 20260705, cities: 2, cityLayout: 'cluster', cityCluster: 1.0,
    landingSpread: 0.85, lanes: 1, startEnergy: 280, towers: T1, slots: 3,
    waves: [
      { prewave: 26, drops: [{ type: 'swarm', n: 10 }] },
      { prewave: 32, drops: [{ type: 'swarm', n: 14 }] },
      { prewave: 34, drops: [{ type: 'swarm', n: 12 }, { type: 'swarm', n: 12 }] },
    ],
  },
  {
    id: 2, chapter: 1, name: '疾风', sub: 'SWIFT RAID',
    flavor: '两条走廊轮番突击，高速单位直扑城市。', objective: '拦截高速突击 · 双走廊',
    seed: 31415926, cities: 2, cityLayout: 'cluster', cityCluster: 0.95,
    landingSpread: 1.0, lanes: 2, startEnergy: 300, towers: T2, slots: 3,
    waves: [
      { prewave: 24, drops: [{ type: 'swarm', n: 12 }] },
      { prewave: 30, drops: [{ type: 'runner', n: 10 }] },
      { prewave: 30, drops: [{ type: 'swarm', n: 12 }, { type: 'runner', n: 8 }] },
      { prewave: 32, drops: [{ type: 'runner', n: 12 }, { type: 'swarm', n: 14 }] },
    ],
  },
  {
    id: 3, chapter: 1, name: '天穹', sub: 'SKYWARD',
    flavor: '城市链沿赤道分布，敌舰自南北两极方向压入。', objective: '守卫赤道城市链 · 防空火力上线',
    seed: 27182818, cities: 3, cityLayout: 'equator', cityCluster: 0.85,
    landingSpread: 1.4, lanes: 2, startEnergy: 320, towers: T3, slots: 4,
    waves: [
      { prewave: 24, drops: [{ type: 'swarm', n: 12 }] },
      { prewave: 30, drops: [{ type: 'swarm', n: 14 }, { type: 'runner', n: 8 }], wings: 40 },
      { prewave: 30, drops: [{ type: 'armored', n: 5 }, { type: 'swarm', n: 12 }], divers: 1, wings: 50 },
      { prewave: 32, drops: [{ type: 'armored', n: 7 }, { type: 'runner', n: 10 }, { type: 'swarm', n: 14 }], divers: 2, wings: 60 },
    ],
  },
  {
    id: 4, chapter: 1, name: '静噪', sub: 'SILENT JAM',
    flavor: '干扰者将瘫痪其轨道下方的地面炮塔。', objective: '击落干扰者 · 保持火力网在线',
    seed: 16180339, cities: 3, cityLayout: 'cluster', cityCluster: 0.75,
    landingSpread: 1.6, lanes: 2, startEnergy: 320, towers: T4, slots: 5,
    waves: [
      { prewave: 24, drops: [{ type: 'swarm', n: 14 }] },
      { prewave: 30, drops: [{ type: 'runner', n: 12 }], jammers: 1, wings: 40 },
      { prewave: 30, drops: [{ type: 'armored', n: 7 }, { type: 'swarm', n: 14 }] },
      { prewave: 30, drops: [{ type: 'swarm', n: 16 }, { type: 'runner', n: 10 }], jammers: 1, wings: 60 },
      { prewave: 32, drops: [{ type: 'armored', n: 9 }, { type: 'swarm', n: 14 }, { type: 'runner', n: 8 }], wings: 50 },
    ],
  },
  {
    id: 5, chapter: 1, name: '中枢', sub: 'THE CORE',
    flavor: '整个星球只剩最后一座都会。敌军从四面八方合围。', objective: '孤城死守 · 敌军四面合围',
    seed: 14142135, cities: 1, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.1, lanes: 4, startEnergy: 340, towers: R5, slots: 6,
    waves: [
      { prewave: 24, drops: [{ type: 'armored', n: 7 }] },
      { prewave: 32, drops: [{ type: 'armored', n: 7 }, { type: 'swarm', n: 14 }], divers: 1 },
      { prewave: 32, drops: [{ type: 'armored', n: 9 }, { type: 'runner', n: 10 }], gunships: 1, wings: 50 },
      { prewave: 34, drops: [{ type: 'armored', n: 9 }, { type: 'armored', n: 7 }, { type: 'swarm', n: 16 }], divers: 2 },
      { prewave: 34, drops: [{ type: 'armored', n: 11 }, { type: 'runner', n: 12 }, { type: 'swarm', n: 18 }], gunships: 1, divers: 2, wings: 70 },
    ],
  },
  {
    id: 6, chapter: 1, name: '流星雨', sub: 'METEOR FALL',
    flavor: '大量小型登陆舱多点着陆，爬行者虫潮与裂变体轮番扑城。', objective: '抵御疯狂登陆 · 四走廊多线',
    seed: 17320508, cities: 2, cityLayout: 'global', cityCluster: 0.4,
    landingSpread: 2.6, lanes: 4, startEnergy: 340, towers: R6, slots: 6,
    waves: [
      { prewave: 24, drops: [{ type: 'crawler', n: 20 }, { type: 'swarm', n: 10 }] },
      { prewave: 28, drops: [{ type: 'splitter', n: 7 }, { type: 'crawler', n: 22 }] },
      { prewave: 28, drops: [{ type: 'runner', n: 10 }, { type: 'splitter', n: 7 }, { type: 'crawler', n: 24 }] },
      { prewave: 30, drops: [{ type: 'splitter', n: 9 }, { type: 'armored', n: 7 }, { type: 'swarm', n: 12 }], jammers: 1 },
      { prewave: 30, drops: [{ type: 'crawler', n: 26 }, { type: 'runner', n: 12 }, { type: 'swarm', n: 12 }, { type: 'swarm', n: 10 }], divers: 2, wings: 50 },
      { prewave: 32, drops: [{ type: 'splitter', n: 11 }, { type: 'armored', n: 9 }, { type: 'crawler', n: 28 }, { type: 'runner', n: 10 }], divers: 2, wings: 70 },
    ],
  },
  {
    id: 7, chapter: 1, name: '寂静轨道', sub: 'DEAD ORBIT',
    flavor: '敌军空中力量全面展开：炮舰压顶、俯冲艇突袭。防御卫星已解锁。', objective: '夺回天空 · 立体防御',
    seed: 22360679, cities: 2, cityLayout: 'global', cityCluster: 0.2,
    landingSpread: 3.0, lanes: 3, startEnergy: 380, towers: R7, slots: 7,
    waves: [
      { prewave: 24, drops: [{ type: 'swarm', n: 14 }], jammers: 1, wings: 50 },
      { prewave: 30, drops: [{ type: 'runner', n: 12 }], jammers: 1, divers: 2, wings: 60 },
      { prewave: 30, drops: [{ type: 'swarm', n: 18 }], jammers: 2, gunships: 1, wings: 70 },
      { prewave: 32, drops: [{ type: 'armored', n: 11 }], divers: 3, gunships: 1, wings: 70 },
      { prewave: 32, drops: [{ type: 'swarm', n: 18 }, { type: 'runner', n: 12 }], jammers: 2, divers: 2, gunships: 1, wings: 80 },
      { prewave: 34, drops: [{ type: 'armored', n: 13 }, { type: 'swarm', n: 18 }], divers: 3, gunships: 2, wings: 90 },
    ],
  },
  {
    id: 8, chapter: 1, name: '母舰降临', sub: 'MOTHERSHIP',
    flavor: '决战。中枢与卫星城背靠背，母舰在高轨持续投放登陆舱。', objective: '守住双子都会 · 击落母舰',
    seed: 26457513, cities: 2, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.6, lanes: 5, startEnergy: 400, towers: R8, slots: 7,
    waves: [
      { prewave: 24, drops: [{ type: 'swarm', n: 16 }, { type: 'runner', n: 10 }] },
      { prewave: 30, drops: [{ type: 'armored', n: 9 }, { type: 'splitter', n: 7 }], jammers: 1, divers: 1, wings: 50 },
      { prewave: 30, drops: [{ type: 'runner', n: 14 }, { type: 'swarm', n: 16 }], divers: 2, gunships: 1, wings: 60 },
      { prewave: 32, drops: [{ type: 'armored', n: 11 }, { type: 'splitter', n: 9 }], jammers: 2 },
      { prewave: 32, drops: [{ type: 'runner', n: 14 }, { type: 'swarm', n: 18 }], divers: 3, gunships: 1, wings: 80 },
      { prewave: 34, drops: [{ type: 'armored', n: 13 }, { type: 'splitter', n: 9 }, { type: 'swarm', n: 18 }], jammers: 1, gunships: 1, wings: 70 },
      { prewave: 36, drops: [{ type: 'armored', n: 11 }, { type: 'swarm', n: 18 }], divers: 3, wings: 90, boss: true },
    ],
  },

  // ================= 章节二《怪潮篇》 =================
  // 亿万僵尸式：建设期攒防线 → 末日时钟倒数 → 飞船潮全向压境。
  {
    id: 9, chapter: 2, name: '虫潮初现', sub: 'FIRST TIDE',
    flavor: '爬行者的数量超出所有预估。能源反应堆已解锁——用地皮换经济。', objective: '割草防线 · 撑过首次飞船潮',
    seed: 61803398, cities: 2, cityLayout: 'cluster', cityCluster: 1.0,
    landingSpread: 1.1, lanes: 2, startEnergy: 360, towers: R9, slots: 8,
    waves: [
      { prewave: 28, drops: [{ type: 'crawler', n: 24 }] },
      { prewave: 30, drops: [{ type: 'crawler', n: 26 }, { type: 'swarm', n: 12 }] },
      { prewave: 30, drops: [{ type: 'crawler', n: 28 }, { type: 'runner', n: 10 }], wings: 50 },
      { prewave: 32, drops: [{ type: 'crawler', n: 30 }, { type: 'splitter', n: 8 }], wings: 60 },
      { prewave: 38, drops: [{ type: 'crawler', n: 34 }, { type: 'crawler', n: 30 }, { type: 'swarm', n: 16 }, { type: 'runner', n: 12 }], wings: 200, divers: 2, tide: true },
    ],
  },
  {
    id: 10, chapter: 2, name: '双重怪潮', sub: 'TWIN TIDES',
    flavor: '两次飞船潮之间只有喘息。攻城巨兽首次现身——它们只对你的塔感兴趣。', objective: '防线维护 · 顶住两次飞船潮',
    seed: 74161987, cities: 2, cityLayout: 'cluster', cityCluster: 0.9,
    landingSpread: 1.3, lanes: 3, startEnergy: 380, towers: R10, slots: 8,
    waves: [
      { prewave: 28, drops: [{ type: 'crawler', n: 26 }, { type: 'swarm', n: 12 }] },
      { prewave: 30, drops: [{ type: 'crawler', n: 28 }, { type: 'behemoth', n: 1 }], wings: 50 },
      { prewave: 36, drops: [{ type: 'crawler', n: 32 }, { type: 'swarm', n: 16 }, { type: 'runner', n: 12 }], wings: 160, divers: 2, tide: true },
      { prewave: 32, drops: [{ type: 'crawler', n: 28 }, { type: 'behemoth', n: 2 }], wings: 60 },
      { prewave: 32, drops: [{ type: 'splitter', n: 10 }, { type: 'armored', n: 8 }], jammers: 1, wings: 70 },
      { prewave: 38, drops: [{ type: 'crawler', n: 36 }, { type: 'crawler', n: 32 }, { type: 'behemoth', n: 2, heavy: true }, { type: 'swarm', n: 18 }], wings: 220, divers: 3, tide: true },
    ],
  },
  {
    id: 11, chapter: 2, name: '尖啸孤堡', sub: 'SHRIEKING SIEGE',
    flavor: '尖啸者死亡时的嘶鸣会让整个虫潮陷入狂暴。孤城，无路可退。', objective: '孤城割草 · 优先点名尖啸者',
    seed: 30277563, cities: 1, cityLayout: 'capital', cityCluster: 1.0,
    landingSpread: 1.2, lanes: 4, startEnergy: 400, towers: R9, slots: 8,
    waves: [
      { prewave: 28, drops: [{ type: 'crawler', n: 28 }, { type: 'shrieker', n: 2 }] },
      { prewave: 30, drops: [{ type: 'crawler', n: 30 }, { type: 'shrieker', n: 3 }], wings: 60 },
      { prewave: 32, drops: [{ type: 'crawler', n: 32 }, { type: 'shrieker', n: 3 }, { type: 'behemoth', n: 1 }], wings: 70 },
      { prewave: 32, drops: [{ type: 'splitter', n: 10 }, { type: 'shrieker', n: 4 }, { type: 'runner', n: 12 }], gunships: 1, wings: 70 },
      { prewave: 40, drops: [{ type: 'crawler', n: 36 }, { type: 'crawler', n: 34 }, { type: 'shrieker', n: 5 }, { type: 'behemoth', n: 2 }], wings: 240, divers: 3, tide: true },
    ],
  },
  {
    id: 12, chapter: 2, name: '天空撕裂', sub: 'TORN SKY',
    flavor: '这次的潮汐来自天上。轨道空间站已解锁——把战争带回它们的高度。', objective: '空中割草 · 天幕不能失守',
    seed: 84147098, cities: 2, cityLayout: 'cluster', cityCluster: 0.85,
    landingSpread: 1.5, lanes: 3, startEnergy: 420, towers: R12, slots: 8,
    waves: [
      { prewave: 28, drops: [{ type: 'swarm', n: 14 }], wings: 80, divers: 2 },
      { prewave: 30, drops: [{ type: 'crawler', n: 28 }], jammers: 1, wings: 100, divers: 3 },
      { prewave: 32, drops: [{ type: 'runner', n: 14 }], gunships: 2, hives: 1, divers: 2 },
      { prewave: 32, drops: [{ type: 'crawler', n: 32 }, { type: 'shrieker', n: 3 }], jammers: 2, wings: 100, divers: 4 },
      { prewave: 40, drops: [{ type: 'crawler', n: 34 }, { type: 'swarm', n: 18 }, { type: 'behemoth', n: 2 }], wings: 240, divers: 5, gunships: 2, hives: 2, tide: true },
    ],
  },
  {
    id: 13, chapter: 2, name: '钢铁洪流', sub: 'IRON FLOOD',
    flavor: '重装与巨兽组成的破城锤，两次怪潮把它们送到你门口。', objective: '硬碰硬 · 防线换血也要站住',
    seed: 99999331, cities: 2, cityLayout: 'cluster', cityCluster: 0.8,
    landingSpread: 1.6, lanes: 4, startEnergy: 440, towers: R13, slots: 8,
    waves: [
      { prewave: 28, drops: [{ type: 'armored', n: 9 }, { type: 'crawler', n: 26 }] },
      { prewave: 32, drops: [{ type: 'armored', n: 11, heavy: true }, { type: 'behemoth', n: 2 }], wings: 60 },
      { prewave: 38, drops: [{ type: 'armored', n: 13, heavy: true }, { type: 'crawler', n: 32 }, { type: 'behemoth', n: 2 }, { type: 'shrieker', n: 3 }], wings: 180, divers: 3, tide: true },
      { prewave: 32, drops: [{ type: 'armored', n: 11 }, { type: 'splitter', n: 10 }], jammers: 2, wings: 80 },
      { prewave: 40, drops: [{ type: 'armored', n: 15, heavy: true }, { type: 'crawler', n: 36 }, { type: 'behemoth', n: 3, heavy: true }, { type: 'shrieker', n: 4 }], wings: 240, divers: 4, gunships: 2, tide: true },
    ],
  },
  {
    id: 14, chapter: 2, name: '终焉之潮', sub: 'FINAL TIDE',
    flavor: '潮汐母舰领衔的最后总攻。三次怪潮，一次终审。', objective: '终焉 · 在第三次怪潮中活下来',
    seed: 27182099, cities: 2, cityLayout: 'capital', cityCluster: 0.9,
    landingSpread: 1.8, lanes: 5, startEnergy: 460, towers: R14, slots: 8,
    waves: [
      { prewave: 30, drops: [{ type: 'crawler', n: 30 }, { type: 'swarm', n: 14 }], wings: 60 },
      { prewave: 32, drops: [{ type: 'crawler', n: 32 }, { type: 'shrieker', n: 3 }, { type: 'behemoth', n: 2 }], jammers: 1, wings: 80 },
      { prewave: 38, drops: [{ type: 'crawler', n: 34 }, { type: 'armored', n: 11 }, { type: 'shrieker', n: 4 }], wings: 220, divers: 3, hives: 1, tide: true },
      { prewave: 32, drops: [{ type: 'splitter', n: 12 }, { type: 'runner', n: 14 }], jammers: 2, gunships: 2, wings: 90 },
      { prewave: 38, drops: [{ type: 'crawler', n: 36 }, { type: 'behemoth', n: 3, heavy: true }, { type: 'shrieker', n: 4 }, { type: 'armored', n: 13, heavy: true }], wings: 200, divers: 4, hives: 2, tide: true },
      { prewave: 36, drops: [{ type: 'armored', n: 13 }, { type: 'crawler', n: 34 }], jammers: 2, wings: 100, divers: 3 },
      { prewave: 42, drops: [{ type: 'crawler', n: 40 }, { type: 'crawler', n: 36 }, { type: 'behemoth', n: 4, heavy: true }, { type: 'shrieker', n: 5 }, { type: 'armored', n: 15, heavy: true }], wings: 260, divers: 5, gunships: 2, hives: 2, boss: true, tide: true },
    ],
  },
];

// ============ 无尽模式 ============

export const ENDLESS_LEVEL: LevelCfg = {
  id: 99, chapter: 1, name: '无尽防线', sub: 'ENDLESS',
  flavor: '敌军的进攻永不停歇。坚守到最后一刻。',
  objective: '无尽防线 · 波次难度递增',
  seed: 88888888, cities: 2, cityLayout: 'global', cityCluster: 0.8,
  landingSpread: 1.6, lanes: 3, startEnergy: 360, towers: R12, slots: 8,
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

export function getSession(): { level: number; autostart: boolean; prep?: boolean } {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { level: 1, autostart: false };
}

/** prep = 重载后直接打开该关的战前部署界面（用于“下一关”） */
export function setSession(level: number, autostart: boolean, prep = false) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ level, autostart, prep }));
}
