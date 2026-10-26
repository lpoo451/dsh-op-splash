// dsh-op-splash — 浏览器半侧（设置页「开场动画」）
// ----------------------------------------------------------------------------
// ModuleLoader bundle 契约（手写 bundle，无需构建；与参考实现同款）：
//   1. 注册 id 必须等于 loader entry 名（dsh-op-splash），否则报
//      "loaded without registering dsh-op-splash"。
//   2. factory 产物必须是 Module 形状：Symbol.toStringTag='Module'，
//      并导出 apply 与 inject=['slots'] —— 缺 inject 时激活链无法闭合，
//      entry 会永远停在 loading（web boot 直接判死）。
//   3. factory 加载期零副作用：自举（selfBoot）只能由 apply() 发起。
//   4. ctx.slots.inject 的回调必须 return ctx.slots.register(...) 的句柄，
//      否则框架拿不到 dispose 句柄，激活流程同样无法完成。
// 配置数据不走 settings 命名空间，走 Host 半侧自带的 HTTP API
// （GET/POST /dsh-op-splash/config，导入/删除另走 /import 与 /animations/delete）。
window.__ModuleLoader__.load({
  id: 'dsh-op-splash',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var ROUTE = '/dsh-op-splash'
    var VERSION = '1.4.1'
    var DEFAULT_CFG = { enabled: true, mode: 'session', animation: '', volume: 0.8, random: false, imageHoldMode: '5', imageHoldCustom: 5 }
    var ACCEPT = 'video/mp4,video/webm,video/ogg,image/png,image/jpeg,image/webp,image/gif'

    /* ── 存储小工具（隐私模式等场景下可能抛错） ──────────────────────────── */
    function readFlag(kind, key) {
      try {
        return (kind === 'session' ? window.sessionStorage : window.localStorage).getItem(key)
      } catch (e) { return null }
    }
    function writeFlag(kind, key, val) {
      try {
        (kind === 'session' ? window.sessionStorage : window.localStorage).setItem(key, val)
      } catch (e) { /* 写不进就算了 */ }
    }

    /* ── 资源装载 ───────────────────────────────────────────────────────── */
    /** 挂一个 <script src>；失败时调 fail(err)。 */
    function loadScript(src, fail) {
      var s = document.createElement('script')
      s.src = src
      s.async = false
      if (typeof fail === 'function') {
        s.addEventListener('load', function () { fail(null) })
        s.addEventListener('error', function () { fail(new Error('script load failed: ' + src)) })
      }
      ;(document.head || document.documentElement).appendChild(s)
    }

    /** 挂一份 <link rel=stylesheet>；失败时调 fail(err)。 */
    function loadCss(href, fail) {
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      if (typeof fail === 'function') {
        link.addEventListener('load', function () { fail(null) })
        link.addEventListener('error', function () { fail(new Error('css load failed: ' + href)) })
      }
      ;(document.head || document.documentElement).appendChild(link)
    }

    /** 移除根节点、解开滚动锁定 —— 自举任何一步失败都要把页面还回去。 */
    function release(ok) {
      if (ok) return
      try {
        var r = document.getElementById('dsh-op-splash-root')
        if (r && r.parentNode) r.parentNode.removeChild(r)
        if (document.documentElement.classList) document.documentElement.classList.remove('dos-lock')
        if (document.body && document.body.style) document.body.style.overflow = ''
        window.__DSH_OP_SPLASH_FAILED__ = true
      } catch (e) { /* 兜底不再抛 */ }
    }

    /** 握手标记：本侧已接管自举（Host 走 index 注入时打的是 'index'）。 */
    function markBooted() {
      window.__DSH_OP_SPLASH_BOOT__ = 'client'
    }

    function injectRoot(cfg) {
      var root = document.getElementById('dsh-op-splash-root')
      if (!root) {
        root = document.createElement('div')
        root.id = 'dsh-op-splash-root'
        document.body.appendChild(root)
      }
      root.className = 'dos-root dos-boot'
      if (document.documentElement.classList) document.documentElement.classList.add('dos-lock')
      if (document.body && document.body.style) document.body.style.overflow = 'hidden'

      var failed = false
      var cssReady = false
      var scriptReady = false
      function guard(err) {
        if (err) {
          if (!failed && typeof console !== 'undefined' && console.warn) {
            console.warn('[dsh-op-splash] 开场动画自举失败，已放开页面：', err.message)
          }
          failed = true
          release(false)
          return
        }
        if (cssReady && scriptReady) release(true)
      }

      /* 样式与运行时都从 Host 路由取 —— 同一份文件，不额外维护内联副本 */
      loadCss(ROUTE + '/splash.css', function (err) {
        if (err) { guard(err); return }
        cssReady = true
        guard(null)
      })

      /* 配置先落 window：splash.js 载入时直接读它 */
      window.__DSH_OP_SPLASH__ = cfg || {}

      loadScript(ROUTE + '/splash.js?t=' + Date.now(), function (err) {
        if (err) { guard(err); return }
        scriptReady = true
        guard(null)
      })

      /* 自愈：样式与脚本都拿到了、dos-boot 标记还在，说明动画没接管，放行。
         播放器 API 已暴露（splash.js 正常接管）时绝不误杀正在播放的画面。 */
      window.setTimeout(function () {
        try {
          var r = document.getElementById('dsh-op-splash-root')
          var api = window.__DSH_OP_SPLASH_API__
          if (r && r.className && r.className.indexOf('dos-boot') !== -1 && !(api && api.replay)) release(false)
        } catch (e) { /* 兜底不再抛 */ }
      }, 9000)
    }

    /* ── 面板控件 ───────────────────────────────────────────────────────── */
    function Row(props) {
      return h('div', { style: { marginBottom: '14px' } },
        h('div', { style: { fontSize: '12px', opacity: 0.72, marginBottom: '6px' } }, props.label),
        props.children,
        props.hint
          ? h('div', { style: { fontSize: '11px', opacity: 0.5, marginTop: '4px' } }, props.hint)
          : null
      );
    }
    function Check(props) {
      return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
        h('input', {
          type: 'checkbox',
          checked: !!props.value,
          onChange: function (e) { props.onChange(e.target.checked); }
        }),
        h('span', null, props.label)
      );
    }
    function Select(props) {
      return h('select', {
        value: props.value,
        onChange: function (e) { props.onChange(e.target.value); },
        style: props.style || { width: '100%', maxWidth: '420px', padding: '6px 8px' }
      }, props.options.map(function (o) {
        return h('option', { key: o.value, value: o.value }, o.label);
      }));
    }
    function Range(props) {
      var pct = Math.round(props.value * 100) + '%';
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.05,
          value: props.value,
          onChange: function (e) { props.onChange(Number(e.target.value)); },
          style: { flex: '1', maxWidth: '360px' }
        }),
        h('span', { style: { fontSize: '12px', opacity: 0.7, minWidth: '42px' } }, pct)
      );
    }
    /** 数字输入：本地暂存，失焦或回车才提交（避免每敲一下都写一次配置）。 */
    function NumberInput(props) {
      var st = react.useState(String(props.value));
      function commit() {
        var n = Number(st[0]);
        if (!isFinite(n)) n = props.value;
        n = Math.max(1, Math.min(600, Math.round(n)));
        st[1](String(n));
        props.onCommit(n);
      }
      return h('input', {
        type: 'number', min: 1, max: 600,
        value: st[0],
        onChange: function (e) { st[1](e.target.value); },
        onBlur: commit,
        onKeyDown: function (e) { if (e.key === 'Enter') commit(); },
        style: { width: '84px', padding: '5px 8px' }
      });
    }
    /** 文本输入：本地暂存，失焦或回车才提交；提交前裁到 40 字（空 = 回默认文案）。 */
    function TextInput(props) {
      var st = react.useState(String(props.value == null ? '' : props.value));
      function commit() {
        var v = String(st[0] || '').trim().slice(0, 40);
        st[1](v);
        props.onCommit(v);
      }
      return h('input', {
        type: 'text', maxLength: 40,
        value: st[0],
        onChange: function (e) { st[1](e.target.value); },
        onBlur: commit,
        onKeyDown: function (e) { if (e.key === 'Enter') commit(); },
        style: { width: '260px', padding: '5px 8px' }
      });
    }

    /** 体积显示：B / KB / MB 自适应（素材清单用）。 */
    function fmtSize(n) {
      var b = Number(n);
      if (!isFinite(b) || b <= 0) return '—';
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(2) + ' MB';
    }

    /** 图片停留秒数：优先用 Host 算好的 imageHold；没有就按选项本地推一份（0 = 一直停）。 */
    function imageHoldOf(cfg) {
      if (!cfg) return 5
      if (typeof cfg.imageHold === 'number') return cfg.imageHold
      if (cfg.imageHoldMode === 'forever') return 0
      if (cfg.imageHoldMode === 'custom') {
        var n = Number(cfg.imageHoldCustom)
        return isFinite(n) && n > 0 ? Math.max(1, Math.min(600, Math.round(n))) : 5
      }
      var m = Number(cfg.imageHoldMode)
      return isFinite(m) && m > 0 ? m : 5
    }

    /* ── 挑这一趟播哪个（与 Host 侧同规则：时段 → 随机池权重 → 选定） ──────
       自举场景下拿不到 Host 挑好的结果，所以这里必须自己算一份等价的。 */
    var WEEKDAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] /* 与 Host 同表：getDay() 里 0 = 周日 */
    function tm(s) {
      var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || ''))
      return m ? Number(m[1]) * 60 + Number(m[2]) : null
    }
    function inWindow(now, from, to) {
      if (from === to) return false
      return from < to ? (now >= from && now < to) : (now >= from || now < to)
    }
    function weightOf(weights, id) {
      if (!weights || typeof weights !== 'object') return 1
      if (!Object.prototype.hasOwnProperty.call(weights, id)) return 1
      var n = Number(weights[id])
      return isFinite(n) && n > 0 ? Math.min(99, n) : 0
    }
    function pickFrom(list, cfg) {
      if (!list || !list.length) return null
      var cfgSafe = cfg || {}
      var sched = cfgSafe.schedules || []
      if (sched.length) {
        var now = new Date()
        var nowMin = now.getHours() * 60 + now.getMinutes()
        for (var i = 0; i < sched.length; i++) {
          /* 星期照「现在这一刻」算（与 Host 同口径）：周日凌晨算周日 */
          var wd = sched[i].weekdays || []
          if (wd.length && wd.indexOf(WEEKDAY_KEYS[(now.getDay() + 6) % 7]) === -1) continue
          var f = tm(sched[i].from)
          var t = tm(sched[i].to)
          if (f == null || t == null || !inWindow(nowMin, f, t)) continue
          for (var j = 0; j < list.length; j++) if (list[j].id === sched[i].animation) return list[j]
        }
      }
      if (cfgSafe.random === true) {
        var pool = cfgSafe.randomPool || []
        var cands = pool.length
          ? list.filter(function (a) { return pool.indexOf(a.id) !== -1 })
          : list.slice()
        if (!cands.length) cands = list.slice()               /* 池子被勾空 → 回退全库 */
        var scored = cands.filter(function (a) { return weightOf(cfgSafe.weights, a.id) > 0 })
        if (!scored.length) return cands[Math.floor(Math.random() * cands.length)]
        var total = 0
        for (var k = 0; k < scored.length; k++) total += weightOf(cfgSafe.weights, scored[k].id)
        var r = Math.random() * total
        for (var q = 0; q < scored.length; q++) {
          r -= weightOf(cfgSafe.weights, scored[q].id)
          if (r <= 0) return scored[q]
        }
        return scored[scored.length - 1]
      }
      for (var z = 0; z < list.length; z++) if (list[z].id === cfgSafe.animation) return list[z]
      /* 选定项不存在（全新安装、素材被删）→ 回落到清单第一件，与 Host 的 normalize 同规则 */
      return list[0]
    }

    /* ── 导入素材：读时长 → 流式上传（带进度） ──────────────────────────── */
    /** 用 <video> 预读真实时长（图片不适用，直接回 0 由 Host 用默认停留时间）。 */
    function probeDuration(file, cb) {
      if (!file || !/^video\//.test(file.type || '')) return cb(0)
      try {
        var url = URL.createObjectURL(file)
        var v = document.createElement('video')
        var done = false
        function fin(d) {
          if (done) return
          done = true
          try { URL.revokeObjectURL(url) } catch (e) {}
          cb(typeof d === 'number' && isFinite(d) && d > 0 ? d : 0)
        }
        v.preload = 'metadata'
        v.onloadedmetadata = function () { fin(v.duration) }
        v.onerror = function () { fin(0) }
        window.setTimeout(function () { fin(0) }, 8000)
        v.src = url
      } catch (e) { cb(0) }
    }

    function uploadFile(file, duration, onPct, onDone) {
      var xhr = new XMLHttpRequest()
      var title = String(file.name || '').replace(/\.[^.]+$/, '')
      var qs = '?name=' + encodeURIComponent(file.name || '') +
        '&title=' + encodeURIComponent(title) +
        '&duration=' + encodeURIComponent(String(duration || 0))
      xhr.open('POST', ROUTE + '/import' + qs)
      xhr.setRequestHeader('content-type', 'application/octet-stream')
      if (xhr.upload && xhr.upload.onprogress !== undefined) {
        xhr.upload.onprogress = function (e) {
          if (e && e.lengthComputable && e.total) onPct(Math.round((e.loaded / e.total) * 100))
        }
      }
      xhr.onload = function () {
        var j = null
        try { j = JSON.parse(xhr.responseText) } catch (e) {}
        if (j && j.ok) return onDone(null, j)
        onDone(new Error((j && j.error) || ('HTTP ' + xhr.status)))
      }
      xhr.onerror = function () { onDone(new Error('网络错误')) }
      xhr.send(file)
    }

    function Panel() {
      var st = react.useState({ cfg: null, animations: [], issues: [], saving: false, msg: '', importing: null, showSchedules: false, slideEdit: null, slideName: '', showAdvanced: false });
      var cfg = st[0].cfg, animations = st[0].animations, issues = st[0].issues,
        saving = st[0].saving, msg = st[0].msg, importing = st[0].importing, showSchedules = st[0].showSchedules;
      var setSt = st[1];

      function reload(after) {
        fetch(ROUTE + '/config')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !data.ok) return;
            setSt(function (s) { return { ...s, cfg: data.config, animations: data.animations || [], issues: data.issues || [] }; });
            if (typeof after === 'function') after(data.animations || []);
          })
          .catch(function () {});
      }

      react.useEffect(function () {
        var alive = true;
        fetch(ROUTE + '/config')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!alive || !data || !data.ok) return;
            setSt(function (s) { return { ...s, cfg: data.config, animations: data.animations || [], issues: data.issues || [] }; });
          })
          .catch(function () {});
        return function () { alive = false; };
      }, []);

      function save(patch, done) {
        setSt(function (s) { return { ...s, saving: true, msg: '' }; });
        fetch(ROUTE + '/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch: patch })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.ok) {
              setSt(function (s) { return { ...s, cfg: data.config, saving: false, msg: '已保存（冷启动生效）' }; });
              if (typeof done === 'function') done(null, data);
            } else {
              setSt(function (s) { return { ...s, saving: false, msg: '保存失败' }; });
              if (typeof done === 'function') done(new Error('保存失败'));
            }
          })
          .catch(function () {
            setSt(function (s) { return { ...s, saving: false, msg: '保存失败' }; });
            if (typeof done === 'function') done(new Error('保存失败'));
          });
      }

      function preview() {
        fetch(ROUTE + '/config')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !data.ok) return;
            window.__DSH_OP_SPLASH__ = {
              enabled: true,
              animation: data.config.animation,
              mode: 'always',
              volume: data.config.volume,
              duration: data.duration || 7,
              kind: data.kind || 'video',
              mediaFile: data.mediaFile || '',
              files: data.files || [],
              slide: !!data.slide,
              hold: data.hold,
              fade: data.fade,
              gap: data.gap,
              transition: (data.config && data.config.transition) || 'fade',
              imageHold: typeof data.imageHold === 'number' ? data.imageHold : imageHoldOf(data.config),
              hintMode: (data.config && data.config.hintMode) || 'bottom',
              hintText: (data.config && data.config.hintText) || '点击跳过',
              src: data.src || (ROUTE + '/media/' + data.config.animation + '/' + (data.mediaFile || 'video.mp4')),
              version: data.version || 'preview'
            };
            loadCss(ROUTE + '/splash.css?v=preview');
            if (window.__DSH_OP_SPLASH_API__ && window.__DSH_OP_SPLASH_API__.replay) {
              window.__DSH_OP_SPLASH_API__.replay();
            } else {
              loadScript(ROUTE + '/splash.js?v=preview');
            }
          })
          .catch(function () {});
      }

      /* 随机范围与权重：空数组 = 全库参与；权重 0 = 不参与 */
      function weightText(id) {
        var w = (cfg && cfg.weights) || {};
        return Object.prototype.hasOwnProperty.call(w, id) ? String(w[id]) : '';
      }
      function setWeight(id, raw) {
        var w = Object.assign({}, (cfg && cfg.weights) || {});
        var s = String(raw == null ? '' : raw).trim();
        var n = Number(s);
        if (!s || !isFinite(n)) delete w[id];
        else w[id] = Math.max(0, Math.min(99, Math.round(n)));
        save({ weights: w });
      }
      function togglePool(id, on) {
        var all = animations.map(function (a) { return a.id; });
        var cur = (cfg.randomPool || []).slice();
        var effective = cur.length ? cur : all.slice();
        var next = effective.slice();
        if (on) { if (next.indexOf(id) === -1) next.push(id); }
        else next = next.filter(function (x) { return x !== id; });
        next = all.filter(function (x) { return next.indexOf(x) !== -1; });
        if (next.length === all.length) next = [];   /* 全选 = 空 = 全库，语义一致 */
        save({ randomPool: next });
      }

      /* 时段场景：列表顺序 = 优先级，第一条命中的时段说了算 */
      function setSchedule(i, patch) {
        var list = (cfg.schedules || []).map(function (s, k) { return k === i ? Object.assign({}, s, patch) : s; });
        save({ schedules: list });
      }
      function addSchedule() {
        var first = cfg.animation || (animations[0] && animations[0].id) || '';
        setSt(function (s) { return { ...s, showSchedules: true }; });
        save({ schedules: (cfg.schedules || []).concat([{ from: '18:00', to: '22:00', animation: first }]) });
      }
      function removeSchedule(i) {
        save({ schedules: (cfg.schedules || []).filter(function (s, k) { return k !== i; }) });
      }

      /** 选文件：临时建一个隐藏 input，选完即摘（不依赖 useRef，兼容无 ref 的运行时）。 */
      function pickFile() {
        try {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = ACCEPT;
          input.style.display = 'none';
          document.body.appendChild(input);
          input.addEventListener('change', function () {
            var f = input.files && input.files[0];
            try { document.body.removeChild(input); } catch (e) {}
            if (f) importFile(f);
          });
          input.click();
        } catch (e) { /* 环境不支持就静默 */ }
      }

      function importFile(file) {
        setSt(function (s) { return { ...s, importing: { name: file.name, pct: 0 }, msg: '' }; });
        probeDuration(file, function (dur) {
          uploadFile(file, dur, function (pct) {
            setSt(function (s) { return { ...s, importing: { name: file.name, pct: pct } }; });
          }, function (err, data) {
            if (err) {
              setSt(function (s) { return { ...s, importing: null, msg: '导入失败：' + err.message }; });
              return;
            }
            var anim = data && data.animation;
            setSt(function (s) { return { ...s, importing: null, msg: '已导入：' + ((anim && anim.title) || file.name) }; });
            reload(function () { if (anim) save({ animation: anim.id }); });
          });
        });
      }

      function removeAnim(id, title) {
        var ok = true;
        try {
          if (typeof window.confirm === 'function') ok = window.confirm('删除「' + title + '」？这个素材会从磁盘移除。');
        } catch (e) {}
        if (!ok) return;
        setSt(function (s) { return { ...s, msg: '正在删除…' }; });
        fetch(ROUTE + '/animations/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !data.ok) {
              setSt(function (s) { return { ...s, msg: '删除失败：' + ((data && data.error) || '未知错误') }; });
              return;
            }
            setSt(function (s) { return { ...s, cfg: data.config, animations: data.animations || [], msg: '已删除' }; });
          })
          .catch(function () { setSt(function (s) { return { ...s, msg: '删除失败' }; }); });
      }

      /* ── 幻灯片：一次选多张图，先建条目，再逐张上传（每张都能看到进度） ──── */
      function pickSlides() {
        try {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
          input.multiple = true;
          input.style.display = 'none';
          document.body.appendChild(input);
          input.addEventListener('change', function () {
            var fs = Array.prototype.slice.call(input.files || []);
            try { document.body.removeChild(input); } catch (e) {}
            if (fs.length) importSlides(fs);
          });
          input.click();
        } catch (e) { /* 环境不支持就静默 */ }
      }

      function uploadSlideItem(slideId, file, onPct, onDone) {
        var xhr = new XMLHttpRequest();
        var qs = '?id=' + encodeURIComponent(slideId) + '&name=' + encodeURIComponent(file.name || '');
        xhr.open('POST', ROUTE + '/import/slides/item' + qs);
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        if (xhr.upload && xhr.upload.onprogress !== undefined) {
          xhr.upload.onprogress = function (e) {
            if (e && e.lengthComputable && e.total) onPct(Math.round((e.loaded / e.total) * 100));
          };
        }
        xhr.onload = function () {
          var j = null;
          try { j = JSON.parse(xhr.responseText) } catch (e) {}
          if (j && j.ok) return onDone(null, j);
          onDone(new Error((j && j.error) || ('HTTP ' + xhr.status)));
        };
        xhr.onerror = function () { onDone(new Error('网络错误')) };
        xhr.send(file);
      }

      function importSlides(files) {
        var title = String((files[0] && files[0].name) || '').replace(/\.[^.]+$/, '') || '我的幻灯片';
        setSt(function (s) { return { ...s, slideName: '正在新建…', msg: '' }; });
        fetch(ROUTE + '/import/slides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: title })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !data.ok) throw new Error((data && data.error) || '新建失败');
            var id = data.id;
            var k = 0;
            function next() {
              if (k >= files.length) {
                setSt(function (s) { return { ...s, slideName: '', msg: '已导入 ' + files.length + ' 张' }; });
                reload(function () {
                  save({ animation: id });
                  setSt(function (s) { return { ...s, slideEdit: id }; });
                });
                return;
              }
              var f = files[k];
              uploadSlideItem(id, f, function (pct) {
                setSt(function (s) { return { ...s, slideName: '第 ' + (k + 1) + '/' + files.length + ' 张 ' + pct + '%' }; });
              }, function (err) {
                if (err) {
                  setSt(function (s) { return { ...s, slideName: '', msg: '第 ' + (k + 1) + ' 张失败：' + err.message }; });
                  reload();
                  return;
                }
                k++;
                next();
              });
            }
            next();
          })
          .catch(function (e) {
            setSt(function (s) { return { ...s, slideName: '', msg: '导入失败：' + ((e && e.message) || '未知错误') }; });
          });
      }

      /** 调顺序：files 数组就是播放顺序，把第 idx 张和相邻一张换位。 */
      function slideOrder(a, idx, delta) {
        var files = (a.files || []).slice();
        var j = idx + delta;
        if (idx < 0 || j < 0 || j >= files.length) return;
        var t = files[idx]; files[idx] = files[j]; files[j] = t;
        setSt(function (s) { return { ...s, msg: '正在调整顺序…' }; });
        fetch(ROUTE + '/import/slides/order', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: a.id, files: files })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !data.ok) { setSt(function (s) { return { ...s, msg: '调序失败：' + ((data && data.error) || '未知错误') }; }); return; }
            setSt(function (s) { return { ...s, msg: '顺序已更新（冷启动生效）' }; });
            reload();
          })
          .catch(function () { setSt(function (s) { return { ...s, msg: '调序失败' }; }); });
      }

      /** 改幻灯片的三个时间（每张停留 / 过渡 / 间隔）。 */
      function slideMeta(id, patch) {
        fetch(ROUTE + '/import/slides/meta', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ id: id }, patch))
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !data.ok) { setSt(function (s) { return { ...s, msg: '保存失败：' + ((data && data.error) || '未知错误') }; }); return; }
            setSt(function (s) { return { ...s, msg: '幻灯片设置已保存（冷启动生效）' }; });
            reload();
          })
          .catch(function () { setSt(function (s) { return { ...s, msg: '保存失败' }; }); });
      }

      /* 版本行：任何状态下都要能渲染（配置还没到时面板只有它 + 加载提示） */
      var versionRow = h('div', { className: '__os_version' },
        '版本 v' + (window.__DSH_OP_SPLASH_VERSION__ || VERSION));

      if (!cfg) {
        return h('div', { style: { padding: '8px 0' } },
          versionRow,
          h('div', { style: { padding: '4px 0', opacity: 0.6, fontSize: '12px' } }, '正在加载开场动画设置…'));
      }
      var animOptions = animations.length
        ? animations.map(function (a) { return { value: a.id, label: a.title }; })
        : [{ value: '', label: '（还没有素材 —— 点下面「导入动画 / 图片」加一个）' }];
      var mine = animations.filter(function (a) { return a.source === 'user'; });

      return h('div', { style: { padding: '4px 0' } },
        versionRow,
        h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '12px' } }, '视频开场动画（dsh-op-splash）'),
        h(Row, { label: '启用' },
          h(Check, {
            value: cfg.enabled,
            label: cfg.enabled ? '已启用（冷启动播放所选动画）' : '已关闭',
            onChange: function (v) { save({ enabled: v }); }
          })
        ),
        h(Row, { label: '动画选择', hint: '内置动画随插件提供；自己导入的会出现在下面的「我的动画」里' },
          h(Select, {
            value: cfg.animation,
            options: animOptions,
            onChange: function (v) { save({ animation: v }); }
          })
        ),
        h(Row, { label: '素材清单', hint: '体积取自素材文件本身；「未上架」的条目不会出现在上面的选择器里，也选不中' },
          h('div', {
            style: {
              maxHeight: '190px', overflowY: 'auto',
              border: '1px solid rgba(128,128,128,0.28)', borderRadius: '6px', padding: '6px 9px'
            }
          },
            animations.map(function (a) {
              return h('div', { key: a.id, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '3px 0', fontSize: '12px' } },
                h('span', { style: { opacity: 0.85, minWidth: '110px' } }, a.title),
                h('span', { style: { opacity: 0.5 } }, a.kind === 'image' ? '图片' : '视频'),
                h('span', { style: { opacity: 0.5 } }, a.duration ? a.duration + 's' : (a.kind === 'image' ? '不限时' : '时长未知')),
                h('span', { style: { opacity: 0.5 } }, fmtSize(a.size)),
                h('span', { style: { opacity: 0.4 } }, a.source === 'user' ? '我的' : '内置'),
                cfg.animation === a.id ? h('span', { style: { opacity: 0.5 } }, '· 当前') : null
              );
            }),
            issues.map(function (it, i) {
              return h('div', { key: 'iss' + i, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '3px 0', fontSize: '11.5px' } },
                h('span', { style: { opacity: 0.75, color: '#c98a5e', minWidth: '46px' } }, '未上架'),
                h('span', { style: { opacity: 0.7, minWidth: '110px' } }, it.title || it.id),
                h('span', { style: { opacity: 0.6 } },
                  it.reason === 'missing-file' ? '素材文件缺失（' + (it.file || '?') + '）'
                    : it.reason === 'no-manifest' ? '缺 manifest.json'
                      : 'manifest.json 读不出来')
              );
            })
          )
        ),
        h(Row, { label: '我的动画', hint: '视频保留原声；图片默认停留 5 秒；幻灯片按顺序一张张放。素材存在 ~/.dsh/dsh-op-splash-animations/' },
          h('div', null,
            mine.length
              ? h('div', { style: { marginBottom: '8px' } }, mine.map(function (a) {
                var isSlide = !!a.slide && (a.files || []).length > 1;
                var editing = st[0].slideEdit === a.id;
                var n = (a.files || []).length;
                return h('div', { key: a.id },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '3px 0', fontSize: '12px' } },
                    h('span', { style: { opacity: 0.8 } }, a.title),
                    h('span', { style: { opacity: 0.45 } },
                      isSlide ? ('幻灯片 ' + n + ' 张 · ' + (a.duration || 0) + 's')
                        : (a.kind === 'image' ? '图片' : (a.duration ? a.duration + 's' : '视频'))),
                    cfg.animation === a.id ? h('span', { style: { opacity: 0.45 } }, '· 当前') : null,
                    isSlide ? h('button', {
                      onClick: function () { setSt(function (s) { return { ...s, slideEdit: editing ? null : a.id }; }); },
                      style: { padding: '2px 8px', cursor: 'pointer', fontSize: '11px' }
                    }, editing ? '收起' : '编辑') : null,
                    h('button', {
                      onClick: function () { removeAnim(a.id, a.title); },
                      style: { padding: '2px 8px', cursor: 'pointer', fontSize: '11px' }
                    }, '删除')
                  ),
                  isSlide ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '2px 0 6px 12px', fontSize: '11.5px' } },
                    (a.files || []).map(function (f, k) {
                      return h('span', { key: f, style: { display: 'flex', alignItems: 'center', gap: '2px' } },
                        h('span', { style: { opacity: 0.7, minWidth: '14px' } }, String(k + 1)),
                        h('button', {
                          onClick: function () { slideOrder(a, k, -1); },
                          style: { padding: '0 5px', cursor: 'pointer', fontSize: '11px' }
                        }, '↑'),
                        h('button', {
                          onClick: function () { slideOrder(a, k, 1); },
                          style: { padding: '0 5px', cursor: 'pointer', fontSize: '11px' }
                        }, '↓')
                      );
                    })
                  ) : null,
                  isSlide && editing ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0 6px 12px', fontSize: '11.5px' } },
                    h('span', { style: { opacity: 0.7 } }, '每张停留'),
                    h(NumberInput, { value: a.hold, onCommit: function (v) { slideMeta(a.id, { hold: v }); } }),
                    h('span', { style: { opacity: 0.55 } }, '秒'),
                    h('span', { style: { opacity: 0.7 } }, '过渡'),
                    h(NumberInput, { value: a.fade, onCommit: function (v) { slideMeta(a.id, { fade: v }); } }),
                    h('span', { style: { opacity: 0.55 } }, '秒'),
                    h('span', { style: { opacity: 0.7 } }, '间隔'),
                    h(NumberInput, { value: a.gap, onCommit: function (v) { slideMeta(a.id, { gap: v }); } }),
                    h('span', { style: { opacity: 0.55 } }, '秒（停留填 0 = 每张一直停，点画面看下一张）')
                  ) : null
                );
              }))
              : h('div', { style: { fontSize: '11.5px', opacity: 0.5, marginBottom: '8px' } }, '还没有导入过 —— 点下面按钮选一个视频、图片，或一次选多张图做幻灯片'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h('button', { onClick: pickFile, style: { padding: '6px 12px', cursor: 'pointer' } }, '导入动画 / 图片'),
              h('button', { onClick: pickSlides, style: { padding: '6px 12px', cursor: 'pointer' } }, '导入幻灯片（可多选图）'),
              importing ? h('span', { style: { fontSize: '11.5px', opacity: 0.6 } }, '上传中 ' + importing.pct + '%') : null,
              st[0].slideName ? h('span', { style: { fontSize: '11.5px', opacity: 0.6 } }, st[0].slideName) : null
            )
          )
        ),
        h(Row, { label: '播放频率' },
          h(Select, {
            value: cfg.mode,
            options: [
              { value: 'always', label: '每次冷启动播放' },
              { value: 'session', label: '每个浏览器会话一次' },
              { value: 'daily', label: '每天一次' }
            ],
            onChange: function (v) { save({ mode: v }); }
          })
        ),
        h(Row, { label: '随机', hint: '开启后每次冷启动从素材库随机挑一个；关掉就回到上面选定的那个（与播放频率是两件事，可以叠着用）' },
          h(Check, {
            value: cfg.random,
            label: '每次启动随机挑一个动画',
            onChange: function (v) { save({ random: v }); }
          })
        ),
        cfg.random ? h(Row, { label: '随机范围与权重', hint: '勾上 = 参与随机；权重留空按 1 算，填 0 = 不参与。全都不勾（或全勾）等于全库，回到原来的纯随机' },
          h('div', {
            style: {
              maxHeight: '190px', overflowY: 'auto',
              border: '1px solid rgba(128,128,128,0.28)', borderRadius: '6px', padding: '6px 9px'
            }
          },
            animations.map(function (a) {
              var inPool = !(cfg.randomPool || []).length || cfg.randomPool.indexOf(a.id) !== -1;
              return h('div', { key: a.id, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0', fontSize: '12px' } },
                h('input', {
                  type: 'checkbox', checked: inPool,
                  onChange: function () { togglePool(a.id, !inPool); }
                }),
                h('span', { style: { opacity: 0.85, minWidth: '130px' } }, a.title),
                h('span', { style: { opacity: 0.5, fontSize: '11.5px' } }, '权重'),
                h('input', {
                  type: 'number', min: 0, max: 99,
                  defaultValue: weightText(a.id),
                  onBlur: function (e) { setWeight(a.id, e.target.value); },
                  onKeyDown: function (e) { if (e.key === 'Enter') setWeight(a.id, e.target.value); },
                  style: { width: '62px', padding: '3px 6px' }
                })
              );
            })
          )
        ) : null,
        h(Row, { label: '图片停留时长', hint: '只对图片生效；视频永远按原声播完，不受这里影响' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            h(Select, {
              value: cfg.imageHoldMode,
              options: [
                { value: '2', label: '2 秒' },
                { value: '3', label: '3 秒' },
                { value: '5', label: '5 秒（默认）' },
                { value: 'forever', label: '一直停到手动跳过' },
                { value: 'custom', label: '自定义…' }
              ],
              onChange: function (v) { save({ imageHoldMode: v }); }
            }),
            cfg.imageHoldMode === 'custom'
              ? h(NumberInput, {
                value: cfg.imageHoldCustom,
                onCommit: function (n) { save({ imageHoldCustom: n }); }
              })
              : null,
            cfg.imageHoldMode === 'custom'
              ? h('span', { style: { fontSize: '11.5px', opacity: 0.55 } }, '秒（1–600）')
              : h('span', { style: { fontSize: '11.5px', opacity: 0.55 } },
                cfg.imageHold === 0 ? '当前：不限时' : '当前：' + cfg.imageHold + ' 秒')
          )
        ),
        h(Row, { label: '转场效果', hint: '只对幻灯片（一次导入多张图）生效；单张视频 / 图片不受影响' },
          h(Select, {
            value: cfg.transition,
            options: [
              { value: 'fade', label: '淡入淡出（默认）' },
              { value: 'zoom', label: '缓慢推进' },
              { value: 'flash', label: '白闪切换' },
              { value: 'wipe', label: '侧向擦除' }
            ],
            onChange: function (v) { save({ transition: v }); }
          })
        ),
        h(Row, { label: '导入上限', hint: '只防手滑，不是硬性限制；超了会当场提示，可以在这里调大' },
          h('div', null,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
              h('button', {
                onClick: function () { setSt(function (s) { return { ...s, showAdvanced: !s.showAdvanced }; }); },
                style: { padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }
              }, st[0].showAdvanced ? '收起' : '展开'),
              h('span', { style: { opacity: 0.6, fontSize: '11.5px' } },
                '最多 ' + cfg.maxSlides + ' 张 · 单张 ' + cfg.maxSlideMB + 'MB · 单条合计 ' + cfg.maxBatchMB + 'MB')
            ),
            st[0].showAdvanced ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', marginTop: '6px' } },
              h('span', { style: { opacity: 0.7 } }, '最多张数'),
              h(NumberInput, { value: cfg.maxSlides, onCommit: function (v) { save({ maxSlides: v }); } }),
              h('span', { style: { opacity: 0.7 } }, '单张 MB'),
              h(NumberInput, { value: cfg.maxSlideMB, onCommit: function (v) { save({ maxSlideMB: v }); } }),
              h('span', { style: { opacity: 0.7 } }, '单条 MB'),
              h(NumberInput, { value: cfg.maxBatchMB, onCommit: function (v) { save({ maxBatchMB: v }); } })
            ) : null
          )
        ),
        h(Row, { label: '音量' },
          h(Range, { value: cfg.volume, onChange: function (v) { save({ volume: v }); } })
        ),
        h(Row, { label: '跳过提示', hint: '播放时底部那行小字与进度线；选「不显示」后点画面、Esc、空格照样能跳过' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            h(Select, {
              value: cfg.hintMode || 'bottom',
              style: { width: '220px', padding: '6px 8px' },
              options: [
                { value: 'bottom', label: '底部居中（默认）' },
                { value: 'left', label: '左下角' },
                { value: 'right', label: '右下角' },
                { value: 'off', label: '不显示' }
              ],
              onChange: function (v) { save({ hintMode: v }); }
            }),
            cfg.hintMode === 'off'
              ? h('span', { style: { fontSize: '11.5px', opacity: 0.6 } }, '进度线也一起隐藏；跳过不受影响')
              : null
          )
        ),
        h(Row, { label: '提示文案', hint: '1–40 字；留空回到默认「点击跳过」' },
          cfg.hintMode === 'off'
            ? h('span', { style: { fontSize: '12px', opacity: 0.5 } }, '（当前不显示提示，文案不会出现）')
            : h(TextInput, {
              value: cfg.hintText,
              onCommit: function (v) { save({ hintText: v }); }
            })
        ),
        h('div', { style: { marginTop: '6px' } },
          h('div', {
            onClick: function () { setSt(function (s) { return { ...s, showSchedules: !s.showSchedules }; }); },
            style: { fontSize: '12px', opacity: 0.72, cursor: 'pointer', margin: '4px 0 8px' }
          }, (showSchedules ? '▾ ' : '▸ ') + '按时段播放（' + ((cfg.schedules || []).length) + ' 条）' +
            ((cfg.schedules || []).length ? '：从上往下，第一条命中的说了算' : '')),
          showSchedules
            ? h('div', null,
              (cfg.schedules || []).map(function (s, i) {
                return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', fontSize: '12px' } },
                  h('input', {
                    type: 'time', value: s.from,
                    onChange: function (e) { setSchedule(i, { from: e.target.value }); },
                    style: { padding: '4px 6px' }
                  }),
                  h('span', { style: { opacity: 0.6 } }, '→'),
                  h('input', {
                    type: 'time', value: s.to,
                    onChange: function (e) { setSchedule(i, { to: e.target.value }); },
                    style: { padding: '4px 6px' }
                  }),
                  h(Select, {
                    value: s.animation,
                    style: { width: '180px', padding: '4px 6px' },
                    options: animOptions,
                    onChange: function (v) { setSchedule(i, { animation: v }); }
                  }),
                  h('span', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
                    [['MO', '一'], ['TU', '二'], ['WE', '三'], ['TH', '四'], ['FR', '五'], ['SA', '六'], ['SU', '日']].map(function (pair) {
                      var d = pair[0], on = (s.weekdays || []).indexOf(d) !== -1;
                      return h('button', {
                        key: d,
                        onClick: function () {
                          var cur = (s.weekdays || []).slice();
                          var next = on ? cur.filter(function (x) { return x !== d; }) : cur.concat([d]);
                          next = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].filter(function (x) { return next.indexOf(x) !== -1; });
                          setSchedule(i, { weekdays: next });
                        },
                        style: {
                          padding: '2px 5px', cursor: 'pointer', fontSize: '11px',
                          opacity: on ? 1 : 0.4, fontWeight: on ? 600 : 400
                        }
                      }, pair[1]);
                    })
                  ),
                  h('button', {
                    onClick: function () { removeSchedule(i); },
                    style: { padding: '2px 8px', cursor: 'pointer', fontSize: '11px' }
                  }, '删除')
                );
              }),
              h('button', {
                onClick: addSchedule,
                style: { padding: '4px 12px', cursor: 'pointer', marginTop: '4px' }
              }, '加一条时段'),
              h('div', { style: { fontSize: '11px', opacity: 0.5, marginTop: '6px' } },
                '跨零点这样写：22:00 → 06:00（两段都算）；星期不勾 = 不限，凌晨那段按「现在这一刻」算（周日凌晨算周日）；时段指向的素材被删掉就跳过该条；起止没填全的整条忽略。')
            )
            : null
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' } },
          h('button', {
            onClick: preview,
            style: { padding: '6px 14px', cursor: 'pointer' }
          }, '立即预览'),
          saving ? h('span', { style: { fontSize: '12px', opacity: 0.6 } }, '保存中…') : null,
          msg ? h('span', { style: { fontSize: '12px', opacity: 0.6 } }, msg) : null
        ),
        h('div', { style: { fontSize: '11px', opacity: 0.5, marginTop: '12px' } },
          '本插件与既有启动画面插件相互独立；若两者同时启用会先后出现两层启动画面，建议只留一个。')
      );
    }

    /* ── 桌面端兜底自举 ─────────────────────────────────────────────────── */
    /* index 注入缺席时（Electron 直载等场景），由这里自行拉配置播放。
       正常 web 流程下 __DSH_OP_SPLASH__/__DSH_OP_SPLASH_BOOT__ 已就位，直接返回。 */
    function selfBoot() {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined') return
        if (!document.body) return
        if (window.__DSH_OP_SPLASH_BOOT__) return          /* 已被 Host 或本侧接管 */
        if (window.__DSH_OP_SPLASH__) return               /* 配置已在页面上：Host 注入过 */
        if (document.getElementById('dsh-op-splash-root')) return
        /* 已经出过错的地方不要再扑一次 */
        if (window.__DSH_OP_SPLASH_FAILED__ === true) return
        markBooted()
        fetch(ROUTE + '/config', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json() })
          .then(function (j) { return j && j.ok === true ? j : null })
          .catch(function () { return null })
          .then(function (res) {
            var cfg = (res && res.config) || DEFAULT_CFG
            if (cfg.enabled === false) return
            if (cfg.mode === 'session' && readFlag('session', 'dsh-op-splash:shown') === '1') return
            if (cfg.mode === 'daily' && readFlag('local', 'dsh-op-splash:day') === new Date().toDateString()) return
            /* 回填判定标记，保证与 Host 侧同款语义（Host 的 BOOTSTRAP_JS 也用 toDateString） */
            if (cfg.mode === 'session') writeFlag('session', 'dsh-op-splash:shown', '1')
            if (cfg.mode === 'daily') writeFlag('local', 'dsh-op-splash:day', new Date().toDateString())
            var list = (res && res.animations) || []
            /* 与 Host 同规则：时段 → 随机池权重 → 配置里选定的那个 */
            var sel = pickFrom(list, cfg)
            /* 一件素材都没有（全新安装）：不播、不建黑幕，页面照常起来 */
            if (!sel) return
            if (sel) cfg.animation = sel.id
            cfg.duration = sel ? sel.duration : 0
            cfg.kind = sel ? sel.kind : 'video'
            cfg.mediaFile = sel ? sel.file : ''
            cfg.files = sel && Array.isArray(sel.files) ? sel.files : []
            cfg.slide = !!(sel && sel.slide)
            cfg.hold = sel ? sel.hold : null
            cfg.fade = sel ? sel.fade : null
            cfg.gap = sel ? sel.gap : null
            cfg.imageHold = imageHoldOf(cfg)
            /* 随机挑中的那个不能用 Host 按「配置里选定」算好的 src，得自己拼一次 */
            cfg.src = sel
              ? ROUTE + '/media/' + sel.id + '/' + sel.file + '?v=' + ((res && res.version) || VERSION)
              : ((res && res.src) || '')
            cfg.version = (res && res.version) || VERSION
            return injectRoot(cfg)
          })
          .catch(function () { /* 自举失败就算了，页面本来就是好的 */ })
      } catch (e) { /* 自举是兜底，绝不许把宿主带崩 */ }
    }

    /* ── 插件 ───────────────────────────────────────────────────────────── */
    var inject = ['slots']

    function apply(ctx) {
      /* 桌面端兜底：Host 的 index 注入不生效时，由这里自举开场动画。
         正常 web 流程下配置已就位，本调用直接返回。 */
      selfBoot()
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'op-splash', order: 27, label: '开场动画' },
          function () { return h(Panel, {}) }
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})