// dsh-op-splash — 冒烟测试：结构 + 契约 + 素材完整性
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond, label) => {
  if (cond) {
    console.log('  ✓', label);
  } else {
    failed++;
    console.error('  ✗', label);
  }
};

// 1) Host 半契约
const mod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href);
ok(mod.name === 'dsh-op-splash', 'host exports.name === dsh-op-splash');
ok(Array.isArray(mod.inject) && mod.inject.includes('webServer'), 'host inject 含 webServer');
ok(typeof mod.apply === 'function', 'host exports.apply 是函数');
ok(mod.default === undefined, '不导出 default（避免 unwrapExports 遮蔽）');

// 2) 文件齐备
for (const f of ['lib/splash.css', 'lib/splash.js', 'lib/client.js']) {
  const text = await readFile(path.join(root, f), 'utf8');
  ok(text.length > 200, `${f} 非空 (${text.length} chars)`);
}

// 3) 客户端 bundle 契约
const client = await readFile(path.join(root, 'lib', 'client.js'), 'utf8');
ok(client.includes("__ModuleLoader__.load"), 'client 使用 __ModuleLoader__.load');
ok(client.includes("id: 'dsh-op-splash'"), 'client 注册 id 与包名一致');
ok(client.includes("settings.section"), 'client 注册设置 section 槽位');

// 3.5) 三项改动的载体都在（跳过提示 / 随机开关 / 图片时长可配）
const splashJs = await readFile(path.join(root, 'lib', 'splash.js'), 'utf8');
const splashCss = await readFile(path.join(root, 'lib', 'splash.css'), 'utf8');
const hostCode = await readFile(path.join(root, 'lib', 'index.js'), 'utf8');
ok(splashJs.includes('dos-hint') && splashJs.includes('点击跳过'), '播放器带「点击跳过」提示与进度线');
ok(splashCss.includes('.dos-hint'), '样式表带提示条样式');
ok(hostCode.includes('HOLD_MODES') && hostCode.includes('imageHoldSeconds'), 'host 支持图片停留时长配置');
ok(hostCode.includes('pickAnimation') && hostCode.includes('random'), 'host 支持随机挑选（只在启动那一刻掷骰子）');
ok(client.includes('每次启动随机挑一个') && client.includes('图片停留时长'), '设置面板露出随机开关与图片时长选择');

// 4) 素材包：每个动画目录的 manifest 都要合法，它声明的素材都要在
//    （有版权的内置素材不进仓库，所以这里只校验实际存在的那些目录）
const { readdir } = await import('node:fs/promises');
const animsDir = path.join(root, 'lib', 'animations');
let animIds = [];
try {
  animIds = (await readdir(animsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
} catch { /* 仓库不带素材时这个目录可能压根不存在（git 不追踪空目录），正常 */ }
// 仓库不带素材是允许的：有目录就校验，没有就跳过（测试不依赖仓库里有内置素材）
ok(true, `动画目录：${animIds.join(', ') || '（空，仓库不带素材，允许）'}`);
let sawBigVideo = false;
for (const id of animIds) {
  const mf = JSON.parse(await readFile(path.join(animsDir, id, 'manifest.json'), 'utf8'));
  const okTitle = typeof mf.title === 'string' && mf.title.length > 0;
  const okDur = Number(mf.duration) > 0 || mf.kind === 'image';
  ok(mf.id === id && okTitle && okDur, `${id} manifest 合法（id/标题/时长）`);
  const files = Array.isArray(mf.files) && mf.files.length
    ? mf.files
    : [mf.file || (mf.kind === 'image' ? 'image.png' : 'video.mp4')];
  for (const fn of files) {
    const st = await stat(path.join(animsDir, id, fn));
    ok(st.size > 1024, `${id}/${fn} 存在 (${(st.size / 1024).toFixed(0)} KB)`);
    if (/\.(mp4|webm|ogv)$/i.test(fn) && st.size > 200_000) sawBigVideo = true;
  }
}
if (animIds.length) ok(sawBigVideo, '至少有一个像样的视频素材（>200 KB）');

// 5) 隔离核查：可执行代码不得引用/修改 dsh-startup-screen 的任何资源（注释提及不算引用）
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const indexCode = stripComments(await readFile(path.join(root, 'lib', 'index.js'), 'utf8'));
ok(!indexCode.includes('dsh-startup-screen'), 'host 代码不引用 dsh-startup-screen');
ok(!indexCode.includes('dsu-') && !indexCode.includes('__DSH_STARTUP'), 'host 代码不占用 dsu-* / __DSH_STARTUP* 命名空间');
const clientCode = stripComments(client);
ok(!clientCode.includes('dsh-startup-screen') && !clientCode.includes('__DSH_STARTUP'), 'client 代码不占用 startup-screen 命名空间');

if (failed) {
  console.error(`\nFAIL: ${failed} 项未通过`);
  process.exit(1);
}
console.log('\nPASS: 全部冒烟检查通过');
