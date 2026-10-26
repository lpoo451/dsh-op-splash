// dsh-op-splash — splash.js 运行时沙盒测试
// 为什么需要它：原有 119 项测试里，没有一项真正执行过 lib/splash.js（它只在浏览器里跑）。
// 这里用假 DOM + 可控时钟把它跑一遍，把「提示条到底建了没有、1.5 秒后有没有亮、进度线走不走」
// 从「读代码觉得对」变成「跑起来有证据」。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ✓', label);
  else { failed++; console.error('  ✗', label); }
};

const code = await readFile(path.join(root, 'lib', 'splash.js'), 'utf8');

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    style: {},
    attrs: {},
    listeners: {},
    textContent: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    setAttribute(k, v) { el.attrs[k] = v; },
    removeAttribute(k) { delete el.attrs[k]; },
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const a = el.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    fire(t, ev) { for (const fn of (el.listeners[t] || []).slice()) fn(ev || {}); }
  };
  return el;
}

/** 起一个干净的假浏览器，把 splash.js 跑起来；返回可控时钟与查询工具。 */
function boot(cfg) {
  let now = 0;
  let seq = 0;
  const timers = [];
  const byId = {};
  const htmlEl = makeEl('html');
  const body = makeEl('body');

  function createElement(tag) {
    const el = makeEl(tag);
    if (String(tag).toLowerCase() === 'video') {
      el.play = () => Promise.resolve();
      el.pause = () => {};
      el.load = () => {};
      el.currentTime = 0;
      el.duration = 6.667;
    }
    return el;
  }

  const doc = {
    readyState: 'complete',
    documentElement: htmlEl,
    body,
    createElement,
    getElementById: (id) => byId[id] || null,
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    fire(t, ev) { for (const fn of (this.listeners[t] || []).slice()) fn(ev || {}); }
  };
  body.appendChild = (c) => { c.parentNode = body; body.children.push(c); if (c.id) byId[c.id] = c; return c; };
  body.removeChild = (c) => {
    const i = body.children.indexOf(c);
    if (i >= 0) body.children.splice(i, 1);
    if (c.id) delete byId[c.id];
    c.parentNode = null;
    return c;
  };

  class FakeDate extends Date { static now() { return now; } }

  const win = {
    setTimeout(fn, ms) { const id = ++seq; timers.push({ id, fn, at: now + (ms || 0) }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener() {},
    removeEventListener() {},
    listeners: {},
    __DSH_OP_SPLASH__: Object.assign({}, cfg)
  };

  const store = {};
  vm.runInNewContext(code, {
    window: win,
    document: doc,
    sessionStorage: { setItem: (k, v) => { store['s' + k] = v; }, getItem: (k) => (k in store ? store['s' + k] : null) },
    localStorage: { setItem: (k, v) => { store['l' + k] = v; }, getItem: (k) => (k in store ? store['l' + k] : null) },
    Date: FakeDate, Math, JSON, Number, String, Array, Object, Promise, isFinite, console,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout
  });

  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      now = due.at;
      timers.splice(timers.indexOf(due), 1);
      try { due.fn(); } catch (e) { console.error('    (timer 抛错:', e && e.message, ')'); }
    }
    now = target;
  }

  return { win, doc, body, byId, htmlEl, advance, store };
}

const part = (b, tag) => {
  const r = b.byId['dsh-op-splash-root'];
  return r ? r.children.find((c) => c.tagName === tag) : null;
};
const hintOf = (b) => {
  const r = b.byId['dsh-op-splash-root'];
  return r ? r.children.find((c) => String(c.className).indexOf('dos-hint') !== -1) : null;
};
const barOf = (b) => {
  const h = hintOf(b);
  return h ? h.children.find((c) => c.tagName === 'I') : null;
};

const VIDEO_CFG = {
  enabled: true, kind: 'video', animation: 'steins-gate-op', mediaFile: 'video.mp4',
  src: '/dsh-op-splash/media/steins-gate-op/video.mp4', duration: 6.667, volume: 1
};

