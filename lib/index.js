// dsh-op-splash — Host 半：HTTP 路由 + index.html 启动注入
// 设计基准：同类启动画面插件的骨架契约（仅参考实现方式，不引用不修改其任何文件）。
// 命名空间全部独立（dsh-op-splash / dos-*），与同类插件（dsu-*）互不干扰。
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { readFile, writeFile, rename, mkdir, readdir, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';

export const name = 'dsh-op-splash';
export const inject = ['webServer', 'connection'];

const VERSION = '1.4.2';
const ROUTE_BASE = '/dsh-op-splash';
const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANIM_DIR = path.join(LIB_DIR, 'animations');
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODES = ['always', 'session', 'daily'];
/** 图片停留时长选项：2/3/5 秒、forever=一直停到手动跳过、custom=自己填（1–600 秒）。 */
const HOLD_MODES = ['2', '3', '5', 'forever', 'custom'];
const MAX_HOLD = 600;
/** 跳过提示的位置：bottom=底部居中、left/right=左下/右下、off=不显示（跳过照旧可用）。 */
const HINT_MODES = ['bottom', 'left', 'right', 'off'];
const HINT_TEXT_DEFAULT = '点击跳过';
const MAX_HINT_TEXT = 40;
const MAX_SCHEDULES = 20;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/**
 * 配置默认值。新字段全部向后兼容：
 * randomPool 空 + weights 空 = 全库等概率随机（与旧配置行为一致）；hintMode 默认底部居中；
 * schedules 空 = 不按时段，走原来的「随机 / 选定」逻辑。
 */
const DEFAULTS = {
  /* 仓库不带任何素材（素材由使用者自己导入），所以默认动画留空。
     配置里指向的素材不存在时，normalize 会自动回落到清单里的第一件。 */
  enabled: true, animation: '', mode: 'always', volume: 1,
  random: false, imageHoldMode: '5', imageHoldCustom: 5,
  randomPool: [], weights: {}, hintMode: 'bottom', hintText: HINT_TEXT_DEFAULT, schedules: [],
  transition: 'fade', maxSlides: 100, maxSlideMB: 300, maxBatchMB: 1024
};

// 转场风格（D1）：淡入淡出 / 缩放推进 / 白闪 / 遮罩擦除
const TRANSITIONS = ['fade', 'zoom', 'flash', 'wipe'];
// 星期代号：getDay() 里 0=周日，这张表按 ISO 排（周一在前）
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
// 幻灯片时间范围：每张停留 / 过渡 / 间隔（秒）
const HOLD_MIN = 0.5, HOLD_MAX = 600, FADE_MAX = 3, GAP_MAX = 10;
const MAX_SLIDES_LIMIT = 999;

// 图片动画的默认停留秒数；导入素材单文件上限；浏览器能直接播的扩展名白名单
const IMAGE_HOLD = 5;
const MAX_IMPORT = 300 * 1024 * 1024;
const MIME_BY_EXT = {
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif'
};

const ROOT_ID = 'dsh-op-splash-root';

const CRITICAL_CSS = [
  'html.dos-lock, html.dos-lock body { overflow: hidden !important; }',
  '#dsh-op-splash-root.dos-boot { position: fixed; inset: 0; z-index: 2147483000; background: #000; }'
].join('\n');

// 首屏自举：同步判定是否该播（不依赖 splash.js 加载成功），失败兜底放行，绝不锁死黑屏。
const BOOTSTRAP_JS = [
  "(function(){",
  "try{",
  "var root=document.getElementById('" + ROOT_ID + "');",
  "var cfg=window.__DSH_OP_SPLASH__||{};",
  "var ok=cfg.enabled!==false&&!!(cfg.src||cfg.animation);",
  "try{",
  "if(cfg.mode==='session'&&sessionStorage.getItem('dsh-op-splash:shown')==='1')ok=false;",
  "if(cfg.mode==='daily'&&localStorage.getItem('dsh-op-splash:day')===new Date().toDateString())ok=false;",
  "}catch(e){}",
  "if(!ok){if(root&&root.parentNode){root.parentNode.removeChild(root);}return;}",
  "document.documentElement.classList.add('dos-lock');",
  "window.setTimeout(function(){try{",
  "var r=document.getElementById('" + ROOT_ID + "');",
  "if(r&&r.parentNode){r.parentNode.removeChild(r);}",
  "document.documentElement.classList.remove('dos-lock');",
  "}catch(e){}},Math.max(10000,((cfg.duration||7)+3)*1000));",
  "}catch(e){try{",
  "var rr=document.getElementById('" + ROOT_ID + "');",
  "if(rr&&rr.parentNode){rr.parentNode.removeChild(rr);}",
  "document.documentElement.classList.remove('dos-lock');",
  "}catch(e2){}}",
  "})();"
].join('\n');

/** 数字夹取：非法值回落默认，超范围夹到边界（保留一位小数）。 */
function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}

/** 整数夹取。 */
function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function homeDir() {
  return process.env.DSH_HOME || os.homedir();
}
function configPath() {
  return path.join(homeDir(), '.dsh', 'dsh-op-splash.json');
}
// 用户导入的动画落在这里（不放插件目录：node_modules 里可能是只读硬链接，升级会丢）
function userAnimDir() {
  return path.join(homeDir(), '.dsh', 'dsh-op-splash-animations');
}

