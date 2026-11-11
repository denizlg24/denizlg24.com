package com.denizlg24.home

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.GradientDrawable
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateFormat
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class HomeActivity : Activity() {
    private class Page(val view: View, val opener: View?)

    private class Entry(
        val label: String,
        val dim: Boolean = false,
        val onLong: ((View) -> Unit)? = null,
        val onClick: (View) -> Unit,
    )

    private val io = Executors.newSingleThreadExecutor()
    private val stack = ArrayDeque<Page>()
    private var apps: List<AppEntry> = emptyList()
    private var placed = false

    private lateinit var type: Type
    private lateinit var homeRow: HomeRow
    private lateinit var watching: Watching
    private lateinit var backdrop: Backdrop

    private lateinit var home: LinearLayout
    private lateinit var pages: FrameLayout
    private lateinit var clock: TextView
    private lateinit var date: TextView
    private lateinit var appsScroll: HorizontalScrollView
    private lateinit var appsRow: LinearLayout
    private lateinit var watchSection: LinearLayout
    private lateinit var watchRow: LinearLayout
    private lateinit var systemRow: LinearLayout

    private val clockTick = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = renderClock()
    }

    private val packagesChanged = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            closePages()
            reloadApps()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        type = Type(this)
        homeRow = HomeRow(this)
        watching = Watching.get(this)
        setContentView(build())

        watching.onChange = ::renderWatching
        renderWatching()
        listen(
            packagesChanged,
            IntentFilter().apply {
                addAction(Intent.ACTION_PACKAGE_ADDED)
                addAction(Intent.ACTION_PACKAGE_REMOVED)
                addAction(Intent.ACTION_PACKAGE_CHANGED)
                addDataScheme("package")
            },
        )
        provision(intent)
        reloadApps()
    }

    override fun onDestroy() {
        watching.onChange = null
        unregisterReceiver(packagesChanged)
        io.shutdown()
        super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        renderClock()
        listen(
            clockTick,
            IntentFilter().apply {
                addAction(Intent.ACTION_TIME_TICK)
                addAction(Intent.ACTION_TIME_CHANGED)
                addAction(Intent.ACTION_TIMEZONE_CHANGED)
            },
        )
    }

    override fun onStop() {
        unregisterReceiver(clockTick)
        super.onStop()
    }

    /** Home pressed again: back to the first app, whatever was open. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        closePages()
        if (provision(intent)) renderApps(null)
        appsScroll.scrollTo(0, 0)
        (appsRow.getChildAt(0) ?: systemRow.getChildAt(0))?.requestFocus()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_UP && stack.isNotEmpty()) pop()
        return true
    }

    /**
     * `am start -n com.denizlg24.home/.HomeActivity --es home a,b,c` sets the
     * home row from adb, for setting a TV up without the remote.
     */
    private fun provision(intent: Intent): Boolean {
        val packages = intent.getStringExtra("home") ?: return false
        homeRow.set(packages.split(',').map { it.trim() }.filter { it.isNotEmpty() })
        return true
    }

    private fun listen(receiver: BroadcastReceiver, filter: IntentFilter) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(receiver, filter)
        }
    }

    private fun build(): View {
        val root = FrameLayout(this).apply { setBackgroundColor(Ink.INK) }
        val image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0f
        }
        root.addView(image, MATCH_PARENT, MATCH_PARENT)
        root.addView(
            View(this).apply {
                background = GradientDrawable(
                    GradientDrawable.Orientation.BOTTOM_TOP,
                    intArrayOf(Ink.INK, Ink.INK and 0x00FFFFFF),
                )
            },
            MATCH_PARENT,
            MATCH_PARENT,
        )
        backdrop = Backdrop(image)
        root.viewTreeObserver.addOnGlobalFocusChangeListener { _, focused -> renderBackdrop(focused) }

        home = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(30), 0, dp(30))
        }

        clock = text(this, type.display, 84f, Ink.PAPER)
        date = text(this, type.regular, 16f, Ink.MUTED)
        home.addView(
            LinearLayout(this).apply {
                setPadding(dp(EDGE), 0, dp(EDGE), 0)
                addView(clock)
                addView(Space(context), LinearLayout.LayoutParams(0, 0, 1f))
                addView(date)
            },
        )
        home.addView(Space(this), LinearLayout.LayoutParams(0, 0, 1f))

        appsRow = LinearLayout(this)
        appsScroll = row(appsRow)
        home.addView(appsScroll)

        watchRow = LinearLayout(this)
        watchSection = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(0, dp(34), 0, 0)
            addView(
                LinearLayout(context).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(EDGE), 0, dp(EDGE), dp(16))
                    addView(text(context, type.bold, 13f, Ink.MUTED).apply { text = "Continue watching" })
                    addView(
                        View(context).apply { setBackgroundColor(Ink.HAIRLINE) },
                        LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = dp(14) },
                    )
                },
            )
            addView(row(watchRow))
        }
        home.addView(watchSection)
        home.addView(Space(this), LinearLayout.LayoutParams(0, 0, 1f))

        systemRow = LinearLayout(this).apply { setPadding(dp(EDGE), 0, dp(EDGE), 0) }
        systemEntries().forEach { entry ->
            systemRow.addView(
                Label(this, type.bold, 17f).apply {
                    text = entry.label
                    setOnClickListener(entry.onClick)
                },
                LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginEnd = dp(34) },
            )
        }
        home.addView(systemRow)

        pages = FrameLayout(this)
        root.addView(home, MATCH_PARENT, MATCH_PARENT)
        root.addView(pages, MATCH_PARENT, MATCH_PARENT)
        return root
    }

    private fun row(content: LinearLayout): HorizontalScrollView =
        RowScroll(this).apply { addView(content) }

    private fun systemEntries(): List<Entry> = listOfNotNull(
        Entry("All apps") { showAllApps(it) },
        Entry("Inputs") { showInputs(it) }.takeIf { tvInputs().isNotEmpty() },
        // A fresh task: Settings otherwise resumes wherever it was last left.
        Entry("Settings") {
            start(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK))
        },
    )

    private fun renderClock() {
        val now = Date()
        clock.text = DateFormat.getTimeFormat(this).format(now)
        val pattern = DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEEdMMMM")
        date.text = SimpleDateFormat(pattern, Locale.getDefault()).format(now)
    }

    private fun reloadApps() {
        io.execute {
            val loaded = Apps.load(this)
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                apps = loaded
                // Installed, not launchable: a source need not have a launcher entry.
                watching.forget { pkg ->
                    runCatching { packageManager.getApplicationInfo(pkg, 0) }.isSuccess
                }
                renderApps(null)
                renderWatching()
            }
        }
    }

    private fun renderApps(focus: String?) {
        val target = focus ?: appsRow.focusedChild?.tag as? String
        appsRow.removeAllViews()
        for (app in homeRow.resolve(apps)) {
            appsRow.addView(
                Label(this, type.displayBold, 40f).apply {
                    text = app.label
                    tag = app.pkg
                    setOnClickListener { start(app.intent) }
                    setOnLongClickListener {
                        showHomeMenu(app, it)
                        true
                    }
                },
                LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginEnd = dp(38) },
            )
        }
        if (stack.isNotEmpty()) return
        val focused = currentFocus
        // Before the first apps arrive the window has focused the system row.
        if (placed && target == null && focused != null && focused.isAttachedToWindow) return
        placed = appsRow.childCount > 0
        val child = (0 until appsRow.childCount).map(appsRow::getChildAt).firstOrNull { it.tag == target }
        (child ?: appsRow.getChildAt(0) ?: systemRow.getChildAt(0))?.requestFocus()
    }

    private fun renderWatching() {
        val items = watching.items()
        val focused = watchRow.indexOfChild(watchRow.focusedChild)
        watchRow.removeAllViews()
        watchSection.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
        for (item in items) {
            watchRow.addView(
                WatchRow(this, type, item, labelOf(item.source)).apply {
                    tag = item
                    setOnClickListener { open(item) }
                },
                LinearLayout.LayoutParams(dp(236), WRAP_CONTENT).apply { marginEnd = dp(40) },
            )
        }
        renderBackdrop(currentFocus)
        if (focused < 0 || stack.isNotEmpty()) return
        val next = watchRow.getChildAt(minOf(focused, watchRow.childCount - 1))
        (next ?: appsRow.getChildAt(0) ?: systemRow.getChildAt(0))?.requestFocus()
    }

    /** The focused item's artwork, else the most recently watched thing that has any. */
    private fun renderBackdrop(focused: View?) {
        val item = focused?.tag as? WatchItem
        backdrop.show(item?.image ?: watching.items().firstNotNullOfOrNull { it.image })
    }

    private fun labelOf(pkg: String): String =
        apps.firstOrNull { it.pkg == pkg }?.label
            ?: runCatching {
                packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
            }.getOrDefault(pkg)

    private fun open(item: WatchItem) {
        val link = item.uri?.let { Intent(Intent.ACTION_VIEW, Uri.parse(it)).setPackage(item.source) }
        if (link != null && start(link)) return
        Apps.launchIntent(packageManager, item.source)?.let(::start)
    }

    private fun start(intent: Intent): Boolean =
        runCatching { startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess

    private fun showHomeMenu(app: AppEntry, opener: View) {
        fun moved(to: (Int, Int) -> Int): (View) -> Unit = {
            homeRow.move(app.pkg, to)
            closePages()
            renderApps(app.pkg)
        }
        showPage(
            app.label,
            listOf(
                Entry("Move left", onClick = moved { index, _ -> index - 1 }),
                Entry("Move right", onClick = moved { index, _ -> index + 1 }),
                Entry("Move to front", onClick = moved { _, _ -> 0 }),
                Entry("Remove from home") {
                    homeRow.remove(app.pkg)
                    closePages()
                    renderApps(null)
                },
                Entry("App info") { showInfo(app) },
            ),
            columns = 1,
            opener = opener,
        )
    }

    private fun showAllApps(opener: View) {
        showPage(
            "All apps",
            apps.map { app ->
                Entry(app.label, onLong = { showAppMenu(app, it) }) { start(app.intent) }
            },
            columns = 3,
            opener = opener,
        )
    }

    private fun showAppMenu(app: AppEntry, opener: View) {
        val onHome = app.pkg in homeRow
        showPage(
            app.label,
            listOfNotNull(
                Entry(if (onHome) "Remove from home" else "Add to home") {
                    if (onHome) homeRow.remove(app.pkg) else homeRow.add(app.pkg)
                    pop()
                    renderApps(null)
                },
                Entry("App info") { showInfo(app) },
                Entry("Uninstall") {
                    start(Intent(Intent.ACTION_DELETE, Uri.parse("package:${app.pkg}")))
                }.takeIf { !app.system },
            ),
            columns = 1,
            opener = opener,
        )
    }

    private fun showInfo(app: AppEntry) {
        start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.pkg}")))
    }

    private fun tvInputs(): List<TvInputInfo> =
        getSystemService(TvInputManager::class.java)?.tvInputList.orEmpty()
            .filter { it.isPassthroughInput }

    private fun showInputs(opener: View) {
        val manager = getSystemService(TvInputManager::class.java) ?: return
        showPage(
            "Inputs",
            tvInputs()
                .map { input ->
                    val label = (input.loadCustomLabel(this) ?: input.loadLabel(this)).toString()
                    Entry(
                        label,
                        dim = manager.getInputState(input.id) != TvInputManager.INPUT_STATE_CONNECTED,
                    ) {
                        start(Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(input.id)))
                    }
                }
                .sortedBy { it.label },
            columns = 1,
            opener = opener,
        )
    }

    private fun showPage(title: String, entries: List<Entry>, columns: Int, opener: View?) {
        val perColumn = maxOf(1, (entries.size + columns - 1) / columns)
        val grid = LinearLayout(this)
        entries.chunked(perColumn).forEach { chunk ->
            val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            chunk.forEach { entry ->
                column.addView(
                    Label(this, type.bold, 20f, if (entry.dim) Ink.HAIRLINE or 0x55000000 else Ink.MUTED).apply {
                        text = entry.label
                        setOnClickListener(entry.onClick)
                        entry.onLong?.let { onLong ->
                            setOnLongClickListener {
                                onLong(it)
                                true
                            }
                        }
                    },
                    LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { bottomMargin = dp(8) },
                )
            }
            grid.addView(column, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        }
        repeat(columns - grid.childCount) {
            grid.addView(Space(this), LinearLayout.LayoutParams(0, 0, 1f))
        }

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ink.INK)
            setPadding(dp(EDGE), dp(34), dp(EDGE), 0)
            addView(text(context, type.display, 44f, Ink.PAPER).apply { text = title })
            addView(
                ScrollView(context).apply {
                    isVerticalScrollBarEnabled = false
                    isFocusable = false
                    overScrollMode = View.OVER_SCROLL_NEVER
                    clipToPadding = false
                    setPadding(0, dp(18), 0, dp(30))
                    setFadingEdgeLength(dp(40))
                    addView(grid)
                },
                LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f),
            )
        }

        (stack.lastOrNull()?.view ?: home).visibility = View.GONE
        pages.addView(page, MATCH_PARENT, MATCH_PARENT)
        stack.addLast(Page(page, opener))
        (grid.getChildAt(0) as? LinearLayout)?.getChildAt(0)?.requestFocus()
    }

    private fun pop() {
        val page = stack.removeLast()
        pages.removeView(page.view)
        val below = stack.lastOrNull()?.view ?: home
        below.visibility = View.VISIBLE
        if (page.opener?.isAttachedToWindow == true) page.opener.requestFocus() else below.requestFocus()
    }

    private fun closePages() {
        if (stack.isEmpty()) return
        pages.removeAllViews()
        stack.clear()
        home.visibility = View.VISIBLE
    }
}
