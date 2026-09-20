/**
 * Base64 编码：纯计算模块，不依赖微信 API，也不依赖 Node 的 Buffer。
 *
 * 小程序运行时没有 btoa / Buffer，而图表要用
 * `data:image/svg+xml;base64,...` 的形式内联进 WXSS，
 * 所以这里自己实现一份 UTF-8 安全的编码。
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 把字符串按 UTF-8 拆成字节数组。
 * 中文标点在 SVG 里也会出现（坐标轴标签），因此必须按 UTF-8 而不是 charCode。
 */
function toUtf8Bytes(text) {
  const input = typeof text === 'string' ? text : String(text == null ? '' : text)
  const bytes = []

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      // 代理对（emoji 等）：合并成单个码点再编码
      const next = input.charCodeAt(index + 1)

      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1
        const point = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)

        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f)
        )
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      }
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }

  return bytes
}

/**
 * UTF-8 字符串 → base64（无换行、带 = 补位）。
 */
function encodeBase64Utf8(text) {
  const bytes = toUtf8Bytes(text)
  let output = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index]
    const byte2 = bytes[index + 1]
    const byte3 = bytes[index + 2]

    output += BASE64_CHARS[byte1 >> 2]
    output += BASE64_CHARS[((byte1 & 0x03) << 4) | ((byte2 || 0) >> 4)]

    if (byte2 === undefined) {
      output += '=='
      break
    }

    output += BASE64_CHARS[((byte2 & 0x0f) << 2) | ((byte3 || 0) >> 6)]

    if (byte3 === undefined) {
      output += '='
      break
    }

    output += BASE64_CHARS[byte3 & 0x3f]
  }

  return output
}

module.exports = {
  encodeBase64Utf8,
  toUtf8Bytes
}
