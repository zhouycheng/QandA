# QandA 微信小程序端

刷题系统的微信小程序端。当前为 **Independent MVP**：不依赖后端接口，用本地题库快照跑通完整练习闭环。

需求基线见 [miniapp-mvp.md](../../docs/prd/miniapp-mvp.md)，Git 协作规则见 [git-workflow.md](../../docs/git-workflow.md)。

## 技术选型

```text
微信原生小程序（JavaScript，非 TypeScript）
WXML / WXSS / 原生组件
零 npm 依赖、零构建步骤
```

**这是一个刻意的决定。** 项目不引入 MobX、TDesign 或任何 npm 包，因此：

- 打开开发者工具即可编译，**不需要执行「构建 npm」**；
- 不存在 `.ts` 编译环节，也就没有 TS 插件、增量编译缓存、`miniprogram_npm` 这一整类问题；
- 包体约 1 MB（题库数据 417 KB + 图片资源 314 KB），首屏无需等待依赖解析。

状态管理采用 **Page / ViewModel / Model 三层分工**，不引入状态库：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Page | `page/` | 只调用微信 API（setData、路由、Storage、定时器），不含业务判断 |
| ViewModel | `viewmodels/` | 承接页面意图，组合 Repository 与 Model，返回 `{ data, ...副作用 }` |
| Model | `models/` | 纯业务逻辑（答题、判分、计时），不碰微信 API |
| Repository | `repositories/` | 数据读取的唯一出口，未来换服务端只改这里 |

数据流是单向的：`Page 事件 → ViewModel 方法 → Model 计算 → 返回 data → Page setData`。

## 目录结构

```text
apps/miniapp/
├── project.config.json       小程序项目配置（miniprogramRoot = miniprogram/）
├── scripts/                  构建期脚本，不参与小程序运行
│   ├── generate-tabbar-icons.cjs   SVG → tabBar 图标 PNG
│   ├── generate-home-icons.cjs     首页内联图标生成并注入 wxss
│   ├── generate-menu-icons.cjs     菜单页（我的 / 设置）图标生成并注入 wxss
│   └── optimize-banner.cjs         PNG 裁剪 / 降采样 / 重编码
└── miniprogram/
    ├── app.js / app.json / app.wxss / sitemap.json
    ├── page/                 页面
    │   ├── subject-list/     首页：欢迎横幅 + 公告 + 学习数据（tabBar）
    │   ├── bank-detail/      题库：科目工作台，科目切换、练习方式、题库进度（tabBar）
    │   ├── stats/            统计：环形总览 + 六维雷达 + 近 7 天趋势 + 科目进度（tabBar）
    │   ├── practice/         答题、看题、模拟测试、成绩回顾
    │   ├── my/               我的：资料卡 + 数据快照 + 学习工具 + 设置入口（tabBar）
    │   ├── settings/         设置：学习偏好、账户与安全、关于
    │   └── wrong-book/       错题本与我的收藏（双 tab）
    ├── components/           自定义组件
    │   ├── bank-list-item/           题库列表项
    │   ├── bottom-sheet/             通用底部弹层
    │   ├── question-overview-sheet/   答题卡弹层
    │   └── route-loading/            跳转加载层
    ├── viewmodels/           页面 ViewModel（每页一个）
    ├── models/
    │   └── practice-session.js   答题会话：作答、判分、跳题、计时、结果
    ├── repositories/
    │   ├── practice-repository.js      题库与练习的数据出口（聚合以下各仓储）
    │   ├── progress-repository.js      做题进度读写（storage 由页面注入）
    │   ├── wrong-book-repository.js    错题本读写
    │   ├── favorite-repository.js      收藏夹读写
    │   ├── custom-quiz-repository.js   自定义练习卷（错题重练 / 收藏练习）
    │   ├── preference-repository.js    学习偏好读写
    │   ├── daily-log-repository.js     每日学习日志读写
    │   └── study-time-repository.js    学习时长读写
    ├── utils/
    │   ├── base64.js                 UTF-8 安全的 base64 编码（图表转 data URI 用）
    │   ├── chart-svg.js              雷达图 / 趋势图 / 环形进度图的 SVG 生成（纯字符串）
    │   ├── preferences.js            学习偏好默认值、开关与选项定义
    │   ├── daily-log.js              每日学习日志的累加、连续天数与近 N 天序列
    │   ├── study-insight.js          统计口径：雷达六维归一化与趋势序列
    │   ├── question-bank-catalog.js  题库清单归一化、抽题与打散
    │   ├── question-lookup.js        按题目 id 反查正文（错题本 / 收藏用）
    │   ├── practice-progress.js      进度与正确率计算（纯函数）
    │   ├── wrong-book.js             错题本合并与攻克规则（纯函数）
    │   ├── favorites.js              收藏夹增删查（纯函数）
    │   ├── custom-quiz.js            自定义练习卷结构（纯函数）
    │   ├── study-time.js             学习时长累计与格式化（纯函数）
    │   ├── daily-quotes.js           每日语录取值（纯函数）
    │   ├── home-content.js           首页问候语 / 建议 / 公告组装（纯函数）
    │   └── wx-storage.js             本地存储适配器
    ├── data/
    │   ├── catalog.js        题库清单（运行态 require）
    │   └── banks/            各题库题目，`.js` 运行 + `.json` 审阅
    └── assets/
        ├── tabbar/           tabBar 图标（8 个 PNG，由构建期脚本生成）
        └── home/             首页插图（1 张 PNG，由构建期脚本压缩）
```