/* ── 动画清单：内置目录 + 用户导入目录，合并成同一份列表 ───────────────────── */
// 一个可选动画 = 一个目录 + manifest.json + 它声明的那个素材文件。
// 内置的以后加新视频仍是「丢一个目录进来，不改代码」；用户导入的走设置页上传。
async function inspectDir(dir, source) {
  const list = [];
  const issues = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || !ID_RE.test(ent.name)) continue;
      const mf = path.join(dir, ent.name, 'manifest.json');
      if (!existsSync(mf)) {
        issues.push({ id: ent.name, source: source, reason: 'no-manifest' });
        continue;
      }
      let m = null;
      try {
        m = JSON.parse(await readFile(mf, 'utf8'));
      } catch {
        issues.push({ id: ent.name, source: source, reason: 'bad-manifest' });
        continue;
      }
      const kind = m.kind === 'image' ? 'image' : 'video';
      const single = typeof m.file === 'string' && FILE_RE.test(m.file) ? m.file : null;
      /* files[] = 幻灯片（一次导入多张图）；没有就退回单文件 file，再退回按类型猜的默认名 */
      let files = Array.isArray(m.files)
        ? m.files.filter((f) => typeof f === 'string' && FILE_RE.test(f) && f.indexOf('..') === -1)
        : [];
      if (!files.length) files = [single || (kind === 'image' ? 'image.png' : 'video.mp4')];
      const title = typeof m.title === 'string' && m.title ? m.title : ent.name;
      const missing = files.filter((f) => !existsSync(path.join(dir, ent.name, f)));
      if (missing.length) {
        // 半截导入 / 素材被手动删掉：不上架，但要说清为什么（面板会把它列出来）
        issues.push({ id: ent.name, title: title, source: source, reason: 'missing-file', file: missing[0] });
        continue;
      }
      let size = 0;
      let mtime = 0;
      for (const f of files) {
        try {
          const st = statSync(path.join(dir, ent.name, f));
          size += st.size;
          mtime = Math.max(mtime, st.mtimeMs);
        } catch {}
      }
      /* 幻灯片的时间参数（三个都写在 manifest 里，面板可事后改） */
      const slide = files.length > 1;
      const hold = clampNum(m.hold, HOLD_MIN, HOLD_MAX, IMAGE_HOLD);
      const fade = clampNum(m.fade, 0, FADE_MAX, 0.5);
      const gap = clampNum(m.gap, 0, GAP_MAX, 0);
      list.push({
        id: ent.name,
        title: title,
        duration: slide
          ? Math.round((files.length * hold + (files.length - 1) * gap) * 10) / 10
          : (Number(m.duration) > 0 ? Number(m.duration) : (kind === 'image' ? IMAGE_HOLD : 0)),
        kind: kind,
        file: files[0],
        files: files,
        slide: slide,
        hold: hold,
        fade: fade,
        gap: gap,
        source: source,
        size: size,
        mtime: mtime
      });
    }
  } catch {}
  return { list: list, issues: issues };
}

/** 兼容旧签名：只要清单，不要问题列表。 */
async function scanDir(dir, source) {
  return (await inspectDir(dir, source)).list;
}

async function listAnimations() {
  return (await inspectAnimations()).list;
}

/** 清单 + 「为什么没上架」——面板要显示的那一份。 */
async function inspectAnimations() {
  const builtin = await inspectDir(ANIM_DIR, 'builtin');
  const user = await inspectDir(userAnimDir(), 'user');
  const seen = new Set(builtin.list.map((a) => a.id));
  const merged = builtin.list.concat(user.list.filter((a) => !seen.has(a.id))); // 同 id 以内置为准
  merged.sort((a, b) => a.id.localeCompare(b.id));
  return { list: merged, issues: builtin.issues.concat(user.issues) };
}

async function findAnimation(id) {
  const all = await listAnimations();
  return all.find((a) => a.id === id) || null;
}

