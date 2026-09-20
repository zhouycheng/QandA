#!/usr/bin/env node
/**
 * 把设计稿图片（AI 生成 / 截图）处理成小程序可用的资源：
 *   1. 裁掉指定边距 —— 常用于去掉生成工具打在角落的水印
 *   2. 盒式平均降采样到目标宽度 —— 控制包体积
 *   3. 重新编码为 PNG（逐行选最优滤波 + zlib 最高压缩）
 *
 * 环境里没有 sharp / jimp 这类图像库，所以这里用 Node 内置的 zlib
 * 直接实现 PNG 编解码，只覆盖 AI 出图常见的「8 位非隔行」RGB / RGBA。
 *
 * 用法：
 *   node scripts/optimize-banner.cjs <输入.png> <输出.png> --crop-bottom=56 --width=702
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }

    table[n] = c
  }

  return table
})()

function crc32(buffer) {
  let c = 0xffffffff

  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }

  return (c ^ 0xffffffff) >>> 0
}

// ---------- 解码 ----------
function readChunks(buffer) {
  const chunks = []
  let offset = PNG_SIGNATURE.length

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)

    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) })
    offset += 12 + length

    if (type === 'IEND') {
      break
    }
  }

  return chunks
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)

  if (pa <= pb && pa <= pc) {
    return a
  }

  return pb <= pc ? b : c
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是合法的 PNG 文件')
  }

  const chunks = readChunks(buffer)
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')

  if (!ihdr) {
    throw new Error('缺少 IHDR 数据块')
  }

  const width = ihdr.data.readUInt32BE(0)
  const height = ihdr.data.readUInt32BE(4)
  const bitDepth = ihdr.data[8]
  const colorType = ihdr.data[9]
  const interlace = ihdr.data[12]
  const channels = CHANNELS_BY_COLOR_TYPE[colorType]

  if (bitDepth !== 8) {
    throw new Error(`只支持 8 位色深，当前为 ${bitDepth}`)
  }

  if (colorType === 3) {
    throw new Error('暂不支持调色板 PNG，请先用其他工具转成 RGB')
  }

  if (!channels) {
    throw new Error(`不支持的颜色类型 ${colorType}`)
  }

  if (interlace !== 0) {
    throw new Error('暂不支持隔行 PNG')
  }

  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data))
  const raw = zlib.inflateSync(idat)
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  let pos = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)

    pos += stride

    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null

    for (let i = 0; i < stride; i++) {
      const rawValue = line[i]
      const left = i >= channels ? out[i - channels] : 0
      const up = prev ? prev[i] : 0
      const upLeft = prev && i >= channels ? prev[i - channels] : 0
      let value

      if (filter === 0) {
        value = rawValue
      } else if (filter === 1) {
        value = rawValue + left
      } else if (filter === 2) {
        value = rawValue + up
      } else if (filter === 3) {
        value = rawValue + ((left + up) >> 1)
      } else if (filter === 4) {
        value = rawValue + paeth(left, up, upLeft)
      } else {
        throw new Error(`未知的滤波类型 ${filter}`)
      }

      out[i] = value & 0xff
    }
  }

  return { width, height, channels, pixels }
}

// ---------- 裁剪 ----------
function crop(image, box) {
  const { width, height, channels, pixels } = image
  const left = box.left || 0
  const top = box.top || 0
  const right = box.right || 0
  const bottom = box.bottom || 0
  const outWidth = width - left - right
  const outHeight = height - top - bottom

  if (outWidth <= 0 || outHeight <= 0) {
    throw new Error('裁剪后尺寸非法，请检查裁剪参数')
  }

  if (left + top + right + bottom === 0) {
    return image
  }

  const out = Buffer.alloc(outWidth * outHeight * channels)

  for (let y = 0; y < outHeight; y++) {
    const srcStart = ((y + top) * width + left) * channels
    pixels.copy(out, y * outWidth * channels, srcStart, srcStart + outWidth * channels)
  }

  return { width: outWidth, height: outHeight, channels, pixels: out }
}

// ---------- 盒式平均降采样 ----------
function resample(image, targetWidth) {
  const { width, height, channels, pixels } = image

  if (!targetWidth || targetWidth >= width) {
    return image
  }

  const outWidth = Math.round(targetWidth)
  const outHeight = Math.max(Math.round((height * outWidth) / width), 1)
  const out = Buffer.alloc(outWidth * outHeight * channels)

  for (let y = 0; y < outHeight; y++) {
    const y0 = Math.floor((y * height) / outHeight)
    const y1 = Math.max(Math.floor(((y + 1) * height) / outHeight), y0 + 1)

    for (let x = 0; x < outWidth; x++) {
      const x0 = Math.floor((x * width) / outWidth)
      const x1 = Math.max(Math.floor(((x + 1) * width) / outWidth), x0 + 1)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0

      for (let sy = y0; sy < y1 && sy < height; sy++) {
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const i = (sy * width + sx) * channels

          r += pixels[i]

          if (channels > 1) {
            g += pixels[i + 1]
          }

          if (channels > 2) {
            b += pixels[i + 2]
          }

          if (channels > 3) {
            a += pixels[i + 3]
          }

          count++
        }
      }

      const outIndex = (y * outWidth + x) * channels

      out[outIndex] = Math.round(r / count)

      if (channels > 1) {
        out[outIndex + 1] = Math.round(g / count)
      }

      if (channels > 2) {
        out[outIndex + 2] = Math.round(b / count)
      }

      if (channels > 3) {
        out[outIndex + 3] = Math.round(a / count)
      }
    }
  }

  return { width: outWidth, height: outHeight, channels, pixels: out }
}

// ---------- 色阶量化 ----------
/**
 * 丢弃每通道的低 N 位。插画类图片有大面积近似色，
 * 量化后相邻像素变得完全一致，Sub 滤波结果出现大量 0 字节，
 * zlib 压缩率显著提升（实测可省约 40% 体积），视觉上几乎无损。
 */
