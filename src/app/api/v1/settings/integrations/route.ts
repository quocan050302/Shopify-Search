import { NextResponse } from "next/server";
import { getShopifyConnectionStatus } from "@/services/shopify/financialService";

export async function GET() {
  const shopifyStatus = getShopifyConnectionStatus();

  return NextResponse.json({
    success: true,
    data: {
      operatingMode: "RESEARCH_ONLY",
      targetMarket: "US",
      integrations: {
        shopify: {
          platform: "Shopify Storefront & Admin API",
          status: shopifyStatus.status,
          message: shopifyStatus.message,
          requiredScopes: ["read_orders", "read_products", "read_analytics"],
          connectedAt: null,
          storeDomain: null,
          featureFlag: Boolean(process.env.ENABLE_SHOPIFY_CONNECTION === "true"),
        },
        metaAdsManager: {
          platform: "Meta Ads Manager (Owned Account)",
          status: "NOT_CONNECTED",
          message: "Connect your Meta Business ad account when you are ready to track private ROAS, ad spend, and conversion events.",
          connectedAt: null,
          accountId: null,
          featureFlag: Boolean(process.env.ENABLE_META_OWNED_ADS === "true"),
        },
        tiktokAdsManager: {
          platform: "TikTok Ads Manager (Owned Account)",
          status: "NOT_CONNECTED",
          message: "Connect your TikTok Ads Manager account when you are ready to evaluate private commercial conversion and CPA metrics.",
          connectedAt: null,
          accountId: null,
          featureFlag: Boolean(process.env.ENABLE_TIKTOK_OWNED_ADS === "true"),
        },
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: "v1",
    },
  });
}
