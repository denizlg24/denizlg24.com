package com.denizlg24.home

import android.content.Context
import android.graphics.Typeface

/** Stream's ink-dark palette (`apps/stream-mobile/src/ui/theme.ts`). */
object Ink {
    const val INK = 0xFF0C0B0A.toInt()
    const val PAPER = 0xFFEFE9DF.toInt()
    const val MUTED = 0xFF8E877C.toInt()
    const val HAIRLINE = 0x1AEFE9DF
    const val AMBER = 0xFFF2B54A.toInt()
}

/** Weight comes from the face, never a synthetic bold. */
class Type(context: Context) {
    val display: Typeface = face(context, "BigShoulders_900Black")
    val displayBold: Typeface = face(context, "BigShoulders_800ExtraBold")
    val regular: Typeface = face(context, "AtkinsonHyperlegibleNext_400Regular")
    val bold: Typeface = face(context, "AtkinsonHyperlegibleNext_700Bold")

    private fun face(context: Context, name: String): Typeface =
        Typeface.createFromAsset(context.assets, "fonts/$name.ttf")
}

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

/** Overscan-safe horizontal margin every row starts from. */
const val EDGE = 48
