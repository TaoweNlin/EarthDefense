# 寰宇防线 / Earth Defense

[Live Demo](https://taowenlin.github.io/EarthDefense/) · [中文](#中文) · [English](#english)

## 中文

《寰宇防线》是一款纯前端 Three.js 球面塔防原型。玩家在全息地球上布置防线，拦截轨道来袭，并处理登陆后的地表进攻。

### 当前内容

- 8 个战役关卡和无尽模式。
- Goldberg 球面网格、地形、城市、进攻走廊和连续波次。
- 地面塔、防空塔、辅助塔、升级、出售和遗迹词条。
- 轨道运输舰、干扰者、飞行蜂群、俯冲艇、炮舰、母舰等敌人。
- 本地进度保存、基础教程、音效开关和战后统计。

### 技术栈

- Vite
- TypeScript
- Three.js
- 无后端、无外部贴图或模型资源

需要 Node.js 20.19 或更高版本。Node.js 22.12+ / 24+ 也可以。

### 本地运行

```bash
npm install
npm run dev
```

开发服务器启动后，在浏览器打开 Vite 输出的本地地址。

### 常用脚本

```bash
npm run typecheck
npm run build
npm run preview
```

- `typecheck`：只运行 TypeScript 检查。
- `build`：先类型检查，再生成生产构建到 `dist/`。
- `preview`：预览生产构建。

## English

Earth Defense is a browser-based Three.js spherical tower-defense prototype. Build a defense grid on a holographic globe, intercept orbital threats, and stop landed enemies before they reach the cities.

### Features

- 8 campaign levels plus endless mode.
- Goldberg sphere grid with terrain, cities, attack corridors, and continuous waves.
- Ground towers, anti-air towers, support towers, upgrades, selling, and relic perks.
- Orbital transports, jammers, flying swarms, divers, gunships, and mothership encounters.
- Local progress saving, a lightweight tutorial, mute control, and post-battle stats.

### Tech Stack

- Vite
- TypeScript
- Three.js
- No backend, external textures, or 3D model assets

Requires Node.js 20.19 or newer. Node.js 22.12+ / 24+ also works.

### Getting Started

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

### Scripts

```bash
npm run typecheck
npm run build
npm run preview
```

- `typecheck`: run TypeScript checks only.
- `build`: type-check and generate a production build in `dist/`.
- `preview`: preview the production build locally.

## Project Structure

```text
.
├── index.html          # Page shell, HUD, and main styles
├── src/
│   ├── main.ts         # Three.js scene, UI events, and main loop
│   ├── game.ts         # Combat systems, towers, enemies, economy, win/loss state
│   ├── levels.ts       # Campaign, endless mode, and progress storage
│   ├── goldberg.ts     # Spherical grid generation
│   ├── noise.ts        # Procedural noise
│   └── sound.ts        # WebAudio sound effects
└── DESIGN.md           # Game design document
```

## Repository Notes

`node_modules/`, `dist/`, local environment files, logs, and editor caches are ignored. `.claude/launch.json` is a shared project launch config and does not contain secrets; private Claude settings are ignored.

## License

MIT License. See [LICENSE](LICENSE).
