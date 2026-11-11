package expo.modules.streamtv

import android.app.BroadcastOptions
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A TV has no touchscreen, but an embed's landing page only starts its player
 * on a real tap: a script's click is untrusted and cannot cross into the
 * provider's frame. This taps the middle of a view, as a finger would.
 */
class StreamTvModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamTv")

    AsyncFunction("tapCenter") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction false
      val x = view.width / 2f
      val y = view.height / 2f
      val downAt = SystemClock.uptimeMillis()
      for ((action, at) in listOf(
        MotionEvent.ACTION_DOWN to downAt,
        MotionEvent.ACTION_UP to downAt + TAP_MS,
      )) {
        val event = MotionEvent.obtain(downAt, at, action, x, y, 0)
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        view.dispatchTouchEvent(event)
        event.recycle()
      }
      true
    }.runOnQueue(Queues.MAIN)

    // The home screen files the list under the sender it can verify, which
    // only Android 14 lets a broadcast carry.
    Function("publishWatching") { items: String ->
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        return@Function false
      }
      val intent = Intent(HOME_PUBLISH).setPackage(HOME_PACKAGE).putExtra("items", items)
      val options = BroadcastOptions.makeBasic().setShareIdentityEnabled(true)
      context.sendBroadcast(intent, null, options.toBundle())
      true
    }
  }

  private companion object {
    const val TAP_MS = 60L
    const val HOME_PACKAGE = "com.denizlg24.home"
    const val HOME_PUBLISH = "com.denizlg24.home.action.PUBLISH_WATCHING"
  }
}
