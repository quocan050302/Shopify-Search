"use client";

import { useEffect, useState, use, Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShoppingBag,
  ExternalLink,
  Store,
  Layers,
  Sparkles,
  Calculator,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  RefreshCw,
  Plus,
  PlaySquare,
  CheckCircle2,
  XCircle,
  HelpCircle,
  BarChart3,
  Truck,
  FileText,
  BookmarkPlus,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/layout/Header";

interface IntelligencePageProps {
  params: Promise<{ id: string }>;
}

function ProductIntelligenceContent({ params }: IntelligencePageProps) {
  const { id: productId } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"product" | "creative" | "offer" | "funnel" | "economics" | "fulfillment" | "decision">("product");

  // Inspect Landing Page Action State
  const [inspecting, setInspecting] = useState(false);
  const [inspectFeedback, setInspectFeedback] = useState<string | null>(null);

  // Economics Scenario Form State
  const [econSellingPrice, setEconSellingPrice] = useState<string>("");
  const [econSupplierCost, setEconSupplierCost] = useState<string>("");
  const [econUnits, setEconUnits] = useState<string>("1");
  const [econShippingPaid, setEconShippingPaid] = useState<string>("5.00");
  const [econShippingCharged, setEconShippingCharged] = useState<string>("0.00");
  const [econFulfillment, setEconFulfillment] = useState<string>("2.00");
  const [econTargetProfit, setEconTargetProfit] = useState<string>("10.00");
  const [savingEcon, setSavingEcon] = useState(false);
  const [econFeedback, setEconFeedback] = useState<string | null>(null);

  // Supplier Quote Form State
  const [quoteSupplierName, setQuoteSupplierName] = useState("");
  const [quoteUnitCost, setQuoteUnitCost] = useState("");
  const [quoteMoq, setQuoteMoq] = useState("1");
  const [quoteLeadDays, setQuoteLeadDays] = useState("10");
  const [quoteSource, setQuoteSource] = useState("USER_ESTIMATE");
  const [savingQuote, setSavingQuote] = useState(false);
  const [quoteFeedback, setQuoteFeedback] = useState<string | null>(null);

  // Research Decision State
  const [selectedDecision, setSelectedDecision] = useState("RESEARCHING");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);

  // Recalculate Opportunity State
  const [recalculating, setRecalculating] = useState(false);

  // Fetch complete product overview
  const loadOverview = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/v1/research/products/${productId}/overview`, { signal });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || "Failed to load product overview");
        return;
      }

      setOverview(json.data);

      // Pre-fill economics selling price if product has price
      if (json.data.product?.currentPrice) {
        setEconSellingPrice(String(json.data.product.currentPrice));
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err?.message || "Network error loading overview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();

    // Reset form and feedback states on product ID change
    setInspectFeedback(null);
    setEconFeedback(null);
    setQuoteFeedback(null);
    setDecisionFeedback(null);
    setEconSellingPrice("");
    setEconSupplierCost("");
    setQuoteSupplierName("");
    setQuoteUnitCost("");
    setDecisionNotes("");

    loadOverview(controller.signal);

    return () => {
      controller.abort();
    };
  }, [productId]);

  // Handle User-Triggered Landing Page Inspection Job
  const handleInspectLandingPage = async () => {
    try {
      setInspecting(true);
      setInspectFeedback("Initiating public landing page research job...");
      const res = await fetch(`/api/v1/research/products/${productId}/landing-page-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRefresh: true }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to launch inspection job");

      const jobId = json.data.jobId;
      setInspectFeedback("Research job queued. Checking worker processing...");

      // Poll job status cleanly via read-only GET (no execution side effects)
      let attempts = 0;
      const maxAttempts = 12; // 18s ceiling
      let terminalStatus: string | null = null;
      let terminalData: any = null;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500));
        attempts++;

        const statusRes = await fetch(`/api/v1/research/jobs/${jobId}`);
        const statusJson = await statusRes.json();

        if (statusJson.success && statusJson.data) {
          const status = statusJson.data.status;
          if (status === "RUNNING") {
            setInspectFeedback(`Worker processing inspection... (${attempts * 1.5}s)`);
          } else if (status === "COMPLETED") {
            terminalStatus = "COMPLETED";
            terminalData = statusJson.data;
            break;
          } else if (status === "ACCESS_RESTRICTED") {
            terminalStatus = "ACCESS_RESTRICTED";
            terminalData = statusJson.data;
            break;
          } else if (status === "FAILED") {
            terminalStatus = "FAILED";
            terminalData = statusJson.data;
            break;
          }
        }
      }

      if (terminalStatus === "COMPLETED") {
        setInspectFeedback("Landing page snapshot and CRO analysis completed!");
        await loadOverview();
      } else if (terminalStatus === "ACCESS_RESTRICTED") {
        setInspectFeedback("Competitor website restricted access (HTTP 401/403). Preserved as restricted snapshot.");
        await loadOverview();
      } else if (terminalStatus === "FAILED") {
        throw new Error(terminalData?.errorMessage || "Inspection job failed during execution.");
      } else {
        // Still pending after 18s: worker is offline
        setInspectFeedback("Job queued. Worker is offline. Run 'npm run kh01:worker' or 'npm run kh01:once' to process.");
      }
    } catch (err: any) {
      setInspectFeedback(`Inspection note: ${err.message}`);
    } finally {
      setInspecting(false);
    }
  };

  // Handle Save Economics Scenario
  const handleSaveEconomicsScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingEcon(true);
      setEconFeedback(null);

      const price = parseFloat(econSellingPrice);
      const cost = econSupplierCost ? parseFloat(econSupplierCost) : null;

      if (isNaN(price)) {
        throw new Error("Valid selling price is required");
      }

      const res = await fetch(`/api/v1/research/products/${productId}/economics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioName: `${econUnits}-Unit Scenario`,
          unitsPerOrder: parseInt(econUnits, 10) || 1,
          sellingPricePerUnit: price,
          supplierCostPerUnit: cost,
          shippingChargedToCustomer: parseFloat(econShippingCharged) || 0,
          actualShippingCostPaid: parseFloat(econShippingPaid) || null,
          fulfillmentCostPerOrder: parseFloat(econFulfillment) || null,
          targetProfitPerOrder: parseFloat(econTargetProfit) || null,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save scenario");

      setEconFeedback("Economics scenario modeled and saved!");
      await loadOverview();
    } catch (err: any) {
      setEconFeedback(`Error: ${err.message}`);
    } finally {
      setSavingEcon(false);
    }
  };

  // Handle Add Supplier Quote
  const handleAddSupplierQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingQuote(true);
      setQuoteFeedback(null);

      const cost = parseFloat(quoteUnitCost);
      if (isNaN(cost) || cost < 0) {
        throw new Error("Valid unit cost is required");
      }

      const res = await fetch(`/api/v1/research/products/${productId}/fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_QUOTE",
          supplierName: quoteSupplierName,
          unitCost: cost,
          moq: parseInt(quoteMoq, 10) || 1,
          shippingLeadTimeDays: parseInt(quoteLeadDays, 10) || 10,
          quoteSource,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to add supplier quote");

      setQuoteFeedback("Authentic supplier quote recorded and linked to economics!");
      setQuoteSupplierName("");
      setQuoteUnitCost("");
      await loadOverview();
    } catch (err: any) {
      setQuoteFeedback(`Error: ${err.message}`);
    } finally {
      setSavingQuote(false);
    }
  };

  // Handle Recalculate Opportunity Assessment
  const handleRecalculateOpportunity = async () => {
    try {
      setRecalculating(true);
      const res = await fetch(`/api/v1/research/products/${productId}/opportunity`, {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Recalculation failed");
      await loadOverview();
    } catch (err: any) {
      alert(`Recalculation error: ${err.message}`);
    } finally {
      setRecalculating(false);
    }
  };

  // Handle Record Research Decision
  const handleRecordDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingDecision(true);
      setDecisionFeedback(null);

      const res = await fetch(`/api/v1/research/products/${productId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: selectedDecision,
          notes: decisionNotes,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to record decision");

      setDecisionFeedback(
        json.data.isOverride
          ? `Recorded: ${json.data.userDecision} (STATUS: ${json.data.overrideStatus})`
          : `Recorded: ${json.data.userDecision}`
      );
      setDecisionNotes("");
      await loadOverview();
    } catch (err: any) {
      setDecisionFeedback(`Error: ${err.message}`);
    } finally {
      setSavingDecision(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />
            <span>Loading Product Intelligence Engine...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
        <Header />
        <div className="p-8 max-w-4xl mx-auto space-y-4">
          <Link href="/products" className="inline-flex items-center gap-2 text-xs text-indigo-400 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to Products
          </Link>
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 text-red-300 text-xs">
            {error || "Failed to load product overview"}
          </div>
        </div>
      </div>
    );
  }

  const { product, advertisingProfile, offerSnapshots, latestLandingPage, economicsScenarios, supplierQuotes, fulfillmentAssessment, opportunityAssessment, decisions } = overview;

  // Opportunity and Readiness Scores
  const opportunityScore = opportunityAssessment?.opportunityScore ?? null;
  const readinessScore = opportunityAssessment?.evidenceReadinessScore ?? null;
  const recommendation = opportunityAssessment?.recommendation || "RESEARCH_MORE";
  const testReadiness = opportunityAssessment?.testReadinessStatus || "BLOCKED_MISSING_DATA";

  // Parse snapshot JSONs
  let landingObservations: any = null;
  let croSignals: any = null;
  let messageMatch: any = null;
  try {
    if (latestLandingPage?.observationsJson) landingObservations = JSON.parse(latestLandingPage.observationsJson);
    if (latestLandingPage?.croSignalsJson) croSignals = JSON.parse(latestLandingPage.croSignalsJson);
    if (latestLandingPage?.messageMatchJson) messageMatch = JSON.parse(latestLandingPage.messageMatchJson);
  } catch {}

  // Parse pillars
  let pillars: any = null;
  try {
    if (opportunityAssessment?.pillarsJson) pillars = JSON.parse(opportunityAssessment.pillarsJson);
  } catch {}

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      <Header />

      <main className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Winning Product Finder
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRecalculateOpportunity}
              disabled={recalculating}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium flex items-center gap-1.5 text-slate-200 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${recalculating ? "animate-spin text-indigo-400" : ""}`} />
              <span>Recalculate Opportunity</span>
            </button>
          </div>
        </div>

        {/* Product Identity Hero Bar */}
        <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.title} className="h-full w-full object-cover" />
              ) : (
                <ShoppingBag className="h-8 w-8 text-slate-600" />
              )}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-indigo-300 font-semibold uppercase">
                  {product.category}
                </span>
                {product.store?.domain && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-800/40 font-mono">
                    {product.store.domain}
                  </span>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 font-mono">
                  Shopify: {product.store?.commercePlatform || "DETECTED"}
                </span>
              </div>

              <h1 className="text-lg md:text-xl font-extrabold text-white">
                {product.title}
              </h1>

              <p className="text-xs text-slate-400 max-w-2xl line-clamp-2">
                {product.description || "Identified competitor product without catalog description."}
              </p>
            </div>
          </div>

          {/* Assessment Score Pills */}
          <div className="flex items-center gap-4 shrink-0 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Evidence Readiness</div>
              <div className="text-lg font-extrabold text-white font-mono flex items-center gap-1.5">
                {readinessScore !== null && readinessScore !== undefined ? (
                  <>
                    <span>{readinessScore}%</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded ${
                        readinessScore >= 70
                          ? "bg-emerald-950 text-emerald-400"
                          : "bg-amber-950 text-amber-400"
                      }`}
                    >
                      {readinessScore >= 70 ? "SUFFICIENT" : "GAPS EXIST"}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500 text-sm">Not Assessed</span>
                )}
              </div>
              <div className="text-[9px] text-slate-500">Verified factual inputs</div>
            </div>

            <div className="h-8 w-[1px] bg-slate-800" />

            <div>
              <div className="text-[10px] text-slate-400 font-medium">Product Opportunity Research Score</div>
              <div className="text-lg font-extrabold font-mono flex items-center gap-1.5">
                {opportunityScore !== null && opportunityScore !== undefined ? (
                  <span className={opportunityScore >= 70 ? "text-emerald-400" : "text-amber-400"}>
                    {opportunityScore}/100
                  </span>
                ) : (
                  <span className="text-slate-500 text-sm">Not Assessed</span>
                )}
              </div>
              <div className="text-[9px] text-slate-500">Six-pillar research heuristic</div>
            </div>

            <div className="h-8 w-[1px] bg-slate-800" />

            <div>
              <div className="text-[10px] text-slate-400 font-medium">Recommendation</div>
              <div className="text-xs font-bold text-white font-mono">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  recommendation === "TEST_CANDIDATE" ? "bg-emerald-950 text-emerald-300 border border-emerald-800/50" :
                  recommendation === "SHORTLIST" ? "bg-indigo-950 text-indigo-300 border border-indigo-800/50" :
                  recommendation === "REJECT" ? "bg-rose-950 text-rose-300 border border-rose-800/50" :
                  "bg-amber-950 text-amber-300 border border-amber-800/50"
                }`}>
                  {recommendation}
                </span>
              </div>
              <div className="text-[9px] text-slate-500">{testReadiness}</div>
            </div>
          </div>
        </div>

        {/* Tab Navigation for 6 Research Panels */}
        <div className="flex border-b border-[#1f293d] overflow-x-auto gap-2">
          {[
            { id: "product", label: "Product & Problem", icon: ShoppingBag },
            { id: "creative", label: `Creative & Ads (${advertisingProfile.distinctAdsCount})`, icon: PlaySquare },
            { id: "offer", label: `Offer Intelligence (${offerSnapshots.length})`, icon: TrendingUp },
            { id: "funnel", label: "Landing Page & CRO", icon: Layers },
            { id: "economics", label: `Economics & Margin (${economicsScenarios.length})`, icon: Calculator },
            { id: "fulfillment", label: `Fulfillment & Supplier (${supplierQuotes.length})`, icon: Truck },
            { id: "decision", label: "Decision & Audit", icon: ShieldCheck },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? "border-indigo-500 text-indigo-400 bg-indigo-950/20"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Panel 1: Product & Problem Identity */}
        {activeTab === "product" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-indigo-400" />
                  <span>Canonical Product Definition</span>
                </h2>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-500 block">Title:</span>
                    <strong className="text-white font-medium">{product.title}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Category:</span>
                    <span className="text-slate-300">{product.category}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Identified Problem Addressed:</span>
                    <p className="text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                      {product.description || "Problem utility derived from competitor ad demonstration."}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Product Landing URL:</span>
                    {product.productUrl ? (
                      <a
                        href={product.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:underline break-all inline-flex items-center gap-1 font-mono"
                      >
                        {product.productUrl} <ExternalLink className="h-3 w-3 inline" />
                      </a>
                    ) : (
                      <span className="text-slate-500">Not recorded</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Store className="h-4 w-4 text-emerald-400" />
                  <span>Storefront Evidence & Verification</span>
                </h2>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Domain:</span>
                    <span className="text-white font-mono font-bold">{product.store?.domain || "N/A"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Commerce Platform:</span>
                    <span className="text-emerald-400 font-mono font-semibold">
                      {product.store?.commercePlatform || "SHOPIFY_CONFIRMED"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Target Market:</span>
                    <span className="text-slate-300">United States (USD)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Associated Advertisers:</span>
                    <span className="text-white font-mono">{advertisingProfile.distinctAdvertisersCount} distinct</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Linked Ad Campaigns:</span>
                    <span className="text-white font-mono">{advertisingProfile.distinctAdsCount} ads</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Panel 2: Creative & Ads Intelligence */}
        {activeTab === "creative" && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
              Showing authentic Meta Ad Library creatives associated with this product. Linked Library IDs, media formats, and observed demonstration angles.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {product.adLinks.map((link: any) => {
                const ad = link.ad;
                const media = ad.mediaAssets?.[0];
                return (
                  <div key={link.id} className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3">
                    <div className="h-44 w-full bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center relative">
                      {media?.thumbnailUrl ? (
                        <img src={media.thumbnailUrl} alt={ad.headline || "Ad thumbnail"} className="h-full w-full object-cover" />
                      ) : (
                        <PlaySquare className="h-10 w-10 text-slate-700" />
                      )}
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/80 text-[10px] text-white font-mono">
                        {ad.originalPlatform || "META"}
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Advertiser:</span>
                        <span className="text-white font-medium">{ad.advertiser?.name || "Competitor"}</span>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[10px]">
                        <span className="text-slate-500">Library ID:</span>
                        <span className="text-indigo-300">{ad.libraryId || ad.id.slice(0, 10)}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 line-clamp-2 italic">
                        "{ad.bodyText || ad.headline || "Demonstration of problem utility"}"
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Panel 3: Competitor Offer Intelligence */}
        {activeTab === "offer" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Observed Competitor Commercial Terms</h2>
                <p className="text-xs text-slate-400">
                  Separates Product Identity from Commercial Offer (single unit, bundles, discounts, free shipping thresholds).
                </p>
              </div>
            </div>

            {offerSnapshots.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 bg-[#111827] rounded-xl border border-[#1f293d]">
                No competitor offer snapshots on file yet. Inspect the landing page to capture real commercial pricing terms.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#1f293d] bg-[#111827]">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-[#1f293d]">
                    <tr>
                      <th className="p-3">Observation Date</th>
                      <th className="p-3">Selling Price</th>
                      <th className="p-3">Compare-At Anchor</th>
                      <th className="p-3">Bundle Structure</th>
                      <th className="p-3">Shipping Terms</th>
                      <th className="p-3">Source URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1f293d]">
                    {offerSnapshots.map((s: any) => (
                      <tr key={s.id} className="hover:bg-slate-900/50">
                        <td className="p-3 font-mono text-[11px]">
                          {new Date(s.observedAt).toLocaleDateString()} {new Date(s.observedAt).toLocaleTimeString()}
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-400">
                          {s.sellingPrice != null ? `$${s.sellingPrice.toFixed(2)}` : "—"}
                        </td>
                        <td className="p-3 font-mono line-through text-slate-500">
                          {s.compareAtPrice != null ? `$${s.compareAtPrice.toFixed(2)}` : "—"}
                        </td>
                        <td className="p-3 font-medium">
                          {s.bundleQuantity > 1 ? `${s.bundleQuantity}-Unit Bundle` : "Single Unit"}
                        </td>
                        <td className="p-3">
                          {s.hasFreeShipping ? (
                            <span className="text-emerald-400 font-medium">
                              Free Shipping {s.shippingThreshold ? `(over $${s.shippingThreshold})` : ""}
                            </span>
                          ) : (
                            <span className="text-slate-500">Standard shipping</span>
                          )}
                        </td>
                        <td className="p-3">
                          <a
                            href={s.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 hover:underline inline-flex items-center gap-1 font-mono text-[11px]"
                          >
                            Inspect <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Panel 4: Landing Page & Funnel Analyzer */}
        {activeTab === "funnel" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
              <div>
                <h2 className="text-sm font-bold text-white">Competitor Landing Page Inspection</h2>
                <p className="text-xs text-slate-400">
                  Inspects public DOM structure, hero section, trust elements, and ad promise match.
                </p>
              </div>

              <button
                onClick={handleInspectLandingPage}
                disabled={inspecting}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${inspecting ? "animate-spin" : ""}`} />
                <span>{inspecting ? "Inspecting Page..." : "Inspect Competitor Landing Page"}</span>
              </button>
            </div>

            {inspectFeedback && (
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-indigo-300">
                {inspectFeedback}
              </div>
            )}

            {latestLandingPage ? (
              <div className="space-y-6">
                {/* Snapshot Meta */}
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Access Status:</span>
                    <span className="font-bold text-emerald-400 font-mono">{latestLandingPage.accessStatus}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">HTTP Status:</span>
                    <span className="font-bold text-white font-mono">{latestLandingPage.httpStatus}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Last Inspected:</span>
                    <span className="text-slate-300 font-mono">
                      {new Date(latestLandingPage.observedAt).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Source Page:</span>
                    <a
                      href={latestLandingPage.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline truncate block font-mono text-[11px]"
                    >
                      {latestLandingPage.originalUrl}
                    </a>
                  </div>
                </div>

                {/* CRO Observations & Elements */}
                {landingObservations && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3 text-xs">
                      <h3 className="font-bold text-white">Observed Above-The-Fold & Hero</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Hero Headline:</span>
                          <span className="text-white font-medium max-w-xs text-right">
                            {landingObservations.heroHeadline || "Observable product header"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Primary CTA Text:</span>
                          <span className="text-emerald-400 font-mono font-bold">
                            {landingObservations.primaryCtaText || "ADD TO CART"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Product Images Observed:</span>
                          <span className="text-white font-mono">{landingObservations.productImagesCount ?? 1}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Price Near CTA:</span>
                          <span className="text-white">{landingObservations.hasVisiblePriceNearCta ? "YES" : "NO"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3 text-xs">
                      <h3 className="font-bold text-white">Trust & Policy Signals</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Customer Reviews Element:</span>
                          <span className="text-white">
                            {landingObservations.hasCustomerReviews ? "Observed on page" : "Not detected"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Shipping Policy Summary:</span>
                          <span className="text-white">
                            {landingObservations.hasShippingPolicySummary ? "Observed" : "Omitted / Hidden"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Return & Refund Policy:</span>
                          <span className="text-white">
                            {landingObservations.hasReturnPolicySummary ? "Observed" : "Not prominently displayed"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Trust Badges / Icons:</span>
                          <span className="text-white">
                            {landingObservations.hasTrustBadges ? "Observed" : "Not detected"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500 bg-[#111827] rounded-xl border border-[#1f293d]">
                No landing page snapshot exists yet. Click "Inspect Competitor Landing Page" to run inspection.
              </div>
            )}
          </div>
        )}

        {/* Panel 5: Economics & Unit Margin Modeling */}
        {activeTab === "economics" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Scenario Input Form */}
              <div className="lg:col-span-1 p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-indigo-400" />
                  <span>Model Offer Economics</span>
                </h2>

                <form onSubmit={handleSaveEconomicsScenario} className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Units in Order</label>
                    <input
                      type="number"
                      min="1"
                      value={econUnits}
                      onChange={(e) => setEconUnits(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Selling Price Per Unit ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="e.g. 29.99"
                      value={econSellingPrice}
                      onChange={(e) => setEconSellingPrice(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Supplier Unit Cost / COGS ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 7.50"
                      value={econSupplierCost}
                      onChange={(e) => setEconSupplierCost(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Actual Shipping Cost Paid ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={econShippingPaid}
                      onChange={(e) => setEconShippingPaid(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Shipping Charged to Customer ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={econShippingCharged}
                      onChange={(e) => setEconShippingCharged(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Target Net Profit per Order ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={econTargetProfit}
                      onChange={(e) => setEconTargetProfit(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingEcon}
                    className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white text-xs transition-colors"
                  >
                    {savingEcon ? "Calculating..." : "Calculate & Save Scenario"}
                  </button>

                  {econFeedback && (
                    <div className="text-[11px] text-emerald-400 mt-2">{econFeedback}</div>
                  )}
                </form>
              </div>

              {/* Scenarios Comparison Table */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="text-sm font-bold text-white">Modeled Economics Scenarios</h2>

                {economicsScenarios.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 bg-[#111827] rounded-xl border border-[#1f293d]">
                    No economics scenarios modeled yet. Enter unit selling price and COGS to compute contribution margin.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {economicsScenarios.map((s: any) => {
                      let parsed: any = null;
                      try {
                        if (s.outputsJson) parsed = JSON.parse(s.outputsJson);
                      } catch {}
                      if (!parsed) return null;

                      return (
                        <div key={s.id} className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3 text-xs">
                          <div className="flex items-center justify-between border-b border-[#1f293d] pb-2">
                            <span className="font-bold text-white text-sm">{s.scenarioName}</span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(s.createdAt).toLocaleDateString()}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div className="p-2.5 rounded-lg bg-slate-900">
                              <span className="text-[10px] text-slate-500 block">Net Revenue</span>
                              <strong className="text-white font-mono">${parsed.netSellingRevenue?.toFixed(2) ?? "—"}</strong>
                            </div>

                            <div className="p-2.5 rounded-lg bg-slate-900">
                              <span className="text-[10px] text-slate-500 block">Contribution Margin</span>
                              <strong className={`font-mono ${parsed.contributionBeforeAds && parsed.contributionBeforeAds > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                ${parsed.contributionBeforeAds?.toFixed(2) ?? "—"}
                              </strong>
                            </div>

                            <div className="p-2.5 rounded-lg bg-slate-900">
                              <span className="text-[10px] text-slate-500 block">Break-Even CPA</span>
                              <strong className="text-indigo-300 font-mono">${parsed.breakEvenCpa?.toFixed(2) ?? "—"}</strong>
                            </div>

                            <div className="p-2.5 rounded-lg bg-slate-900">
                              <span className="text-[10px] text-slate-500 block">Break-Even ROAS</span>
                              <strong className="text-amber-400 font-mono">{parsed.breakEvenRoas ? `${parsed.breakEvenRoas}x` : "—"}</strong>
                            </div>
                          </div>

                          {parsed.missingInputs?.length > 0 && (
                            <div className="text-[10px] text-amber-400 bg-amber-950/30 p-2 rounded border border-amber-800/30">
                              Missing Cost Inputs: {parsed.missingInputs.join(", ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Panel 6: Fulfillment & Supplier Risk */}
        {activeTab === "fulfillment" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Add Quote Form */}
              <div className="lg:col-span-1 p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Truck className="h-4 w-4 text-indigo-400" />
                  <span>Record Supplier Quote</span>
                </h2>

                <form onSubmit={handleAddSupplierQuote} className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Supplier / Factory Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Shenzhen Meiduo Technology"
                      value={quoteSupplierName}
                      onChange={(e) => setQuoteSupplierName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Unit Cost ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="e.g. 5.80"
                      value={quoteUnitCost}
                      onChange={(e) => setQuoteUnitCost(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">MOQ (Minimum Order Quantity)</label>
                    <input
                      type="number"
                      min="1"
                      value={quoteMoq}
                      onChange={(e) => setQuoteMoq(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Est. Transit Days to US</label>
                    <input
                      type="number"
                      value={quoteLeadDays}
                      onChange={(e) => setQuoteLeadDays(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Quote Source Provenance</label>
                    <select
                      value={quoteSource}
                      onChange={(e) => setQuoteSource(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white"
                    >
                      <option value="USER_ESTIMATE">User Estimate</option>
                      <option value="SUPPLIER_INVOICE">Supplier Invoice</option>
                      <option value="DIRECT_CHAT">Direct Supplier Chat</option>
                      <option value="ALIBABA_LISTING">Alibaba / 1688 Verified Listing</option>
                      <option value="CJ_DROPSHIPPING">CJ Dropshipping / Private Agent</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={savingQuote}
                    className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white text-xs transition-colors"
                  >
                    {savingQuote ? "Saving Quote..." : "Add Supplier Quote"}
                  </button>

                  {quoteFeedback && (
                    <div className="text-[11px] text-emerald-400 mt-2">{quoteFeedback}</div>
                  )}
                </form>
              </div>

              {/* Quotes & Operational Risk Review */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="text-sm font-bold text-white">Supplier Quotes on Record</h2>

                {supplierQuotes.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 bg-[#111827] rounded-xl border border-[#1f293d]">
                    No supplier quotes recorded. Adding an authentic quote unlocks full unit economics validation.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#1f293d] bg-[#111827]">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-[#1f293d]">
                        <tr>
                          <th className="p-3">Supplier</th>
                          <th className="p-3">Unit Cost</th>
                          <th className="p-3">MOQ</th>
                          <th className="p-3">Transit Time</th>
                          <th className="p-3">Source Provenance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1f293d]">
                        {supplierQuotes.map((q: any) => (
                          <tr key={q.id}>
                            <td className="p-3 font-semibold text-white">{q.supplierName}</td>
                            <td className="p-3 font-mono font-bold text-emerald-400">${q.unitCost.toFixed(2)}</td>
                            <td className="p-3 font-mono">{q.moq} pcs</td>
                            <td className="p-3 font-mono">{q.shippingLeadTimeDays ? `${q.shippingLeadTimeDays} days` : "Unverified"}</td>
                            <td className="p-3 text-[11px] text-indigo-300">{q.quoteSource}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Panel 7: Final Opportunity Assessment & Research Decision */}
        {activeTab === "decision" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Six Pillars Breakdown */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="text-sm font-bold text-white">Six-Pillar Opportunity Radar</h2>

                {pillars ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Object.values(pillars).map((p: any) => (
                      <div key={p.pillar} className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">{p.pillar} ({p.weight}%)</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.status === "PASS" ? "bg-emerald-950 text-emerald-400" :
                            p.status === "NEEDS_WORK" ? "bg-amber-950 text-amber-400" :
                            p.status === "FAIL" ? "bg-rose-950 text-rose-400" :
                            "bg-slate-800 text-slate-400"
                          }`}>
                            {p.status}
                          </span>
                        </div>

                        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                          <span>Readiness: {p.readiness}%</span>
                          <span>Score: {p.score != null ? `${p.score}/100` : "INSUFFICIENT"}</span>
                        </div>

                        {p.findings.length > 0 && (
                          <p className="text-[11px] text-slate-300 italic">
                            "{p.findings[0]}"
                          </p>
                        )}

                        {p.missingEvidence.length > 0 && (
                          <p className="text-[10px] text-amber-400">
                            Missing: {p.missingEvidence[0]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500 bg-[#111827] rounded-xl border border-[#1f293d]">
                    Click "Recalculate Opportunity" above to evaluate all six pillars.
                  </div>
                )}
              </div>

              {/* Record Decision Form */}
              <div className="lg:col-span-1 p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Record Operator Decision</span>
                </h2>

                <form onSubmit={handleRecordDecision} className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Algorithmic Recommendation</label>
                    <div className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-indigo-300 font-mono font-bold">
                      {recommendation}
                    </div>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Operator Decision</label>
                    <select
                      value={selectedDecision}
                      onChange={(e) => setSelectedDecision(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-semibold"
                    >
                      <option value="RESEARCHING">RESEARCHING (Deepen data)</option>
                      <option value="SHORTLISTED">SHORTLISTED (Strong candidate)</option>
                      <option value="TEST_CANDIDATE">TEST_CANDIDATE (Ready for ad test)</option>
                      <option value="REJECTED">REJECTED (Unviable unit economics)</option>
                      <option value="ARCHIVED">ARCHIVED</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Decision Rationale & Audit Notes</label>
                    <textarea
                      rows={3}
                      placeholder="Document verified supplier quotes, angle differentiation, and ad test budget..."
                      value={decisionNotes}
                      onChange={(e) => setDecisionNotes(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingDecision}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold text-white text-xs transition-colors"
                  >
                    {savingDecision ? "Recording..." : "Save Operator Decision"}
                  </button>

                  {decisionFeedback && (
                    <div className="text-[11px] text-amber-300 mt-2 p-2 bg-slate-900 rounded border border-slate-800">
                      {decisionFeedback}
                    </div>
                  )}
                </form>

                {/* Decision History */}
                {decisions?.length > 0 && (
                  <div className="pt-3 border-t border-[#1f293d] space-y-2 text-[11px]">
                    <span className="text-slate-400 font-semibold block">Decision Audit Trail</span>
                    {decisions.slice(0, 3).map((d: any) => (
                      <div key={d.id} className="p-2 rounded bg-slate-900/60 border border-slate-800">
                        <div className="flex justify-between font-mono text-[10px]">
                          <span className="font-bold text-white">{d.decision}</span>
                          <span className="text-slate-500">{new Date(d.decidedAt).toLocaleDateString()}</span>
                        </div>
                        {d.notes && <p className="text-slate-400 mt-1 italic">{d.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ProductIntelligencePage(props: IntelligencePageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 p-8 flex items-center justify-center text-slate-400">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-teal-400" />
            <span>Loading Product Intelligence...</span>
          </div>
        </div>
      }
    >
      <ProductIntelligenceContent {...props} />
    </Suspense>
  );
}