console.log('\n[1] 视频：提示条建了没有、1.5 秒后亮不亮、进度线走不走');
{
  const b = boot(VIDEO_CFG);
  ok(!!b.byId['dsh-op-splash-root'], '冷启动建了 #dsh-op-splash-root');
  const hint = hintOf(b);
  ok(!!hint, 'root 里确实建了 .dos-hint 提示条');
  const span = hint && hint.children.find((c) => c.tagName === 'SPAN');
  const bar = barOf(b);
  ok(span && span.textContent === '点击跳过', '提示文字是「点击跳过」');
  ok(!!bar, '进度线元素 <i> 在');
  ok(hint && hint.className === 'dos-hint', '刚建出来时没加 .on（此时确实不显示）');
  b.advance(1400);
  ok(hint && hint.className === 'dos-hint', '1.4 秒时仍未显示（延迟符合预期）');
  b.advance(200);
  ok(hint && hint.className === 'dos-hint on', '推进到 1.5 秒后加上了 .on（淡入定时器有触发）');
  const v = part(b, 'VIDEO');
  ok(!!v, '视频元素也在 root 里');
  ok(v && v.attrs.src === VIDEO_CFG.src, '视频走的是 Host 给的 src');
  if (v) {
    v.currentTime = 3.3335;
    v.fire('timeupdate');
  }
  ok(bar && bar.style.width === '50.00%', '视频播到一半 → 进度线 50.00%（实测 ' + (bar && bar.style.width) + '）');
  if (v) {
    v.currentTime = 6.667;
    v.fire('timeupdate');
  }
  ok(bar && bar.style.width === '100.00%', '播完 → 进度线 100.00%');
}

console.log('\n[2] 跳过：点画面 / Esc');
{
  const a = boot(VIDEO_CFG);
  a.advance(3000);
  const r = a.byId['dsh-op-splash-root'];
  r.fire('click');
  a.advance(600);
  ok(!a.byId['dsh-op-splash-root'], '点画面后黑幕被摘掉（跳过生效）');
  ok(a.htmlEl.classList.contains('dos-lock') === false, '顺带解开了滚动锁');

  const b = boot(VIDEO_CFG);
  b.doc.fire('keydown', { key: 'Escape' });
  b.advance(600);
  ok(!b.byId['dsh-op-splash-root'], 'Esc 也能跳过');
}

console.log('\n[3] 图片：停留时长与「一直停」');
{
  const IMG = { enabled: true, kind: 'image', animation: 'pic', mediaFile: 'image.png', src: '/x/image.png', duration: 5, volume: 1 };
  const a = boot(Object.assign({}, IMG, { imageHold: 2 }));
  const bar = barOf(a);
  a.advance(1000);
  ok(bar && bar.style.width === '50.00%', 'imageHold=2：1 秒时进度线 50.00%（实测 ' + (bar && bar.style.width) + '）');
  a.advance(1100);
  a.advance(600);
  ok(!a.byId['dsh-op-splash-root'], 'imageHold=2：2 秒后自动收尾');

  const c = boot(Object.assign({}, IMG, { imageHold: 0 }));
  const cbar = barOf(c);
  ok(cbar && cbar.style.display === 'none', '「一直停」时进度线被隐藏（没有终点）');
  c.advance(20000);
  ok(!!c.byId['dsh-op-splash-root'], '「一直停」不会自动收尾（20 秒后仍在等）');
  const chint = hintOf(c);
  ok(chint && chint.className === 'dos-hint on', '「一直停」时提示条照样在 1.5 秒后淡入');

  const d = boot(Object.assign({}, IMG, { duration: 3 }));
  d.advance(3100);
  d.advance(600);
  ok(!d.byId['dsh-op-splash-root'], '旧 Host 没给 imageHold → 回退用 duration（3 秒）');

  const e = boot(IMG);
  e.advance(2500);
  ok(barOf(e) && barOf(e).style.width === '50.00%', '什么都没给 → 默认停留 5 秒（2.5 秒时 50.00%）');
}

if (failed) {
  console.error(`\nFAIL: ${failed} 项未通过`);
  process.exit(1);
}
console.log('\nPASS: splash.js 运行时行为检查全部通过');