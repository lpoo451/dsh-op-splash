# dsh-op-splash — 开场动画插件

冷启动全屏播放一段动画。视频、图片、幻灯片都行。**仓库不带任何素材**——装上后动画选择是空的，用设置页导入自己的视频 / 图片 / 幻灯片即可（见「导入自己的素材」）。

## 功能

- **总开关**：启用 / 关闭开场动画
- **动画选择**：在内置与自导入的素材之间切换
- **播放频率**：每次冷启动 / 每个浏览器会话一次 / 每天一次
- **随机**：每次冷启动随机挑一个；可限定「只随机这几个」，还能给每件素材设权重（0 = 不参与）
- **按时段播放**：例如 22:00–06:00 播 A，其余时间走随机或手选；跨零点照常识别，列表顺序即优先级；每条还能限定星期几（不勾 = 不限，跨零点时段按「现在这一刻」算星期）
- **图片停留时长**：2 / 3 / 5 秒、一直停到手动跳过、或自定义 1–600 秒（只对图片生效，视频永远按原声播完）
- **跳过提示**：底部那行小字与进度线的位置（底部居中 / 左下 / 右下 / 不显示）与文案（1–40 字）都可改；选「不显示」时点画面、Esc、空格照样能跳过
- **音量**：0–100%
- **幻灯片**：一次导入多张图，按顺序一张张放；每张停留 / 过渡 / 间隔都能事后改，顺序可在面板里用 ↑↓ 调
- **转场效果**：淡入淡出 / 缓慢推进 / 白闪切换 / 侧向擦除（只对幻灯片生效，单张视频与图片不受影响）
- **素材清单**：列出每件素材的类型、时长、体积与来源；「未上架」的条目会写明原因（素材文件缺失 / 缺 manifest.json / manifest 读不出来）
- **导入素材**：设置页直接选视频、图片，或一次多选图做幻灯片，导完自动出现在选择器里
- **导入上限**：最多张数 / 单张 MB / 单条合计 MB 都可调（默认 100 张 · 300MB · 1024MB，只为防手滑）
- **立即预览**：一键重播，改完不用重启就能看效果

## 导入自己的素材

设置 →「开场动画」→「我的动画」→「导入动画 / 图片」：

- 视频：mp4 / webm / ogv（浏览器能播的就行），原声保留；
- 图片：png / jpg / webp / gif / avif，按上面「图片停留时长」的设置淡入—停留—淡出；
- 幻灯片：点「导入幻灯片（可多选图）」一次挑多张，按挑选顺序排；导入后可在面板里展开改「每张停留 / 过渡 / 间隔」，或用 ↑↓ 调顺序；「每张停留」填 0 = 每张停到手动跳过（这时点画面 = 看下一张，Esc 整段跳过）；
- 单文件上限 300 MB（可调），素材落在 `~/.dsh/dsh-op-splash-animations/<id>/`（不放进插件目录——那里升级时会被覆盖）；
- 列表里每项都能删（内置素材不可删）。

## 素材与版权

**代码是 MIT，素材不进仓库。** 仓库里一件素材都不带：装上后动画选择是空的，素材由使用者自己导入——落在 `~/.dsh/dsh-op-splash-animations/`，不进版本库，升级也不丢。

作者本机在 `lib/animations/` 里可能自备了素材（例如某段动画 OP 片段），那些**不在仓库里**——`.gitignore` 已把 `lib/animations/steins-gate-op/` 挡在外面。想在作者那台机器上复现，自备视频后：

```bash
mkdir -p lib/animations/steins-gate-op
# 把你的 video.mp4 放进去，再按下面「新增内置动画素材包」写一个 manifest.json
```

或者更省事：用设置页的「导入动画 / 图片」，素材落在 `~/.dsh/dsh-op-splash-animations/`，不进版本库、升级也不丢。

> 把别人的影视片段放进公开仓库，会吃 DMCA 下架。自己的片子放自己的机器。

## 安装 / 卸载

见 [INSTALL.md](INSTALL.md)。

## 与其他插件的关系

**完全独立**：独立的 DOM id（`dsh-op-splash-*`）、独立的存储键（`dsh-op-splash:shown` / `dsh-op-splash:day`）、独立的路由前缀（`/dsh-op-splash/*`）、独立的 CSS 类（`dos-*`）。本插件不读取、不修改、不依赖任何其他插件的文件。

若与其他负责启动画面的插件同时启用，冷启动会先后出现两层启动画面（后挂者覆盖在前者之上）。**建议二选一**：在其中一个的设置里关掉它的动画即可。

## 新增内置动画素材包（零代码）

1. 在 `lib/animations/` 下新建一个目录，目录名即动画 id（小写字母/数字/`.`/`_`/`-`）；
2. 放入素材与 `manifest.json`：

   视频：
   ```json
   { "id": "你的目录名", "title": "显示在设置里的名字", "duration": 6.667, "kind": "video", "file": "video.mp4" }
   ```
   图片：
   ```json
   { "id": "你的目录名", "title": "显示在设置里的名字", "kind": "image", "file": "image.png" }
   ```

3. 重启 DSH，设置 →「开场动画」→ 动画选择里就会出现新条目。

> 只是自己用的话其实不必碰目录：设置页的「导入动画 / 图片」就是为这件事准备的。

## 配置文件

`~/.dsh/dsh-op-splash.json`（`DSH_HOME` 环境变量可覆盖 home）。改动在**下一次冷启动**生效；设置页的「立即预览」即时生效。

字段：`enabled` / `animation` / `mode` / `volume` / `random` / `randomPool` / `weights` / `imageHoldMode` / `imageHoldCustom` / `hintMode` / `hintText` / `transition` / `schedules`（每条含 `weekdays`）/ `maxSlides` / `maxSlideMB` / `maxBatchMB`。旧配置缺字段会自动补默认（随机关、提示在底部、无时段、转场淡入淡出），行为与升级前一致。

## 技术说明

- Host 半（`lib/index.js`）：注册 `/dsh-op-splash/{splash.css,splash.js,animations,config,import,import/slides,import/slides/item,import/slides/order,import/slides/meta,animations/delete,media/*}` 路由 + `tapIndex` 注入启动黑幕；`media` 路由带最小 Range 支持与「文件名以 manifest 声明为准」的白名单，防目录穿越；`import` 为流式写盘（单文件 300 MB 上限，`.part` 临时文件 + 原子改名）；清单扫描（`inspectDir` / `inspectAnimations`）顺带产出「未上架」原因。
- 播放器（`lib/splash.js`）：原生 `<video>` 逐帧播放原片帧率（30fps 原帧直出，无补帧）；图片走淡入—停留—淡出；自动播放被浏览器静音策略拦截时降级为静音播放 + 首次手势恢复声音；点击画面或 Esc/Enter/空格跳过（幻灯片「一直停」时点画面 = 看下一张）；幻灯片按 manifest 的 hold / fade / gap 序列播放，转场按 `transition` 取四套 CSS 类之一；提示条按 `hintMode` / `hintText` 生成；10 秒（或时长+3s）failsafe 兜底，绝不锁死黑屏。
- Client 半（`lib/client.js`）：ModuleLoader bundle，向设置页注入「开场动画」面板；Host 注入缺席时（Electron 直载）自行拉配置自举播放，挑选规则与 Host 同源（时段 → 随机池权重 → 选定）。
- 测试：`smoke.mjs` / `smoke-desktop-boot.mjs` / `smoke-import.mjs` / `smoke-splash.mjs` / `smoke-features.mjs`，近 200 项断言（**一件素材都不带**也能全绿：测试自己造素材，不依赖仓库里有内置素材）。