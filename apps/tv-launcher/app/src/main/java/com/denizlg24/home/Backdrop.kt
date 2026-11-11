package com.denizlg24.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.widget.ImageView
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** One item's artwork, faint behind the page: a URL (disk-cached) or a saved file. */
class Backdrop(private val view: ImageView) {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val dir = File(view.context.cacheDir, "backdrops")
    private var wanted: String? = null
    private var shown = false

    private val load = Runnable {
        val url = wanted ?: return@Runnable
        io.execute {
            val bitmap = runCatching { fetch(url) }.getOrNull() ?: return@execute
            main.post {
                if (wanted != url) return@post
                view.setImageBitmap(bitmap)
                shown = true
                view.animate().alpha(SHOWN_ALPHA).setDuration(320).start()
            }
        }
    }

    fun show(url: String?) {
        // Asked again for artwork that was not there yet: try once more.
        if (url == wanted && (shown || url == null)) return
        wanted = url
        shown = false
        main.removeCallbacks(load)
        view.animate().alpha(0f).setDuration(160).start()
        // Focus crossing a row should not start a download per item passed.
        if (url != null) main.postDelayed(load, SETTLE_MS)
    }

    private fun fetch(url: String): Bitmap? {
        dir.mkdirs()
        val file = if (url.startsWith("/")) File(url) else File(dir, name(url))
        if (!file.exists()) download(url, file)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        val options = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.RGB_565
            inSampleSize = maxOf(1, bounds.outWidth / view.resources.displayMetrics.widthPixels)
        }
        return BitmapFactory.decodeFile(file.path, options)
    }

    private fun download(url: String, file: File) {
        if (!url.startsWith("https://")) return
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 8_000
        connection.readTimeout = 8_000
        try {
            if (connection.responseCode != 200 || connection.contentLengthLong > MAX_BYTES) return
            val partial = File(dir, "${file.name}.part")
            connection.inputStream.use { input -> partial.outputStream().use { input.copyTo(it) } }
            partial.renameTo(file)
            trim()
        } finally {
            connection.disconnect()
        }
    }

    private fun trim() {
        val files = dir.listFiles().orEmpty().sortedByDescending { it.lastModified() }
        files.drop(KEPT).forEach { it.delete() }
    }

    private fun name(url: String): String =
        MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private companion object {
        const val SHOWN_ALPHA = 0.26f
        const val SETTLE_MS = 220L
        const val MAX_BYTES = 6L * 1024 * 1024
        const val KEPT = 24
    }
}
