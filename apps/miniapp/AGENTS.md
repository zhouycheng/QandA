# apps/miniapp — Agent Notes

WeChat mini program. **Native JS, zero npm, zero build.** Architecture and file map live in
`README.md` next to this file; the requirement baseline is `../../docs/prd/miniapp-mvp.md`.
This file only covers two things: **how to verify a change**, and **traps already paid for**.

## 1. Always verify — compiling is not passing

Run everything from `apps/miniapp/`.

```sh
# 1) Offline self-checks (24 suites, plain Node, no devtools needed)
for f in tests/*.check.js; do
  node "$f" || exit 1
done

# 2) The real compiler (fixed path on Windows + Git Bash)
WCC="/d/Program Files x86/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec"
"$WCC/wcc.exe" $(cd miniprogram && find . -name "*.wxml") > /tmp/wcc.log 2>&1
grep -cE '\.wxml:[0-9]+:[0-9]+' /tmp/wcc.log          # expect 0

(cd miniprogram
 "$WCC/wcsc.exe" -lc app.wxss | grep "^ERR" && echo "ERR app.wxss"
 # 带 @import 的页面必须把被 import 的文件当额外参数传进去，
 # 否则每个都会报「path ../../styles/xxx.wxss not found」——那是传参问题，不是代码问题
 for f in page/account/index.wxss page/my/index.wxss page/stats/index.wxss page/reminder/index.wxss \
          page/login/index.wxss page/register/index.wxss page/forgot-password/index.wxss; do
   "$WCC/wcsc.exe" -lc "$f" styles/list-page.wxss styles/auth-form.wxss | grep "^ERR" && echo "ERR $f"
 done)
```

Three counter-intuitive details:

- `wcsc.exe` **always exits 0**. You must grep the output for `^ERR`.
- Usage is `<root_css_file..> [import_css_files..]` — a page wxss whose `@import` targets aren't passed
  as extra arguments reports `path ... not found` even though the relative path is right. `-lc app.wxss`
  alone therefore only ever validates the global stylesheet, and 7 pages were silently unchecked before.
- `wcc.exe` reports real errors as `file.wxml:line:col`. **Never `grep -i error`** — its generated
  code legitimately contains `console.error` and the string `"not found"`, so that always false-positives.
- After editing sources from the CLI, `touch` the file. The devtools compile incrementally by mtime,
  so a same-second edit can be skipped.

## 2. Hard rules

1. **No `package.json`** anywhere (repo root or `miniprogram/`). No TypeScript.
2. Modules loaded with `require` must be **flat files** — WeChat does not compile `<dir>/index.js`.
3. `require` has no dynamic paths. New question banks must be registered in
   `utils/question-bank-catalog.js` → `BANK_LOADERS`.
4. Layering: Page (wx APIs only) → ViewModel (returns `{ data, command? }`) → Model/utils (pure).
   Repository is the single data exit point. Pages funnel results through `applyViewModelResult()`.
5. WXSS limits: no `*` selector; `.p > :nth-child(1)` must be written `.p > view:nth-child(1)`;
   **`background-image` cannot reference a local file** — base64 or network only. That is why every
   icon in this project is an inlined SVG data URI.
6. **Multiple edits to the same file must be serial.** Parallel edits each apply to their own snapshot
   and silently overwrite each other.

## 3. Traps already paid for

### Custom tabBar (highest risk)

- **It always paints above page content; `z-index` never wins.** Any page-level `position: fixed`
  overlay (`bottom-sheet`, `route-loading`) gets covered.
  Fix: use `bottom-sheet`'s `placement="center"`, and call `getTabBar().setHidden(true)` while an
  overlay is open — with `display: none`, not `opacity: 0` (that stays invisible but still eats taps).
  Every page that hides it must call `setHidden(false)` in `onShow` as a safety net.
- **It reserves no bottom space.** The native tabBar did. Tab pages need
  `padding-bottom: 272rpx` (plus `env(safe-area-inset-bottom)`); `bank-detail` uses
  `height: calc(100vh - 272rpx)`.
- **Selected state does not follow the page.** All four tab pages must call
  `getTabBar().setSelected('<page path>')` in `onShow`, or the highlight sticks to the wrong tab.
- **Never let an absolutely positioned layer span the full bar.** `.continue-label` (the 「继续答题」
  caption) once used `left: 0; right: 0`. It sits at the same height as the four tab captions and comes
  later in the DOM, so it swallowed every tap on 首页/题库/复盘/我的 — tapping 复盘 launched the practice
  page. It is now a 130rpx block centred on the circle. Any new overlay inside `.tabbar-wrap` must stay
  inside its own slot; `tests/custom-tabbar.check.js` asserts it.
