"use client";
import { Moon, ShieldAlert, Sun } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const LINKS = [
  { href: "/", label: "Report" },
  { href: "/board", label: "Campus Pulse", short: "Pulse" },
  { href: "/admin", label: "Authority" },
];

// The <html> class is the source of truth for the theme; subscribe to it so every toggle stays in sync.
function subscribeTheme(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <button onClick={toggle} aria-label="Toggle dark mode" className="grid size-9 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-soft hover:text-brand">
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="glass sticky top-0 z-30 border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-3 py-3 sm:px-6">
        <Link href="/" className="mr-auto flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-gradient text-white shadow-md">
            <ShieldAlert className="size-5" />
          </span>
          <span className="text-brand-gradient hidden min-[400px]:inline">Campus Assist</span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`relative rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition sm:px-3 sm:text-sm ${active ? "text-brand" : "text-muted hover:text-foreground"}`}>
                {active && <motion.span layoutId="nav-pill" className="absolute inset-0 -z-10 rounded-full bg-soft" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                {"short" in l ? (
                  <>
                    <span className="sm:hidden">{l.short}</span>
                    <span className="hidden sm:inline">{l.label}</span>
                  </>
                ) : (
                  l.label
                )}
              </Link>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
