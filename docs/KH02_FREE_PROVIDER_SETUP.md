# KH-02: free provider setup (checked 27 October 2026)

The existing source cards report missing credentials; Discover Sources does not create accounts or install external servers. Engine Ready means only that the local demand calculation code can run.

| Source | Free option | App configuration | Limits |
| --- | --- | --- | --- |
| Google Ads Transparency | Local open-source MCP, no key | `npm run kh02:setup:free` | Unofficial public endpoint; throttling may block requests |
| TikTok Organic | HasData Free account | `HASDATA_API_KEY` | 1,000 shared credits/month; 10 credits/search |
| Google Trends | SerpApi Free account | `SERPAPI_API_KEY` | 250 searches/month shared across engines; one series request per product |
| TikTok Ads US | Creative Center login + verified ad import | Import in `/explorer`, optionally own `TIKTOK_CC_COOKIE` | Session-based automated endpoint is experimental; no generally available official US competitor API verified |

## Google Ads: working without a key

From the repository root, after installing Node dependencies and Python 3.10+:

```powershell
npm run kh02:setup:free
```

The script creates a project-local Python virtual environment and installs the reviewed upstream source at commit `8180b10a338be0d825d59797084df6bb8c06cca6` from https://github.com/block-town/google-ads-transparency-mcp. It writes the Python executable and JSON arguments as separate values in `.env.local`; existing nonempty MCP configuration is preserved. Git and Python with venv/pip support must be available. No global installation is required.

If switching from the old example `npx -y gads-transparency-mcp`, remove just the old GOOGLE_TRANSPARENCY_MCP_COMMAND / GOOGLE_TRANSPARENCY_MCP_ARGS entries before running setup. Do not overwrite the other settings in your environment file.

Restart the web server and KH-02 worker. Run Test Connections, then research a topic with product candidates that have confirmed store domains. The bridge uses exact advertiser IDs and filters creatives by US delivery region. MCP transport connectivity does not by itself establish a successful live data query. The connector uses a direct connection by default and never installs a proxy or CAPTCHA solver.

Live check performed during this change: chewy.com -> advertiser AR01709643824168435713 -> one creative CR02617007969560166401, with region US. This verifies one public lookup at the recorded time, not universal coverage or every candidate's product relevance. See `acceptance/kh02-free-providers/GOOGLE_LIVE_QUERY.json`.

## Personal keys: HasData and SerpApi

1. HasData: register at https://app.hasdata.com, select the Free plan, then copy your API key from account settings / API Keys. Documentation: https://docs.hasdata.com/apis/tiktok/search. Pricing: https://hasdata.com/prices.
2. SerpApi: register for the Free plan at https://serpapi.com/users/sign_up, obtain the private key at https://serpapi.com/manage-api-key. Pricing: https://serpapi.com/pricing. Account quota API: https://serpapi.com/account-api.
3. Add the keys to `.env.local` on the machine running the web server AND worker:

```dotenv
HASDATA_API_KEY="your_personal_key"
SERPAPI_API_KEY="your_personal_key"
AUTO_PAID_RESEARCH=false
```

Restart both processes. Keep keys out of chat, Git, browser code and NEXT_PUBLIC variables. No shared or leaked GitHub keys are needed.

HasData's GET `/user/me/usage` must return an authoritative balance and an explicit Free plan before this integration permits a free-credit query with paid research disabled. An unknown plan, unsupported response, insufficient balance or paid plan remains blocked. Never infer account balance from the advertised monthly allowance. Without a real user key, the current usage response shape and live TikTok search cannot be verified; tests use clearly identified fixtures. If your account reports a different shape, use a redacted schema sample to update the parser; do not enable all paid research as a workaround.

SerpApi's non-metered account endpoint verifies the Free plan (`plan_monthly_price` and Free plan identity) and available searches before each series request. Paid accounts stay blocked while AUTO_PAID_RESEARCH is false. The app now sends the requested date range and reads epoch timestamps instead of display date ranges. `<1` interest is represented as 0.5; invalid, missing, out-of-range and partial points are excluded. Google Trends reports relative interest, not absolute search volume.

## TikTok Ads US

Open https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en, log in with your own account and select United States. The free manual path is to copy verified ad links and import them through Ads Explorer. `TIKTOK_CC_COOKIE` is your private session cookie, not an issued API key. The existing automated adapter depends on an undocumented endpoint; login does not guarantee automated access will succeed. Keep WAF, expiry and authentication failures visible.

TikTok's official Commercial Content API currently states EU-only data: https://developers.tiktok.com/products/commercial-content-api/. Do not label EU results as US ads. Google Trends' official API remains application-gated alpha: https://developers.google.com/search/apis/trends. A generic Google Cloud key is not a substitute; this app does not implement that alpha protocol.

Apify has a $5/month free allowance (https://apify.com/pricing), but actors consume credits and vary in coverage. It is not enabled by this setup and is not an unlimited free fallback.

## Changes and validation

- Fixed executable/argument separation in the example configuration and added the project-local Google MCP setup command.
- Added source-specific signup links and configuration instructions to the diagnostics cards.
- Fixed HasData field mapping for plays, saves, captions, creator identifiers and media URLs. Removed the undocumented count parameter; results are bounded locally.
- Allowed only provider-verified Free-plan quota as an exception to the paid-research guard. Unknown quota remains blocked.
- Fixed Trends date window, timestamps, bad numeric values, secret-safe errors, and non-metered account verification.
- Stopped reporting the internal demand engine as a connected external data source, and stopped reading server secrets in client rendering.
- Fixed nested Google creative metadata and stopped classifying failed creative retrieval as a successful empty result.

No production database, running user app or personal account was changed. The Google connector is installed only in the isolated checkout used for this review. Apply this change to the actual app checkout and run setup there before expecting its source cards to change.
