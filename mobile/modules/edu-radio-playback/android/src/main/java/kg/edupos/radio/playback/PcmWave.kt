package kg.edupos.radio.playback

import java.nio.ByteBuffer
import java.nio.ByteOrder

internal data class PcmWave(val rate: Int, val offset: Int, val size: Int)

// Only mono, uncompressed 16-bit PCM is streamed. Other WAV codecs go to the ordinary file player.
internal fun readPcmWave(bytes: ByteArray): PcmWave? {
  if (bytes.size < 44) return null
  val input = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
  fun tag(start: Int) = String(bytes, start, 4, Charsets.US_ASCII)
  if (tag(0) != "RIFF" || tag(8) != "WAVE") return null
  val end = input.getInt(4).toLong() + 8
  if (end !in 44L..bytes.size.toLong()) return null
  var pos = 12
  var rate = 0
  while (pos + 8 <= end) {
    val kind = tag(pos)
    val size = input.getInt(pos + 4)
    val data = pos + 8
    if (size < 0 || size.toLong() + data > end) return null
    if (kind == "fmt ") {
      if (size < 16 || input.getShort(data).toInt() != 1 || input.getShort(data + 2).toInt() != 1 ||
        input.getShort(data + 12).toInt() != 2 || input.getShort(data + 14).toInt() != 16) return null
      rate = input.getInt(data + 4)
      if (rate !in 8000..48000 || input.getInt(data + 8) != rate * 2) return null
    }
    if (kind == "data") {
      if (rate == 0 || size <= 0 || size % 2 != 0) return null
      return PcmWave(rate, data, size)
    }
    pos = data + size + (size and 1)
  }
  return null
}