- Tab captions: 首页 / 题库 / **复盘** / 我的. The third tab's route is still `page/stats/index` (changing
  a tab route means touching `app.json`, deep links and four test files for zero user value) — only the
  product name changed.

### Layout and visuals

- **`mode="aspectFill"` requires the image ratio to equal the container ratio**, otherwise edges are
  cropped. The three `assets/home/cover-*.jpg` are cut to the card's 686:320; changing the card height
  means re-running `scripts/prepare-home-covers.cjs`. `tests/home-prototype.check.js` decodes each JPEG
  header and asserts the ratio.
- White text over an illustration needs a **darkening veil**, and the gradient must stay opaque across
  the exact horizontal range the text occupies.
- Frosted glass with `blur` alone reads gray — pair it with `saturate()`.
- Stacking a light glyph on a light glyph merges into one blob; separate with a stroke or a value step.
- Tappable elements need `hover-class` **and** `hover-start-time="0"` (the 50ms default swallows quick
  taps). The full feedback rules sit in a comment block in `app.wxss` — read it before changing them.

### Data and import

- **Excel-exported CSV is GBK by default.** The importer only falls back to GBK after seeing U+FFFD.
- Header aliases must stay lowercase (`normalizeHeader` lowercases before matching). An uppercase alias
  silently never matches, which shows up as "every row reports missing options".
- `wx.chooseMessageFile` **can only pick files from WeChat chats**, not the system file picker.
- Parse `textarea` input on `bindblur`, not `bindinput` — the latter re-parses the whole table per
  keystroke and freezes the input.

### WeChat platform

- `getUserProfile` / `getUserInfo` are deprecated (the self-check fails if any file calls them). Avatar
  and nickname editing live in `page/account` (`781:2123`): use `<button open-type="chooseAvatar">` +
  `copyFileSync` into `wx.env.USER_DATA_PATH` (temp paths expire) and `<input type="nickname">`.
- `project.config.json` → `useMultiFrameRuntime` **must stay `false`**. When true, in-page `bindtap`
  stops working entirely and compilation still succeeds.
- **Custom components have isolated styles.** Official wording: 「除继承样式外，app.wxss 中的样式、
  组件所在页面的样式对自定义组件无效」. So a component that writes `hover-class="card-hover"` while the
  rule only exists in `app.wxss` taps with **no visual feedback at all** — and nothing fails to compile.
  Two real leaks found this way: `bank-list-item` (`card-hover`, now `chapter-hover`) and
  `question-overview-sheet`
  (`.panel-btn.primary` — the blue fill leaked in from the page only inside the preview HTML, which
  concatenates both stylesheets into one document). Every class a component uses, including modifier
  classes like `primary` / `accent` / `danger`, must be defined in **its own** WXSS.
  `interaction-audit.check.js` check 7 enforces this.

### Auth pages (email + password, per Figma)

- Three pages: `page/login` (763:567), `page/register` (772:1036), `page/forgot-password` (772:1076).
  Shared styles live in `miniprogram/styles/auth-form.wxss`; each page WXSS only carries its own
  spacing deltas. Design scale: board is 402px wide → **rpx = px × 1.8657** (36px → 67rpx,
  52px field height → 97rpx, 48px button → 90rpx, 12px radius → 22rpx).
- Validation is a single pure module: `utils/auth-form.js` (`validateLogin` / `validateRegister` /
  `validateReset`). Don't re-implement rules inside pages.
- **Degrade only when the backend is `unavailable`.** Every gateway result carries `unavailable`
  (`true` = never connected: no `baseUrl`, network fail, gateway threw). Only that case falls back to a
  local identity derived from the email (`email_<hash>`). A real rejection — HTTP 4xx/5xx with a body —
  must surface the server message and **must not create a login**, otherwise a wrong password would
  silently log the user in once a backend exists. `sendCode` follows the same rule: `unavailable` →
  "verification skipped" + cooldown; real rejection → toast with the reason and **no cooldown**
  (a cooldown would white-lock the button for 60s).
- **Passwords are never written to storage** — the self-check asserts it.
- The verification-code cooldown is driven by an **absolute end time** (`utils/cooldown.js`,
  `page.cooldownEndAt`), never by `cooldown - 1` per tick. `onHide` stops the interval only; `onShow`
  calls `cooldown.resume(this)`. Self-decrement freezes the counter when the app is backgrounded, and
  the resend button then stays dead until the page is re-entered.
