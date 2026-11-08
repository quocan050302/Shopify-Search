"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { importLocalTrendsCsv } from "@/services/kh02/demand/localTrendsWorkflow";

type ImportResult = Awaited<ReturnType<typeof importLocalTrendsCsv>>;
type Evaluation = NonNullable<ImportResult["evaluation"]>;

export default function LocalTrendsPage() {
  const [products, setProducts] = useState<Array<{ id: string; title: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [productId, setProductId] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const workspace = params.get("workspaceId");
    fetch(`/api/v1/demand/local-trends${workspace ? `?${new URLSearchParams({ workspaceId: workspace })}` : ""}`, { signal: controller.signal })
      .then(response => response.json()).then(body => {
        if (!body.success) throw new Error(body.error?.message || "Cannot load workspace products.");
        setProducts(body.data.products);
        setWorkspaceId(body.data.workspaceId);
        const selected = body.data.products.find((p: { id: string; title: string }) => p.id === params.get("productId"));
        if (selected) { setProductId(selected.id); setQuery(selected.title); }
      }).catch(reason => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, []);

  const sourceUrl = `https://trends.google.com/trends/explore?${new URLSearchParams({ geo: "US", date: "today 12-m", q: query.trim() })}`;
  async function importFile(file: File | undefined) {
    if (!file || !productId || !query.trim() || busy) return;
    setError(""); setBusy(true); setResult(null); setEvaluation(null);
    try {
      if (file.size > 256 * 1024) throw new Error("CSV must be at most 256 KiB.");
      const original = await file.arrayBuffer();
      const rawCsv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original);
      const response = await fetch(`/api/v1/demand/local-trends?${new URLSearchParams({ workspaceId })}`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, query, sourceUrl, rawCsv }) });
      const body = await response.json();
      if (!body.success) throw new Error(`${body.error?.code}: ${body.error?.message}`);
      setResult(body.data); setEvaluation(body.data.evaluation);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed."); }
    finally { setBusy(false); }
  }
  async function reevaluate() {
    if (!productId || busy) return;
    setBusy(true); setError(""); setEvaluation(null);
    try {
      const response = await fetch(`/api/v1/demand/local-trends?${new URLSearchParams({ productId, workspaceId })}`);
      const body = await response.json();
      if (!body.success) throw new Error(body.error?.message || "Evaluation failed.");
      setEvaluation(body.data.evaluation);
      if (!body.data.evaluation) setError("No local Trends import found for this product yet.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Evaluation failed."); }
    finally { setBusy(false); }
  }
  return (
    <main className="min-h-screen bg-[#0b0f19] text-slate-100 p-6 sm:p-10">
      <div className="max-w-4xl mx-auto space-y-7">
        <Link href="/products" className="text-sm text-indigo-300">← Product Finder</Link>
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-indigo-300">US demand evidence · Free CSV workflow</p>
          <h1 className="text-3xl font-semibold">Google Trends → local product evaluation</h1>
          <p className="text-slate-400">Download the official CSV, then the app saves completed periods and runs G15/G16. Search interest is relative demand evidence, not verified sales.</p>
        </header>
        <div className="rounded-xl border border-amber-800 bg-amber-950/20 p-4 text-sm text-amber-200">
          Download requires your action in Google Trends. Unattended Explore access is currently disallowed by Google’s robots policy. This workflow uses no paid API and does not automatically approve uploaded data.
        </div>
        {workspaceId && <p className="text-xs text-slate-500">Workspace: {workspaceId}</p>}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
          <h2 className="font-semibold text-lg">1. Choose the product and search term</h2>
          <label className="block space-y-2 text-sm">Product
            <select value={productId} disabled={busy} onChange={event => {
              setProductId(event.target.value); setQuery(products.find(p => p.id === event.target.value)?.title || "");
              setResult(null); setEvaluation(null); setError("");
            }} className="w-full block bg-slate-950 border border-slate-700 rounded-lg p-3">
              <option value="">Select a workspace product</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}
            </select>
          </label>
          <label className="block space-y-2 text-sm">Exact Google Trends search term
            <input value={query} maxLength={200} disabled={busy} onChange={event => setQuery(event.target.value)} className="w-full block bg-slate-950 border border-slate-700 rounded-lg p-3" />
          </label>
          <p className="text-xs text-slate-400">Choose a term that describes this product. A broad category or another merchant’s SKU cannot establish this product’s demand.</p>
          {productId && query.trim().length >= 3 && <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium">Open official Trends · US · past 12 months ↗</a>}
          <h2 className="font-semibold text-lg pt-3">2. Download “Interest over time”, then select that CSV</h2>
          <p className="text-sm text-slate-400">In Trends, use the chart’s download button. Selecting the file below automatically imports it into this product and evaluates the gates.</p>
          <label className="block text-sm">Official CSV file
            <input type="file" accept=".csv,text/csv" aria-label="Official CSV file" disabled={!productId || query.trim().length < 3 || busy}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }}
              className="block mt-2 w-full rounded-lg border border-slate-700 p-3 file:mr-3 file:bg-slate-800 file:text-slate-100 file:border-0 file:rounded file:px-3 file:py-1" />
          </label>
          <button disabled={!productId || busy} onClick={() => void reevaluate()} className="text-sm text-indigo-300 disabled:text-slate-600">Re-evaluate the latest stored import</button>
        </section>
        {busy && <p role="status" className="text-indigo-300">Saving and evaluating…</p>}
        {error && <p role="alert" className="rounded-lg border border-red-900 p-4 text-red-300">{error}</p>}
        {result && <section className="rounded-xl border border-slate-700 p-5 space-y-2 text-sm" data-testid="trends-import-result">
          <h2 className="font-semibold">Database import complete</h2>
          <p>{result.imported.insertedCount} inserted · {result.imported.skippedCount} already stored · {result.excludedIncompletePeriods} incomplete periods excluded</p>
          <p className="text-slate-400 break-all">Original CSV SHA-256: {result.rawSha256}</p>
          <p>Source review: {result.authority.code}. {result.authority.reason}</p>
          {result.evaluationError && <p role="alert" className="text-amber-300">{result.evaluationError}</p>}
          {result.warning && <p role="alert" className="text-amber-300">{result.warning}</p>}
        </section>}
        {evaluation && <section className="rounded-xl border border-slate-700 p-5 space-y-4" data-testid="trends-gates-result">
          <h2 className="font-semibold">{evaluation.title}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-900 p-4"><h3 className="text-sm text-slate-400">G15 · historical demand</h3><p className="text-lg mt-1">{evaluation.g15.status}</p><p className="text-xs text-slate-400 mt-2">{evaluation.storedObservations} stored rows · {evaluation.g15.coveredDays} covered days</p></div>
            <div className="rounded-lg bg-slate-900 p-4"><h3 className="text-sm text-slate-400">G16 · product eligibility</h3><p className="text-lg mt-1">{evaluation.g16.eligible ? "Eligible for further leaderboard selection" : "Not eligible"}</p><p className="text-xs text-slate-400 mt-2">{evaluation.g16.tier}</p></div>
          </div>
          <p className="text-sm">{evaluation.g15.explanation}</p>
          <ul className="list-disc pl-5 text-sm text-slate-400 space-y-1">{[...new Set([...evaluation.g15.missingEvidence, ...evaluation.g16.reasons])].map(reason => <li key={reason}>{reason}</li>)}</ul>
          <p className="text-xs text-amber-300">Release remains on hold. This evaluates one product; it does not publish or pad a Top 3 leaderboard.</p>
        </section>}
      </div>
    </main>
  );
}
