package kg.edupos.radio.capture

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque
import kotlin.concurrent.thread

private const val RATE = 16000
private const val FRAME_BYTES = 2
private const val PERIOD_BYTES = RATE * FRAME_BYTES / 100 // 10 ms of mono PCM16
private const val PACKET_BYTES = 16 * PERIOD_BYTES
private const val MAX_QUEUED_PACKETS = 32

class RadioCaptureModule : Module() {
  private class Capture(val token: Double, val input: AudioRecord) {
    val partial = ByteArrayOutputStream(PACKET_BYTES)
    val packets = ArrayDeque<ByteArray>()
  }

  private val guard = Any()
  @Volatile private var active: Capture? = null
  private var lastStarted = 0.0
  private var lastStopped = 0.0
  private var foreground = true

  override fun definition() = ModuleDefinition {
    Name("EduRadioCapture")
    Events("onChunkReady", "onCaptureEnded")
    AsyncFunction("start") { token: Double -> open(token) }
    Function("take") { token: Double ->
      synchronized(guard) { active?.takeIf { it.token == token }?.packets?.poll() }?.let(::wav)
    }
    Function("finish") { token: Double -> finish(token, true) }
    OnActivityEntersForeground { synchronized(guard) { foreground = true } }
    OnActivityEntersBackground { suspendCapture() }
    OnDestroy { suspendCapture() }
  }

  @SuppressLint("MissingPermission") // The caller obtains RECORD_AUDIO before requesting the channel.
  private fun open(token: Double): Boolean {
    synchronized(guard) {
      if (!foreground || token <= lastStopped || active != null) return false
      lastStarted = maxOf(lastStarted, token)
    }
    val format = AudioFormat.ENCODING_PCM_16BIT
    val mono = AudioFormat.CHANNEL_IN_MONO
    val minimum = AudioRecord.getMinBufferSize(RATE, mono, format)
    check(minimum > 0) { "Unsupported microphone format" }
    val input = AudioRecord(MediaRecorder.AudioSource.MIC, RATE, mono, format,
      maxOf(minimum * 2, RATE * FRAME_BYTES))
    val capture = Capture(token, input)
    synchronized(guard) {
      if (!foreground || token <= lastStopped || active != null) {
        input.release()
        return false
      }
      active = capture
    }
    try {
      check(input.state == AudioRecord.STATE_INITIALIZED) { "Could not initialize microphone" }
      input.startRecording()
      check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Could not start microphone" }
      if (active !== capture) return false
      thread(name = "edu-radio-mic", isDaemon = true) { record(capture) }
      return true
    } catch (error: Exception) {
      finish(token, false)
      throw error
    }
  }

  private fun record(capture: Capture) {
    runCatching { Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO) }
    val period = ByteArray(PERIOD_BYTES)
    try {
      while (active === capture) {
        val count = capture.input.read(period, 0, period.size, AudioRecord.READ_BLOCKING)
        if (active !== capture) return
        check(count > 0 && count % FRAME_BYTES == 0) { "Microphone read failed: $count" }
        val ready = synchronized(guard) {
          if (active !== capture) return
          capture.partial.write(period, 0, count)
          if (capture.partial.size() >= PACKET_BYTES) {
            if (capture.packets.size == MAX_QUEUED_PACKETS) capture.packets.removeFirst()
            capture.packets.addLast(capture.partial.toByteArray())
            capture.partial.reset()
            true
          } else false
        }
        if (ready) sendEvent("onChunkReady", mapOf("token" to capture.token))
      }
    } catch (_: Exception) {
      if (active === capture) {
        finish(capture.token, false)
        sendEvent("onCaptureEnded", mapOf("token" to capture.token))
      }
    }
  }

  private fun finish(token: Double, keepTail: Boolean): List<String> {
    val pending = mutableListOf<ByteArray>()
    val capture = synchronized(guard) {
      lastStopped = maxOf(lastStopped, token)
      val current = active?.takeIf { it.token == token } ?: return emptyList()
      active = null
      // Only data copied before button-up is included. A pending hardware read can never
      // append to this session again, even if Android completes it after the release.
      if (keepTail) {
        pending.addAll(current.packets)
        if (current.partial.size() > 0) pending.add(current.partial.toByteArray())
      }
      current
    }
    // Stop the actual input independently of its blocking read and release the channel promptly.
    thread(name = "edu-radio-mic-stop", isDaemon = true) {
      try {
        if (capture.input.recordingState == AudioRecord.RECORDSTATE_RECORDING) capture.input.stop()
      } catch (_: IllegalStateException) {
        // Android may revoke the microphone or stop it while the application is backgrounded.
      } finally {
        capture.input.release()
      }
    }
    return pending.map(::wav)
  }

  private fun suspendCapture() {
    val token = synchronized(guard) {
      foreground = false
      lastStopped = maxOf(lastStopped, lastStarted)
      active?.token
    }
    if (token != null) finish(token, false)
  }

  private fun wav(pcm: ByteArray): String {
    val packet = ByteBuffer.allocate(44 + pcm.size).order(ByteOrder.LITTLE_ENDIAN)
    packet.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt(36 + pcm.size)
    packet.put("WAVEfmt ".toByteArray(Charsets.US_ASCII)).putInt(16)
    packet.putShort(1).putShort(1).putInt(RATE).putInt(RATE * FRAME_BYTES)
    packet.putShort(FRAME_BYTES.toShort()).putShort(16)
    packet.put("data".toByteArray(Charsets.US_ASCII)).putInt(pcm.size).put(pcm)
    return Base64.encodeToString(packet.array(), Base64.NO_WRAP)
  }
}
