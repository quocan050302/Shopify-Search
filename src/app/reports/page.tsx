"use client";

import { useState } from "react";
import { FileSpreadsheet, Download, ShieldCheck, FileText, CheckCircle2 } from "lucide-react";
import { Header } from "@/components/layout/Header";

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleExport = async (entityType: "ads" | "products") => {
    try {
      setDownloading(entityType);
      const res = await fetch("/api/v1/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType }),
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `swai-${entityType}-research-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Failed to export research report.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0B1020]">
      <Header />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-indigo-400" />
            <span>Research Reports & Data Exports</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Export structured competitor advertising research and product data with complete source provenance
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Export Ads Card */}
          <div className="p-6 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between space-y-4">
            <div>
              <div className="h-10 w-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center mb-3">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h2 className="text-base font-bold text-white">Competitor Advertisements CSV</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Full export of observed video advertisements. Includes canonical source URLs, advertiser names, observed longevity days, research scores, categories, and reliability classification.
              </p>
            </div>

            <button
              onClick={() => handleExport("ads")}
              disabled={downloading === "ads"}
              className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>{downloading === "ads" ? "Generating CSV..." : "Download Ads Research CSV"}</span>
            </button>
          </div>

          {/* Export Products Card */}
          <div className="p-6 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between space-y-4">
            <div>
              <div className="h-10 w-10 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center mb-3">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h2 className="text-base font-bold text-white">Identified Winning Products CSV</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Export of candidate ecommerce products. Includes observed prices, product URLs, merchant storefront domains, detected commerce platform, and count of linked creative campaigns.
              </p>
            </div>

            <button
              onClick={() => handleExport("products")}
              disabled={downloading === "products"}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>{downloading === "products" ? "Generating CSV..." : "Download Products CSV"}</span>
            </button>
          </div>
        </div>

        {/* Provenance Guarantee Banner */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3 text-xs text-slate-400">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
          <span>
            Every exported record preserves original source links to Meta Ad Library or TikTok Creative Center. No synthetic sales figures or fabricated conversion rates are included.
          </span>
        </div>
      </main>
    </div>
  );
}
