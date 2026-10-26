# 安装 / 更新 / 卸载

## 安装（本地开发方式，源码目录直挂）

```cmd
dsh plugin --profile web add link:D:\Documents\deepseek-harness\default-workspace\dsh-op-splash
```

装完重启 DSH，冷启动即会播放开场动画；设置页出现「开场动画」面板。

## 验证

1. 冷启动验证：先在设置 →「开场动画」里导入一段视频或图片，然后完全关闭 DSH 页面 → 重新打开 → 应看到全屏黑幕播出它，播完自动淡出进入主界面。（仓库不带素材：还没导入时冷启动不播、也不会留黑幕，直接进主界面。）
2. 设置验证：设置 →「开场动画」→ 切换总开关 / 动画 / 频率 / 音量 → 点「立即预览」即时重播确认。
3. 跳过验证：播放中点击画面或按 Esc，应立即淡出。
4. 频率验证：mode 设为 daily 后刷新页面不应再播；把 `~/.dsh/dsh-op-splash.json` 里 `mode` 改回 `always` 重启恢复。

## 与 dsh-startup-screen 共存

二者完全独立、互不修改。若同时启用，冷启动会叠加两层启动画面——在其中一个的设置里关掉即可（例如用本插件时，把 dsh-startup-screen 的动画关掉）。

## 卸载

```cmd
dsh plugin --profile web remove dsh-op-splash
```

卸载不删除配置文件 `~/.dsh/dsh-op-splash.json`（可手动删）。

## 冒烟测试

```cmd
cd /d D:\Documents\deepseek-harness\default-workspace\dsh-op-splash
node test\smoke.mjs
```