### 关于 tabBar 图标

微信 tabBar 只接受本地图片，不支持 SVG 或 base64，所以图标是**构建期生成**的一次性产物：

```sh
NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
  node apps/miniapp/scripts/generate-tabbar-icons.cjs
```

脚本用 `@resvg/resvg-js` 把 24×24 的描边 SVG 渲染成 81×81 PNG，与页面内联图标共用同一套网格，视觉语言一致。
改图标只改脚本里的 `ICONS` 再重跑，不要手工编辑 PNG。**运行时依旧零 npm 依赖**——脚本只在生成图标时用到外部库。

### 关于首页插图

首页顶部的书桌插画同样是构建期的产物，用脚本处理而不是手工编辑：

```sh
node apps/miniapp/scripts/optimize-banner.cjs <源图.png> \
  miniprogram/assets/home/banner-study.png --crop-bottom=56 --width=702 --quantize=2
```

环境里没有 sharp / jimp 这类图像库，脚本用 Node 内置的 `zlib` 直接实现 PNG 编解码，做三件事：

1. **裁剪** —— 去掉出图工具打在右下角的水印（`--crop-bottom=56`）；
2. **盒式降采样** —— 1024px 宽降到 702px，正好对应 2 倍屏下 702rpx 的展示宽度；
3. **色阶量化 + 逐行最优滤波** —— 每通道丢弃低 2 位，配合按行择优选滤波，885KB → 301KB。

横幅上的白色文字靠 `.banner-veil` 的渐变蒙层保证可读性，换任何插画都不需要调文字颜色。

页面里的线性图标（公告喇叭、数据网格、四个指标、每日一句引号）则由 `generate-home-icons.cjs`
生成并直接注入 wxss 的 `background-image`，脚本按 class 名定位、可重复执行。

「我的 / 设置」页的菜单图标同理，由 `generate-menu-icons.cjs` 生成 10 个图标
（`switch / shield / info / wrong / star / trash / lock / mail / logout / user`），
统一写成 `.mi-tile-<name>` 色块 + `.mi-<name>` 图标两层，换配色与换图标互不干扰。

### 关于统计页图表

统计页的三张图（环形进度、六维雷达、近 7 天趋势）**不用 canvas，也不用任何图表库**，
由 `utils/chart-svg.js` 直接拼 SVG 字符串，再经 `utils/base64.js` 编成 `data:image/svg+xml;base64,...`
交给 `<image>` 渲染：

- 省掉 canvas 的 DPR 换算、节点查询与绘制时序问题，纯计算可在 Node 里断言；
- 图表是「一次性算好的字符串」，页面只负责显示，不做任何绘制逻辑；
- 字号要按 viewBox 折算：viewBox 宽 640 对应实际约 654 rpx，因此 `font-size="20"` 约等于 20rpx，
  照搬页面字号（如 24rpx）在图里会偏大，脚本里已按 20–28 档调过。

## 运行

1. 微信开发者工具 → 导入项目，目录选 **`apps/miniapp`**。
2. AppID 选择测试号，或使用自己的 AppID（`project.config.json` 中 `appid` 当前为占位值 `touristappid`）。
3. 点「编译」（`Ctrl + B`）。

**不需要安装依赖，不需要「构建 npm」。** 项目根与 `miniprogram/` 下都没有 `package.json`。

### 控制台常见信息：哪些是真问题

刚导入项目时控制台会刷出下面这些内容，**其中只有一条与 AppID 有关，其余都是开发者工具自己的噪声**：

| 控制台信息 | 定性 | 处理 |
| --- | --- | --- |
| `请注意游客模式下，调用 wx.operateWXData 是受限的，API 的返回是工具的模拟返回` | 工具警告 | 见下方「游客模式」 |
| `Error: SystemError (appServiceSDKScriptError) {"errMsg":"webapi_getwxaasyncsecinfo:fail"}` | **真错误，但根因是缺 AppID** | 见下方「游客模式」 |
| `The resource http://127.0.0.1:20165/__dev__/WAServiceMainContext.js was preloaded using link preload but not used` | 工具自身的预加载提示 | 忽略 |
| `[渲染层错误] Listener added for a 'DOMNodeRemoved' mutation event` | Chromium 移除该事件，工具自身渲染层兼容提示 | 忽略 |

**为什么可以确定与业务代码无关**：`webapi_getwxaasyncsecinfo` 是基础库为「获取小程序异步安全信息」发起的请求，
需要真实 AppID 做签名。本项目**一处都没有调用**需要它的接口——全仓库搜不到 `wx.login`、`wx.getUserProfile`、
`wx.getUserInfo`、`open-data`、`wx.operateWXData`、`wx.checkSession`。所以游客模式下功能完全正常，
错误也不会阻断编译，只是红字会干扰看真正的报错。

### 游客模式：根因与修法

**根因**：`project.config.json` 里的 `appid` 是占位值 `touristappid`。工具检测到不是 `wx` 开头的合法 AppID，
就强制以游客身份运行，基础库随即调用 `webapi_getwxaasyncsecinfo` 并必然失败。

**修法（二选一）**：

