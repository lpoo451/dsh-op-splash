// dsh-op-splash — 四项新功能的针对性检查
// 只碰 __test__ 导出的纯函数与清单扫描，不启动宿主、不碰真实用户目录（DSH_HOME 指到插件内的临时目录）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = path.join(PLUGIN, '.test-features-home')
process.env.DSH_HOME = HOME

const T = (await import('../lib/index.js')).__test__

let pass = 0
let fail = 0
function ck(name, fn) {
  try {
    fn()
    pass++
    console.log('  ok   ' + name)
  } catch (e) {
    fail++
    console.log('  FAIL ' + name + ' → ' + e.message)
  }
}

/* ── 造一份临时的「我的素材」：一个完好、一个半截（有 manifest 没素材） ── */
const UDIR = T.userAnimDir()
fs.mkdirSync(path.join(UDIR, 'feature-img'), { recursive: true })
fs.writeFileSync(
  path.join(UDIR, 'feature-img', 'manifest.json'),
  JSON.stringify({ id: 'feature-img', title: '测试图', kind: 'image', duration: 5, file: 'image.png' })
)
fs.writeFileSync(path.join(UDIR, 'feature-img', 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
fs.mkdirSync(path.join(UDIR, 'feature-broken'), { recursive: true })
fs.writeFileSync(
  path.join(UDIR, 'feature-broken', 'manifest.json'),
  JSON.stringify({ id: 'feature-broken', title: '半截导入', kind: 'video', file: 'video.mp4' })
)

/* ── 1. 素材清单 + 缺失自检 ─────────────────────────────────────────── */
const { list, issues } = await T.inspectAnimations()

ck('清单每项都带体积与修改时间', () => {
  assert.ok(list.length >= 1, '清单太短：' + list.length)
  for (const a of list) {
    assert.ok(a.size > 0, a.id + ' 缺 size')
    assert.ok(a.mtime > 0, a.id + ' 缺 mtime')
    assert.ok(a.source === 'builtin' || a.source === 'user', a.id + ' source 异常')
  }
})

ck('用户素材出现，且体积等于真实文件大小', () => {
  const hit = list.find((a) => a.id === 'feature-img')
  assert.ok(hit, 'feature-img 没上架')
  assert.equal(hit.kind, 'image')
  assert.equal(hit.size, 4)
  assert.equal(hit.source, 'user')
})

ck('素材文件缺失 → 不上架，但出现在 issues 里并说明原因', () => {
  assert.ok(!list.some((a) => a.id === 'feature-broken'), '半截素材不该上架')
  const iss = issues.find((i) => i.id === 'feature-broken')
  assert.ok(iss, 'issues 里没有半截素材')
  assert.equal(iss.reason, 'missing-file')
  assert.equal(iss.file, 'video.mp4')
})

/* ── 2 & 4 & 3. 配置归一化 ─────────────────────────────────────────── */
const known = ['a', 'b', 'c']

const cfg = T.normalize(
  {
    randomPool: ['a', 'zzz', 'a'],
    weights: { a: 5, b: -3, c: 'x', zzz: 9 },
    hintMode: 'left',
    hintText: '  按任意键继续跳过世界线  ',
    schedules: [
      { from: '22:00', to: '06:00', animation: 'a' },
      { from: 'bad', to: '06:00', animation: 'a' },
      { from: '09:00', to: '09:00', animation: 'a' },
      { from: '10:00', to: '12:00', animation: 'zzz' }
    ]
  },
  known
)

ck('randomPool：去重 + 剔掉库里不存在的 id', () => {
  assert.deepEqual(cfg.randomPool, ['a'])
})

ck('weights：负数归 0、非法值丢弃、库里没有的键丢弃', () => {
  assert.deepEqual(cfg.weights, { a: 5, b: 0 })
})

ck('weights：超过 99 封顶', () => {
  assert.equal(T.normalize({ weights: { a: 999 } }, known).weights.a, 99)
})

ck('hintMode：合法值保留', () => assert.equal(cfg.hintMode, 'left'))

ck('hintMode：非法值回落 bottom', () => {
  assert.equal(T.normalize({ hintMode: 'middle' }, known).hintMode, 'bottom')
})

ck('hintText：首尾空白裁掉后保留', () => {
  assert.equal(cfg.hintText, '按任意键继续跳过世界线')
})

ck('hintText：空白串回落默认「点击跳过」', () => {
  assert.equal(T.normalize({ hintText: '   ' }, known).hintText, '点击跳过')
})

ck('hintText：超 40 字被截断', () => {
  assert.equal(T.normalize({ hintText: '字'.repeat(60) }, known).hintText.length, 40)
})

ck('schedules：时间非法 / 起止相同 / 素材已删 的条目全部丢掉', () => {
  assert.deepEqual(cfg.schedules, [{ from: '22:00', to: '06:00', animation: 'a', weekdays: [] }])
})

ck('schedules：条数上限 20', () => {
  const many = []
  for (let i = 0; i < 40; i++) many.push({ from: '01:00', to: '02:00', animation: 'a' })
  assert.equal(T.normalize({ schedules: many }, known).schedules.length, 20)
})

/* ── 4. 时段判定与优先级 ───────────────────────────────────────────── */
ck('跨零点：22:00–06:00 在 23:30 / 05:00 命中，12:00 不命中', () => {
  assert.equal(T.inWindow(23 * 60 + 30, 22 * 60, 6 * 60), true)
  assert.equal(T.inWindow(5 * 60, 22 * 60, 6 * 60), true)
  assert.equal(T.inWindow(12 * 60, 22 * 60, 6 * 60), false)
})

ck('普通时段按 [from, to)：末端不含', () => {
  assert.equal(T.inWindow(10 * 60, 9 * 60, 11 * 60), true)
  assert.equal(T.inWindow(11 * 60, 9 * 60, 11 * 60), false)
})

const anims = [
  { id: 'a', title: 'A', duration: 1, kind: 'video', file: 'video.mp4' },
  { id: 'b', title: 'B', duration: 2, kind: 'video', file: 'video.mp4' }
]

ck('时段重叠：取列表里第一条命中的（顺序 = 优先级）', () => {
  const c = T.normalize(
    {
      schedules: [
        { from: '10:00', to: '12:00', animation: 'b' },
        { from: '00:00', to: '23:59', animation: 'a' }
      ]
    },
    ['a', 'b']
  )
  assert.equal(T.pickAnimation(anims, c, new Date('2026-10-26T11:00:00')).id, 'b')
})

ck('没命中任何时段 → 回落到选定/随机逻辑', () => {
  const c = T.normalize({ animation: 'a', schedules: [{ from: '10:00', to: '12:00', animation: 'b' }] }, ['a', 'b'])
  assert.equal(T.pickAnimation(anims, c, new Date('2026-10-26T15:00:00')).id, 'a')
})

ck('时段优先于随机开关', () => {
  const c = T.normalize({ random: true, animation: 'a', schedules: [{ from: '10:00', to: '12:00', animation: 'b' }] }, ['a', 'b'])
  for (let i = 0; i < 50; i++) assert.equal(T.pickAnimation(anims, c, new Date('2026-10-26T11:00:00')).id, 'b')
})

/* ── 2. 随机池与权重 ───────────────────────────────────────────────── */
ck('随机池：只在池子里抽（200 次）', () => {
  const c = T.normalize({ random: true, randomPool: ['a'] }, ['a', 'b'])
  for (let i = 0; i < 200; i++) assert.equal(T.pickAnimation(anims, c, new Date()).id, 'a')
})

ck('权重 0 = 不参与（200 次都不出现）', () => {
  const c = T.normalize({ random: true, weights: { b: 0 } }, ['a', 'b'])
  for (let i = 0; i < 200; i++) assert.equal(T.pickAnimation(anims, c, new Date()).id, 'a')
})

ck('池子被勾空 → 回退全库（两个都可能中）', () => {
  const c = T.normalize({ random: true, randomPool: [] }, ['a', 'b'])
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(T.pickAnimation(anims, c, new Date()).id)
  assert.equal(seen.size, 2)
})

ck('池子里权重全为 0 → 回退全库等概率', () => {
  const c = T.normalize({ random: true, weights: { a: 0, b: 0 } }, ['a', 'b'])
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(T.pickAnimation(anims, c, new Date()).id)
  assert.equal(seen.size, 2)
})

ck('权重真的改变概率（9 : 1，200 次里重的那个应明显更多）', () => {
  const c = T.normalize({ random: true, weights: { a: 9, b: 1 } }, ['a', 'b'])
  let na = 0
  for (let i = 0; i < 200; i++) if (T.pickAnimation(anims, c, new Date()).id === 'a') na++
  assert.ok(na > 120, '重的那个只中了 ' + na + ' 次')
})

ck('旧配置（random 关、无池无权重）行为不变：仍按 animation 选定', () => {
  const c = T.normalize({ animation: 'b' }, ['a', 'b'])
  for (let i = 0; i < 50; i++) assert.equal(T.pickAnimation(anims, c, new Date()).id, 'b')
})

/* ── 3. 提示条可配（播放器与样式表的可见证据） ─────────────────────── */
const splashSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'splash.js'), 'utf8')
const cssSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'splash.css'), 'utf8')

