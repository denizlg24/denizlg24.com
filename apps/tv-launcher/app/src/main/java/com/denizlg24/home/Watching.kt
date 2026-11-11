package com.denizlg24.home

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

class WatchItem(
    val source: String,
    val title: String,
    val subtitle: String?,
    /** Opens the item inside its app; null opens the app itself. */
    val uri: String?,
    val positionMs: Long,
    val durationMs: Long,
    val updatedAt: Long,
)

/**
 * What was last watched, per app. An app either publishes its own list
 * (Stream) or is observed through its media session; a published list wins,
 * because it survives the app closing and carries deep links.
 *
 * Main thread only.
 */
class Watching private constructor(context: Context) {
    private val prefs = context.getSharedPreferences("watching", Context.MODE_PRIVATE)
    private val published = HashMap<String, List<WatchItem>>()
    private val observed = HashMap<String, WatchItem>()

    var onChange: (() -> Unit)? = null

    init {
        val stored = runCatching { JSONObject(prefs.getString(KEY, "{}").orEmpty()) }.getOrNull()
        stored?.optJSONObject(PUBLISHED)?.let { sources ->
            for (source in sources.keys()) {
                published[source] = parseItems(source, sources.getJSONArray(source))
            }
        }
        stored?.optJSONObject(OBSERVED)?.let { sources ->
            for (source in sources.keys()) {
                parseItem(source, sources.getJSONObject(source))?.let { observed[source] = it }
            }
        }
    }

    fun items(): List<WatchItem> =
        (published.values.flatten() + observed.filterKeys { it !in published }.values)
            .sortedByDescending { it.updatedAt }
            .take(SHOWN)

    fun publish(source: String, items: List<WatchItem>) {
        published[source] = items
        changed()
    }

    fun observe(item: WatchItem) {
        val before = observed[item.source]
        observed[item.source] = item
        if (before?.title != item.title || before.subtitle != item.subtitle) changed() else save()
    }

    fun forget(installed: (String) -> Boolean) {
        val gone = (published.keys + observed.keys).filterNot(installed)
        if (gone.isEmpty()) return
        gone.forEach { published.remove(it); observed.remove(it) }
        changed()
    }

    private fun changed() {
        save()
        onChange?.invoke()
    }

    private fun save() {
        val root = JSONObject()
        root.put(PUBLISHED, JSONObject().also { out ->
            published.forEach { (source, items) -> out.put(source, JSONArray(items.map(::json))) }
        })
        root.put(OBSERVED, JSONObject().also { out ->
            observed.forEach { (source, item) -> out.put(source, json(item)) }
        })
        prefs.edit().putString(KEY, root.toString()).apply()
    }

    companion object {
        private const val KEY = "state"
        private const val PUBLISHED = "published"
        private const val OBSERVED = "observed"
        private const val SHOWN = 12
        const val PUBLISHED_MAX = 10

        private var instance: Watching? = null

        fun get(context: Context): Watching =
            instance ?: Watching(context.applicationContext).also { instance = it }

        fun parseItems(source: String, array: JSONArray): List<WatchItem> =
            (0 until minOf(array.length(), PUBLISHED_MAX))
                .mapNotNull { index -> array.optJSONObject(index)?.let { parseItem(source, it) } }

        private fun parseItem(source: String, json: JSONObject): WatchItem? {
            val title = json.optString("title").trim()
            if (title.isEmpty()) return null
            return WatchItem(
                source = source,
                title = title,
                subtitle = text(json, "subtitle"),
                uri = text(json, "uri"),
                positionMs = json.optLong("positionMs").coerceAtLeast(0),
                durationMs = json.optLong("durationMs").coerceAtLeast(0),
                updatedAt = json.optLong("updatedAt"),
            )
        }

        private fun text(json: JSONObject, key: String): String? =
            if (json.isNull(key)) null else json.optString(key).trim().ifEmpty { null }

        private fun json(item: WatchItem): JSONObject = JSONObject()
            .put("title", item.title)
            .put("subtitle", item.subtitle ?: JSONObject.NULL)
            .put("uri", item.uri ?: JSONObject.NULL)
            .put("positionMs", item.positionMs)
            .put("durationMs", item.durationMs)
            .put("updatedAt", item.updatedAt)
    }
}

/**
 * `com.denizlg24.home.action.PUBLISH_WATCHING` with an `items` JSON array of
 * `{ title, subtitle?, uri?, positionMs, durationMs, updatedAt }`.
 * The sender must share its identity (`BroadcastOptions`, Android 14): the
 * list is filed under that package and its links only ever open that package.
 */
class WatchingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
        val source = sentFromPackage ?: return
        val items = runCatching { JSONArray(intent.getStringExtra("items").orEmpty()) }.getOrNull() ?: return
        Watching.get(context).publish(source, Watching.parseItems(source, items))
    }
}
