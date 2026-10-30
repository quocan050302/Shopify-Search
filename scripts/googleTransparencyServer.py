"""Read-only Google Ads Transparency MCP bridge; no API key required."""
import os

os.environ.setdefault("GOOGLE_ADS_TRANSPARENCY_PROXY", "direct")

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
def get_advertiser_ads(advertiser_id: str, region: str = "US", count: int = 5) -> dict:
    """Get creatives for an exact advertiser ID filtered by delivery region."""
    if not advertiser_id.startswith("AR"):
        raise ValueError("A Google advertiser ID is required")
    client = GoogleAdsTransparency(region=region)
    ads = []
    for creative_id in client.get_creative_ids(advertiser_id, max(1, min(count, 10))):
        ad = client.get_ad_detail(advertiser_id, creative_id)
        # Preserve original upstream response as-is. Never inject request filter into ad delivery fields.
        ads.append(ad)
    return {
        "requested_region": region,
        "provider_filter_region": region,
        "ads": ads,
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")
