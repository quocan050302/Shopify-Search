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

DEFAULT_CONNECT_TIMEOUT_SEC = float(os.environ.get("GOOGLE_TRANSPARENCY_CONNECT_TIMEOUT_SEC", "4.0"))
DEFAULT_READ_TIMEOUT_SEC = float(os.environ.get("GOOGLE_TRANSPARENCY_READ_TIMEOUT_SEC", "8.0"))
MAX_RESPONSE_BYTES = int(os.environ.get("GOOGLE_TRANSPARENCY_MAX_RESPONSE_BYTES", str(2 * 1024 * 1024)))
MAX_CREATIVES_PER_CALL = 3


def _configure_bounded_client(region: str = "US") -> GoogleAdsTransparency:
    """Create a GoogleAdsTransparency client with strict repo-side HTTP timeout, size, and retry bounds."""
    client = GoogleAdsTransparency(region=region)
    session = getattr(client, "session", None) or getattr(client, "_session", None)
    if session is not None and hasattr(session, "request"):
        orig_request = session.request

        def bounded_request(method, url, **kwargs):
            # Enforce explicit (connect_timeout, read_timeout) if not provided or unbounded
            if kwargs.get("timeout") is None or isinstance(kwargs.get("timeout"), (int, float)):
                kwargs["timeout"] = (DEFAULT_CONNECT_TIMEOUT_SEC, DEFAULT_READ_TIMEOUT_SEC)
            resp = orig_request(method, url, **kwargs)
            content_len = resp.headers.get("Content-Length") if hasattr(resp, "headers") else None
            if content_len and content_len.isdigit() and int(content_len) > MAX_RESPONSE_BYTES:
                raise RuntimeError(
                    f"Google Ads Transparency response exceeded max byte limit ({content_len} > {MAX_RESPONSE_BYTES})"
                )
            if hasattr(resp, "content") and resp.content and len(resp.content) > MAX_RESPONSE_BYTES:
                raise RuntimeError(
                    f"Google Ads Transparency payload exceeded max byte limit ({len(resp.content)} > {MAX_RESPONSE_BYTES})"
                )
            # Fail fast with zero retries on 429 / 403 / CAPTCHA / sorry wall
            status_code = getattr(resp, "status_code", 200)
            url_str = str(getattr(resp, "url", url) or "")
            if status_code in (429, 403) or "/sorry/" in url_str.lower():
                raise RuntimeError(
                    f"Google Ads Transparency upstream blocked or rate-limited request (HTTP {status_code})"
                )
            return resp

        session.request = bounded_request
    return client


@mcp.tool()
def search_advertiser(query: str) -> dict:
    """Resolve a confirmed store domain without guessing an advertiser name."""
    cleaned = str(query or "").strip()
    if not cleaned:
        return {"advertisers": []}
    client = _configure_bounded_client(region="US")
    advertiser = client.search_advertiser_by_domain(cleaned)
    return {"advertisers": [advertiser] if advertiser else []}


@mcp.tool()
def get_advertiser_ads(advertiser_id: str, region: str = "US", count: int = 3) -> dict:
    """Get creatives for an exact advertiser ID filtered by delivery region."""
    adv_id = str(advertiser_id or "").strip()
    if not adv_id.startswith("AR"):
        raise ValueError("A Google advertiser ID starting with 'AR' is required")
    eff_region = str(region or "US").strip().upper() or "US"
    client = _configure_bounded_client(region=eff_region)
    ads = []
    # Bound count to max 3 so each creative lookup completes within the per-domain budget
    try:
        parsed_count = int(count)
    except (TypeError, ValueError):
        parsed_count = MAX_CREATIVES_PER_CALL
    effective_count = max(1, min(parsed_count, MAX_CREATIVES_PER_CALL))
    creative_ids = client.get_creative_ids(adv_id, effective_count) or []
    for creative_id in list(creative_ids)[:effective_count]:
        ad = client.get_ad_detail(adv_id, creative_id)
        # Preserve original upstream response as-is. Never inject request filter into ad delivery fields.
        if ad:
            ads.append(ad)
    return {
        "requested_region": eff_region,
        "provider_filter_region": eff_region,
        "ads": ads,
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")

