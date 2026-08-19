"use client"

import {
  Apple,
  Barcode,
  BookOpen,
  ChefHat,
  CircleEllipsisIcon,
  Dumbbell,
  LayoutTemplate,
  Plus,
  Scale,
  Search,
  Shapes,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { useWeightOverview } from "@/lib/app-cache/api"
import { cn } from "@/lib/utils"
import { dateToIso } from "@/lib/weights/date-utils"
import { WeighInDrawerForm } from "./weigh-in-drawer-form"

type NavLinkProps = {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
}

function NavLink({ href, icon: Icon, label, active }: NavLinkProps) {
  return (
    <Button
      asChild
      variant="ghost"
      className="w-full flex-col gap-1 h-auto py-2 px-1"
    >
      <Link
        href={href}
        className={cn(
          "flex flex-col items-center gap-1",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <Icon className="size-5" />
        <span className="text-[10px]">{label}</span>
      </Link>
    </Button>
  )
}

function ShortcutButton({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <DrawerClose asChild>
      <Link href={href} className="flex flex-col items-center gap-2">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6" />
        </span>
        <span className="text-xs font-medium">{label}</span>
      </Link>
    </DrawerClose>
  )
}

function ShortcutAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-2"
      onClick={onClick}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6" />
      </span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

function ShortcutRow({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <DrawerClose asChild>
      <Link
        href={href}
        className="flex items-center gap-4 border-b border-border/70 py-4 last:border-b-0"
      >
        <Icon className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 text-base font-medium">{label}</span>
        <span className="text-2xl leading-none text-muted-foreground">›</span>
      </Link>
    </DrawerClose>
  )
}

export function DashboardHeader() {
  const pathname = usePathname()
  const { data } = useWeightOverview()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<"shortcuts" | "weight">(
    "shortcuts"
  )
  const today = data?.today ?? dateToIso(new Date())
  const todayEntry = useMemo(
    () => data?.entries.find((entry) => entry.logDate === today) ?? null,
    [data?.entries, today]
  )

  function closeDrawer() {
    setDrawerOpen(false)
    setDrawerMode("shortcuts")
  }

  return (
    <header className="macros-fixed-inset-x fixed bottom-0 z-10 border-t bg-background">
      <div className="mx-auto grid w-full max-w-sm grid-cols-5 items-end px-2 pt-2 pb-safe-end">
        <NavLink
          href="/app"
          icon={LayoutTemplate}
          label="Dashboard"
          active={pathname === "/app"}
        />
        <NavLink
          href="/app/food-log"
          icon={Apple}
          label="Food Log"
          active={pathname === "/app/food-log"}
        />

        <Drawer
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open)
            if (!open) setDrawerMode("shortcuts")
          }}
          shouldScaleBackground={false}
          repositionInputs={false}
        >
          <DrawerTrigger asChild>
            <button
              type="button"
              aria-label="Open shortcuts"
              className="mx-auto mb-1 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            >
              <Plus className="size-6" />
            </button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[72dvh]! rounded-t-3xl pb-safe-end">
            {drawerMode === "weight" ? (
              <WeighInDrawerForm
                selectedDate={today}
                activeEntry={todayEntry}
                onClose={closeDrawer}
                showHandle={false}
              />
            ) : (
              <>
                <DrawerHeader className="grid grid-cols-[auto_1fr_auto] items-center border-b border-border/70 px-5 pb-4 text-center">
                  <DrawerClose asChild>
                    <button
                      type="button"
                      className="flex size-9 items-center justify-center"
                      aria-label="Close shortcuts"
                    >
                      <X className="size-6" />
                    </button>
                  </DrawerClose>
                  <div>
                    <DrawerTitle className="text-xl font-bold">
                      Shortcuts
                    </DrawerTitle>
                    <DrawerDescription className="sr-only">
                      Choose what to add or open.
                    </DrawerDescription>
                  </div>
                  <span className="size-9" aria-hidden="true" />
                </DrawerHeader>

                <div className="grid grid-cols-3 gap-3 px-8 py-5">
                  <ShortcutAction
                    icon={Scale}
                    label="Weight"
                    onClick={() => setDrawerMode("weight")}
                  />
                  <ShortcutButton
                    href="/app/add?focus=search"
                    icon={Search}
                    label="Search"
                  />
                  <ShortcutButton
                    href="/app/scan"
                    icon={Barcode}
                    label="Barcode"
                  />
                </div>

                <div className="px-8">
                  <ShortcutRow
                    href="/app/foods"
                    icon={ChefHat}
                    label="Your Foods"
                  />
                  <ShortcutRow
                    href="/app/weight"
                    icon={Dumbbell}
                    label="Metrics"
                  />
                  <ShortcutRow
                    href="/app/recipes"
                    icon={BookOpen}
                    label="Recipes"
                  />
                </div>
              </>
            )}
          </DrawerContent>
        </Drawer>

        <NavLink
          href="/app/strategy"
          icon={Shapes}
          label="Strategy"
          active={pathname === "/app/strategy"}
        />
        <NavLink
          href="/app/more"
          icon={CircleEllipsisIcon}
          label="More"
          active={pathname === "/app/more"}
        />
      </div>
    </header>
  )
}
