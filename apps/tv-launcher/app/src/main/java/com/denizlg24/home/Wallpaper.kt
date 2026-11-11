package com.denizlg24.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.widget.ImageView
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * The one picture behind the home screen: `assets/wallpaper.jpg`, or the file
 * a provisioned URL was saved to. Decoded once, off the main thread.
 */
class Wallpaper(private val view: ImageView) {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val custom = File(view.context.filesDir, "wallpaper.jpg")

    fun show() {
        io.execute {
            val bitmap = runCatching { decode() }.getOrNull() ?: return@execute
            main.post {
                view.setImageBitmap(bitmap)
                view.animate().alpha(1f).setDuration(400).start()
            }
        }
    }

    /** Keeps the current picture unless the whole download lands. */
    fun replace(url: String) {
        if (!url.startsWith("https://")) return
        io.execute { runCatching { download(url) } }
        show()
    }

    private fun decode(): Bitmap? {
        val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 }
        if (!custom.exists()) {
            return view.context.assets.open("wallpaper.jpg").use {
                BitmapFactory.decodeStream(it, null, options)
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(custom.path, bounds)
        options.inSampleSize = maxOf(1, bounds.outWidth / view.resources.displayMetrics.widthPixels)
        return BitmapFactory.decodeFile(custom.path, options)
    }

    private fun download(url: String) {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        try {
            if (connection.responseCode != 200 || connection.contentLengthLong > MAX_BYTES) return
            val partial = File(custom.path + ".part")
            connection.inputStream.use { input -> partial.outputStream().use { input.copyTo(it) } }
            partial.renameTo(custom)
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val MAX_BYTES = 8L * 1024 * 1024
    }
}
