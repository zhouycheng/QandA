package qanda.backend.platform.files

import org.springframework.http.HttpStatus
import qanda.backend.platform.http.ApiException
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import javax.imageio.ImageIO
import javax.imageio.IIOImage
import javax.imageio.stream.MemoryCacheImageInputStream
import javax.imageio.stream.MemoryCacheImageOutputStream

internal data class NormalizedImage(val bytes: ByteArray, val width: Int, val height: Int)

internal object ImageNormalizer {
    fun readBounded(input: InputStream, max: Long): ByteArray {
        val bytes = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (bytes.size().toLong() + count > max) throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE", "图片字节超过限制")
            bytes.write(buffer, 0, count)
        }
        if (bytes.size() == 0) invalid()
        return bytes.toByteArray()
    }

    fun normalize(raw: ByteArray, limits: ImageLimits): NormalizedImage {
        val actual = when {
            raw.size >= 8 && raw.take(8).toByteArray().contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 13, 10, 26, 10)) -> "image/png"
            raw.size >= 3 && raw[0] == 0xff.toByte() && raw[1] == 0xd8.toByte() && raw[2] == 0xff.toByte() -> "image/jpeg"
            raw.size >= 12 && String(raw, 0, 4, Charsets.US_ASCII) == "RIFF" && String(raw, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
            else -> throw ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "IMAGE_TYPE_UNSUPPORTED", "仅支持PNG、JPEG和WebP图片")
        }
        if (actual != limits.declaredMediaType) throw ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "IMAGE_TYPE_MISMATCH", "图片内容与声明类型不一致")
        try {
            MemoryCacheImageInputStream(ByteArrayInputStream(raw)).use { stream ->
                val readers = ImageIO.getImageReaders(stream)
                if (!readers.hasNext()) invalid()
                val reader = readers.next()
                try {
                    reader.input = stream
                    val width = reader.getWidth(0)
                    val height = reader.getHeight(0)
                    if (width !in 1..limits.maxDimension || height !in 1..limits.maxDimension || width.toLong() * height > limits.maxPixels) {
                        throw ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "IMAGE_DIMENSIONS_EXCEEDED", "图片尺寸或像素超过限制")
                    }
                    val image = reader.read(0) ?: invalid()
                    try {
                        val output = object : ByteArrayOutputStream() {
                            override fun write(value: Int) { bounded(1); super.write(value) }
                            override fun write(bytes: ByteArray, offset: Int, length: Int) { bounded(length); super.write(bytes, offset, length) }
                            private fun bounded(length: Int) {
                                if (size().toLong() + length > limits.maxBytes) throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE", "规范化图片字节超过限制")
                            }
                        }
                        val writer = ImageIO.getImageWritersByFormatName("png").next()
                        try {
                            MemoryCacheImageOutputStream(output).use { encoded ->
                                writer.output = encoded
                                writer.write(null, IIOImage(image, null, null), null)
                            }
                        } finally { writer.dispose() }
                        return NormalizedImage(output.toByteArray(), width, height)
                    } finally { image.flush() }
                } finally { reader.dispose() }
            }
        } catch (error: ApiException) { throw error }
        catch (error: Exception) {
            generateSequence<Throwable>(error) { it.cause }.filterIsInstance<ApiException>().firstOrNull()?.let { throw it }
            invalid()
        }
    }
    private fun invalid(): Nothing = throw ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "IMAGE_INVALID", "图片无法完整解码")
}