- The `cooldown` data field is **initialised by `cooldown.getInitialCooldownData()`**, not hardcoded as
  `{ cooldown: 0 }` inside `Page({ data: ... })`. A field that exists solely in a page's own `data:`
  literal, and in no module's `getInitial*Data()`, is invisible to the WXML data-binding audit and ends
  up reported as undefined. Any page-only UI state therefore has to be initialised by the module that
  owns it.
- Inputs are deliberately uncontrolled in the `bindinput` path: the page writes back only
  `errorField` / `submitting`, never `value`, otherwise the cursor jumps to the end on device.

### Settings hub: `page/my` + `page/account` + `page/reminder` (Figma 781:1922 / 781:2123 / 781:2043)

- **`page/my` is the only entry point.** It is a navigation hub (profile header, 账号管理, 学习设置,
  其他, 法律协议). Account state must not be duplicated elsewhere — `page/settings` deliberately has no
  account group any more, and `tests/my-hub.check.js` asserts it stays that way.
- Rows are built in `MyViewModel` (`learnRows` / `otherRows` / `links`); the trailing value ("即时答案",
  "选项在下", "已开启") always comes from the real preference, never a hardcoded label.
- 退出登录 is the only destructive row; the page wraps it in `wx.showModal` first. It is hidden for
  guests so a tap never returns "当前没有登录状态".
- Shared layout lives in `miniprogram/styles/list-page.wxss` (same 750/402 scale as the auth pages:
  22px → 41rpx margin, 54px → 101rpx row, 48px → 90rpx button). Each page WXSS only carries deltas.
- **About / 用户协议 / 隐私政策 are center sheets** (`placement="center"`) on the tab page, and the tabbar
  must be hidden while they are open — `page/my` calls `setTabBarHidden(!!this.data.sheet)` right after
  `setData`, and re-shows it in `onShow`.
- `answerLayout` (`below` / `above`) is a real preference: `page/practice` swaps 题干/选项 with flex
  `order`, **never by reordering the DOM** — reordering children of the `scroll-view` resets scroll
  position.
- Email reminders (`utils/reminder-settings.js` + `repositories/reminder-repository.js`) store *intent*
  only (`qandaReminder`); sending is a backend job. Every control saves immediately, so `保存设置` is an
  idempotent confirm + back. `advanceDays` keeps at least one entry; exam name/date are validated in the
  pure module (past dates are allowed on purpose — 已结束 is a real state).
  `applyViewModelResult` does `setData(result.data)` wholesale — that's safe only because the value
  it writes is the same string the ViewModel already holds.

### Home 四宫格 `STUDY_ENTRIES` (recent / mock / wrong / favorite)

- ⚠️ **「模拟考试」是一键开考，不再让用户先去题库选科目**（用户明确要求）。`openMock()` 直接产出
  `scope=subject&mode=test&count&duration&seed` 的跳转；科目取「上次练过的那科」，没练过取题库第一个
  有题的科目；题量抽 20（不够就整科全量），时长=题量向上取整到 5 分钟、保底 10 分钟。
- 这条链路在 `tests/mock-exam-entry.check.js` 里锁死（含把链接喂给 `PracticeViewModel` 真开一场），
  退化场景（空题库）才允许吐 toast。

### Home countdown card: 早 / 中 / 晚 covers

- Three JPEGs (`assets/home/cover-morning|noon|evening.jpg`) swap by device hour.
  `utils/home-content.js` owns the rule: `getDayPart()` → `morning` (05–11) / `noon` (11–18) /
  `evening` (18–05), and `COVER_BY_DAY_PART` maps those to paths. `buildHomeContent()` returns both
  `dayPart` and `coverImage`, so the image and the greeting can never disagree — a separate hour check
  elsewhere would let 18:00 say "晚上好" while still showing the noon art.
- ⚠️ Greeting has five buckets (早上/中午/下午/晚上/夜深) but there are only **three** covers:
  中午+下午 share `noon`, 晚上+夜深 share `evening`. Don't "fix" this asymmetry — three images was the
  requirement.
- ⚠️ **All three JPEGs must be cut with the identical crop window** (`scripts/prepare-home-covers.cjs`,
  `CROP_TOP = 80`). The three scenes differ, so if the window drifts the card visibly jumps as the hour
  changes.
