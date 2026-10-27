// dsh-op-splash — Splash 播放器（浏览器端，defer 加载）
// 职责：把视频或图片挂进启动黑幕、播放/停留、可跳过、结束时摘除并解锁滚动。
// 与同类插件的 splash.js 完全独立：无共享 DOM id / 存储键 / 全局名。
(function () {
  if (window.__DSH_OP_SPLASH_PLAYER__) return;
  window.__DSH_OP_SPLASH_PLAYER__ = true;

  var ROOT_ID = 'dsh-op-splash-root';
  var ROUTE = '/dsh-op-splash';
  var IMAGE_HOLD = 5; // 秒：配置没给 imageHold 时的图片停留兜底
  var HINT_DELAY = 1500; // 毫秒：跳过提示延迟淡入，先让开场画面干净一会儿
  var state = { root: null, video: null, image: null, slides: null, slideNext: null, slidesForever: false, hintBar: null, timers: [], done: false, listeners: [] };

  function cfgNow() { return window.__DSH_OP_SPLASH__ || {}; }

  function on(target, type, fn, capture) {
    target.addEventListener(type, fn, !!capture);
    state.listeners.push([target, type, fn, !!capture]);
  }
  function clearListeners() {
    for (const item of state.listeners) {
      try { item[0].removeEventListener(item[1], item[2], item[3]); } catch {}
    }
    state.listeners = [];
  }
  function clearTimers() {
    for (const t of state.timers) {
      try { window.clearTimeout(t); } catch {}
    }
    state.timers = [];
  }
  function later(fn, ms) {
    state.timers.push(window.setTimeout(fn, ms));
  }

  /* ── 播放期提示：一行小字 + 一条淡进度线 ───────────────────────────────
     位置与文案都由配置决定（hintMode / hintText）；选「不显示」时干脆不建，
     但跳过通道（点画面 / Esc / 空格）不受影响。
     小字延迟淡入（不打扰开场），进度线跟着真实播放进度走；
     「一直停到手动跳过」的图片没有终点，所以不画进度线。 */
  function ensureHint(root, cfg) {
    var mode = (cfg && cfg.hintMode) || 'bottom';
    if (mode === 'off') return null;
    var hint = document.createElement('div');
    hint.className = 'dos-hint' + (mode === 'left' ? ' dos-hint-left' : (mode === 'right' ? ' dos-hint-right' : ''));
    var txt = document.createElement('span');
    txt.textContent = (cfg && cfg.hintText) || '点击跳过';
    hint.appendChild(txt);
    var bar = document.createElement('i');
    hint.appendChild(bar);
    root.appendChild(hint);
    state.hintBar = bar;
    later(function () { try { hint.className = hint.className + ' on'; } catch {} }, HINT_DELAY);
    return hint;
  }
  function setProgress(p) {
    if (!state.hintBar) return;
    var pct = Math.max(0, Math.min(1, p)) * 100;
    try { state.hintBar.style.width = pct.toFixed(2) + '%'; } catch {}
  }
  function hideProgress() {
    if (!state.hintBar) return;
    try { state.hintBar.style.display = 'none'; } catch {}
  }
  /** 视频进度：duration 未知（流式/元数据没到）时退回配置里的时长。 */
  function videoProgress(v, cfg) {
    var dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (cfg.duration || 0);
    if (!dur) return;
    setProgress(v.currentTime / dur);
  }
  /** 图片进度：按停留时长自己推进（holdMs = 0 时不调用）。 */
  function imageProgress(holdMs) {
    if (!holdMs) return;
    var t0 = Date.now();
    var tick = function () {
      if (state.done) return;
      setProgress((Date.now() - t0) / holdMs);
      if (Date.now() - t0 < holdMs) later(tick, 100);
    };
    later(tick, 100);
  }

  function markShown() {
    try {
      sessionStorage.setItem('dsh-op-splash:shown', '1');
      localStorage.setItem('dsh-op-splash:day', new Date().toDateString());
    } catch {}
  }
  function unlock() {
    try { document.documentElement.classList.remove('dos-lock'); } catch {}
  }
  function teardown() {
    clearListeners();
    clearTimers();
    unlock();
    var v = state.video;
    if (v) {
      try { v.pause(); } catch {}
      try { v.removeAttribute('src'); v.load(); } catch {}
      state.video = null;
    }
    var img = state.image;
    if (img) {
      try { img.removeAttribute('src'); } catch {}
      state.image = null;
    }
    var root = state.root || document.getElementById(ROOT_ID);
    if (root) {
      try { if (root.parentNode) root.parentNode.removeChild(root); } catch {}
    }
    state.root = null;
    state.slides = null;
    state.slideNext = null;
    state.slidesForever = false;
    state.hintBar = null;
  }
  function finish() {
    if (state.done) return;
    state.done = true;
    markShown();
    var root = state.root;
    if (root) root.classList.add('dos-out');
    window.setTimeout(teardown, 480);
  }

  function ensureRoot() {
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    root.classList.remove('dos-out');
    return root;
  }

  // 自动播放被浏览器拒绝时：先退静音重试保画面；首次手势再尝试恢复声音。
  function playWithFallback(v, cfg) {
    var p;
    try { p = v.play(); } catch { p = null; }
    if (p && typeof p.catch === 'function') {
      p.catch(function () {
        v.muted = true;
        var q;
        try { q = v.play(); } catch { q = null; }
        if (q && typeof q.catch === 'function') {
          q.catch(function () { later(finish, 600); });
        }
        var restore = function () {
          if (state.done) return cleanup();
          try {
            v.muted = false;
            v.volume = typeof cfg.volume === 'number' ? cfg.volume : 1;
            v.play();
          } catch {}
          cleanup();
        };
        var cleanup = function () {
          document.removeEventListener('pointerdown', restore, true);
          document.removeEventListener('keydown', restore, true);
        };
        document.addEventListener('pointerdown', restore, true);
        document.addEventListener('keydown', restore, true);
      });
    }
  }

  /** 素材地址：Host 在配置里已经给了最终 src；没有时才按老规矩回退拼一次。 */
  function mediaSrc(cfg) {
    if (cfg.src) return cfg.src;
    var id = cfg.animation || '';
    var file = cfg.mediaFile || ((cfg.kind || 'video') === 'image' ? 'image.png' : 'video.mp4');
    return ROUTE + '/media/' + id + '/' + file;
  }

  /** 图片动画：淡入 → 停留 imageHold 秒 → 淡出收尾，中途可跳过。
      imageHold = 0 表示「一直停到手动跳过」：不自动收尾、也不画进度线。 */
  function numOr(v, dflt) {
    var n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }

  /** 幻灯片：多张图按顺序播。四种进场（fade/zoom/flash/wipe），张与张之间可留间隔。
      hold = 0 表示每张一直停：这时点画面是「看下一张」，Esc / 空格才是整段跳过。 */
  function mountSlides(cfg, root) {
    var base = ROUTE + '/media/' + (cfg.animation || '') + '/';
    var ver = '?v=' + (cfg.version || '');
    var files = (Array.isArray(cfg.files) && cfg.files.length) ? cfg.files : [cfg.mediaFile || 'image.png'];
    var hold = numOr(cfg.hold, IMAGE_HOLD);
    var fade = numOr(cfg.fade, 0.5);
    var gapMs = Math.max(0, numOr(cfg.gap, 0)) * 1000;
    var forever = hold <= 0;
    var trans = ['fade', 'zoom', 'flash', 'wipe'].indexOf(cfg.transition) === -1 ? 'fade' : cfg.transition;

    var box = document.createElement('div');
    box.className = 'dos-slides';
    root.appendChild(box);
    state.slides = box;
    state.slidesForever = forever;

    /* 白闪层：只有 flash 转场建它；压在画面之上、提示条之下 */
    var flash = null;
    if (trans === 'flash') {
      flash = document.createElement('i');
      flash.className = 'dos-flash';
      if (state.hintBar && state.hintBar.parentNode === root) root.insertBefore(flash, state.hintBar);
      else root.appendChild(flash);
    }

    var i = 0;
    var cur = null;

    function show() {
      if (state.done) return;
      var idx = i;
      var img = document.createElement('img');
      img.className = 'dos-slide dos-tr-' + trans;
      img.setAttribute('src', base + files[idx] + ver);
      on(img, 'error', finish);
      var prev = cur;
      box.appendChild(img);
      cur = img;
      later(function () {
        if (state.done) return;
        try { img.classList.add('in'); } catch {}
        if (flash) {
          try { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); } catch {}
        }
        if (prev) {
          try { prev.classList.add('out'); } catch {}
          later(function () {
            try { if (prev.parentNode) prev.parentNode.removeChild(prev); } catch {}
          }, Math.max(320, fade * 1000 + 140));
        }
      }, 20);
      setProgress((idx + 1) / files.length);

      if (forever) {
        /* 每张一直停：点画面翻页；翻到最后一张再点就收尾 */
        state.slideNext = function () {
          if (idx >= files.length - 1) { finish(); return; }
          i = idx + 1;
          show();
        };
        return;
      }
      var stayMs = Math.max(200, hold * 1000);
      if (idx >= files.length - 1) {
        later(finish, stayMs);
      } else {
        later(function () {
          if (state.done) return;
          i = idx + 1;
          show();
        }, stayMs + gapMs);
      }
    }

    hideProgress(); /* 幻灯片的总进度线没有意义（节奏由 hold / gap 决定） */
    show();
    return box;
  }

  /** 图片动画：淡入 → 停留 imageHold 秒 → 淡出收尾，中途可跳过。
      imageHold = 0 表示「一直停到手动跳过」：不自动收尾、也不画进度线。 */
  function mountImage(cfg, root) {
    var img = document.createElement('img');
    img.className = 'dos-image';
    img.setAttribute('src', mediaSrc(cfg));
    img.addEventListener('error', finish);
    root.appendChild(img);
    state.image = img;

    var holdSec = typeof cfg.imageHold === 'number'
      ? cfg.imageHold
      : (typeof cfg.duration === 'number' && cfg.duration > 0 ? cfg.duration : IMAGE_HOLD);
    later(function () {
      try { img.classList.add('dos-img-in'); } catch {}
    }, 30);
    if (holdSec === 0) {
      hideProgress(); // 没有终点，进度线没有意义
      return img;
    }
    var holdMs = Math.max(1, holdSec) * 1000;
    later(function () {
      try { img.classList.add('dos-img-out'); } catch {}
    }, Math.max(60, holdMs - 500));
    later(finish, holdMs);
    imageProgress(holdMs);
    return img;
  }

  function mountVideo(cfg, root) {
    var v = document.createElement('video');
    v.className = 'dos-video';
    v.setAttribute('src', mediaSrc(cfg));
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('disablepictureinpicture', '');
    v.preload = 'auto';
    v.volume = typeof cfg.volume === 'number' ? cfg.volume : 1;
    v.addEventListener('ended', finish);
    v.addEventListener('error', finish);
    var onProgress = function () { videoProgress(v, cfg); };
    on(v, 'loadedmetadata', onProgress);
    on(v, 'timeupdate', onProgress);
    root.appendChild(v);
    state.video = v;
    return v;
  }

  function mount() {
    var cfg = cfgNow();
    state.done = false;
    /* 没有素材（全新安装、还没导入）时什么都不画：Host 与自举都已拦过，这里是最后一道兜底 */
    if (!cfg.src && !cfg.animation) { finish(); return; }
    var root = ensureRoot();
    state.root = root;
    ensureHint(root, cfg);

    var isSlide = cfg.slide === true || (Array.isArray(cfg.files) && cfg.files.length > 1);
    var el = isSlide ? mountSlides(cfg, root)
      : ((cfg.kind || 'video') === 'image' ? mountImage(cfg, root) : mountVideo(cfg, root));

    // 点击画面 / Esc·Enter·空格 跳过；幻灯片「一直停」模式下点画面 = 看下一张（Esc 仍整段跳过）
    on(root, 'click', function () {
      if (state.slidesForever && state.slideNext) { state.slideNext(); return; }
      finish();
    });
    on(document, 'keydown', function (ev) {
      if (ev && (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ')) finish();
    }, true);

    if (state.video) playWithFallback(state.video, cfg);
    return el;
  }

  function replay() {
    teardown();
    mount();
  }

  // 兜底（与 BOOTSTRAP_JS 的定时器双保险；先到先摘）
  window.__DSH_OP_SPLASH_FAILSAFE__ = finish;
  window.__DSH_OP_SPLASH_API__ = {
    replay: replay,
    skip: finish
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();