package com.edupos.mobile

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager

private const val SAMPLE_RATE = 24000
private const val CHUNK_BYTES = SAMPLE_RATE * 2 / 25
private const val PCM_EVENT = "EduPttPcm"
private const val FINISH_EVENT = "EduPttInputFinished"

class PttMicrophoneModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
    private val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var active: Capture? = null

    private class Capture(val id: String, val input: AudioRecord, val previousMode: Int) {
        @Volatile var stopping = false
        var echo: AcousticEchoCanceler? = null
        var noise: NoiseSuppressor? = null
    }

    override fun getName() = "EduPttMicrophone"

    @ReactMethod fun addListener(name: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    @ReactMethod
    @Synchronized
    fun start(id: String, promise: Promise) {
        if (active != null) {
            promise.reject("PTT_BUSY", "Radio microphone is already active")
            return
        }

        var capture: Capture? = null
        try {
            val minBytes = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            check(minBytes > 0) { "Unsupported radio input format" }
            val input = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBytes, CHUNK_BYTES * 4),
            )
            val session = Capture(id, input, audio.mode)
            capture = session
            check(input.state == AudioRecord.STATE_INITIALIZED) { "Radio input is unavailable" }
            check(audio.mode == AudioManager.MODE_NORMAL || audio.mode == AudioManager.MODE_IN_COMMUNICATION) {
                "The microphone is in use"
            }
            audio.mode = AudioManager.MODE_IN_COMMUNICATION
            session.echo = runCatching {
                AcousticEchoCanceler.create(input.audioSessionId)?.also { it.enabled = true }
            }.getOrNull()
            session.noise = runCatching {
                NoiseSuppressor.create(input.audioSessionId)?.also { it.enabled = true }
            }.getOrNull()
            input.startRecording()
            check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Radio recording could not start" }
            active = session
            Thread({ read(session) }, "edu-ptt-input").start()
            promise.resolve(null)
        } catch (error: Exception) {
            capture?.let { close(it) }
            promise.reject("PTT_INPUT", error)
        }
    }

    @ReactMethod
    @Synchronized
    fun stop(id: String) {
        val session = active?.takeIf { it.id == id } ?: return
        stopCapture(session)
    }

    @Synchronized
    override fun invalidate() {
        active?.let { stopCapture(it) }
        super.invalidate()
    }

    private fun stopCapture(session: Capture) {
        session.stopping = true
        runCatching { session.input.stop() }
    }

    private fun read(session: Capture) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val samples = ByteArray(CHUNK_BYTES)
        var failed = false
        try {
            while (!session.stopping) {
                val count = session.input.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
                if (count > 0) {
                    emit(PCM_EVENT, session.id, Base64.encodeToString(samples, 0, count, Base64.NO_WRAP))
                } else if (count < 0) {
                    failed = !session.stopping
                    break
                }
            }
        } catch (_: Exception) {
            failed = !session.stopping
        } finally {
            close(session)
            emit(FINISH_EVENT, session.id, null, complete = !failed)
        }
    }

    @Synchronized
    private fun close(session: Capture) {
        runCatching { session.echo?.release() }
        runCatching { session.noise?.release() }
        runCatching { session.input.release() }
        if (audio.mode == AudioManager.MODE_IN_COMMUNICATION && session.previousMode != audio.mode) {
            runCatching { audio.mode = session.previousMode }
        }
        if (active === session) active = null
    }

    private fun emit(event: String, id: String, samples: String?, complete: Boolean? = null) {
        if (!app.hasActiveReactInstance()) return
        val data = Arguments.createMap().apply {
            putString("id", id)
            if (samples != null) putString("samples", samples)
            if (complete != null) putBoolean("complete", complete)
        }
        app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, data)
    }
}

class PttMicrophonePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(PttMicrophoneModule(context))

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
