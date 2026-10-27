const guides: Record<string, { title: string; href: string; text: string; config?: string }> = {
  TIKTOK_ORGANIC: {
    title: "Get a free HasData key", href: "https://app.hasdata.com",
    text: "Create a Free account, open account settings and copy your API key. 1,000 credits/month; TikTok search uses 10 credits. Key configuration, quota verification and query authorization are separate steps.",
    config: 'HASDATA_API_KEY="your_personal_key"',
  },
  GOOGLE_ADS: {
    title: "Free Google Ads connector (no key)", href: "https://github.com/block-town/google-ads-transparency-mcp",
    text: "Install the local connector once, then restart the app and research worker. Test Connections checks MCP transport; a real query is still needed to verify upstream data. Public endpoints can be rate-limited.",
    config: "npm run kh02:setup:free",
  },
  DEMAND_HISTORY: {
    title: "Get a free SerpApi key", href: "https://serpapi.com/manage-api-key",
    text: "Choose the Free plan (250 searches/month). The app verifies the free plan and remaining searches before querying Trends. The local scoring engine alone does not supply search history. Official Google Trends API access is still application-gated.",
    config: 'SERPAPI_API_KEY="your_personal_key"',
  },
  TIKTOK_ADS: {
    title: "Open free TikTok Creative Center", href: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en",
    text: "Log in with your own account and select United States. Import verified ad URLs in Ads Explorer, or configure your own Creative Center session locally. This is a session cookie, not an API key; automated access is experimental. The official Commercial Content API currently covers EU data.",
  },
};

export function ProviderSetupGuide({ source }: { source: string }) {
  const guide = guides[source];
  if (!guide) return null;
  return (
    <details className="rounded border border-purple-500/25 p-2 text-[11px] text-slate-300">
      <summary className="cursor-pointer font-medium text-purple-300">Free source setup</summary>
      <p className="mt-2 leading-relaxed">{guide.text}</p>
      <a href={guide.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-cyan-300 underline">{guide.title} ↗</a>
      {guide.config && <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-2 text-[10px]">{guide.config}</pre>}
      {source === "TIKTOK_ADS" && <a href="/explorer" className="mt-2 block text-cyan-300 underline">Import ads in Ads Explorer</a>}
      <p className="mt-2 text-slate-500">Checked 27 Oct 2026. Keep personal keys in .env.local on the app host and restart the app and worker. Do not share keys or cookies in chat.</p>
    </details>
  );
}
