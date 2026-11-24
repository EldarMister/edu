package kg.edupos.radio.playback

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RadioPlaybackModule : Module() {
  private var session: String? = null
  private var track: AudioTrack? = null
  private var rate = 0
  private var writtenFrames = 0L
  private var lastSpeechFrame = 0L
  private var lastWrite = 0L
  private var drainBy = 0L
  private var observedHead = 0L
  private var headChangedAt = 0L
  private var tailPadded = false

  override fun definition() = ModuleDefinition {
    Name("EduRadioPlayback")
    Function("begin") { id: String -> synchronized(this@RadioPlaybackModule) {
      closeTrack()
      session = id
    } }
    AsyncFunction("enqueue") { id: String, packet: String -> enqueue(id, packet) }
    Function("remaining") { id: String -> synchronized(this@RadioPlaybackModule) {
      if (id == session) remainingMillis() else 0
    } }
    Function("stop") { id: String -> synchronized(this@RadioPlaybackModule) {
      if (session == id) reset()
    } }
    OnDestroy { reset() }
  }

  // JS sends in socket order. Non-blocking writes let a channel change flush even a long WAV in flight.
  private fun enqueue(id: String, packet: String): Boolean {
    if (packet.length > 8_000_000) return false
    val bytes = try { Base64.decode(packet, Base64.DEFAULT) } catch (_: IllegalArgumentException) { return false }
    val wave = readPcmWave(bytes) ?: return false
    var pos = wave.offset
    val end = wave.offset + wave.size
    var progressAt = SystemClock.elapsedRealtime()
    while (pos < end) {
      val count = synchronized(this) {
        if (session != id) return true
        if (track != null && wave.rate != rate && remainingMillis() > 0) 0 else {
          if (track == null || wave.rate != rate) openTrack(wave.rate)
          val current = track ?: return false
          val written = current.write(bytes, pos, end - pos, AudioTrack.WRITE_NON_BLOCKING)
          if (written > 0) {
            writtenFrames += written / 2
            lastSpeechFrame = writtenFrames
            lastWrite = SystemClock.elapsedRealtime()
            val head = current.playbackHeadPosition.toLong() and 0xffffffffL
            val queued = (lastSpeechFrame - head).coerceIn(0L, current.bufferSizeInFrames.toLong())
            drainBy = lastWrite + (queued * 1000 + rate - 1) / rate + 800
            tailPadded = false
          }
          written
        }
      }
      if (count > 0) {
        pos += count
        progressAt = SystemClock.elapsedRealtime()
      } else {
        if (count < 0 || SystemClock.elapsedRealtime() - progressAt > 2500) {
          synchronized(this) { if (session == id) closeTrack() }
          return pos != wave.offset
        }
        SystemClock.sleep(5)
      }
    }
    return true
  }

  private fun openTrack(sampleRate: Int) {
    closeTrack()
    val min = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) return
    val output = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
      .setBufferSizeInBytes(maxOf(min, sampleRate * 2 * 160 / 1000)).setTransferMode(AudioTrack.MODE_STREAM).build()
    try {
      check(output.state == AudioTrack.STATE_INITIALIZED)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        output.setStartThresholdInFrames(minOf(output.bufferSizeInFrames, sampleRate * 60 / 1000))
      }
      output.play()
      track = output
      rate = sampleRate
    } finally {
      if (track !== output) output.release()
    }
  }

  private fun remainingMillis(): Int {
    val current = track ?: return 0
    val head = current.playbackHeadPosition.toLong() and 0xffffffffL
    val remaining = (lastSpeechFrame - head).coerceAtLeast(0)
    val now = SystemClock.elapsedRealtime()
    val sinceWrite = now - lastWrite
    if (head != observedHead) {
      observedHead = head
      headChangedAt = now
    }
    if (now >= drainBy) {
      closeTrack()
      return 0
    }
    if (remaining == 0L) {
      if (sinceWrite > 400) closeTrack()
      return 0
    }
    // A short last packet can be smaller than the hardware restart threshold after an underrun.
    // Packets arrive every 160 ms. Only unblock a stalled tail after two full packet intervals.
    if (sinceWrite > 350 && now - headChangedAt > 120 && !tailPadded) {
      val pad = ByteArray(current.bufferSizeInFrames * 2)
      val count = current.write(pad, 0, pad.size, AudioTrack.WRITE_NON_BLOCKING)
      if (count > 0) {
        writtenFrames += count / 2
        tailPadded = true
      }
    }
    return minOf((remaining * 1000 + rate - 1) / rate, drainBy - now).toInt()
  }

  @Synchronized private fun reset() {
    session = null
    closeTrack()
  }

  private fun closeTrack() {
    val previous = track
    track = null
    if (previous != null) {
      try {
        previous.pause()
        previous.flush()
      } catch (_: IllegalStateException) {
        // A disconnected output can already be uninitialized.
      } finally { previous.release() }
    }
    rate = 0
    writtenFrames = 0
    lastSpeechFrame = 0
    drainBy = 0
    observedHead = 0
    headChangedAt = 0
    tailPadded = false
  }
}
