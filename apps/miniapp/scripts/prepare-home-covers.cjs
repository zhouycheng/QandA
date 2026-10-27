/**
 * 首页倒计时卡封面：把用户给的三张原图裁成卡片比例。
 *   node scripts/prepare-home-covers.cjs
 *
 * 原图在 design/home-covers/（1672x941，约 1.78:1），卡片是 686rpx:320rpx（2.14:1），
 * 所以只裁掉上下各 ~80px，构图基本不损失。
 *
 * 为什么不用 PIL / sharp：本机没装 Pillow，pip 也装不上，仓库又不允许加 npm 依赖。
 * 为什么不用 `edge --screenshot`：那条路**没法指定 JPEG 质量**，写实插画会压到
 * 100KB+/张，三张直接吃掉主包余量。所以这里走 DevTools 协议，
 * `Page.captureScreenshot` 能显式给 `quality`，体积可控。
 * （Node 22 自带全局 WebSocket，不需要任何第三方库。）
 *
 * ⚠️ 三张必须用**同一个裁剪窗口**（同一个 CROP_TOP + 同一个输出尺寸）。
 * 三张画面本来就不同，比例再不一致，切换时段时卡片会「一换就跳一下」。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'design/home-covers')
const OUT_DIR = path.join(ROOT, 'miniprogram/assets/home')

// 卡片宽高比：686rpx / 320rpx。必须与 .exam-card 完全一致，否则 aspectFill 会切边。
const CARD_RATIO = 686 / 320

// 原图 1672 宽 → 输出 1080 宽（屏显宽度的 3 倍左右）
const SRC_WIDTH = 1672
const OUT_WIDTH = 960
const OUT_HEIGHT = Math.round(OUT_WIDTH / CARD_RATIO) // 504

// 纵向窗口：原图 941 高，窗口 = 1672 / 2.14375 ≈ 780，上下各裁 80
const CROP_TOP = 80

// 写实插画对质量敏感：80 之后肉眼几乎无差，76 以下开始欠采样
const QUALITY = 76

const DEBUG_PORT = 9333

const SOURCES = {
  morning: 'morning.jpg',
  noon: 'noon.jpg',
  evening: 'evening.jpg'
}

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((file) => fs.existsSync(file))

if (!edge) {
  console.error('未找到 Edge，无法裁图')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function buildHtml(srcPath) {
  const scale = OUT_WIDTH / SRC_WIDTH
  const offsetTop = Math.round(CROP_TOP * scale)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: #22306b; }
  .window { position: relative; width: ${OUT_WIDTH}px; height: ${OUT_HEIGHT}px; overflow: hidden; }
  .window img { position: absolute; left: 0; top: -${offsetTop}px; width: ${OUT_WIDTH}px; height: auto; display: block; }
</style></head><body>
  <div class="window"><img src="file:///${srcPath.replace(/\\/g, '/')}"></div>
</body></html>`
}

/** 极简 CDP 客户端：够用就好，不引任何依赖 */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let seq = 0

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  socket.addEventListener('message', (event) => {
    let message

    try {
      message = JSON.parse(event.data)
    } catch (error) {
      return
    }

    const slot = pending.get(message.id)

    if (slot) {
      pending.delete(message.id)

      if (message.error) {
        slot.reject(new Error(`${message.error.message} (${message.error.code})`))
      } else {
        slot.resolve(message.result)
      }
    }
  })

  return {
    send(method, params, sessionId) {
      seq += 1
      const id = seq

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify(Object.assign({ id, method, params: params || {} }, sessionId ? { sessionId } : {})))
      })
    },
    close() {
      socket.close()
    }
  }
}

async function waitForEndpoint(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      // 还没起来，继续等
    }

    await sleep(120)
  }

  throw new Error(`调试端口未就绪：${url}`)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = spawn(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank'
  ], { stdio: 'ignore' })

  const results = []
  let client = null

  try {
    const version = await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 15000)
    client = await connect(version.webSocketDebuggerUrl)

    for (const key of Object.keys(SOURCES)) {
      const srcPath = path.join(SRC_DIR, SOURCES[key])

      if (!fs.existsSync(srcPath)) {
        throw new Error(`源图缺失：${srcPath}`)
      }

      const tmpHtml = path.join(os.tmpdir(), `qanda-cover-${key}.html`)
      fs.writeFileSync(tmpHtml, buildHtml(srcPath))

      const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })

      await client.send('Page.enable', {}, sessionId)
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: OUT_WIDTH,
        height: OUT_HEIGHT,
        deviceScaleFactor: 1,
        mobile: false
      }, sessionId)
      await client.send('Page.navigate', { url: `file:///${tmpHtml.replace(/\\/g, '/')}` }, sessionId)

      // 本地文件 + 固定尺寸，等一帧就够；等太久没意义
      await sleep(500)

      const shot = await client.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: QUALITY,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: OUT_WIDTH, height: OUT_HEIGHT, scale: 1 }
      }, sessionId)

      const outPath = path.join(OUT_DIR, `cover-${key}.jpg`)
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
      fs.rmSync(tmpHtml, { force: true })

      await client.send('Target.closeTarget', { targetId })

      results.push({ key, outPath, size: fs.statSync(outPath).size })
    }
  } finally {
    if (client) {
      client.close()
    }

    browser.kill()
  }

  results.forEach((item) => {
    console.log(`${item.key.padEnd(8)} ${OUT_WIDTH}x${OUT_HEIGHT} q${QUALITY}  ${Math.round(item.size / 1024)} KB  ${path.basename(item.outPath)}`)
  })

  const total = results.reduce((sum, item) => sum + item.size, 0)
  const magic = fs.readFileSync(results[0].outPath).subarray(0, 2).toString('hex')

  console.log(`合计 ${Math.round(total / 1024)} KB（预算 150KB）；格式 magic ${magic}${magic === 'ffd8' ? ' = 真 JPEG' : ' 异常'}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
