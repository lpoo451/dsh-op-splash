// dsh-op-splash — 导入/删除链路冒烟测试
// 真落盘 + 假 HTTP 请求：验证上传流式写盘、manifest 生成、清单合并、删除保护。
// DSH_HOME 指向插件目录下的 .test-dshhome（测完清掉），绝不碰真实 ~/.dsh。
import { readFile, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeHome = path.join(root, '.test-dshhome');
process.env.DSH_HOME = fakeHome;

let failed = 0;
const ok = (cond, label) => {
  if (cond) {
    console.log('  ✓', label);
  } else {
    failed++;
    console.error('  ✗', label);
  }
};

/* ── 假 HTTP 收发 ─────────────────────────────────────────────────────────── */
function makeReq(url, method, body) {
  const chunks = body ? [body] : [];
  let i = 0;
  return {
    url: url,
    method: method,
    headers: {},
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true };
        }
      };
    },
    destroy() {}
  };
}
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b === undefined ? '' : String(b); }
  };
}
async function call(route, req) {
  const res = makeRes();
  await route.handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { res, json };
}

try {
  await rm(fakeHome, { recursive: true, force: true });
  await mkdir(fakeHome, { recursive: true });

  const mod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href);
  const T = mod.__test__;
  ok(!!T && typeof T.listAnimations === 'function', '导出了测试探针 __test__');
  ok(T.userAnimDir().indexOf('dsh-op-splash-animations') !== -1, '用户素材目录带插件名前缀（不与他人撞）');
  ok(T.userAnimDir().startsWith(fakeHome), '用户素材目录跟随 DSH_HOME');

  /* 1) 纯函数：类型识别 / id 归一 / 素材 URL */
  ok(T.detectKind('a.mp4').kind === 'video' && T.detectKind('a.mp4').mime === 'video/mp4', 'detectKind: mp4 → video');
  ok(T.detectKind('a.PNG').kind === 'image' && T.detectKind('a.PNG').mime === 'image/png', 'detectKind: 大写扩展名照样认');
  ok(T.detectKind('a.exe') === null && T.detectKind('noext') === null, 'detectKind: 不收的类型返回 null');
  ok(T.slugify('My Video.mp4') === 'my-video-mp4', 'slugify: 标题 → 合法 id');
  ok(T.slugify('命运石之门') === 'clip', 'slugify: 中文标题兜底成 clip');
  ok(T.mediaUrl({ id: 'x', file: 'video.mp4' }) === '/dsh-op-splash/media/x/video.mp4?v=1.4.2', 'mediaUrl: 唯一拼法');

  /* 1.5) 配置归一化：随机开关与图片停留时长的默认值、夹取、回落 */
  const d0 = T.normalize({}, ['steins-gate-op']);
  ok(d0.random === false && d0.imageHoldMode === '5' && d0.imageHold === 5, '默认：随机关、图片停 5 秒');
  const d1 = T.normalize({ imageHoldMode: '3' }, ['steins-gate-op']);
  ok(d1.imageHold === 3, '图片停留：选 3 秒就停 3 秒');
  const d2 = T.normalize({ imageHoldMode: 'forever' }, ['steins-gate-op']);
  ok(d2.imageHold === 0, '图片停留：一直停 = 0（不自动收尾）');
  const d3 = T.normalize({ imageHoldMode: 'custom', imageHoldCustom: 9999 }, ['steins-gate-op']);
  ok(d3.imageHoldCustom === 600 && d3.imageHold === 600, '自定义时长夹到上界 600 秒');
  const d4 = T.normalize({ imageHoldMode: 'custom', imageHoldCustom: 0.2 }, ['steins-gate-op']);
  ok(d4.imageHoldCustom === 1, '自定义时长夹到下界 1 秒');
  const d5 = T.normalize({ imageHoldMode: 'nonsense' }, ['steins-gate-op']);
  ok(d5.imageHoldMode === '5' && d5.imageHold === 5, '非法时长选项回落默认 5 秒');
  const d6 = T.normalize({ random: 'yes' }, ['steins-gate-op']);
  ok(d6.random === false, '随机只认真正的 true（字符串不算开）');
  const d7 = T.normalize({ random: true }, ['steins-gate-op']);
  ok(d7.random === true, '随机开关能存下来');

  /* 1.6) 挑选动画：随机开关与边界（任务书要求：库里只有一个、空库都不能出错） */
  const A = [{ id: 'a', duration: 1 }, { id: 'b', duration: 2 }];
  ok(T.pickAnimation(A, { random: false, animation: 'b' }).id === 'b', '不随机时按配置选定那个');
  ok(T.pickAnimation([A[1]], { random: true }).id === 'b', '库里只有一个动画时开随机也不报错，就播它');
  ok(T.pickAnimation([], { random: true }) === null, '素材库为空 → null（上层有兜底，不炸）');
  ok(T.pickAnimation(null, { random: true }) === null, '名单缺失也不抛异常');
  const rnd = T.pickAnimation(A, { random: true, animation: 'a' });
  ok(rnd && (rnd.id === 'a' || rnd.id === 'b'), '开随机时挑到的必定在名单里');
  ok(T.pickAnimation(A, { random: false, animation: 'missing' }) === null, '配置指向已消失的动画 → null（上层回落）');

  /* 2) 清单字段：仓库不带素材，所以「有内置视频」是可选的——
        有就校验它的字段，没有就跳过（素材由使用者自己导入） */
  const builtin = await T.listAnimations();
  const bvideo = builtin.find((a) => a.source === 'builtin' && a.kind === 'video');
  if (bvideo) {
    ok(bvideo.file === 'video.mp4' && bvideo.duration > 0, '内置项带 source/kind/file/duration');
  } else {
    ok(true, '仓库不带内置素材（可接受：素材由使用者自己导入）');
  }
  const BID = (bvideo && bvideo.id) || '';

  /* 3) 素材白名单：内置素材在时先验它；不在时留到下面用户素材处再验 */
  if (bvideo) {
    const hit = await T.resolveMedia(BID, bvideo.file);
    ok(hit && hit.mime === 'video/mp4', 'resolveMedia: 命中声明的素材');
    ok((await T.resolveMedia(BID, '../../package.json')) === null, 'resolveMedia: 拒绝 ../ 穿越');
    ok((await T.resolveMedia(BID, 'manifest.json')) === null, 'resolveMedia: 拒绝未声明的文件');
  }
  ok((await T.resolveMedia('..', 'video.mp4')) === null, 'resolveMedia: 拒绝非法动画 id');
  ok((await T.resolveMedia('nope-not-here', 'video.mp4')) === null, 'resolveMedia: 未知动画 → 404');

  /* 4) 真起一遍 Host 半，拿到真实路由 */
  const routes = [];
  const fakeServer = {
    register(spec) { routes.push(spec); return () => {}; },
    tapIndex() { return () => {}; }
  };
  const ctx = {
    get(k) {
      if (k === 'webServer') return fakeServer;
      if (k === 'connection') return { requestRejection: async () => null };
      return undefined;
    },
    effect() {}
  };
  await mod.apply(ctx);
  ok(routes.length >= 7, '注册了全部路由（' + routes.length + ' 条）');
  const routeOf = (p) => routes.find((r) => r.path === p);
  const importRoute = routeOf('/dsh-op-splash/import');
  const deleteRoute = routeOf('/dsh-op-splash/animations/delete');
  ok(!!importRoute && !!deleteRoute, '导入/删除路由都在');

  /* 5) 视频导入：流式落盘 + manifest */
  const payload = Buffer.alloc(64 * 1024, 7);
  const r1 = await call(importRoute, makeReq(
    '/dsh-op-splash/import?name=My%20Trip.mp4&title=My%20Trip&duration=12.5', 'POST', payload));
  ok(r1.json && r1.json.ok === true, '导入视频返回 ok');
  const anim = r1.json && r1.json.animation;
  ok(anim && anim.id === 'my-trip' && anim.kind === 'video' && anim.source === 'user', '导入结果带 id/kind/source');
  ok(anim && anim.file === 'video.mp4' && anim.duration === 12.5, '素材文件名与时长按请求写入');
  const vfile = path.join(T.userAnimDir(), anim.id, 'video.mp4');
  const vsz = existsSync(vfile) ? (await stat(vfile)).size : 0;
  ok(vsz === payload.length, '素材字节完整落盘（' + vsz + ' / ' + payload.length + '）');
  const mf = JSON.parse(await readFile(path.join(T.userAnimDir(), anim.id, 'manifest.json'), 'utf8'));
  ok(mf.kind === 'video' && mf.file === 'video.mp4' && mf.duration === 12.5, 'manifest 字段正确');

  /* 6) 图片导入：默认停留 5 秒，扩展名保留 */
  const r2 = await call(importRoute, makeReq('/dsh-op-splash/import?name=poster.png', 'POST', Buffer.alloc(2048, 1)));
  const img = r2.json && r2.json.animation;
  ok(img && img.kind === 'image' && img.duration === 5 && img.file === 'image.png', '导入图片 → 停留 5 秒、image.png');

  /* 7) 拒收与坏请求 */
  const r3 = await call(importRoute, makeReq('/dsh-op-splash/import?name=evil.exe', 'POST', Buffer.alloc(16)));
  ok(r3.json && r3.json.ok === false, '拒收不支持的类型（.exe）');
  const r4 = await call(importRoute, makeReq('/dsh-op-splash/import?name=empty.mp4', 'POST', null));
  ok(r4.json && r4.json.ok === false, '空请求体不算数（不留空目录）');
  ok(!existsSync(path.join(T.userAnimDir(), 'empty')), '空导入没有留下垃圾目录');
  const r5 = await call(routeOf('/dsh-op-splash/import'), makeReq('/dsh-op-splash/import?name=a.mp4', 'GET', null));
  ok(r5.json && r5.json.ok === false, '导入路由只收 POST');

  /* 8) 合并清单：用户项与内置项同时可见、同 id 不重复 */
  const list = await T.listAnimations();
  ok(list.filter((a) => a.source === 'user').length === 2, '清单里两条用户动画');
  if (bvideo) ok(list.some((a) => a.id === BID && a.source === 'builtin'), '内置动画没有被用户扫描顶掉');
  ok(list.length === new Set(list.map((a) => a.id)).size, '清单无重复 id');
  const userHit = await T.resolveMedia(anim.id, 'video.mp4');
  ok(userHit && userHit.mime === 'video/mp4', '用户素材能被 media 路由取到');
  ok((await T.resolveMedia(anim.id, '../../package.json')) === null, 'resolveMedia: 拒绝 ../ 穿越（用户素材）');
  ok((await T.resolveMedia(anim.id, 'manifest.json')) === null, 'resolveMedia: 拒绝未声明的文件（用户素材）');

  /* 9) 删除保护与删除 */
  if (bvideo) {
    const rd0 = await call(deleteRoute, makeReq('/dsh-op-splash/animations/delete', 'POST',
      Buffer.from(JSON.stringify({ id: BID }))));
    ok(rd0.json && rd0.json.ok === false, '内置动画拒绝删除');
  }
  const rd1 = await call(deleteRoute, makeReq('/dsh-op-splash/animations/delete', 'POST',
    Buffer.from(JSON.stringify({ id: '根本没有这个素材' }))));
  ok(rd1.json && rd1.json.ok === false, '不存在的 id 拒绝删除');
  const rd2 = await call(deleteRoute, makeReq('/dsh-op-splash/animations/delete', 'POST',
    Buffer.from(JSON.stringify({ id: '../../lib' }))));
  ok(rd2.json && rd2.json.ok === false, '非法 id 拒绝删除');
  const rd3 = await call(deleteRoute, makeReq('/dsh-op-splash/animations/delete', 'POST',
    Buffer.from(JSON.stringify({ id: anim.id }))));
  ok(rd3.json && rd3.json.ok === true, '删除用户动画成功');
  ok(!existsSync(path.join(T.userAnimDir(), anim.id)), '素材目录已从磁盘移除');
  ok(rd3.json && rd3.json.animations.every((a) => a.id !== anim.id), '删除后清单同步更新');
  ok(rd3.json && rd3.json.config && rd3.json.config.animation !== anim.id, '配置不会停在已删动画上');

  /* 10) 隔离红线：仍然不碰参考插件的命名空间 */
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const idx = stripComments(await readFile(path.join(root, 'lib', 'index.js'), 'utf8'));
  ok(!idx.includes('dsh-startup-screen') && !idx.includes('dsu-') && !idx.includes('__DSH_STARTUP'),
    'host 代码仍不占 startup-screen 命名空间');
} finally {
  await rm(fakeHome, { recursive: true, force: true });
}

if (failed) {
  console.error(`\nFAIL: ${failed} 项未通过`);
  process.exit(1);
}
console.log('\nPASS: 导入/删除链路检查全部通过');