- Each cover is exactly `686rpx : 320rpx`. Same ratio as `.exam-card` — `aspectFill` then does no
  cropping, so the composition can't be half-cut.
- **The source art is the user's own** (`design/home-covers/{morning,noon,evening}.jpg`, 1672×941,
  committed outside the mini program bundle). They picked these; do **not** regenerate or "improve" them.
  Only the compressed crops live under `miniprogram/assets/home/`.
- Output is 960×448 at JPEG q76 (≈62–86KB each, ≤230KB total). These are realistic paintings, not flat
  vector gradients — the old 3×36KB figure was for the previous flat-vector set and no longer applies.
- ⚠️ `edge --screenshot` **cannot set JPEG quality**, which is why the script drives the DevTools protocol
  (`Page.captureScreenshot` with `quality`) instead. Node 22's global `WebSocket` makes that dependency-free.
  Pillow is not installed and `pip install` doesn't work in this environment.
- `.exam-veil` is tuned for **full-bleed** artwork: a horizontal gradient alone can't hold white text on
  a bright window, so it also carries a bottom-up scrim. Weakening it "because it looks dull" will make
  修改/金句 unreadable on the noon and morning images.
- The source art is generated (image-to-image from the noon frame, `input_fidelity: high`) and lives in
  `.tmp-preview/covers/` (gitignored). Only the cropped output is committed.

### 答题 page (`page/practice`)

Rewritten against the 2026-10-27 design board (练习模式 / 即时模式 / 答题卡 / 答题结果). Classes are
prefixed `pra-` (question flow) and `res-` (result page); the old `question-area` / `option` /
`footer-btn` / `sheet-*` names are gone.

- Fixed three-band layout: 页内标题 + 细进度条 + 信息行 (no scroll) + `scroll-view.pra-body` (scrolls) +
  `.pra-footer` (no scroll). `flex: 1; min-height: 0` on the middle band, never `height: calc()` — the
  keyboard and safe-area resize break the math.
- 系统导航标题留空（`index.json` 的 `navigationBarTitleText: ""`），标题由页内 `.pra-head` 画：
  返回箭头 + 题库名 + `practiceSubtitle`（`MODE_LABELS` + 题数，**不要写死章节名**，题库里没有章节字段）。
- 题干/选项 order is switched with **flex `order`** on `.pra-content-above`, not by reordering the DOM:
  reordering `scroll-view` children resets the scroll position.
- 底部结构是「工具行（收藏 / 答题卡 / 标记）+ 两个等宽按钮」。收藏和答题卡从顶部移到这里，
  所以顶部只剩 `7/12` 纯文字题号 —— 别再把图标塞回题号胶囊。
- Prefer `opacity`-only hover classes here (`pra-option-hover`, `chip-flat-hover`, `btn-flat-hover`).
  `interaction-audit.check.js` fails on **any** `transform:` inside a hover class that lives in a
  scroll-view — `transform: none` does not satisfy it, the declaration has to be absent.
- ⚠️ The result page's 答题卡 grid iterates `overviewItems`, and `finish()` must refresh it with the
  final `answers` (`currentIndex` = `-1`, so no cell is highlighted). Reusing the pre-submit snapshot
  paints every cell grey — `answered` is still `false` in it.
- 解析 is collapsed by default (`explanationOpen`, 5-line clamp) with a 展开/收起 toggle; the flag is
  reset whenever `currentIndex` changes. `elapsedText` is frozen at submit so 用时 stops ticking.
- **标记 (mark) 是 2026-10-27 新增的能力**，和收藏刻意分开：收藏跨会话（`qandaFavorites`），标记属于这一轮
  练习（`markedIds` 跟着 `qandaSession` 走，`reset()` 清空）。答题卡的橙点是**绝对定位的右上角小圆点**，
  不占题号位置。
- ⚠️ 会话恢复走的是 `session.restore(saved)`，**不是**构造函数里的 `restored` 分支 —— 新字段必须在
  `restore()` 里恢复，否则「重新进来记号没了」。同理，`ViewModel.load()` 只认 `sessionId` / `resume=1`，
  只传 `bankId` 是新建一轮，写测试时容易误判成「没存住」。
- **答题卡 (`components/question-overview-sheet`) 只区分「答没答」，不区分「对不对」**：格子是
  已答 `#B6E7D2` / 未答 白底虚线框 / 当前 `#466BFF` / 橙点=标记，图例文案是 已答·未答·当前·标记。
  按对错染色等于在考试模式下当场泄题（`isCorrect` 在提交前就已经算好了）。结果页的 `res-cell`
  才按 答对/答错 上色 —— 那时已经交卷了。
