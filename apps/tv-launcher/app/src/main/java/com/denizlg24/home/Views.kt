package com.denizlg24.home

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.text.TextUtils
import android.util.TypedValue
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView

fun text(context: Context, face: Typeface, sp: Float, color: Int): TextView =
    TextView(context).apply {
        typeface = face
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        includeFontPadding = false
        fontFeatureSettings = "tnum"
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }

/** A word the remote can rest on: paper over an amber rule when focused. */
class Label(
    context: Context,
    face: Typeface,
    sp: Float,
    private val rest: Int = Ink.MUTED,
) : TextView(context) {
    private val rule = Paint().apply { color = Ink.AMBER }
    private val ruleHeight = context.dp(2).toFloat()

    init {
        typeface = face
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(rest)
        includeFontPadding = false
        maxLines = 1
        isFocusable = true
        isClickable = true
        isLongClickable = true
        setPadding(0, context.dp(4), 0, context.dp(9))
    }

    override fun onFocusChanged(gained: Boolean, direction: Int, previous: Rect?) {
        super.onFocusChanged(gained, direction, previous)
        setTextColor(if (gained) Ink.PAPER else rest)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (isFocused) canvas.drawRect(0f, height - ruleHeight, width.toFloat(), height.toFloat(), rule)
    }
}

/** How far through, as a hairline. */
class Progress(context: Context) : View(context) {
    private val track = Paint().apply { color = Ink.HAIRLINE }
    private val fill = Paint().apply { color = Ink.MUTED }

    var fraction = 0f
        set(value) {
            field = value.coerceIn(0f, 1f)
            invalidate()
        }

    var lit = false
        set(value) {
            field = value
            fill.color = if (value) Ink.AMBER else Ink.MUTED
            invalidate()
        }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), track)
        if (fraction > 0f) canvas.drawRect(0f, 0f, width * fraction, height.toFloat(), fill)
    }
}

/** One thing to carry on watching: its name, where it stands, a hairline. */
class WatchRow(context: Context, type: Type, item: WatchItem, source: String) : LinearLayout(context) {
    private val title = text(context, type.bold, 18f, Ink.MUTED)
    private val progress = Progress(context)

    init {
        orientation = VERTICAL
        isFocusable = true
        isClickable = true
        title.text = item.title
        addView(title)
        addView(
            text(context, type.regular, 14f, Ink.MUTED).apply {
                text = listOfNotNull(item.subtitle, remaining(item), source).joinToString("   ")
            },
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
                topMargin = context.dp(5)
            },
        )
        progress.fraction =
            if (item.durationMs > 0) item.positionMs.toFloat() / item.durationMs else 0f
        addView(
            progress,
            LayoutParams(LayoutParams.MATCH_PARENT, context.dp(2)).apply { topMargin = context.dp(11) },
        )
    }

    override fun onFocusChanged(gained: Boolean, direction: Int, previous: Rect?) {
        super.onFocusChanged(gained, direction, previous)
        title.setTextColor(if (gained) Ink.PAPER else Ink.MUTED)
        progress.lit = gained
    }

    private fun remaining(item: WatchItem): String? {
        if (item.durationMs <= 0 || item.positionMs >= item.durationMs) return null
        val minutes = ((item.durationMs - item.positionMs + 59_999) / 60_000).toInt()
        return if (minutes < 60) "$minutes min left" else "${minutes / 60} h ${minutes % 60} min left"
    }
}

/**
 * A row that bleeds to both screen edges. The focused item always comes to
 * rest on the left margin, as Stream's rows do, so the eye stays in one place
 * while the row moves under it.
 */
class RowScroll(context: Context) : HorizontalScrollView(context) {
    init {
        isHorizontalScrollBarEnabled = false
        overScrollMode = OVER_SCROLL_NEVER
        clipToPadding = false
        isFocusable = false
        setPadding(context.dp(EDGE), 0, context.dp(EDGE), 0)
    }

    override fun computeScrollDeltaToGetChildRectOnScreen(rect: Rect): Int {
        val content = getChildAt(0) ?: return 0
        val furthest = maxOf(0, content.width + paddingLeft + paddingRight - width)
        return (rect.left - paddingLeft).coerceIn(0, furthest) - scrollX
    }
}
