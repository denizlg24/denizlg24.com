package expo.modules.streamtv

import android.content.Context
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference

/**
 * A row of focusable tiles that Android's own focus search treats as one
 * target from outside: while focus is elsewhere, the row offers only the
 * tile it last held (or, never focused, the leftmost one on screen). Up and
 * Down between rows then land on the remembered column in the same frame the
 * key arrives, with no round trip through JavaScript, and a row below the
 * viewport is still found because nothing here depends on being on screen.
 * This is what Leanback's HorizontalGridView does for its selection.
 */
class FocusRowView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var remembered: WeakReference<View>? = null
  private val bounds = Rect()

  init {
    descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
    isFocusable = false
  }

  // ExpoView is a LinearLayout; left to it, Android's layout pass would line
  // the label and the strip up side by side over where Yoga put them.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(
      MeasureSpec.getSize(widthMeasureSpec),
      MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun requestChildFocus(child: View?, focused: View?) {
    super.requestChildFocus(child, focused)
    if (focused != null) remembered = WeakReference(focused)
  }

  override fun addFocusables(views: ArrayList<View>, direction: Int, focusableMode: Int) {
    if (hasFocus()) {
      super.addFocusables(views, direction, focusableMode)
      return
    }
    val target = rememberedTile() ?: leftmostTile(direction, focusableMode)
    if (target != null) views.add(target) else super.addFocusables(views, direction, focusableMode)
  }

  private fun rememberedTile(): View? {
    val view = remembered?.get() ?: return null
    if (!view.isAttachedToWindow || !view.isFocusable || view.visibility != View.VISIBLE) return null
    var parent = view.parent
    while (parent != null && parent !== this) parent = parent.parent
    return if (parent === this) view else null
  }

  private fun leftmostTile(direction: Int, focusableMode: Int): View? {
    val candidates = ArrayList<View>()
    super.addFocusables(candidates, direction, focusableMode)
    var best: View? = null
    var bestLeft = Int.MAX_VALUE
    for (view in candidates) {
      view.getDrawingRect(bounds)
      offsetDescendantRectToMyCoords(view, bounds)
      if (bounds.right > 0 && bounds.left < bestLeft) {
        best = view
        bestLeft = bounds.left
      }
    }
    return best ?: candidates.firstOrNull()
  }
}
