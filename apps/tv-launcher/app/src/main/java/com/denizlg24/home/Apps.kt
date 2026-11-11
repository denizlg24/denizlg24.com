package com.denizlg24.home

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager

class AppEntry(
    val pkg: String,
    val label: String,
    val intent: Intent,
    val system: Boolean,
)

object Apps {
    const val STREAM = "com.denizlg24.stream"

    /** Every launchable app, TV entry points preferred, sorted by name. */
    fun load(context: Context): List<AppEntry> {
        val pm = context.packageManager
        val found = LinkedHashMap<String, AppEntry>()
        for (category in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val query = Intent(Intent.ACTION_MAIN).addCategory(category)
            for (resolved in pm.queryIntentActivities(query, 0)) {
                val info = resolved.activityInfo
                if (info.packageName == context.packageName || info.packageName in found) continue
                found[info.packageName] = AppEntry(
                    pkg = info.packageName,
                    label = resolved.loadLabel(pm).toString().trim(),
                    intent = Intent(Intent.ACTION_MAIN)
                        .addCategory(category)
                        .setClassName(info.packageName, info.name)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED),
                    system = info.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0,
                )
            }
        }
        return found.values.sortedBy { it.label.lowercase() }
    }

    fun launchIntent(pm: PackageManager, pkg: String): Intent? =
        (pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg))
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/** Which apps sit on the home row, and in what order. */
class HomeRow(context: Context) {
    private val prefs = context.getSharedPreferences("home-row", Context.MODE_PRIVATE)

    private var order: List<String> = read(ORDER)
    private var known: Set<String> = read(KNOWN).toSet()

    /**
     * The first run seeds Stream and whatever the owner installed; afterwards
     * only a newly installed app joins on its own. System apps start in All apps.
     */
    fun resolve(all: List<AppEntry>): List<AppEntry> {
        val byPkg = all.associateBy { it.pkg }
        // A row provisioned before the first run is taken as it stands.
        val provisioned = known.isEmpty() && order.isNotEmpty()
        val fresh =
            if (provisioned) emptyList()
            else all.filter { it.pkg !in known && !it.system }.map { it.pkg }
        if (fresh.isNotEmpty() || !known.containsAll(byPkg.keys)) {
            val seeded = if (known.isEmpty()) fresh.sortedBy { it != Apps.STREAM } else fresh
            order = order + seeded.filter { it !in order }
            known = known + byPkg.keys
            save()
        }
        return order.mapNotNull { byPkg[it] }
    }

    operator fun contains(pkg: String): Boolean = pkg in order

    fun set(packages: List<String>) {
        order = packages.distinct()
        save()
    }

    fun move(pkg: String, to: (index: Int, last: Int) -> Int) {
        val from = order.indexOf(pkg)
        if (from < 0) return
        val next = order.toMutableList()
        next.removeAt(from)
        next.add(to(from, next.size).coerceIn(0, next.size), pkg)
        set(next)
    }

    fun add(pkg: String) = set(order + pkg)

    fun remove(pkg: String) = set(order - pkg)

    private fun read(key: String): List<String> =
        prefs.getString(key, "").orEmpty().split(',').filter { it.isNotEmpty() }

    private fun save() {
        prefs.edit()
            .putString(ORDER, order.joinToString(","))
            .putString(KNOWN, known.joinToString(","))
            .apply()
    }

    private companion object {
        const val ORDER = "order"
        const val KNOWN = "known"
    }
}
