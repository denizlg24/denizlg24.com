"use client";

import {
  ClockFading,
  Contact,
  FolderGit2,
  Home,
  Menu,
  Notebook,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "home", icon: <Home className="w-4.5 h-4.5" /> },
  {
    href: "/projects",
    label: "projects",
    icon: <FolderGit2 className="w-4.5 h-4.5" />,
  },
  {
    href: "/blog",
    label: "blog",
    icon: <Notebook className="w-4.5 h-4.5" />,
  },
  {
    href: "/now",
    label: "now",
    icon: <ClockFading className="w-4.5 h-4.5" />,
  },
  {
    href: "/contact",
    label: "contact",
    icon: <Contact className="w-4.5 h-4.5" />,
  },
];

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: -8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.15 },
  },
};

export const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (pathname.includes("admin") || pathname.includes("pdf-preview")) {
    return null;
  }

  return (
    <>
      <header
        className={cn(
          "transition-all w-full fixed pt-4 top-0 left-1/2 -translate-x-1/2 max-w-5xl sm:px-4 px-2 z-45",
          isScrolled && "max-w-full px-0! pt-0!",
        )}
      >
        <div
          className={cn(
            "transition-all sm:w-fit w-full bg-surface border drop-shadow sm:rounded-full rounded-2xl mx-auto",
            isScrolled &&
              "shadow w-full! rounded-none! mx-0 bg-background! border-0 drop-shadow-none",
          )}
        >
          <div className="flex flex-row py-4 sm:px-8 px-4">
            <nav className="hidden sm:flex w-full max-w-3xl mx-auto flex-row items-center justify-center gap-6 font-semibold text-base">
              {navLinks.map((link) => {
                const isActive =
                  link.href === "/"
                    ? pathname === link.href
                    : pathname.startsWith(link.href);
                const showUnderline = hoveredLink
                  ? hoveredLink === link.href
                  : isActive;

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="relative group inline-flex justify-center gap-2 items-center"
                    onMouseEnter={() => setHoveredLink(link.href)}
                    onMouseLeave={() => setHoveredLink(null)}
                  >
                    {link.icon}
                    <p>{link.label}</p>
                    <span
                      className={cn(
                        "absolute -bottom-1 left-1/2 -translate-x-1/2 h-0.5 bg-foreground transition-all duration-300",
                        showUnderline ? "w-full" : "w-0",
                      )}
                    />
                  </Link>
                );
              })}
            </nav>

            <div className="sm:hidden flex items-center justify-between w-full">
              {(() => {
                const activeLink = navLinks.find((link) =>
                  link.href === "/"
                    ? pathname === link.href
                    : pathname.startsWith(link.href),
                );
                return (
                  <p className="text-sm font-bold flex flex-row items-center gap-1">
                    {activeLink?.icon}
                    {activeLink?.label}
                  </p>
                );
              })()}
              <button
                onClick={() => setMobileOpen((o) => !o)}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                className="relative w-5 h-5"
              >
                <X
                  className={cn(
                    "w-5 h-5 absolute inset-0 transition-all duration-200",
                    mobileOpen ? "opacity-100 rotate-0" : "opacity-0 rotate-90",
                  )}
                />
                <Menu
                  className={cn(
                    "w-5 h-5 absolute inset-0 transition-all duration-200",
                    mobileOpen
                      ? "opacity-0 -rotate-90"
                      : "opacity-100 rotate-0",
                  )}
                />
              </button>
            </div>
          </div>

          <AnimatePresence>
            {mobileOpen && (
              <motion.div
                className="sm:hidden overflow-hidden"
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                transition={{
                  duration: 0.3,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <motion.nav
                  className="flex flex-col px-3 py-3 gap-0.5 border-t border-border"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={staggerContainer}
                >
                  {navLinks.map((link) => {
                    const isActive =
                      link.href === "/"
                        ? pathname === link.href
                        : pathname.startsWith(link.href);

                    return (
                      <motion.div key={link.href} transition={staggerItem}>
                        <Link
                          href={link.href}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors",
                            isActive
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {link.icon}
                          {link.label}
                        </Link>
                      </motion.div>
                    );
                  })}
                </motion.nav>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="sm:hidden fixed inset-0 z-44"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};
