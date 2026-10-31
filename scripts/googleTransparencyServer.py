"""Read-only Google Ads Transparency MCP bridge; no API key required."""
import os
import sys

# Windows cp1252 stdio encoding defense: force UTF-8 on stdio streams
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

os.environ.setdefault("GOOGLE_ADS_TRANSPARENCY_PROXY", "direct")
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from mcp.server.fastmcp import FastMCP
from google_ads_transparency_mcp import GoogleAdsTransparency

mcp = FastMCP("SWAI Google Ads Transparency")


@mcp.tool()
def search_advertiser(query: str) -> dict:
    """Resolve a confirmed store domain without guessing an advertiser name."""
    client = GoogleAdsTransparency(region="US")
    advertiser = client.search_advertiser_by_domain(query)
    return {"advertisers": [advertiser] if advertiser else []}


@mcp.tool()
def get_advertiser_ads(advertiser_id: str, region: str = "US", count: int = 3) -> dict:
    """Get creatives for an exact advertiser ID filtered by delivery region."""
    if not advertiser_id.startswith("AR"):
        raise ValueError("A Google advertiser ID is required")
    client = GoogleAdsTransparency(region=region)
    ads = []
    # Bound count to max 3 so each creative lookup (approx 4.5s) completes within the 15s per-domain budget
    effective_count = max(1, min(count, 3))
    for creative_id in client.get_creative_ids(advertiser_id, effective_count):
        ad = client.get_ad_detail(advertiser_id, creative_id)
        # Preserve original upstream response as-is. Never inject request filter into ad delivery fields.
        if ad:
            ads.append(ad)
    return {
        "requested_region": region,
        "provider_filter_region": region,
        "ads": ads,
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")
