"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Compass,
  PlaySquare,
  ShoppingBag,
  Sparkles,
  Users,
  Bookmark,
  FileSpreadsheet,
  Settings,
  Lock,
  ShieldCheck,
  Radar,
  Flame,
  Globe2,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  LucideIcon,
  X,
} from "lucide-react";

interface NavItemDef {
  name: string;
  href: string;
  icon: LucideIcon;
  exactMatch?: boolean;
  requiredParam?: { key: string; value: string };
  excludedParam?: { key: string; value: string };
  badge?: string;
  isLocked?: boolean;
}

interface NavGroupDef {
  groupName: string;
  items: NavItemDef[];
}

const navGroups: NavGroupDef[] = [
  {
    groupName: "WORKSPACE",
    items: [
      { name: "Overview", href: "/", icon: Compass, exactMatch: true },
    ],
  },
  {
    groupName: "RESEARCH",
    items: [
      { name: "Meta Ads", href: "/meta-discovery", icon: Globe2 },
      {
        name: "Ads Explorer",
        href: "/explorer",
        icon: PlaySquare,
        excludedParam: { key: "mode", value: "EVERGREEN" },
      },
      { name: "Product Finder", href: "/products", icon: ShoppingBag },
      {
        name: "Evergreen Research",
        href: "/explorer?mode=EVERGREEN",
        icon: Flame,
        requiredParam: { key: "mode", value: "EVERGREEN" },
      },
      { name: "TikTok Research", href: "/discovery", icon: Radar },
    ],
  },
  {
    groupName: "INTELLIGENCE",
    items: [
      { name: "Creative Analyzer", href: "/analyzer", icon: Sparkles },
      { name: "Competitor Tracker", href: "/tracker", icon: Users },
      { name: "Watchlist", href: "/watchlist", icon: Bookmark },
    ],
  },
  {
    groupName: "OPERATIONS",
    items: [
      { name: "Research Jobs", href: "/meta-discovery#jobs", icon: ListFilter },
      { name: "Reports & Exports", href: "/reports", icon: FileSpreadsheet },
    ],
  },
  {
    groupName: "SYSTEM",
    items: [
      { name: "Settings", href: "/settings", icon: Settings },
      {
        name: "My Store Analytics",
        href: "/my-store",
        icon: Lock,
        isLocked: true,
        badge: "FUTURE",
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    try {
      const saved = localStorage.getItem("swai_sidebar_collapsed");
      if (saved !== null) {
        setIsCollapsed(saved === "true");
      }
    } catch {}

    const handleToggle = () => setIsMobileOpen((prev) => !prev);
    const handleClose = () => setIsMobileOpen(false);
    window.addEventListener("swai:toggle-sidebar", handleToggle);
    window.addEventListener("swai:close-sidebar", handleClose);
    return () => {
      window.removeEventListener("swai:toggle-sidebar", handleToggle);
      window.removeEventListener("swai:close-sidebar", handleClose);
    };
  }, []);

  // Close mobile drawer on route navigation
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname, searchParams]);

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("swai_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const isItemActive = (item: NavItemDef) => {
    const itemUrl = new URL(item.href, "http://localhost");
    const itemPath = itemUrl.pathname;

    if (item.exactMatch) {
      return pathname === itemPath;
    }

    if (item.requiredParam) {
      return (
        pathname === itemPath &&
        searchParams.get(item.requiredParam.key) === item.requiredParam.value
      );
    }

    if (item.excludedParam) {
      if (
        pathname === itemPath &&
        searchParams.get(item.excludedParam.key) === item.excludedParam.value
      ) {
        return false;
      }
      return pathname === itemPath || pathname.startsWith(itemPath + "/");
    }

    if (item.href.includes("#jobs")) {
      return false;
    }

    return pathname === itemPath || (itemPath !== "/" && pathname.startsWith(itemPath + "/"));
  };

  const renderNavGroups = (collapsed: boolean, onItemClick?: () => void) => (
    <nav className="flex-1 p-2 space-y-4 overflow-y-auto mt-1 scrollbar-thin">
      {navGroups.map((group) => (
        <div key={group.groupName} className="space-y-1">
          {!collapsed && (
            <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              {group.groupName}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isMounted && isItemActive(item);
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={onItemClick}
                  title={collapsed ? item.name : undefined}
                  className={`flex items-center ${
                    collapsed ? "justify-center px-2" : "justify-between px-3"
                  } py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-xs"
                      : item.isLocked
                      ? "text-slate-500 hover:text-slate-400 hover:bg-slate-800/40"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active
                          ? "text-indigo-400"
                          : item.isLocked
                          ? "text-slate-600"
                          : "text-slate-400"
                      }`}
                    />
                    {!collapsed && <span className="truncate">{item.name}</span>}
                  </div>

                  {!collapsed && item.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-slate-800 text-slate-400 border border-slate-700">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 md:hidden animate-in fade-in duration-200"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Overlay Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-68 bg-[#0D1424] border-r border-slate-800 flex flex-col md:hidden transition-transform duration-250 select-none shadow-2xl ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
        }`}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <Link href="/" onClick={() => setIsMobileOpen(false)} className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md shrink-0">
              S
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-100 text-sm tracking-tight">SWAI</span>
                <span className="text-[10px] font-semibold px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  US
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Winning Ads Intelligence</p>
            </div>
          </Link>
          <button
            onClick={() => setIsMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-md bg-slate-900/80 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-medium text-slate-300">RESEARCH_ONLY</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">v11.5</span>
        </div>

        {renderNavGroups(false, () => setIsMobileOpen(false))}

        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Verified Source Provenance</span>
          </div>
        </div>
      </aside>

      {/* Desktop Persistent Sidebar */}
      <aside
        className={`hidden md:flex border-r border-slate-800 bg-[#0D1424] flex-col h-screen sticky top-0 z-40 select-none transition-all duration-200 ${
          isCollapsed ? "w-[68px]" : "w-64"
        }`}
      >
      {/* Brand Header */}
      <div className={`p-4 border-b border-slate-800 flex items-center justify-between ${isCollapsed ? "px-3" : ""}`}>
        {!isCollapsed ? (
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md shrink-0">
              S
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-100 text-sm tracking-tight truncate">SWAI</span>
                <span className="text-[10px] font-semibold px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                  US
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">Winning Ads Intelligence</p>
            </div>
          </Link>
        ) : (
          <Link href="/" className="mx-auto" title="SWAI Winning Ads Intelligence">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md">
              S
            </div>
          </Link>
        )}

        {/* Desktop Collapse Toggle */}
        <button
          onClick={toggleCollapsed}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer hidden md:flex items-center justify-center ${
            isCollapsed ? "mx-auto mt-2" : ""
          }`}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Operating Mode Indicator */}
      {!isCollapsed ? (
        <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-md bg-slate-900/80 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-medium text-slate-300">RESEARCH_ONLY</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">v11.5</span>
        </div>
      ) : (
        <div className="my-2 flex justify-center" title="Operating Mode: RESEARCH_ONLY (v11.5)">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
      )}

      {/* Navigation Groups */}
      <nav className="flex-1 p-2 space-y-4 overflow-y-auto mt-1 scrollbar-thin">
        {navGroups.map((group) => (
          <div key={group.groupName} className="space-y-1">
            {!isCollapsed && (
              <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {group.groupName}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isMounted && isItemActive(item);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    title={isCollapsed ? item.name : undefined}
                    className={`flex items-center ${
                      isCollapsed ? "justify-center px-2" : "justify-between px-3"
                    } py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                      active
                        ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-xs"
                        : item.isLocked
                        ? "text-slate-500 hover:text-slate-400 hover:bg-slate-800/40"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active
                            ? "text-indigo-400"
                            : item.isLocked
                            ? "text-slate-600"
                            : "text-slate-400"
                        }`}
                      />
                      {!isCollapsed && <span className="truncate">{item.name}</span>}
                    </div>

                    {!isCollapsed && item.badge && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-slate-800 text-slate-400 border border-slate-700">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Provenance & Integrity Footer */}
      {!isCollapsed ? (
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400 space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Verified Source Provenance</span>
          </div>
          <p className="text-[10px] text-slate-400 leading-snug">
            Research data backed by authentic public library records.
          </p>
        </div>
      ) : (
        <div className="p-3 border-t border-slate-800 flex justify-center text-emerald-400" title="Verified Source Provenance">
          <ShieldCheck className="h-4 w-4" />
        </div>
      )}
    </aside>
  </>
);
}