- **A. 用自己的 AppID（推荐，毕设最终也需要）**
  1. 到 [微信公众平台](https://mp.weixin.qq.com) 注册小程序（个人主体免费），在「开发管理 → 开发设置」里复制 AppID；
  2. 把 `project.config.json` 第 5 行改成 `"appid": "wx????????????????"`；
  3. **完全退出开发者工具再重新打开**（改 AppID 后不重启，工具仍会沿用旧的游客会话）；
  4. 重新「编译」（`Ctrl + B`），控制台不再出现「游客模式」字样。

- **B. 用测试号（不占用已有项目的临时方案）**
  1. 开发者工具顶部工具栏右侧点「**详情**」→「项目配置」；
  2. 在 AppID 一栏点「**测试号**」，按提示用微信扫码，工具会分配一个真实的测试 AppID；
  3. 工具会把这个 AppID **自动写回 `project.config.json`**（不用手抄），点「确定」后重新编译即可。

  若 AppID 那一栏没有「测试号」入口，改用：**工具栏「项目」→「导入项目」**，目录仍选 `apps/miniapp`，
  在 AppID 输入框下方点「测试号」链接，效果一样。

两条路都做完后，控制台应该只剩上面表格里那两条「工具自身」的提示——那是可以一直忽略的。

**一个 AppID 能不能被多个本地项目复用**：能。AppID 只是「以谁的身份运行」，不绑定代码，
同一个 AppID 可以有任意多个本地项目，业务功能互不影响。唯一要留意的是
**真机预览 / 上传会占用该小程序的「开发版」**——两个活跃项目共用同一个 AppID 会互相顶掉开发版
（已发布的线上版本不受影响，动线上需要再走「提交审核 → 发布」）。

**团队协作时的建议**：`project.config.json` 是进 Git 的，把个人 AppID 写进去会带给所有人。
更好的做法是留在 `project.private.config.json`（已在 `.gitignore` 中，工具会自动生成，
且私有配置的优先级高于 `project.config.json`），`project.config.json` 里继续保留 `touristappid` 占位值。

### 编译报错「编译 .wxss 文件错误」：怎么拿到真实错误信息

**症状**：模拟器整屏变白（或只剩一个空壳），中间一行

```
编译 .wxss 文件错误，错误信息如上，可在控制台查看更详细信息
```

但**控制台里根本没有详情**（只有游客模式那几条无关警告），完全没法定位。

**原因**：WXSS 编译器**不支持通配符选择器 `*`**。用它就会整包停编译：

```css
/* ❌ 直接编译失败，报错位置精确到 token */
.stagger > *:nth-child(1) { animation-delay: 0ms; }

/* ✅ 显式写出子元素标签 */
.stagger > view:nth-child(1),
.stagger > text:nth-child(1) { animation-delay: 0ms; }
```

同一类「编译器不支持」的写法还有：`:nth-child(1)` 前面不带任何类型/类选择器（`.parent > :nth-child(1)` 同样报
`error at token ':'`）。**注意 `:nth-child(n + 10)` 里的空格是合法的**，`@keyframes`、类型选择器列表、
多行 `transition`、`var()` 这些也都支持——只有 `*` 是雷。

**拿到真实错误信息的两个办法**（都不需要靠猜测）：

**① 直接命令行调用工具自带的编译器**（最快，毫秒级，带文件行列号）

```bash
WCC="/d/Program Files x86/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec"
"$WCC/wcsc.exe" -lc app.wxss        # WXSS 编译器，-lc 开启 lint
"$WCC/wcc.exe"  $(find . -name "*.wxml")   # WXML 编译器
```

输出形如 `ERR: app.wxss(143:12): error at token `*``——**这就是开发者工具藏着不给你的那句话**。
本项目已把它固化成自检：`node tests/compile.check.js`。

**② 用开发者工具自己的日志反查是「哪次改动」触发的**

日志目录：`%LOCALAPPDATA%\微信开发者工具\User Data\<hash>\WeappLog\logs\*.log`，最新那个是当前会话。

```bash
# 报错发生的时刻
grep -a -o "2026-09-19 13:49:.*编译 .wxss" 2026-09-19-11-24-48-938.log
# 该时刻前后哪些文件被改过（关键证据：哪个文件一改就报错）
grep -a -o "2026-09-19 13:4[0-9].*onFileChange[^\"]*" 2026-09-19-11-24-48-938.log
```

本次就是这样定位的：`13:49:46 change miniprogram/app.wxss` → `13:49:49` 首次报错，凶手锁定在这一次改动里。

## 功能

### 底部导航（tabBar）

四个原生 tab（图标为构建期生成的 PNG）：

| tab | 页面 | 职责 |
| --- | --- | --- |
| 首页 | subject-list | 看今天该做什么：欢迎横幅 + 公告 + 学习数据 |
| 题库 | bank-detail | 切科目、选练习方式、进入单元 |
| 统计 | stats | 看数据：环形总览 / 六维雷达 / 近 7 天趋势 / 科目进度 |
| 我的 | my | 资料卡、学习工具、设置入口、清理本地数据 |

**科目列表不在首页。** 首页只回答「今天该做什么」，找科目是「题库」tab 的职责——
首页再放一份科目卡片，等于让用户在同一屏里做两次选择。

**题库既是 tab 页，又要能「带着科目进来」**：`wx.switchTab` 不支持 query 参数，所以从我的页等处跳题库时先把
`subjectId` 存进 `app.globalData.pendingSubjectId`，题库页 `onShow` 用 `consumePendingSubjectId()` 取走
（取走即清空，避免用户普通切 tab 时被重复消费）。这也是 `tests/tabbar-config.check.js` 中
「跳转方式与页面类型匹配」那条断言要守住的东西——用 `navigateTo` 打开 tab 页会直接失败。

### 首页（subject-list）

首页从上到下四段，全部随「时间与学习状态」变化，没有静态装饰：

| 区块 | 内容 | 数据来源 |
| --- | --- | --- |
| 欢迎横幅 | 书桌插画 + 按时段变化的问候语（早上好 / 中午好 / 下午好 / 晚上好 / 夜深了）+ 日期 + 针对性建议 + **每日语录** | `utils/home-content.js` / `utils/daily-quotes.js` |
| 公告条 | 有错题 → 指向错题本；有进度 → 指向题库；全新用户 → 起步引导。点击展开完整说明 | `utils/home-content.js` |
| 学习数据 | 顶部总题量 + 完成度条 +「去刷题」；下面 2×2 指标：已完成 / 错题 / 正确率 / 学习时长；右上角「详情」进统计 | 进度 + 错题本 + 学习时长 |
| 继续上次练习 | 按最近一次练习记录（`updatedAt` 最大）直接回到对应题库 | 进度 |

- **每日语录并入横幅**：语录压在插画底部的渐变蒙层上（`.banner-quote`），不再单独开一个文本框。
  取词规则仍是「一年中的第几天 % 语录池长度」，同一天稳定、次日自动更换。
- **文案与数字同源**：横幅建议、公告条、指标卡都由 ViewModel 里同一份 `summary` 推导，
  不会出现「横幅说还有 3 道错题、卡片写 5 道」这类前后矛盾。
- **指标卡是两行两列，不是 `flex-wrap` 的四宫格。** 早期用 `flex-wrap` + `calc(50% - 9rpx)`，
  部分机型会因小数像素把格子挤成「一行一个」，右侧露出大片留白。现在改成两个 `.metric-row`，
  每格 `flex:1` + 固定 `margin-left`，等分且不留缝。
- 「详情」整行可点进统计页；指标格也可点——点「错题」直接进错题本，其余进统计。

### 题库（bank-detail）

- 左侧科目栏可直接切换科目，无需返回首页，切换后统计与题库列表同步刷新。
- 右侧统计卡：该科目的题目 / 已做 / 正确率 + 完成度。
- **练习方式是参数，不是按钮**：分段控件三选一，只决定后续「开始练习」与点单元卡片时的进入方式。

  | 模式 | 行为 |
  | --- | --- |
  | 背题模式 | 直接展示题目与答案，不判分、不计入进度 |
  | 顺序练习 | 按题库原始题序作答，即时判对错 |
  | 随机练习 | 题目打散后作答，即时判对错 |

- **动作只保留两个**：「开始练习」按当前方式练整科全部题目，直接进入不弹窗；「模拟测试」打开抽屉选题量与时间。背题模式下隐藏「模拟测试」，只留主按钮。
- 抽屉里时长选「不限时」即退化为普通抽题练习（不进倒计时），因此不再单独提供「整科抽题」入口——它和模拟测试本就是同一套抽题逻辑的两种变体。
- 题库列表逐项展示题量、已做/总数、正确率与进度条，未做满时按科目主题色填充，做满转为绿色。点单元卡片即按当前练习方式练该单元。

### 统计（stats）

只读汇总，`load()` 不产生任何写副作用（自检里有断言守着）。数据来自四个本地来源：做题进度、
错题本、收藏、**每日学习日志**。页面分四块：

| 区块 | 内容 |
| --- | --- |
| 总览卡 | 深蓝渐变卡 + 环形完成度图 + 一句状态标题（连续学习 N 天 / 保持节奏 / 今天开始第一次练习）+ 题目 / 已做 / 正确率 / 时长四格 |
| 学习力雷达 | 六维：完成度 / 正确率 / 错题攻克 / 刷题量 / 坚持度 / 学习时长，全部归一化到 0-100，右侧给出总分与最强 / 最弱项 |
| 近 7 天趋势 | 每日答题数柱状 + 答对数折线，今日高亮；下方给累计答题、连续天数、单日峰值 |
| 科目进度 | 每个科目一行，进度条用科目主题色，正确率按 ≥80 / ≥60 / <60 三级上色，未做过的标「—」不评判 |

- **六维归一化**在 `utils/study-insight.js`，分母集中在 `RADAR_TARGETS`（近 7 天 140 题、
  累计 600 分钟、7 天全勤），是「达到即满分」的参考量而不是硬性指标。总取六维均值，
  所以只猛练一个维度拿不到高分。
- **六维全为 0 时不出雷达图**：多边形会退化成中心一个点，看着像渲染失败，改为只显示维度列表。
  趋势图同理，少于 2 天数据时不画。
- **错题与收藏**：待复习 / 已攻克 / 收藏三个数字，其中待复习与收藏可点击进对应列表。
- **历史最佳**：按「题库 + 模式 + 时长」缓存的记录，按分数倒序。

### 我的（my）

统计能力已迁到「统计」tab，这一页是个人中心：

- **资料卡**：头像 +「本地学习者」+ 版本徽章，下面三个数据快照（题库题目 / 待复习错题 / 收藏）；
- **学习工具**：错题本、我的收藏；
- **设置**：学习偏好、账户与安全（均跳设置页并滚动到对应分组）、清空学习数据；
- **关于**：版本与题量信息。

进入设置页带 `?focus=practice|account`，设置页 `onLoad` 读参数后用 `scroll-into-view` 定位到分组，
避免用户在长列表里自己找。

### 设置（settings）

三组，全部由 `utils/preferences.js` 的声明式定义驱动，新增偏好只改那一个文件，页面模板不动。

**学习偏好**（落 `qandaPreferences`，右上角「恢复默认」）：

| 开关 | 默认 | 作用 |
| --- | --- | --- |
| 答题后自动显示解析 | 开 | 关掉后答题页只标记对错与正确答案，解析留到交卷回顾 |
| 答错自动加入错题本 | 开 | 关掉后错题不再自动入库 |
| 答对后自动进入下一题 | 关 | 单选题答对后约 0.8 秒自动翻页，多选与测试模式不受影响 |
| 显示答题卡入口 | 开 | 关掉后顶部只剩纯文本题号，不能跳题 |
| 答题震动反馈 | 开 | 作答时轻微震动 |

选择型：**题目字号**（小 / 标准 / 大，直接作用于题干、选项与解析）、
**发音音色**（三个选项已备好，标记「即将支持」，点了给提示而不是静默无反应）。

**账户与安全**（修改密码 / 更换邮箱 / 退出登录）：账号体系尚未接入，三项统一标「待接入」，
点击给明确说明（例如「退出登录」提示「当前是本地模式，没有需要退出的登录状态」）。
等后端就绪，只需把 `ACCOUNT_ACTIONS` 里对应项的 `available` 改成 `true` 并在 ViewModel 接上调用。

**关于**：版本号（`app.globalData.version`）、题量、科目 / 题库数、技术形态，以及一句
「所有学习数据保存在本机」的提醒。

偏好不是摆设，答题页真的会读：`PracticeSession` 构造时注入 `preferences`，
`selectOption` 按它决定要不要自动翻页，`finish()` 按 `autoAddWrongBook` 决定要不要写错题本，
页面按 `shouldShowExplanation` 决定解不展开解析。`tests/settings-charts.check.js` 里有断言守着
「改偏好 → 答题行为真的变了」。

### 答题（practice）

- **顶部信息区**（一行放完）：进度条 → 题号胶囊（点击开答题卡）→ 题型标签 → 收藏星标；模拟测试模式在星标左侧显示倒计时。
- **底部操作区只保留两个按钮**：上一题 / 下一题，最后一题自动变为「交卷」（背题模式为「返回题库」）；首题的「上一题」置灰。
- 答题卡与收藏不再占用底部空间：答题卡移到顶部题号胶囊，收藏移到顶部星标。两处都放大了触控热区（星标图形 44rpx，热区 72rpx）。
- 主按钮文案：单选未作答时点「下一题」可直接跳过（该题按未作答计入错题）；多选题勾选后按钮临时变为「确认答案」，确认后才翻页。
- 支持单选、多选、判断题。顺序与随机模式即时判对错并显示解析；背题模式直接展示答案；模拟测试倒计时结束自动交卷，交卷后统一公布。
- 交卷后展示得分、答对题数、历史最佳与逐题回顾；历史最佳按「题库 + 模式 + 时长」分别缓存，互不覆盖。
- **偏好在这里生效**：根节点挂 `font-{{preferences.fontSize}}` 控制整页字号；解析区按 `shouldShowExplanation`
  决定是否展开（关掉时显示一行「解析已按偏好隐藏」而不是直接消失）；答题卡入口按 `showOverviewEntry`
  条件渲染，关掉时降级为不可点的纯文本题号；作答时按 `vibrateOnAnswer` 震动。
- **自动翻页要能被手动操作打断**：`scheduleAutoAdvance` 起 800ms 定时器，任何手动跳转 / 交卷 / 返回前
  都先 `clearAutoAdvance`，否则会出现「用户已经点了下一题，定时器又翻一次」的鬼畜跳题。

### 错题本与收藏（wrong-book）

入口有两个：我的页「学习工具」→ 错题本 / 我的收藏；答题结果页的「重练错题 N 题」。

页面内是双 tab：

| Tab | 内容 | 操作 |
| --- | --- | --- |
| 错题本 | 待复习 / 已攻克两个筛选 | 重练错题、单题移除、整组移除、收藏 |
| 我的收藏 | 全部收藏题目，最新收藏在前 | 练习收藏、取消收藏、清空收藏 |

错题本只存题目 id，展示时由 `utils/question-lookup.js` 反查正文，题库更新后不会留下过期快照。

**入库与攻克规则**（`utils/wrong-book.js`，`MASTER_STREAK = 2`）：

- 答错或未作答 → 入库，`wrongCount + 1`，连续答对清零；
- 答对且该题从未错过 → **不入库**，避免「做过的题全进错题本」；
- 已在错题本中的题答对 → `rightCount + 1`、连续答对 `+ 1`，连续答对 2 次转为「已攻克」；
- 已攻克后再答错 → 回到「待复习」。

**重练错题的传参方式**：题目 id 列表可能很长，拼在 `navigateTo` 的 URL 上有长度风险，因此改为写入 `qandaCustomQuiz`，跳转只带 `scope=custom`。答题页识别该 scope 后从存储取 id 组卷，题目可跨科目与题库，不写入历史最佳。

## 交互反馈

这部分看着像"锦上添花"，实际是**功能可用性的一部分**：一个没有按压反馈的按钮，
点下去界面毫无反应，用户会直接判定为「这个功能坏了」。之前答题页、题库页、错题本页就是这种情况。

### 三条硬约定

**1. 可点元素必须有 `hover-class`，只有遮罩层例外。**
遮罩层给了缩放会让整块背景跟着抖，观感更差，所以 `.mask` / `.overlay` 不设反馈。

反馈分四档，按元素形态选，别一律用同一个：

| 类 | 用于 | 效果 |
| --- | --- | --- |
| `.row-hover` | 菜单行、公告条 | 淡蓝底，不位移 |
| `.card-hover` | 卡片（题库列表项） | 轻微回缩 + 淡底 |
| `.btn-hover` | 主/次按钮 | 回缩更明显 + 降透明度 |
| `.chip-hover` | 小标签、分段、题号胶囊 | 回缩 + 主题淡色 |
| `.ghost-hover` | 纯图标按钮（收藏星、恢复默认） | 只降透明度，不缩放 |

**2. 过渡必须挂在元素基类上，不能只写在 hover 类里。**
微信的 `hover-class` 在 `touchstart` 加、`touchend` 撤——若只在 hover 类上写 `transition`，
按下有动画、松手却是瞬间跳回，这正是「生硬」的来源。`app.wxss` 里已对
`view / text / button / image / switch` 统一挂了 240ms 的 `transition` 兜底。

**3. hover-cost 两个时间参数要显式给。** 微信默认 `hover-start-time=50`（延迟 50ms 才出反馈），
高频操作处会显得"点了半天没反应"。答题选项、主按钮统一设 `hover-start-time="0" hover-stay-time="120"`。

### 背景色状态与 hover 的冲突

答题选项、答题卡格子、科目栏的背景已被「选中 / 正确 / 错误 / 当前」等状态占用，
hover 若也改同一个属性，两边争抢会出现闪烁。这类元素**只做 `transform` 缩放，不碰背景色**
（见 `.option-hover` 与 `.cell-hover`）。

### 滚动与下拉

- 所有 `scroll-view` 统一加 `enhanced bounces show-scrollbar="{{false}}"`，开启惯性回弹并隐藏滚动条；
- 首页、统计、我的、错题本开了 `enablePullDownRefresh`，页面实现 `onPullDownRefresh` 重读数据；
- **不要立刻 `wx.stopPullDownRefresh()`**——会让"正在刷新"一闪而过反而显得敷衍，统一延迟 400ms 收回。

### 入场动画

`app.wxss` 提供 `qanda-fade-up / qanda-fade-in / qanda-pop-in` 三个 keyframes，
配套 `.anim-fade-up / .anim-fade-in / .anim-pop-in`；父容器加 `.stagger` 可让子元素按 45ms 错峰入场。
差的不是"有没有动画"，而是"整屏内容啪一下出现"和"依次浮现"的区别。

> ⚠️ `.stagger` 的错峰规则**必须写成 `.stagger > view:nth-child(n)`，不能用通配符 `*`**——
> WXSS 不支持 `*`，会以「编译 .wxss 文件错误」整包停编译，而工具还不告诉你原因。
> 详见「编译报错：怎么拿到真实错误信息」一节。

> 这三条由 `tests/interaction.check.js` 静态守住，通配符那条由 `tests/compile.check.js` 用真编译器守住。
> 漏写 hover-class 在开发者工具里**不报错、不打日志**，只能扫出来。

## 本地存储键

| 键 | 结构 | 说明 |
| --- | --- | --- |
| `qandaProgress` | `{ [scopeKey]: { total, answers: { 题目id: 1\|0 }, updatedAt } }` | 做题进度，1 = 对 / 0 = 错 |
| `qandaWrongBook` | `{ [题目id]: { wrongCount, rightCount, streak, mastered, updatedAt } }` | 错题本 |
| `qandaFavorites` | `{ ids: [题目id], updatedAt }` | 收藏夹，最新收藏在前 |
| `qandaCustomQuiz` | `{ ids, title, createdAt }` | 最近一份自定义练习卷 |
| `qandaBestScore:*` | `number` | 历史最佳，按「题库 + 模式 + 时长」分别缓存 |
| `qandaStudyTime` | `{ totalSeconds, sessionCount, updatedAt }` | 累计学习时长与完成的练习次数 |
| `qandaPreferences` | `{ autoShowExplanation, autoAddWrongBook, autoNextWhenCorrect, showOverviewEntry, vibrateOnAnswer, fontSize, voice }` | 学习偏好，平铺键值对 |
| `qandaDailyLog` | `{ 'YYYY-MM-DD': { answered, correct, seconds } }` | 每日学习日志，供雷达图与趋势图使用，保留 90 天 |

全部为本地存储，清除数据即移除对应键；键名集中在各 `utils/` 模块的常量里，不要散落在页面中。

**清空学习数据不清偏好**（`MyViewModel.clearRecords` 刻意跳过 `qandaPreferences`）：
用户清的是做题记录，不是自己一个个调出来的设置；清完发现偏好也被重置会很难受。

## 每日学习日志

交卷时 `PracticeSession.finish()` 额外产出一份 `saveDailyLog` 载荷，由 ViewModel 落盘到 `qandaDailyLog`：

- 按 `YYYY-MM-DD` 累加当天的答题数、答对数与学习秒数，一天多练几次会合并；
- `getRecentDays(n)` 返回含今天在内的连续 n 天，**空缺的日子补 0**，否则趋势图的横轴会少一段；
- `calcStreak()` 从今天往回数连续有记录的天数；今天还没练时从昨天开始回溯，
  否则用户早上一打开就看到「连续 0 天」，明明昨晚才练过；
- `pruneDailyLog()` 只保留最近 90 天，避免这个键无限增长。

## 做题进度统计

每道题的作答结果按 `{ 题库或科目 id: { 题目 id: 1|0 } }` 存入本地存储键 `qandaProgress`：

- 未作答的题目**不写入**，因此「已做」= 记录条数，多次练习可跨会话累积；
- 同一题重复作答时**后一次覆盖前一次**；
- **正确率** = 答对 / 已做（未做的题不拉低正确率）；**完成度** = 已做 / 总题量（反映掌握范围），两者刻意分开；
- 背题模式不产生记录（`saveScopeProgress` 在 `isViewMode` 时返回 `null`）；
- 整科练习与模拟测试记在科目 id 下，因题目 id 唯一，与分题库记录汇总时天然去重。

写入时机在 `PracticeSession.finish()`：它返回 `saveScopeProgress` 载荷，由 `PracticeViewModel` 落盘。清空数据只需移除 `qandaProgress` 键。

## 学习时长

存 `qandaStudyTime`：`{ totalSeconds, sessionCount, updatedAt }`。

- 计时由 `PracticeSession` 自己维护（`resetStudyClock` / `pauseStudy` / `resumeStudy`），
  答题页在 `onHide` / `onShow` 里暂停与恢复，所以**切后台的等待时间不会被算进去**；
- 交卷时在 `finish()` 结算一次，通过 `saveStudyTime` 载荷交给 ViewModel 落盘；
- **重复交卷不重复结算**——交卷弹窗与超时自动交卷可能同时触发，靠 `alreadyCompleted` 拦住；
- 单次练习最多按 2 小时计（`MAX_SESSION_SECONDS`），超出基本是忘记关页面，直接截断；
- 不足 1 秒的练习不累加，也不让「完成次数」虚增；
- 背题模式同样计入学习时长：它不写做题进度，但确实是在学习。

展示统一走 `formatStudyDuration()`：`尚未开始` / `不到1分钟` / `25分钟` / `3时35分` / `2小时`。
单位连写是为了在首页的指标格子里不被挤成两行。

## 题库数据

运行态快照位于 `miniprogram/data/`，当前共 **3 科目 / 9 题库 / 234 题**：

| 科目 | 题库 | 题目 |
| --- | ---: | ---: |
| 大学语文 | 3 | 89 |
| 大学生心理健康 | 3 | 69 |
| 大学英语 | 3 | 76 |

运行时读取 `data/catalog.js` 与各 `data/banks/<bank-id>.js`；同名 `.json` 供审阅与校验。

题目字段：

```js
{
  id, type,            // single | multiple | judge
  stem, options: [{ key, label, text }],
  answerKeys, weight, difficulty, tags, explanation
}
```

> 新增题库时必须同步登记到 `utils/question-bank-catalog.js` 的 `BANK_LOADERS`。
> 小程序的 `require` 不支持完全动态路径，`require(\`../data/banks/${id}.js\`)` 无法被静态分析。

## 团队约定

**1. 被 `import` / `require` 的模块一律平铺成文件，不要用「目录 + index」组织。**

微信不会把 `<dir>/index.js` 可靠地纳入编译产物，两种写法都会失败：

| 写法 | 磁盘文件 | 结果 |
| --- | --- | --- |
| `require('../scenarios')` | `scenarios/index.js` | ❌ `module 'xxx/scenarios.js' is not defined` |
| `require('../scenarios/index')` | `scenarios/index.js` | ❌ 同上 |
| `require('../scenarios')` | `scenarios.js` | ✅ |

`app.json` 里登记页面路径不受此限，仍写全 `page/xxx/index`。

**2. 在命令行侧改动源码后，要 `touch` 一遍文件。** 开发者工具按 mtime 做增量编译，`mv` 等不改 mtime 的操作会让工具跳过该文件，出现「代码是新的、运行却报模块找不到」。

**3. 页面不写业务判断。** 需要判断的地方一律下沉到 ViewModel，页面只做 `setData` 和微信 API 调用。

**4. 图标用内联 base64 的 SVG，不要引图标字体，也不要引本地图片。**

WXSS 的 `background-image` 无法引用本地图片路径（`url('../assets/x.png')` 构建后失效），
所以封面色块用的是 `data:image/svg+xml;base64,...` 内联描边图标，
见 `components/subject-card/index.wxss` 的 `.icon-chinese / .icon-mental / .icon-english`。

图标规格统一为 **24×24 网格、`stroke="#ffffff"`、`stroke-width="1.8"`、圆头圆角连接**，
底色由 `.cover-<theme>` 的主题渐变提供，两者职责分离：换配色不动图标，换图标不动配色。

> 若要新增科目，需同步补三处：`SUBJECT_UI` 里的 `theme` / `shortName`、
> `.cover-<theme>` 与 `.fill-<theme>` / `.num-<theme>` 配色、以及对应的 `.icon-<theme>` 图标。

## 常用检查

```sh
# 1. 语法检查
find miniprogram -name "*.js" -not -path "*/data/*" -exec node --check {} \;

# 2. 业务自检（错题本 / 收藏 / 重练错题，47 项断言）
node apps/miniapp/tests/wrong-book-favorite.check.js

# 3. 入口自检（练习方式、开始练习、模拟测试抽屉，30 项断言）
node apps/miniapp/tests/bank-detail-entry.check.js

# 4. tabBar 与统计页（tab 配置、图标合法性、跳转方式匹配、统计口径，49 项断言）
node apps/miniapp/tests/tabbar-config.check.js

# 5. 首页学习数据（学习时长计算、每日语录、文案分支、清空数据，71 项断言）
node apps/miniapp/tests/home-dashboard.check.js

# 6. 设置偏好与统计图表（base64 / 偏好读写 / 每日日志 / 雷达趋势 / 图表 SVG /
#    设置页 ViewModel / 统计页 ViewModel / 偏好对答题行为的实际影响，102 项断言）
node apps/miniapp/tests/settings-charts.check.js

# 7. 交互完整性（按压反馈是否全覆盖、hover 类有无定义、下拉刷新是否闭环，6 项断言）
node apps/miniapp/tests/interaction.check.js

# 8. 模块引用可解析性（目录导入 / 路径写错 / 组件路径 / 页面路径）
node "$USERPROFILE/.workbuddy/skills/wechat-miniprogram-first-run/scripts/check-resolve.mjs" .

# 9. WXML 数据绑定与事件处理函数是否都有定义
node "$USERPROFILE/.workbuddy/skills/wechat-miniprogram-first-run/scripts/check-binding.mjs" .

# 10. 离线真编译（调用开发者工具自带的 wcsc / wcc，含 WXSS 通配符选择器兜底扫描，3 项断言）
#     找不到编译器时打印 SKIP 并退出 0，不阻塞其他机器
node apps/miniapp/tests/compile.check.js

# 11. 脏数据压测：模拟真实 wx.getStorageSync 行为（键不存在返回 ''，不是 null），
#     验证旧格式 / 残缺数据不会让页面 onLoad 崩溃（12 项断言）
node apps/miniapp/tests/dirty-data.check.js
```

> 第 7、8 条在 Windows 的 Git Bash 下**不要用 `~`**——它会被展开成 `E:\c\Users\...` 导致
> `MODULE_NOT_FOUND`。用 `$USERPROFILE` 或 `C:/Users/<用户名>/...` 的完整路径。

由于全部逻辑都是纯 CommonJS 模块，也可以直接在 Node 里 require `viewmodels/` 与 `models/` 做业务验证，无需启动开发者工具。

校验脚本的设计意图：**这几类问题在开发者工具里都是静默或难以定位的**——目录导入要到运行时才报「module is not defined」，WXML 引用不存在的字段只会渲染为空、不报错，事件处理函数名写错则点击毫无反应，WXSS 里的 `*` 更是只丢一句「编译 .wxss 文件错误」就把详情藏起来。所以在提交前静态扫一遍，比在模拟器里逐页点更可靠。

> 第 10 条是**唯一真正的编译校验**：前面几条都是扫源码文本，只有它会让官方编译器真的跑一遍，
> 能抓出「语法看着没问题但编译器不接受」的写法（例如 `*`）。

### 真机点击验证（自动化）

上面 11 条全是静态或离线校验，**没有一条能证明「用户点了到底有没有反应」**。
要证伪这类问题，只能真的去点：

> **前置条件**：开发者工具 → 设置 → 安全设置 → **服务端口【打开】**。
> 默认是关闭的，不开会报 `IDE service port disabled`，CLI 与自动化都连不上。

```bash
# 依赖装到隔离工作区，不进项目（项目保持零 npm 依赖）
cd ~/.workbuddy/binaries/node/workspace && npm install miniprogram-automator

cd apps/miniapp
NODE_PATH="C:/Users/<你>/.workbuddy/binaries/node/workspace/node_modules" node scripts/tap-test.cjs
```

脚本会依次打开首页 / 题库页 / 统计页，真实 tap 关键元素，对比点击前后的页面路径与
`page.data()`，判断「跳转生效」「页面有响应」还是「点击无反应」。

## 已知待办

- `PracticeSession` 的字段名与后端 `PracticeSession / PracticeResult` 契约尚未对齐，需在 Contract Freeze 阶段与后端确认后，由 `repositories/practice-repository.js` 统一收口。
- 用户侧题目列表接口（`listQuestions`）在 API PRD 中缺失，目前由本地题库快照替代。
- 错题本与收藏均为本地存储，未与账号打通；后续接后端时只需替换 `repositories/` 下对应实现。
- 尚未实现：断点续做、按题型/难度筛选、练习历史列表。
- 每日语录是本地静态池（`utils/daily-quotes.js`，36 条按日循环），后续若接服务端可换成远端下发。
- 发音音色（标准 / 温柔 / 沉稳）已留存储位与选项 UI，等题目朗读能力接入后把
  `PREFERENCE_CHOICES` 里该项的 `available` 改成 `true` 即可，页面不用改。
