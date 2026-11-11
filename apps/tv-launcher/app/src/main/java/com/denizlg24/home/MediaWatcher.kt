package com.denizlg24.home

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService

/**
 * Other apps' "last watched". Their Watch Next rows are readable only by a
 * privileged launcher, so this follows media sessions instead, which a
 * notification listener may see. Enabled once over adb:
 * `cmd notification allow_listener com.denizlg24.home/.MediaWatcher`.
 */
class MediaWatcher : NotificationListenerService() {
    private val main = Handler(Looper.getMainLooper())
    private val followed = HashMap<MediaSession.Token, Followed>()
    private val sessionsChanged =
        MediaSessionManager.OnActiveSessionsChangedListener { follow(it.orEmpty()) }

    private class Followed(val controller: MediaController, val callback: MediaController.Callback)

    // A playing session reports its position only when its state changes.
    private val tick = object : Runnable {
        override fun run() {
            val playing = followed.values.filter { isPlaying(it.controller) }
            playing.forEach { record(it.controller) }
            if (playing.isNotEmpty()) main.postDelayed(this, TICK_MS)
        }
    }

    override fun onListenerConnected() {
        val manager = getSystemService(MediaSessionManager::class.java)
        val self = ComponentName(this, MediaWatcher::class.java)
        manager.addOnActiveSessionsChangedListener(sessionsChanged, self)
        follow(manager.getActiveSessions(self))
    }

    override fun onListenerDisconnected() {
        getSystemService(MediaSessionManager::class.java)
            .removeOnActiveSessionsChangedListener(sessionsChanged)
        follow(emptyList())
        main.removeCallbacks(tick)
    }

    private fun follow(controllers: List<MediaController>) {
        val live = controllers.filter { it.packageName !in IGNORED && it.packageName != packageName }
        val tokens = live.map { it.sessionToken }.toSet()
        followed.keys.filter { it !in tokens }.forEach { token ->
            followed.remove(token)?.let { it.controller.unregisterCallback(it.callback) }
        }
        for (controller in live) {
            if (controller.sessionToken in followed) continue
            val callback = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) = record(controller)
                override fun onPlaybackStateChanged(state: PlaybackState?) = record(controller)
            }
            controller.registerCallback(callback, main)
            followed[controller.sessionToken] = Followed(controller, callback)
            record(controller)
        }
    }

    private fun record(controller: MediaController) {
        val metadata = controller.metadata ?: return
        val state = controller.playbackState ?: return
        if (state.state != PlaybackState.STATE_PLAYING && state.state != PlaybackState.STATE_PAUSED) return
        val title = first(metadata, MediaMetadata.METADATA_KEY_DISPLAY_TITLE, MediaMetadata.METADATA_KEY_TITLE)
            ?: return
        val subtitle = first(
            metadata,
            MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
            MediaMetadata.METADATA_KEY_ARTIST,
            MediaMetadata.METADATA_KEY_ALBUM,
        )
        Watching.get(this).observe(
            WatchItem(
                source = controller.packageName,
                title = title,
                subtitle = subtitle?.takeIf { it != title },
                uri = null,
                positionMs = position(state),
                durationMs = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION).coerceAtLeast(0),
                updatedAt = System.currentTimeMillis(),
            ),
        )
        if (isPlaying(controller)) {
            main.removeCallbacks(tick)
            main.postDelayed(tick, TICK_MS)
        }
    }

    private fun position(state: PlaybackState): Long {
        if (state.state != PlaybackState.STATE_PLAYING) return state.position.coerceAtLeast(0)
        val elapsed = SystemClock.elapsedRealtime() - state.lastPositionUpdateTime
        return (state.position + (elapsed * state.playbackSpeed).toLong()).coerceAtLeast(0)
    }

    private fun isPlaying(controller: MediaController): Boolean =
        controller.playbackState?.state == PlaybackState.STATE_PLAYING

    private fun first(metadata: MediaMetadata, vararg keys: String): String? =
        keys.firstNotNullOfOrNull { metadata.getString(it)?.trim()?.ifEmpty { null } }

    private companion object {
        const val TICK_MS = 30_000L
        val IGNORED = setOf("com.android.bluetooth")
    }
}