ck('播放器：读 hintMode，并支持 off（不建提示条）', () => {
  assert.ok(splashSrc.includes('cfg.hintMode'), 'splash.js 没读 hintMode')
  assert.ok(splashSrc.includes("mode === 'off'"), 'splash.js 没处理 off')
})

ck('播放器：支持左下 / 右下两个位置类', () => {
  assert.ok(splashSrc.includes('dos-hint-left'))
  assert.ok(splashSrc.includes('dos-hint-right'))
})

ck('播放器：文案取自 hintText，缺省回「点击跳过」', () => {
  assert.ok(splashSrc.includes('cfg.hintText'))
  assert.ok(splashSrc.includes('点击跳过'))
})

ck('播放器：跳过通道与提示条无关（点击 / Esc 照旧）', () => {
  /* 点击画面现在分两条路：幻灯片「一直停」= 换下一张；其余 = 收尾。两条都得在。 */
  assert.ok(splashSrc.includes("on(root, 'click'"), 'splash.js 丢了点击接管')
  assert.ok(splashSrc.includes('state.slideNext'), 'splash.js 丢了「点画面看下一张」')
  assert.ok(splashSrc.includes("ev.key === 'Escape'"))
})

ck('样式表：定义了两个位置类，且衬底与阴影仍在', () => {
  assert.ok(cssSrc.includes('.dos-hint.dos-hint-left'))
  assert.ok(cssSrc.includes('.dos-hint.dos-hint-right'))
  assert.ok(cssSrc.includes('linear-gradient(to top'))
})