/** "HH:MM" → 当日分钟数；不合法返回 null。 */
function timeToMinutes(s) {
  const m = HHMM_RE.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 时段命中判定。跨零点（22:00–06:00）按「或」，其余按 [from, to)。 */
function inWindow(nowMin, fromMin, toMin) {
  if (fromMin === toMin) return false;
  return fromMin < toMin
    ? (nowMin >= fromMin && nowMin < toMin)
    : (nowMin >= fromMin || nowMin < toMin);
}

/** 按时段挑：列表顺序即优先级，第一条命中的就赢；时间没填全或素材已删的条目直接跳过。 */
function matchSchedule(anims, cfg, date) {
  const list = cfg && Array.isArray(cfg.schedules) ? cfg.schedules : [];
  if (!list.length) return null;
  const nowMin = date.getHours() * 60 + date.getMinutes();
  /* 星期按「现在这一刻」算：周日凌晨 2 点就是周日（跨零点不回溯到起始那天） */
  const today = WEEKDAYS[(date.getDay() + 6) % 7];
  for (const s of list) {
    const wd = s && Array.isArray(s.weekdays) ? s.weekdays : [];
    if (wd.length && wd.indexOf(today) === -1) continue; // 星期不匹配 → 看下一条
    const from = timeToMinutes(s && s.from);
    const to = timeToMinutes(s && s.to);
    if (from == null || to == null) continue;      // 起止没填全 → 整条忽略
    if (!inWindow(nowMin, from, to)) continue;
    const hit = anims.find((a) => a.id === (s && s.animation));
    if (hit) return hit;                            // 素材被删 → 跳过该条，继续看下一条
  }
  return null;
}

/** 单项权重：没配过 → 1；配了 ≤0 或非数字 → 0（不参与）。 */
function weightOf(weights, id) {
  if (!weights || typeof weights !== 'object') return 1;
  if (!Object.prototype.hasOwnProperty.call(weights, id)) return 1;
  const n = Number(weights[id]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(99, n);
}

/** 加权抽样：只在池子里抽；池子被勾空或全被判 0 → 回退全库等概率。 */
function randomPick(anims, cfg) {
  const pool = cfg && Array.isArray(cfg.randomPool) ? cfg.randomPool : [];
  let cands = pool.length ? anims.filter((a) => pool.indexOf(a.id) !== -1) : anims.slice();
  if (!cands.length) cands = anims.slice(); // 池子被勾空 → 回退全库，不能让启动变成不播
  const weights = cfg && cfg.weights;
  const scored = cands.map((a) => ({ a: a, w: weightOf(weights, a.id) })).filter((x) => x.w > 0);
  if (!scored.length) return cands[Math.floor(Math.random() * cands.length)];
  let total = 0;
  for (const x of scored) total += x.w;
  let r = Math.random() * total;
  for (const x of scored) {
    r -= x.w;
    if (r <= 0) return x.a;
  }
  return scored[scored.length - 1].a;
}

/** 挑这一趟要播的动画：时段优先 → 随机（带池子与权重）→ 配置里选定的那个。 */
function pickAnimation(anims, cfg, now) {
  if (!Array.isArray(anims) || !anims.length) return null;
  const date = now instanceof Date ? now : new Date();
  const bySchedule = matchSchedule(anims, cfg, date);
  if (bySchedule) return bySchedule;
  if (cfg && cfg.random === true) return randomPick(anims, cfg);
  return anims.find((a) => a.id === (cfg && cfg.animation)) || null;
}

/** 素材 URL 的唯一拼法：Host 与浏览器两半都只认它产出的 src。 */
function mediaUrl(anim) {
  if (!anim) return '';
  const f = (Array.isArray(anim.files) && anim.files[0]) || anim.file;
  return ROUTE_BASE + '/media/' + anim.id + '/' + f + '?v=' + VERSION;
}

/** 素材请求解析：白名单 = 该动画 manifest 亲自声明的那个文件名（比正则更严）。 */
async function resolveMedia(animId, fileName) {
  const id = String(animId || '');
  const nm = String(fileName || '');
  if (!ID_RE.test(id) || !FILE_RE.test(nm)) return null;
  if (nm.indexOf('..') !== -1 || path.basename(nm) !== nm) return null;
  const anim = await findAnimation(id);
  if (!anim || (Array.isArray(anim.files) ? anim.files : [anim.file]).indexOf(nm) === -1) return null;
  const dir = anim.source === 'user' ? userAnimDir() : ANIM_DIR;
  const file = path.join(dir, id, nm);
  if (path.dirname(path.dirname(file)) !== dir) return null; // 双保险：必须正好落在该动画目录里
  if (!existsSync(file)) return null;
  const ext = nm.split('.').pop().toLowerCase();
  return { file: file, mime: MIME_BY_EXT[ext] || 'application/octet-stream' };
}

/** 标题 → 合法 id（导入时用）。 */
function slugify(s) {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return out && ID_RE.test(out) ? out : 'clip';
}

/** 扩展名 → {kind, mime}；不收的一律 null。 */
function detectKind(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  return { ext: ext, mime: mime, kind: mime.indexOf('video/') === 0 ? 'video' : 'image' };
}

function queryOf(url) {
  try {
    return new URL(String(url || ''), 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

async function writeConfig(cfg) {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  await rename(tmp, file);
}

/** 配置 → 实际停留秒数：0 表示一直停到手动跳过。 */
function imageHoldSeconds(cfg) {
  if (cfg.imageHoldMode === 'forever') return 0;
  if (cfg.imageHoldMode === 'custom') return cfg.imageHoldCustom;
  const n = Number(cfg.imageHoldMode);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** 时段清单归一化：时间不合法、起止相同、指向已删素材的条目一律丢掉。 */
function normalizeSchedules(raw, knownIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const from = typeof s.from === 'string' && HHMM_RE.test(s.from) ? s.from : null;
    const to = typeof s.to === 'string' && HHMM_RE.test(s.to) ? s.to : null;
    if (!from || !to) continue;
    if (timeToMinutes(from) === timeToMinutes(to)) continue;
    if (knownIds.indexOf(s.animation) === -1) continue;
    /* 星期限定：空 = 不限（旧配置行为不变）；非法代号丢掉 */
    const wd = Array.isArray(s.weekdays)
      ? WEEKDAYS.filter((d) => s.weekdays.indexOf(d) !== -1) /* 去重 + 剔非法 + 固定按周一到周日排，配置 diff 才稳定 */
      : [];
    out.push({ from: from, to: to, animation: s.animation, weekdays: wd });
    if (out.length >= MAX_SCHEDULES) break;
  }
  return out;
}

function normalize(raw, knownIds) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const cfg = { ...DEFAULTS };
  cfg.enabled = src.enabled !== false;
  cfg.animation = knownIds.includes(src.animation) ? src.animation : (knownIds[0] || DEFAULTS.animation);
  cfg.mode = MODES.includes(src.mode) ? src.mode : 'always';
  const vol = Number(src.volume);
  cfg.volume = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : DEFAULTS.volume;
  cfg.random = src.random === true;
  cfg.imageHoldMode = HOLD_MODES.includes(src.imageHoldMode) ? src.imageHoldMode : DEFAULTS.imageHoldMode;
  const hold = Number(src.imageHoldCustom);
  cfg.imageHoldCustom = Number.isFinite(hold) ? Math.min(MAX_HOLD, Math.max(1, Math.round(hold))) : DEFAULTS.imageHoldCustom;
  cfg.imageHold = imageHoldSeconds(cfg);
  /* 随机池：只认库里还在的 id；空数组 = 全部参与（旧配置行为不变） */
  cfg.randomPool = Array.isArray(src.randomPool)
    ? Array.from(new Set(src.randomPool.filter((id) => typeof id === 'string' && knownIds.indexOf(id) !== -1)))
    : [];
  /* 权重：只留库里还在的 id；0 表示不参与；没配过的按 1 算 */
  const weights = {};
  if (src.weights && typeof src.weights === 'object') {
    for (const [k, v] of Object.entries(src.weights)) {
      if (knownIds.indexOf(k) === -1) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      weights[k] = Math.min(99, Math.max(0, Math.round(n)));
    }
  }
  cfg.weights = weights;
  cfg.hintMode = HINT_MODES.indexOf(src.hintMode) !== -1 ? src.hintMode : DEFAULTS.hintMode;
  const ht = typeof src.hintText === 'string' ? src.hintText.trim() : '';
  cfg.hintText = ht ? ht.slice(0, MAX_HINT_TEXT) : DEFAULTS.hintText;
  cfg.transition = TRANSITIONS.indexOf(src.transition) !== -1 ? src.transition : DEFAULTS.transition;
  cfg.maxSlides = clampInt(src.maxSlides, 1, MAX_SLIDES_LIMIT, DEFAULTS.maxSlides);
  cfg.maxSlideMB = clampInt(src.maxSlideMB, 1, 10000, DEFAULTS.maxSlideMB);
  cfg.maxBatchMB = clampInt(src.maxBatchMB, 1, 100000, DEFAULTS.maxBatchMB);
  cfg.schedules = normalizeSchedules(src.schedules, knownIds);
  return cfg;
}

export async function apply(ctx) {
  const webServer = (ctx.get && ctx.get('webServer')) || ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') return; // 桌面端无 webServer 时静默跳过
  const connection = (ctx.get && ctx.get('connection')) || ctx.connection;

  const guard = (handler) => async (req, res) => {
    try {
      const reject = connection && typeof connection.requestRejection === 'function'
        ? await connection.requestRejection(req)
        : null;
      if (reject != null) {
        try {
          res.statusCode = 403;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
        } catch {}
        return;
      }
    } catch {}
    return handler(req, res);
  };

  const sendText = (res, code, mime, body, cache) => {
    try {
      res.statusCode = code;
      res.setHeader('content-type', mime);
      res.setHeader('cache-control', cache || 'no-store');
      res.end(body);
    } catch {}
  };
  const sendJson = (res, obj, cache) => sendText(res, 200, 'application/json; charset=utf-8', JSON.stringify(obj), cache);

  // 素材（视频/图片）：白名单校验 + 最小 Range 支持（Chromium <video> 会发 Range 请求）
  async function mediaHandler(req, res, animId, fileName) {
    const hit = await resolveMedia(animId, fileName);
    if (!hit) return sendText(res, 404, 'text/plain; charset=utf-8', 'not found');
    let size = 0;
    try { size = statSync(hit.file).size; } catch { return sendText(res, 404, 'text/plain; charset=utf-8', 'not found'); }
    const base = {
      'content-type': hit.mime,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=86400'
    };
    const range = req.headers && req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range));
    let start = 0;
    let end = size - 1;
    let partial = false;
    if (m && (m[1] !== '' || m[2] !== '')) {
      partial = true;
      if (m[1] === '') {
        const n = Math.min(parseInt(m[2], 10) || 0, size);
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = Math.min(parseInt(m[1], 10) || 0, size - 1);
        end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10) || size - 1, size - 1);
      }
      if (!(start >= 0 && start <= end && end < size)) {
        try {
          res.statusCode = 416;
          res.setHeader('content-range', 'bytes */' + size);
          res.end();
        } catch {}
        return;
      }
    }
    try {
      res.statusCode = partial ? 206 : 200;
      if (partial) res.setHeader('content-range', 'bytes ' + start + '-' + end + '/' + size);
      res.setHeader('content-length', String(end - start + 1));
      for (const k in base) res.setHeader(k, base[k]);
      const stream = createReadStream(hit.file, partial ? { start, end } : undefined);
      stream.on('error', () => { try { res.end(); } catch {} });
      stream.pipe(res);
    } catch {
      try { res.end(); } catch {}
    }
  }

  /* ── 幻灯片 ────────────────────────────────────────────────────────────
     一次导入多张图，按顺序播放。分三步：建条目 → 逐张上传 → 可选的调顺序/改时间。
     之所以不一次传完：一次一个文件能报进度，断了也不用从头再来。 */

  /** 读一个小 JSON 请求体（幻灯片这些控制请求都很小）。 */
  const readJson = async (req, limit) => {
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > (limit || 4096)) break;
      }
    } catch {}
    try { return JSON.parse(body || '{}'); } catch { return null; }
  };

  /** 幻灯片条目：id 合法 + 目录里有 manifest（可选要求它确实是幻灯片）。 */
  const loadSlide = async (id, mustSlide) => {
    if (!ID_RE.test(String(id || ''))) return null;
    const dir = path.join(userAnimDir(), id);
    try {
      const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
      if (mustSlide && !Array.isArray(m.files)) return null;
      return { dir: dir, m: m };
    } catch { return null; }
  };

  /** 流式落盘一个请求体，返回 { error, size }。 */
  const streamToFile = async (req, finalPath, maxBytes) => {
    const tmp = finalPath + '.part';
    let received = 0;
    let failed = null;
    const ws = createWriteStream(tmp);
    try {
      for await (const chunk of req) {
        received += chunk.length;
        if (received > maxBytes) { failed = '单个文件超过上限（' + Math.round(maxBytes / 1048576) + 'MB）'; break; }
        if (!ws.write(chunk)) { try { await once(ws, 'drain'); } catch { failed = '写入中断'; break; } }
      }
      if (!failed) { ws.end(); try { await once(ws, 'finish'); } catch { failed = '写入失败'; } }
    } catch { failed = failed || '写入失败'; }
    if (!failed && received === 0) failed = '没有收到文件内容';
    if (failed) {
      try { ws.destroy(); } catch {}
      try { await rm(tmp, { force: true }); } catch {}
      try { req.destroy(); } catch {}
      return { error: failed, size: 0 };
    }
    try { await rename(tmp, finalPath); } catch { return { error: '落盘失败', size: 0 }; }
    return { error: null, size: received };
  };

  /** 写回幻灯片 manifest（files 数组就是播放顺序；duration 按张数与三个时间算出来）。 */
  const saveSlide = async (dir, m) => {
    m.files = Array.isArray(m.files) ? m.files : [];
    m.hold = clampNum(m.hold, HOLD_MIN, HOLD_MAX, IMAGE_HOLD);
    m.fade = clampNum(m.fade, 0, FADE_MAX, 0.5);
    m.gap = clampNum(m.gap, 0, GAP_MAX, 0);
    m.duration = Math.round((m.files.length * m.hold + Math.max(0, m.files.length - 1) * m.gap) * 10) / 10;
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2), 'utf8');
    return m;
  };

  /** 建一个空的幻灯片条目。 */
  async function slidesCreateHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' });
    const msg = await readJson(req, 4096);
    if (!msg) return sendJson(res, { ok: false, error: 'bad request' });
    const title = String(msg.title || '我的幻灯片').trim().slice(0, 60) || '我的幻灯片';
    const base = slugify(title);
    const taken = new Set((await listAnimations()).map((a) => a.id));
    let id = base;
    for (let i = 2; taken.has(id) && i < 1000; i++) id = base.slice(0, 28) + '-' + i;
    if (taken.has(id)) id = base.slice(0, 24) + '-' + Date.now();
    const dir = path.join(userAnimDir(), id);
    try { await mkdir(dir, { recursive: true }); } catch { return sendJson(res, { ok: false, error: '建目录失败' }); }
    const m = {
      id: id, title: title, kind: 'image', files: [],
      hold: clampNum(msg.hold, HOLD_MIN, HOLD_MAX, IMAGE_HOLD),
      fade: clampNum(msg.fade, 0, FADE_MAX, 0.5),
      gap: clampNum(msg.gap, 0, GAP_MAX, 0),
      duration: 0, importedAt: new Date().toISOString()
    };
    try { await saveSlide(dir, m); } catch { return sendJson(res, { ok: false, error: '写 manifest 失败' }); }
    return sendJson(res, { ok: true, id: id, title: title });
  }

  /** 往幻灯片里加一张图。 */
  async function slidesItemHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' });
    const q = queryOf(req.url);
    const hit = await loadSlide(q.get('id'), true);
    if (!hit) return sendJson(res, { ok: false, error: '找不到这个幻灯片' });
    const cfg = normalize(await readConfig(), (await listAnimations()).map((a) => a.id));
    const det = detectKind(path.basename(String(q.get('name') || '')));
    if (!det || det.kind !== 'image') return sendJson(res, { ok: false, error: '幻灯片只能收图片（png / jpg / webp / gif）' });
    const files = Array.isArray(hit.m.files) ? hit.m.files.slice() : [];
    if (files.length >= cfg.maxSlides) {
      return sendJson(res, { ok: false, error: '张数已达上限 ' + cfg.maxSlides + ' 张（可在设置里调）' });
    }
    const name = String(files.length + 1).padStart(2, '0') + '.' + det.ext;
    const maxOne = cfg.maxSlideMB * 1024 * 1024;
    const maxAll = cfg.maxBatchMB * 1024 * 1024;
    const got = await streamToFile(req, path.join(hit.dir, name), maxOne);
    if (got.error) return sendJson(res, { ok: false, error: got.error });
    files.push(name);
    hit.m.files = files;
    let total = 0;
    for (const f of files) {
      try { total += statSync(path.join(hit.dir, f)).size; } catch {}
    }
    if (total > maxAll) {
      try { await rm(path.join(hit.dir, name), { force: true }); } catch {}
      hit.m.files = files.slice(0, -1);
      try { await saveSlide(hit.dir, hit.m); } catch {}
      return sendJson(res, { ok: false, error: '这一批总大小超过 ' + cfg.maxBatchMB + 'MB 上限（可在设置里调）' });
    }
    try { await saveSlide(hit.dir, hit.m); } catch { return sendJson(res, { ok: false, error: '写 manifest 失败' }); }
    return sendJson(res, { ok: true, files: hit.m.files, count: hit.m.files.length, duration: hit.m.duration });
  }

  /** 调整幻灯片的播放顺序（files 数组的顺序就是播放顺序）。 */
  async function slidesOrderHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' });
    const msg = await readJson(req, 4096);
    const hit = msg ? await loadSlide(msg.id, true) : null;
    if (!hit) return sendJson(res, { ok: false, error: '找不到这个幻灯片' });
    const cur = Array.isArray(hit.m.files) ? hit.m.files : [];
    const want = Array.isArray(msg.files) ? msg.files.filter((f) => typeof f === 'string') : [];
    /* 必须是同一批文件的重排：名字集合一致，不能凭空多也不能少 */
    if (want.length !== cur.length || want.some((f) => cur.indexOf(f) === -1) || new Set(want).size !== want.length) {
      return sendJson(res, { ok: false, error: '顺序清单和现有文件对不上' });
    }
    hit.m.files = want;
    try { await saveSlide(hit.dir, hit.m); } catch { return sendJson(res, { ok: false, error: '写 manifest 失败' }); }
    return sendJson(res, { ok: true, files: hit.m.files });
  }

  /** 改幻灯片的标题或三个时间（每张停留 / 过渡 / 间隔）。 */
  async function slidesMetaHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' });
    const msg = await readJson(req, 4096);
    const hit = msg ? await loadSlide(msg.id, true) : null;
    if (!hit) return sendJson(res, { ok: false, error: '找不到这个幻灯片' });
    if (typeof msg.title === 'string' && msg.title.trim()) hit.m.title = msg.title.trim().slice(0, 60);
    if (msg.hold !== undefined) hit.m.hold = clampNum(msg.hold, HOLD_MIN, HOLD_MAX, hit.m.hold);
    if (msg.fade !== undefined) hit.m.fade = clampNum(msg.fade, 0, FADE_MAX, hit.m.fade);
    if (msg.gap !== undefined) hit.m.gap = clampNum(msg.gap, 0, GAP_MAX, hit.m.gap);
    try { await saveSlide(hit.dir, hit.m); } catch { return sendJson(res, { ok: false, error: '写 manifest 失败' }); }
    return sendJson(res, {
      ok: true,
      animation: {
        id: hit.m.id, title: hit.m.title, files: hit.m.files,
        hold: hit.m.hold, fade: hit.m.fade, gap: hit.m.gap, duration: hit.m.duration
      }
    });
  }

  // 导入一个素材：请求体就是文件原始字节，流式落盘（绕开 config 路由的 64KB JSON 上限）
  async function importHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' });
    const q = queryOf(req.url);
    const cfg = normalize(await readConfig(), (await listAnimations()).map((a) => a.id));
    const maxOne = cfg.maxSlideMB * 1024 * 1024;
    const rawName = path.basename(String(q.get('name') || ''));
    const det = detectKind(rawName);
    if (!det) return sendJson(res, { ok: false, error: '不支持的文件类型（收 mp4 / webm / ogv / png / jpg / webp / gif）' });
    const title = String(q.get('title') || rawName.replace(/\.[^.]+$/, '') || '导入的动画').slice(0, 60);
    const wantDur = Number(q.get('duration'));
    const duration = det.kind === 'image'
      ? IMAGE_HOLD
      : (Number.isFinite(wantDur) && wantDur > 0 ? Math.round(wantDur * 100) / 100 : 0);

    const base = slugify(title);
    const taken = new Set((await listAnimations()).map((a) => a.id));
    let id = base;
    for (let i = 2; taken.has(id) && i < 1000; i++) id = base.slice(0, 28) + '-' + i;
    if (taken.has(id)) id = base.slice(0, 24) + '-' + Date.now();

    const dir = path.join(userAnimDir(), id);
    const fileName = (det.kind === 'video' ? 'video.' : 'image.') + det.ext;
    const finalPath = path.join(dir, fileName);
    const tmpPath = finalPath + '.part';

    try { await mkdir(dir, { recursive: true }); } catch { return sendJson(res, { ok: false, error: '建目录失败' }); }

    let received = 0;
    let failed = null;
    const ws = createWriteStream(tmpPath);
    try {
      for await (const chunk of req) {
        received += chunk.length;
        if (received > maxOne) { failed = '文件超过 ' + cfg.maxSlideMB + 'MB 上限（可在设置里调）'; break; }
        if (!ws.write(chunk)) { try { await once(ws, 'drain'); } catch { failed = '写入中断'; break; } }
      }
      if (!failed) {
        ws.end();
        try { await once(ws, 'finish'); } catch { failed = '写入失败'; }
      }
    } catch {
      failed = failed || '写入失败';
    }
    if (!failed && received === 0) failed = '没有收到文件内容';

    if (failed) {
      try { ws.destroy(); } catch {}
      try { await rm(dir, { recursive: true, force: true }); } catch {}
      try { req.destroy(); } catch {}
      return sendJson(res, { ok: false, error: failed });
    }

    try {
      await rename(tmpPath, finalPath);
      const manifest = { id: id, title: title, duration: duration, kind: det.kind, file: fileName, importedAt: new Date().toISOString() };
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      const anim = { id: id, title: title, duration: duration, kind: det.kind, file: fileName, source: 'user' };
      return sendJson(res, { ok: true, animation: anim, src: mediaUrl(anim) });
    } catch {
      try { await rm(dir, { recursive: true, force: true }); } catch {}
      return sendJson(res, { ok: false, error: '落盘失败' });
    }
  }

  // 删除一个用户导入的动画（内置素材一律不许删）
  async function deleteHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' });
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) break;
      }
    } catch {}
    let msg = null;
    try { msg = JSON.parse(body || '{}'); } catch {}
    const id = msg && typeof msg.id === 'string' ? msg.id : '';
    if (!ID_RE.test(id)) return sendJson(res, { ok: false, error: 'bad id' });
    if ((await scanDir(ANIM_DIR, 'builtin')).some((a) => a.id === id)) {
      return sendJson(res, { ok: false, error: '内置动画不能删除' });
    }
    const dir = path.join(userAnimDir(), id);
    if (path.dirname(dir) !== userAnimDir()) return sendJson(res, { ok: false, error: 'bad path' });
    if (!existsSync(dir)) return sendJson(res, { ok: false, error: '动画不存在' });
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      return sendJson(res, { ok: false, error: '删除失败' });
    }
    // 删掉的正好是当前所选 → 让配置回落到仍然存在的动画
    const anims = await listAnimations();
    const knownIds = anims.map((a) => a.id);
    const prev = await readConfig();
    const cfg = normalize(prev, knownIds);
    if (!prev || prev.animation !== cfg.animation) {
      try { await writeConfig(cfg); } catch {}
    }
    return sendJson(res, { ok: true, animations: anims, config: cfg });
  }

  const disposers = [];
  const reg = (spec) => {
    try {
      const d = webServer.register(spec);
      if (typeof d === 'function') disposers.push(d);
    } catch {}
  };

  reg({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.css',
    handler: guard(async (req, res) => {
      sendText(res, 200, 'text/css; charset=utf-8', await readFile(path.join(LIB_DIR, 'splash.css'), 'utf8'));
    })
  });
  reg({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.js',
    handler: guard(async (req, res) => {
      sendText(res, 200, 'text/javascript; charset=utf-8', await readFile(path.join(LIB_DIR, 'splash.js'), 'utf8'));
    })
  });
  reg({
    kind: 'exact',
    path: ROUTE_BASE + '/animations',
    handler: guard(async (req, res) => {
      const { list, issues } = await inspectAnimations();
      sendJson(res, { ok: true, version: VERSION, animations: list, issues: issues });
    })
  });
  reg({
    kind: 'exact',
    path: ROUTE_BASE + '/import',
    handler: guard(importHandler)
  });
  reg({ kind: 'exact', path: ROUTE_BASE + '/import/slides', handler: guard(slidesCreateHandler) });
  reg({ kind: 'exact', path: ROUTE_BASE + '/import/slides/item', handler: guard(slidesItemHandler) });
  reg({ kind: 'exact', path: ROUTE_BASE + '/import/slides/order', handler: guard(slidesOrderHandler) });
  reg({ kind: 'exact', path: ROUTE_BASE + '/import/slides/meta', handler: guard(slidesMetaHandler) });
  reg({
    kind: 'exact',
    path: ROUTE_BASE + '/animations/delete',
    handler: guard(deleteHandler)
  });
  reg({
    kind: 'prefix',
    path: ROUTE_BASE + '/media',
    handler: guard(async (req, res) => {
      const raw = String(req.url || '').split('?')[0];
      let rel;
      try { rel = decodeURIComponent(raw); } catch { rel = raw; }
      // webServer 对带尾斜杠的 prefix 不匹配（实机 404 实锤），故注册无尾斜杠；
      // url 可能是完整路径或前缀内剩余路径，两种形态都兼容解析
      const full = ROUTE_BASE + '/media/';
      if (rel.startsWith(full)) rel = rel.slice(full.length);
      else if (rel.startsWith('/media/')) rel = rel.slice('/media/'.length);
      else if (rel.startsWith('media/')) rel = rel.slice('media/'.length);
      const parts = rel.split('/').filter(Boolean);
      return mediaHandler(req, res, parts[0], parts[1]);
    })
  });
  reg({
    kind: 'exact',
    path: ROUTE_BASE + '/config',
    handler: guard(async (req, res) => {
      const anims = await listAnimations();
      const knownIds = anims.map((a) => a.id);
      if (req.method === 'POST') {
        let body = '';
        try {
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 65536) break;
          }
        } catch {}
        let msg = null;
        try { msg = JSON.parse(body || '{}'); } catch {}
        if (msg && msg.action === 'reset') {
          const cfg = normalize({}, knownIds);
          await writeConfig(cfg);
          return sendJson(res, { ok: true, config: cfg, defaults: DEFAULTS });
        }
        if (msg && msg.patch && typeof msg.patch === 'object') {
          const merged = normalize({ ...(await readConfig()), ...msg.patch }, knownIds);
          await writeConfig(merged);
          return sendJson(res, { ok: true, config: merged });
        }
        return sendJson(res, { ok: false, error: 'bad request' });
      }
      const cfg = normalize(await readConfig(), knownIds);
      const sel = anims.find((a) => a.id === cfg.animation);
      const inspected = await inspectAnimations();
      sendJson(res, {
        ok: true,
        version: VERSION,
        config: cfg,
        defaults: DEFAULTS,
        animations: inspected.list,
        issues: inspected.issues,
        duration: sel ? sel.duration : 0,
        kind: sel ? sel.kind : 'video',
        mediaFile: sel ? sel.file : '',
        files: sel && Array.isArray(sel.files) ? sel.files : [],
        slide: !!(sel && sel.slide),
        hold: sel ? sel.hold : null,
        fade: sel ? sel.fade : null,
        gap: sel ? sel.gap : null,
        imageHold: cfg.imageHold,
        src: mediaUrl(sel),
        file: configPath()
      });
    })
  });

  // index.html 启动注入（冷启动 splash 的入口）
  if (typeof webServer.tapIndex === 'function') {
    const anims = await listAnimations();
    const knownIds = anims.map((a) => a.id);
    const bootCfg = normalize(await readConfig(), knownIds);
    /* 随机开关：只在启动这一刻掷骰子，不动配置里老大选定的那个 */
    const sel = pickAnimation(anims, bootCfg);
    if (sel) bootCfg.animation = sel.id;
    bootCfg.duration = sel ? sel.duration : 0;
    bootCfg.kind = sel ? sel.kind : 'video';
    bootCfg.mediaFile = sel ? sel.file : '';
    bootCfg.files = sel && Array.isArray(sel.files) ? sel.files : [];
    bootCfg.slide = !!(sel && sel.slide);
    bootCfg.hold = sel ? sel.hold : null;
    bootCfg.fade = sel ? sel.fade : null;
    bootCfg.gap = sel ? sel.gap : null;
    bootCfg.src = mediaUrl(sel);
    bootCfg.version = VERSION;
    /* 一件素材都没有（全新安装、仓库本来就不带素材）：整段不启用——
       不建黑幕、不注入播放器，页面照常启动，使用者去设置里导入自己的素材。 */
    if (!sel) bootCfg.enabled = false;

    webServer.tapIndex((html) => {
      if (typeof html !== 'string' || !html.includes('</head>') || !html.includes('</body>')) return html;
      if (html.includes(ROUTE_BASE + '/splash.js')) return html; // 防重注入
      const headHtml =
        '<link rel="stylesheet" href="' + ROUTE_BASE + '/splash.css?v=' + VERSION + '" />' +
        '<style id="dsh-op-splash-critical">' + CRITICAL_CSS + '</style>';
      const bodyHtml =
        '<div id="' + ROOT_ID + '" class="dos-root dos-boot"></div>' +
        '<script>window.__DSH_OP_SPLASH_BOOT__=\'index\';' +
        'window.__DSH_OP_SPLASH_VERSION__=\'' + VERSION + '\';' +
        'window.__DSH_OP_SPLASH__=' + JSON.stringify(bootCfg) + ';' +
        BOOTSTRAP_JS +
        '</script>' +
        '<script defer src="' + ROUTE_BASE + '/splash.js?v=' + VERSION + '"></script>';
      return html
        .replace('</head>', headHtml + '</head>')
        .replace('</body>', bodyHtml + '</body>');
    });
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const d of disposers) {
        try { d(); } catch {}
      }
    });
  }
}

// 仅供测试使用的探针（loader 只认 name/inject/apply，多导出成员无副作用）
export const __test__ = {
  clampNum,
  clampInt,
  TRANSITIONS,
  WEEKDAYS,
  listAnimations,
  inspectAnimations,
  inspectDir,
  mediaUrl,
  resolveMedia,
  slugify,
  detectKind,
  scanDir,
  normalize,
  normalizeSchedules,
  pickAnimation,
  randomPick,
  matchSchedule,
  inWindow,
  timeToMinutes,
  weightOf,
  imageHoldSeconds,
  ANIM_DIR,
  userAnimDir,
  MIME_BY_EXT,
  DEFAULTS
};