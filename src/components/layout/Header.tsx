"use client";

import { useState } from "react";
import { Search, PlusCircle, Globe2, Sparkles } from "lucide-react";
import { ImportAdModal } from "@/components/ads/ImportAdModal";

export function Header({ onImportSuccess }: { onImportSuccess?: () => void }) {
  const [isImportOpen, setIsImportOpen] = useState(false);

  return (
    <header className="h-16 border-b border-[#1f293d] bg-[#0c121e]/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Search Input */}
      <div className="flex items-center gap-3 w-96">
        <div className="relative w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search ads, products, advertisers, or keywords..."
            className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Actions & Target Market */}
      <div className="flex items-center gap-3">
        {/* Market Badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
          <Globe2 className="h-3.5 w-3.5 text-indigo-400" />
          <span>Market: <strong className="text-white">United States (US)</strong></span>
        </div>

        {/* Quick Ingest Button */}
        <button
          onClick={() => setIsImportOpen(true)}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span>Import Ad URL</span>
        </button>
      </div>

      <ImportAdModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => {
          setIsImportOpen(false);
          if (onImportSuccess) onImportSuccess();
        }}
      />
    </header>
  );
}