- 答题卡按钮是**三态**（对应设计稿三个面板）：还有未答 → 确认结束(红描边) + 继续答题(蓝)；
  已答完且有标记 → 继续答题 + 含标记，前往查看(橙)，确认结束另起一行；已答完无标记 →
  继续答题 + 确认结束(橙实心，交卷是唯一主操作)。改文案/顺序时三态要一起看。
- `scripts/preview-practice.cjs` 渲染 6 个面板（练习模式 / 即时模式 / 三个答题卡 / 结果）。
  它把 app+page+component 三份 WXSS 拼进同一个 HTML，**看不出组件样式隔离的问题** —— 组件类名缺失
  只能靠 `interaction-audit.check.js` 第 7 项查。

### 题库 page (`page/bank-detail`)

Rewritten against the 2026-10-27 board (章节列表 + 答题配置抽屉). Old `mode-seg` / `action-row` /
`list-head` / `option-chip` / `confirm-btn` blocks are **gone**; parameters now live in the sheet.

- 页内标题「题库」+ 搜索 + 筛选，`index.json` 的 `navigationBarTitleText` 留空。页头是
  `.bank-detail-page`（flex column）的第一段，`.workbench` 用 `flex: 1; min-height: 0` 吃掉剩下的高度 ——
  `custom-tabbar.check.js` 同时要求 `.bank-detail-page` 里有 `height: calc(`、`.workbench` 里有 `height: 100%`
  （`flex: 1` 的 basis 是 0，`height` 不参与主轴计算，留着是为了那条断言，别删）。
- 左栏 = 最近在刷 / 我的错题 / 我的收藏 / 科目… / 导入题库。选中项**白底 + 蓝色左条**（与右侧白面板同色，
  侧边标签页的常见做法），选中文字是深色粗体而不是品牌蓝。
- 列表**一行一章**：`components/bank-list-item` 现在是一条灰条（`chapter-row`），只显示
  `第N章：名称` + 右侧 `已做/总数`。题库数据里没有章节字段，`第N章` 是行序号；名称本身已带序号
  （「第一单元」）时不再叠一层。点一行 = 配这一章的参数。
- **抽屉里的开关都是「本次答题」的参数，不写学习偏好**。「解析自动展开 / 答对自动翻页」这类偏好只在
  「我的」页维护 —— 同一个状态两处能改，迟早出现「我明明关了又自己开了」。
- ⚠️ 整科 + 只答错题时**不能**带 `scope=subject`：答题页先判 `scope === 'subject'` 再判 `ids`，
  带上就把错题筛选静默吃掉。只答错题一律走 `ids=`（取卷后与错题本求交，题目 id 和题库 id 不同前缀，
  不能靠字符串前缀过滤）。
- 背题模式固定原顺序，顺序项变灰并在点击时 toast 说明；模拟考默认开限时（5/10/15/20 分钟）。
- 搜索是跨科目的（索引由目录一次性建成）。`handleSearchInput` **不把 `searchKeyword` 写回 data**：
  回写的是 trim 过的值，敲空格时光标会被拽回行尾。
- `scripts/preview-bank-detail.cjs` 渲染 3 个面板（章节列表 / 搜索 / 答题配置），数据来自真实
  `BankDetailViewModel`，底栏是静态还原（只为看位置与比例）。

### 复盘 page (`page/stats`, tab caption 复盘)

- Shape: range switcher (近 7 天 / 近 30 天 / 累计) + three metrics + **错题本 / 收藏本两张入口卡** +
  half-year heatmap + trend curve.
  `StatsViewModel` keeps `overall` / `wrongCount` / `favoriteCount` for other callers, but the page no
  longer renders them — the old 环形进度 / 六维雷达 / 科目进度 / 历史最佳 blocks are gone.
- 入口卡是**跳转**不是展开：`entries.wrong.url = /page/wrong-book/index?type=wrong`，收藏同理。两个页面
  是 `navigateTo` 的二级页（不是 tab），所以题库页左栏不再有这两个入口 —— 用户指定「放在复盘里」。
- 入口卡摘要只写**算得出来**的东西：错题本只有 `updatedAt`，所以是「近 7 天更新 N 道」而不是「新增」
  （答对一次也会刷新 `updatedAt`，写「新增」会虚报）；收藏只存 id 列表、没有逐条时间，给「待练习 N 道」。
