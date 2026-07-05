# 寰宇防线 / Earth Defense

一款纯前端 Three.js 球面塔防原型：玩家在全息地球上布置防线，拦截轨道来袭并处理登陆后的地表进攻。

## 当前内容

- 8 个战役关卡和无尽模式。
- Goldberg 球面网格、地形、城市、进攻走廊和连续波次。
- 地面塔、防空塔、辅助塔、升级、出售和遗迹词条。
- 轨道运输舰、干扰者、飞行蜂群、俯冲艇、炮舰、母舰等敌人。
- 本地进度保存、基础教程、音效开关和战后统计。

## 技术栈

- Vite
- TypeScript
- Three.js
- 无后端、无外部贴图或模型资源

需要 Node.js 20.19 或更高版本。Node.js 22.12+ / 24+ 也可以。

## 本地运行

```bash
npm install
npm run dev
```

开发服务器启动后，在浏览器打开 Vite 输出的本地地址。

## 常用脚本

```bash
npm run typecheck
npm run build
npm run preview
```

- `typecheck`：只运行 TypeScript 检查。
- `build`：先类型检查，再生成生产构建到 `dist/`。
- `preview`：预览生产构建。

## 项目结构

```text
.
├── index.html          # 页面结构、HUD 和主要样式
├── src/
│   ├── main.ts         # Three.js 场景、UI 事件和主循环
│   ├── game.ts         # 战斗系统、塔、敌人、经济和胜负判定
│   ├── levels.ts       # 战役、无尽模式和进度存储
│   ├── goldberg.ts     # 球面网格生成
│   ├── noise.ts        # 程序化噪声
│   └── sound.ts        # WebAudio 音效
└── DESIGN.md           # 游戏设计文档
```

## 入库说明

`node_modules/`、`dist/`、本地环境文件、日志和编辑器缓存不会入库。`.claude/launch.json` 是项目级启动配置，不包含密钥；私有 Claude 设置已被忽略。
