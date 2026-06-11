"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Brain,
  Calendar,
  Clock,
  Contact,
  FolderGit2,
  MapPin,
  MessageSquare,
  NotebookPen,
  Plus,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface UpcomingCard {
  _id: string;
  title: string;
  dueDate?: string;
  columnTitle: string;
  daysUntilDue: number;
  overdue: boolean;
}

interface UpcomingBoardGroup {
  boardId: string;
  boardTitle: string;
  boardColor?: string;
  cards: UpcomingCard[];
}

interface UpcomingKanbanResult {
  boards: UpcomingBoardGroup[];
  stats: {
    total: number;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
  };
}

function formatDueLabel(card: UpcomingCard) {
  if (card.overdue) return "overdue";
  if (card.daysUntilDue <= 0) return "today";
  if (card.daysUntilDue === 1) return "tomorrow";
  return `in ${card.daysUntilDue}d`;
}

interface DashboardStats {
  contacts: {
    total: number;
    unread: number;
    recent: Array<{
      _id: string;
      name: string;
      email: string;
      createdAt: Date;
      status: string;
    }>;
  };
  projects: {
    total: number;
    featured: number;
  };
  blogs: {
    total: number;
    published: number;
  };
  calendar: {
    todayEvents: number;
    upcomingEvents: number;
    events: Array<{
      _id: string;
      title: string;
      date: Date;
      status: string;
    }>;
  };
  comments: {
    total: number;
    pending: number;
  };
  timetable: Array<{
    _id: string;
    title: string;
    startTime: string;
    endTime: string;
    place?: string;
    color: string;
  }>;
  resources: Array<{
    _id: string;
    name: string;
    type: string;
    status: "healthy" | "degraded" | "unreachable" | null;
    lastCheckedAt: Date | null;
  }>;
  emails: {
    total: number;
    unread: number;
  };
  notes: {
    total: number;
    recent: Array<{
      _id: string;
      title: string;
      updatedAt: Date;
    }>;
  };
  llm: {
    todayCost: number;
    todayRequests: number;
    todayInputTokens: number;
    todayOutputTokens: number;
  };
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function StatNumber({
  value,
  label,
  href,
  delay,
}: {
  value: number;
  label: string;
  href: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <Link
        href={href}
        className="group flex flex-col items-center gap-1 px-2 sm:px-4 py-2 rounded-lg transition-colors hover:bg-surface/60"
      >
        <span className="font-calistoga text-3xl sm:text-4xl lg:text-5xl text-accent-strong leading-none tracking-tight">
          {value}
        </span>
        <span className="text-[11px] sm:text-xs uppercase tracking-widest text-muted-foreground group-hover:text-accent-strong transition-colors">
          {label}
        </span>
      </Link>
    </motion.div>
  );
}

function AgendaItem({
  time,
  title,
  subtitle,
  color,
  delay,
}: {
  time: string;
  title: string;
  subtitle?: string;
  color: string;
  delay: number;
}) {
  const colorMap: Record<string, string> = {
    accent: "bg-accent",
    "accent-strong": "bg-accent-strong",
    surface: "bg-surface",
    muted: "bg-muted",
    foreground: "bg-foreground",
    background: "bg-muted",
    destructive: "bg-destructive",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay }}
      className="flex items-start gap-4 py-3 group"
    >
      <span className="text-sm font-mono text-muted-foreground w-12 shrink-0 pt-0.5 tabular-nums">
        {time}
      </span>
      <div
        className={`w-0.5 h-full min-h-5 rounded-full shrink-0 ${colorMap[color] ?? "bg-accent"}`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-accent-strong leading-snug">
          {title}
        </p>
        {subtitle && (
          <p className="text-xs text-foreground mt-0.5 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {subtitle}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function ActivityRow({
  icon: Icon,
  label,
  meta,
  href,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  meta: string;
  href: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <Link
        href={href}
        className="flex items-center gap-3 py-2.5 group hover:bg-surface/40 -mx-2 px-2 rounded-md transition-colors"
      >
        <Icon className="w-3.5 h-3.5 text-foreground shrink-0" />
        <span className="text-sm text-accent-strong truncate flex-1">
          {label}
        </span>
        <span className="text-xs text-foreground shrink-0">{meta}</span>
      </Link>
    </motion.div>
  );
}

function ResourceDot({
  name,
  type,
  status,
}: {
  name: string;
  type: string;
  status: "healthy" | "degraded" | "unreachable" | null;
}) {
  const typeIcons: Record<string, string> = {
    pi: "RPi",
    vps: "VPS",
    api: "API",
    service: "SVC",
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          status === "healthy"
            ? "bg-accent"
            : status === "degraded"
              ? "bg-yellow-500"
              : status === "unreachable"
                ? "bg-destructive"
                : "bg-muted"
        }`}
      />
      <span className="text-xs text-foreground uppercase tracking-wider w-7 shrink-0">
        {typeIcons[type] ?? type}
      </span>
      <span className="text-sm text-accent-strong">{name}</span>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  delay,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <Link
        href={href}
        className="flex items-center gap-2 text-sm text-foreground hover:text-accent-strong transition-colors group"
      >
        <span className="flex items-center justify-center w-6 h-6 rounded-full border border-foreground/15 group-hover:border-accent-strong/30 group-hover:bg-surface transition-all">
          <Plus className="w-3 h-3" />
        </span>
        <span>{label}</span>
      </Link>
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium mb-4">
      {children}
    </h2>
  );
}

function LoadingSkeleton() {
  return (
    <div className="w-full flex flex-col gap-10">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex justify-center gap-8">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Skeleton className="h-12 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardOverview() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingKanbanResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, upcomingRes] = await Promise.all([
        fetch("/api/admin/dashboard/stats"),
        fetch("/api/admin/kanban/upcoming?days=7"),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (upcomingRes.ok) setUpcoming(await upcomingRes.json());
    } catch (error) {
      console.error("Failed to fetch dashboard stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) return <LoadingSkeleton />;

  if (!stats) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-8 h-8 mx-auto text-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          Failed to load dashboard data
        </p>
      </div>
    );
  }

  const alerts: { label: string; href: string }[] = [];
  if (stats.contacts.unread > 0)
    alerts.push({
      label: `${stats.contacts.unread} unread contact${stats.contacts.unread > 1 ? "s" : ""}`,
      href: "/admin/dashboard/contacts",
    });
  if (stats.comments.pending > 0)
    alerts.push({
      label: `${stats.comments.pending} pending comment${stats.comments.pending > 1 ? "s" : ""}`,
      href: "/admin/dashboard/comments",
    });
  if (stats.emails.unread > 0)
    alerts.push({
      label: `${stats.emails.unread} unread email${stats.emails.unread > 1 ? "s" : ""}`,
      href: "/admin/dashboard/inbox",
    });

  const agendaItems = [
    ...stats.timetable.map((entry) => ({
      time: entry.startTime,
      title: entry.title,
      subtitle: entry.place,
      color: entry.color,
      type: "timetable" as const,
      sortKey: entry.startTime,
    })),
    ...stats.calendar.events
      .filter((event) => {
        const eventDate = new Date(event.date);
        const today = new Date();
        return eventDate.toDateString() === today.toDateString();
      })
      .map((event) => ({
        time: format(new Date(event.date), "HH:mm"),
        title: event.title,
        subtitle: undefined,
        color:
          event.status === "completed"
            ? "accent"
            : event.status === "canceled"
              ? "destructive"
              : "accent-strong",
        type: "event" as const,
        sortKey: format(new Date(event.date), "HH:mm"),
      })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const upcomingEvents = stats.calendar.events
    .filter((event) => {
      const eventDate = new Date(event.date);
      const today = new Date();
      return eventDate.toDateString() !== today.toDateString();
    })
    .slice(0, 3);

  return (
    <div className="w-full flex flex-col gap-0">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10"
      >
        <h1 className="font-calistoga text-3xl sm:text-4xl text-accent-strong leading-tight">
          {getGreeting()}, Deniz.
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          {format(new Date(), "EEEE, MMMM d, yyyy")}
        </p>

        {alerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-3 text-sm"
          >
            {alerts.map((alert, i) => (
              <span key={alert.label} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span className="text-foreground select-none">·</span>
                )}
                <Link
                  href={alert.href}
                  className="text-muted-foreground hover:text-accent-strong transition-colors underline decoration-foreground/30 underline-offset-2 hover:decoration-accent-strong/40"
                >
                  {alert.label}
                </Link>
              </span>
            ))}
          </motion.div>
        )}
      </motion.div>

      <div className="flex flex-wrap justify-center gap-2 sm:gap-4 lg:gap-6 pb-10 border-b border-foreground/6">
        <StatNumber
          value={stats.contacts.total}
          label="Contacts"
          href="/admin/dashboard/contacts"
          delay={0.1}
        />
        <StatNumber
          value={stats.calendar.todayEvents + stats.timetable.length}
          label="Today"
          href="/admin/dashboard/calendar"
          delay={0.15}
        />
        <StatNumber
          value={stats.projects.total}
          label="Projects"
          href="/admin/dashboard/projects"
          delay={0.2}
        />
        <StatNumber
          value={stats.blogs.published}
          label="Posts"
          href="/admin/dashboard/blogs"
          delay={0.25}
        />
        <StatNumber
          value={stats.emails.total}
          label="Emails"
          href="/admin/dashboard/inbox"
          delay={0.3}
        />
      </div>

      <div className="py-10 border-b border-foreground/6">
        <SectionLabel>Today&apos;s Agenda</SectionLabel>

        {agendaItems.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-sm text-foreground italic"
          >
            Nothing scheduled for today
          </motion.p>
        ) : (
          <div className="flex flex-col divide-y divide-foreground/4">
            {agendaItems.map((item, i) => (
              <AgendaItem
                key={`${item.type}-${item.time}-${item.title}`}
                time={item.time}
                title={item.title}
                subtitle={item.subtitle}
                color={item.color}
                delay={0.2 + i * 0.06}
              />
            ))}
          </div>
        )}

        <AnimatePresence>
          {upcomingEvents.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 pt-4"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-foreground uppercase tracking-wider">
                  Coming up
                </span>
                <Link
                  href="/admin/dashboard/calendar"
                  className="text-xs text-foreground hover:text-accent-strong transition-colors flex items-center gap-0.5"
                >
                  Calendar <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
              {upcomingEvents.map((event) => (
                <div key={event._id} className="flex items-center gap-3 py-1.5">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">
                    {format(new Date(event.date), "MMM d")}
                  </span>
                  <span className="text-sm text-accent-strong/80">
                    {event.title}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {upcoming && upcoming.stats.total > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="py-10 border-b border-foreground/6"
        >
          <div className="flex items-baseline justify-between mb-4">
            <SectionLabel>Upcoming Deadlines</SectionLabel>
            <div className="flex items-center gap-3 text-[11px] text-foreground">
              {upcoming.stats.overdue > 0 && (
                <span className="text-destructive">
                  {upcoming.stats.overdue} overdue
                </span>
              )}
              {upcoming.stats.dueToday > 0 && (
                <span>{upcoming.stats.dueToday} today</span>
              )}
              <Link
                href="/admin/dashboard/kanban"
                className="hover:text-accent-strong transition-colors flex items-center gap-0.5"
              >
                Kanban <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-6">
            {upcoming.boards.map((board, bi) => (
              <motion.div
                key={board.boardId}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.4 + bi * 0.05 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        board.boardColor ?? "var(--muted-foreground)",
                    }}
                  />
                  <span className="text-[11px] uppercase tracking-wider text-foreground">
                    {board.boardTitle}
                  </span>
                </div>
                <div className="flex flex-col divide-y divide-foreground/4 border-l border-foreground/10 pl-4 ml-[3px]">
                  {board.cards.map((card) => (
                    <div
                      key={card._id}
                      className="flex items-baseline gap-4 py-2"
                    >
                      <span
                        className={`text-xs font-mono w-20 shrink-0 tabular-nums ${
                          card.overdue
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatDueLabel(card)}
                      </span>
                      <span className="text-sm text-accent-strong truncate flex-1">
                        {card.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {card.columnTitle}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      <div className="py-10 grid grid-cols-1 md:grid-cols-5 gap-10 md:gap-12 border-b border-foreground/6">
        <div className="md:col-span-3">
          <SectionLabel>Recent Activity</SectionLabel>

          <div className="flex flex-col">
            {stats.contacts.recent.length === 0 &&
            stats.comments.total === 0 ? (
              <p className="text-sm text-foreground italic">
                No recent activity
              </p>
            ) : (
              <>
                {stats.contacts.recent.slice(0, 4).map((contact, i) => (
                  <ActivityRow
                    key={contact._id}
                    icon={contact.status === "new" ? Bell : Contact}
                    label={`${contact.name} — ${contact.email}`}
                    meta={formatDistanceToNow(new Date(contact.createdAt), {
                      addSuffix: true,
                    })}
                    href={`/admin/dashboard/contacts/${contact._id}`}
                    delay={0.2 + i * 0.05}
                  />
                ))}
                {stats.comments.pending > 0 && (
                  <ActivityRow
                    icon={MessageSquare}
                    label={`${stats.comments.pending} comment${stats.comments.pending > 1 ? "s" : ""} awaiting approval`}
                    meta="review"
                    href="/admin/dashboard/comments"
                    delay={0.4}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <div className="md:col-span-2">
          <SectionLabel>System</SectionLabel>

          {stats.resources.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mb-6"
            >
              <Link href="/admin/dashboard/resources" className="block group">
                <div className="flex flex-col gap-0.5">
                  {stats.resources.map((resource) => (
                    <ResourceDot
                      key={resource._id}
                      name={resource.name}
                      type={resource.type}
                      status={resource.status}
                    />
                  ))}
                </div>
              </Link>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="pt-4 border-t border-foreground/4"
          >
            <Link href="/admin/dashboard/llm-usage" className="block group">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-3.5 h-3.5 text-foreground" />
                <span className="text-xs text-foreground uppercase tracking-wider">
                  LLM Today
                </span>
              </div>
              <div className="flex items-baseline gap-4">
                <div>
                  <span className="font-calistoga text-xl text-accent-strong">
                    ${stats.llm.todayCost.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    cost
                  </span>
                </div>
                <div>
                  <span className="font-calistoga text-xl text-accent-strong">
                    {stats.llm.todayRequests}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    requests
                  </span>
                </div>
              </div>
              {stats.llm.todayRequests > 0 && (
                <p className="text-xs text-foreground mt-1">
                  {(
                    (stats.llm.todayInputTokens + stats.llm.todayOutputTokens) /
                    1000
                  ).toFixed(1)}
                  k tokens
                </p>
              )}
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="pt-4 mt-4 border-t border-foreground/4"
          >
            <Link href="/admin/dashboard/blogs" className="block group">
              <div className="flex items-center gap-2 mb-2">
                <NotebookPen className="w-3.5 h-3.5 text-foreground" />
                <span className="text-xs text-foreground uppercase tracking-wider">
                  Blog
                </span>
              </div>
              <div className="flex items-baseline gap-4">
                <div>
                  <span className="font-calistoga text-xl text-accent-strong">
                    {stats.blogs.published}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    published
                  </span>
                </div>
                {stats.blogs.total - stats.blogs.published > 0 && (
                  <div>
                    <span className="font-calistoga text-xl text-accent-strong/40">
                      {stats.blogs.total - stats.blogs.published}
                    </span>
                    <span className="text-xs text-foreground ml-1">drafts</span>
                  </div>
                )}
              </div>
            </Link>
          </motion.div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="py-10"
      >
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <QuickAction
            href="/admin/dashboard/projects/new"
            icon={FolderGit2}
            label="Project"
            delay={0.55}
          />
          <QuickAction
            href="/admin/dashboard/blogs/new"
            icon={NotebookPen}
            label="Blog Post"
            delay={0.6}
          />
          <QuickAction
            href="/admin/dashboard/calendar"
            icon={Calendar}
            label="Event"
            delay={0.65}
          />
          <QuickAction
            href="/admin/dashboard/timeline/new"
            icon={Clock}
            label="Timeline Entry"
            delay={0.7}
          />
        </div>
      </motion.div>
    </div>
  );
}
