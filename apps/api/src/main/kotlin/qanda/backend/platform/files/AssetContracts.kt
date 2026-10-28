package qanda.backend.platform.files

data class ImageLimits(val declaredMediaType: String,val maxBytes: Long=5L*1024*1024,val maxDimension: Int=8192,val maxPixels: Long=32_000_000) {
    init { require(declaredMediaType in setOf("image/png","image/jpeg","image/webp"));require(maxBytes in 1..5L*1024*1024 && maxDimension in 1..8192 && maxPixels in 1..32_000_000) }
}
