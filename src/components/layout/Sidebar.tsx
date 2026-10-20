"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const navigation = [
    { name: "Overview", href: "/", icon: Compass },
    { name: "Auto Discovery", href: "/discovery", icon: Radar },
    { name: "Winning Ads Explorer", href: "/explorer", icon: PlaySquare },
    { name: "Winning Product Finder", href: "/products", icon: ShoppingBag },
    { name: "AI Creative Analyzer", href: "/analyzer", icon: Sparkles },
    { name: "Competitor Tracker", href: "/tracker", icon: Users },
    { name: "Watchlist", href: "/watchlist", icon: Bookmark },
    { name: "Reports & Exports", href: "/reports", icon: FileSpreadsheet },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-[#1f293d] bg-[#0c121e] flex flex-col h-screen sticky top-0 z-30 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-[#1f293d]">
        <Link href="/" className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-indigo-500/20">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-base tracking-tight">SWAI</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                US 🇺🇸
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Winning Ads Intelligence</p>
          </div>
        </Link>

        {/* Operating Mode Badge */}
        <div className="mt-3.5 px-2.5 py-1.5 rounded-md bg-slate-900/90 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-slate-300">RESEARCH_ONLY</span>
          </div>
          <span className="text-[10px] text-slate-500">v2.0</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-indigo-400" : "text-slate-500"}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}

        {/* Future Section: Shopify Store Analytics (Honest locked state) */}
        <div className="pt-4 mt-4 border-t border-[#1f293d]/60">
          <p className="px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Future Store Commerce
          </p>
          <Link
            href="/my-store"
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              pathname.startsWith("/my-store")
                ? "bg-slate-800 text-slate-200"
                : "text-slate-500 hover:text-slate-400 hover:bg-slate-900/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-slate-600" />
              <span>My Store Analytics</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
              SETUP
            </span>
          </Link>
        </div>
      </nav>

      {/* System Integrity & Provenance Footer */}
      <div className="p-3 border-t border-[#1f293d] bg-slate-950/40 text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Real Data Provenance</span>
        </div>
        <p className="text-[10px] text-slate-500">
          All ads backed by authentic Meta & TikTok public library links.
        </p>
      </div>
    </aside>
  );
}