function quantize(image, bits) {
  if (!bits) {
    return image
  }

  const mask = (0xff << bits) & 0xff
  const { channels, pixels } = image
  const colorChannels = Math.min(channels, 3)

  for (let i = 0; i < pixels.length; i += channels) {
    for (let c = 0; c < colorChannels; c++) {
      pixels[i + c] &= mask
    }
  }

  return image
}

// ---------- 编码 ----------
/**
 * PNG 允许逐行选择滤波方式。这里对每行试算 5 种滤波，
 * 取「字节绝对差之和」最小的那种 —— 是压缩率的决定性因素。
 */
function pickFilter(line, prev, channels) {
  const stride = line.length
  let bestType = 0
  let bestData = null
  let bestCost = Infinity

  for (let type = 0; type <= 4; type++) {
    const out = Buffer.alloc(stride)
    let cost = 0

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0
      const up = prev ? prev[i] : 0
      const upLeft = prev && i >= channels ? prev[i - channels] : 0
      let value

      if (type === 0) {
        value = line[i]
      } else if (type === 1) {
        value = line[i] - left
      } else if (type === 2) {
        value = line[i] - up
      } else if (type === 3) {
        value = line[i] - ((left + up) >> 1)
      } else {
        value = line[i] - paeth(left, up, upLeft)
      }

      value &= 0xff
      out[i] = value
      cost += value < 128 ? value : 256 - value
    }

    if (cost < bestCost) {
      bestCost = cost
      bestType = type
      bestData = out
    }
  }

  return { type: bestType, data: bestData }
}

function buildChunk(type, data) {
  const length = Buffer.alloc(4)

  length.writeUInt32BE(data.length, 0)

  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)

  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(image) {
  const { width, height, channels, pixels } = image
  const stride = width * channels
  const rows = []

  for (let y = 0; y < height; y++) {
    const line = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    const best = pickFilter(line, prev, channels)

    rows.push(Buffer.concat([Buffer.from([best.type]), best.data]))
  }

  const colorType = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6
  const ihdr = Buffer.alloc(13)

  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    buildChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 命令行入口 ----------
function parseArgs(argv) {
  const flags = {}

  argv
    .filter((item) => item.startsWith('--'))
    .forEach((item) => {
      const [key, value] = item.replace(/^--/, '').split('=')
      flags[key] = value === undefined ? true : value
    })

  return {
    positional: argv.filter((item) => !item.startsWith('--')),
    flags
  }
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))

  if (positional.length < 2) {
    console.error(
      '用法：node scripts/optimize-banner.cjs <输入.png> <输出.png> ' +
        '[--crop-top=0] [--crop-bottom=56] [--crop-left=0] [--crop-right=0] [--width=702] [--quantize=2]'
    )
    process.exit(1)
  }

  const [input, output] = positional
  const before = fs.statSync(input).size
  let image = decodePng(fs.readFileSync(input))

  console.log(`读取 ${path.basename(input)} → ${image.width}x${image.height}，${(before / 1024).toFixed(1)}KB`)

  const cropBox = {
    top: Number(flags['crop-top']) || 0,
    bottom: Number(flags['crop-bottom']) || 0,
    left: Number(flags['crop-left']) || 0,
    right: Number(flags['crop-right']) || 0
  }

  if (cropBox.top || cropBox.bottom || cropBox.left || cropBox.right) {
    image = crop(image, cropBox)
    console.log(`裁剪 top=${cropBox.top} bottom=${cropBox.bottom} left=${cropBox.left} right=${cropBox.right} → ${image.width}x${image.height}`)
  }

  if (flags.width) {
    image = resample(image, Number(flags.width))
    console.log(`降采样 → ${image.width}x${image.height}`)
  }

  if (flags.quantize) {
    const bits = Number(flags.quantize)

    image = quantize(image, bits)
    console.log(`色阶量化 → 每通道丢弃低 ${bits} 位（剩 ${Math.pow(2, 8 - bits)} 级）`)
  }

  const buffer = encodePng(image)
  const resolved = path.resolve(output)

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, buffer)
  console.log(
    `写入 ${resolved} → ${(buffer.length / 1024).toFixed(1)}KB` +
      `（体积为原始的 ${((buffer.length / before) * 100).toFixed(0)}%）`
  )
}

main()