/* ── 5. 幻灯片 · 转场 · 按星期 ─────────────────────────────────────── */
const clientSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8')

const SDIR = path.join(UDIR, 'feature-slides')
fs.mkdirSync(SDIR, { recursive: true })
fs.writeFileSync(path.join(SDIR, 'manifest.json'), JSON.stringify({
  id: 'feature-slides', title: '三张图', kind: 'image',
  files: ['a.png', 'b.png', 'c.png'], hold: 2, fade: 0.4, gap: 0.2
}))
for (const f of ['a.png', 'b.png', 'c.png']) fs.writeFileSync(path.join(SDIR, f), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

const all2 = await T.inspectAnimations()
const slides = all2.list.find((a) => a.id === 'feature-slides')

ck('幻灯片：files[] 上架，slide 标真，file 保留为第一张', () => {
  assert.ok(slides, 'feature-slides 没上架')
  assert.equal(slides.slide, true)
  assert.deepEqual(slides.files, ['a.png', 'b.png', 'c.png'])
  assert.equal(slides.file, 'a.png')
  assert.equal(slides.kind, 'image')
})

ck('幻灯片：hold / fade / gap 各就各位；duration = n*hold + (n-1)*gap', () => {
  assert.equal(slides.hold, 2)
  assert.equal(slides.fade, 0.4)
  assert.equal(slides.gap, 0.2)
  assert.equal(slides.duration, 6.4)
})

ck('幻灯片：体积是几张图之和', () => {
  assert.equal(slides.size, 12)
})

const rOk = await T.resolveMedia('feature-slides', 'b.png')
const rMiss = await T.resolveMedia('feature-slides', 'zzz.png')
const rEvil = await T.resolveMedia('feature-slides', '../a.png')

ck('媒体白名单：files[] 里每一张都放行；名单外 / 路径穿越都挡下', () => {
  assert.ok(rOk && rOk.file.endsWith('b.png'), 'b.png 没放行')
  assert.equal(rMiss, null)
  assert.equal(rEvil, null)
})

/* 动态锚点：从 2026-10-26 起找最近的某个星期几的某点钟（不硬编码星期） */
function dayShift(targetDow, hour) {
  const d = new Date('2026-10-26T04:00:00')
  while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d
}

ck('星期：不勾 = 不限（旧配置行为不变，任何一天都命中）', () => {
  const c = T.normalize({ schedules: [{ from: '00:00', to: '23:59', animation: 'a' }] }, ['a'])
  assert.equal(T.pickAnimation(anims, c, dayShift(1, 10)).id, 'a')
  assert.equal(T.pickAnimation(anims, c, dayShift(0, 10)).id, 'a')
  assert.equal(T.pickAnimation(anims, c, dayShift(6, 10)).id, 'a')
})

ck('星期：只勾周日 → 周日命中，周一不命中', () => {
  const c = T.normalize({ animation: 'a', schedules: [{ from: '00:00', to: '23:59', animation: 'b', weekdays: ['SU'] }] }, ['a', 'b'])
  assert.equal(T.pickAnimation(anims, c, dayShift(0, 10)).id, 'b', '周日没命中')
  assert.equal(T.pickAnimation(anims, c, dayShift(1, 10)).id, 'a', '周一不该命中')
})

ck('星期 × 跨零点：按「现在这一刻」算 —— 周日凌晨算周日，周六凌晨不算', () => {
  const c = T.normalize({ animation: 'a', schedules: [{ from: '22:00', to: '06:00', animation: 'b', weekdays: ['SU'] }] }, ['a', 'b'])
  assert.equal(T.pickAnimation(anims, c, dayShift(0, 2)).id, 'b', '周日 02:00 该命中')
  assert.equal(T.pickAnimation(anims, c, dayShift(6, 2)).id, 'a', '周六 02:00 不该算周日')
})

ck('normalizeSchedules：weekdays 去重 + 剔掉非法代号', () => {
  const c = T.normalize({ schedules: [{ from: '01:00', to: '02:00', animation: 'a', weekdays: ['SU', 'SU', 'XX', 'MO'] }] }, ['a'])
  assert.deepEqual(c.schedules[0].weekdays, ['MO', 'SU'])
})

ck('normalize：transition 合法保留、非法回落 fade', () => {
  assert.equal(T.normalize({ transition: 'wipe' }, known).transition, 'wipe')
  assert.equal(T.normalize({ transition: 'sparkle' }, known).transition, 'fade')
})

ck('normalize：maxSlides / maxSlideMB / maxBatchMB 夹取与回落', () => {
  assert.equal(T.normalize({ maxSlides: 0 }, known).maxSlides, 1)
  assert.equal(T.normalize({ maxSlides: 99999 }, known).maxSlides, 999)
  assert.equal(T.normalize({ maxSlideMB: -5 }, known).maxSlideMB, 1)
  assert.equal(T.normalize({ maxSlides: 'x' }, known).maxSlides, 100)
  assert.equal(T.normalize({ maxBatchMB: 'x' }, known).maxBatchMB, 1024)
})

ck('播放器：幻灯片序列 + 四种转场类（js 与 css 都在）', () => {
  assert.ok(splashSrc.includes('mountSlides'), 'splash.js 丢了幻灯片序列')
  assert.ok(splashSrc.includes('state.slidesForever'), 'splash.js 丢了「一直停」联动')
  assert.ok(splashSrc.includes('dos-tr-'), 'splash.js 缺转场类前缀')
  for (const t of ['dos-tr-fade', 'dos-tr-zoom', 'dos-tr-flash', 'dos-tr-wipe']) {
    assert.ok(cssSrc.includes(t), 'splash.css 少了 ' + t)
  }
})

ck('面板：导入幻灯片按钮 / 调顺序 / 编辑时间 / 转场选择 / 星期按钮都在', () => {
  assert.ok(clientSrc.includes('导入幻灯片'), 'client.js 少了幻灯片导入按钮')
  assert.ok(clientSrc.includes('slideOrder'), 'client.js 少了调顺序')
  assert.ok(clientSrc.includes('slideMeta'), 'client.js 少了编辑时间参数')
  assert.ok(clientSrc.includes('转场效果'), 'client.js 少了转场选择')
  assert.ok(clientSrc.includes('weekdays'), 'client.js 少了星期按钮')
})

/* ── 收尾 ─────────────────────────────────────────────────────────── */
try {
  fs.rmSync(HOME, { recursive: true, force: true })
} catch {}

console.log('============================')
console.log('  通过 ' + pass + ' / 失败 ' + fail)
console.log('============================')
process.exit(fail ? 1 : 0)