- `setRange()` returns `null` when the range is unchanged, and only recomputes metrics + trend
  (`activity` / `identity` are deliberately not in its payload, so `setData` cannot re-decode the
  heatmap data URI on every tap).
- Heatmap = 26 columns × 7 rows, weeks starting Monday, last column is the current week and may be
  partial. `HEAT_LEVELS = [0, 1, 5, 10, 20]` are **fixed** thresholds, not normalised per dataset —
  otherwise the same amount of work changes colour from week to week.
- Because the heatmap is "近半年", `utils/daily-log.js` keeps **190** days (was 90). Pruning still runs
  on every write, so storage stays ~8KB.
- ⚠️ `daily-log`'s `shiftDays` / `formatDateKey` accept **timestamps only**. Passing
  `'2026-10-27T00:00:00'` gets through `Number()` as `NaN` and silently falls back to *now*, which draws
  the whole heatmap anchored to today. Split the `YYYY-MM-DD` key and build a real `Date` first.
- Charts live in `utils/chart-svg.js`: `buildHeatmapSvg` (grid + month labels) and `buildAreaTrendSvg`
  (Catmull-Rom smoothed line + gradient area). Both are pure string builders, so they're asserted in
  Node; `scripts/preview-review.cjs` renders the page from **real ViewModel output**.

### 错题本 / 收藏本 (`page/wrong-book`, 二级页)

- 一个页面承载两种模式（`type=wrong|favorite`），标题、统计口径、空态、底部按钮全由 `WrongBookViewModel`
  按 `type` 决定；WXML 只有一份。页面**不挂 tabBar**（`navigateTo` 进来的），所以没有 272rpx 让位。
- 顶部「返回 + 居中标题 + 管理」是页内自绘（`navigationBarTitleText` 留空），和答题页同一套做法。
- ⚠️ 错题本的「正确率」必须按**本子里这些题**的 `rightCount / (rightCount + wrongCount)` 算。
  直接取全站近 7 天正确率会显示成 80% 这种漂亮数字 —— 一个错题本号称正确率 80%，用户第一眼就不信。
  该口径由 `readBookAccuracy(items)` 提供，`wrong-book-favorite.check.js` 有断言锁死。
- 收藏本没有逐条时间戳，「最近保存」是按收藏列表顺序（`saveFavorites` 每次都把新收藏放最前）。

## 4. Generator scripts (edit the script, not the output)

| Script | Purpose |
| --- | --- |
| `scripts/inline-entry-icons.cjs` | Home grid icons; idempotently rewrites base64 in WXSS |
| `scripts/prepare-home-covers.cjs` | 早/中/晚 covers: crops the user's originals with one shared window via CDP (quality-controlled JPEG) |
| `scripts/preview-home.cjs` | Renders the real WXSS at 375px; states `configured\|today\|past\|empty\|modal` |
| `scripts/preview-home-covers.cjs` | The countdown card × three day-parts side by side (checks nothing jumps) |
| `scripts/preview-practice.cjs` | 答题页四态并排（答对 / 答错 / 答题卡 / 结果），跑真实 `PracticeViewModel` |
| `scripts/preview-bank-detail.cjs` | 题库页三态并排（章节列表 / 搜索 / 答题配置），跑真实 `BankDetailViewModel` |
| `scripts/preview-review.cjs` | 复盘 / 错题本 / 收藏本 三面板并排，全部跑真实 ViewModel（含真实 SVG 图） |
| `scripts/preview-auth.cjs` | Renders login / register / forgot-password side by side at the 402px design width |
| `scripts/preview-my.cjs` | Renders 我的 / 账号管理 / 邮箱提醒 side by side at 402×874 (Figma 781:1922 / 781:2123 / 781:2043) |
| `scripts/import-question-bank.cjs` | CSV/TSV/JSON → `data/banks/` |
| `scripts/generate-tabbar-icons.cjs` | tabBar icon PNGs |

Preview output goes to `apps/miniapp/.tmp-preview/` (gitignored). Screenshot it with headless Edge
instead of opening the devtools for every visual tweak. Preview scripts inject the real WXSS, so the
outer layout wrapper must **not** reuse class names the pages define (`.row`, `.tag`, `.card` …) —
that silently inflates row heights and the comparison becomes worthless.

## 5. Git

See `docs/git-workflow.md`. Branch naming is `name/type/description` (personal prefix, e.g.
`curry/feat/...`), merge via PR + squash, **never push to main directly**.
