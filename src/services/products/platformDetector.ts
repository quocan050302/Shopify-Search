import { CommercePlatformStatus } from "@/types";

/**
 * Detects whether an ecommerce merchant domain is running on Shopify or another engine.
 */
export function detectCommercePlatform(
  domainOrUrl: string,
  sampleHtml?: string
): {
  platform: CommercePlatformStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string[];
} {
  const evidence: string[] = [];
  const lowerUrl = domainOrUrl.toLowerCase();

  // 1. Explicit domain check
  if (lowerUrl.includes(".myshopify.com")) {
    evidence.push("Domain contains .myshopify.com");
    return { platform: "SHOPIFY_CONFIRMED", confidence: "HIGH", evidence };
  }

  // 2. HTML Inspection (if provided from a safe public storefront probe)
  if (sampleHtml) {
    const lowerHtml = sampleHtml.toLowerCase();

    if (lowerHtml.includes("cdn.shopify.com")) {
      evidence.push("Assets loaded from cdn.shopify.com");
    }
    if (lowerHtml.includes("window.shopify") || lowerHtml.includes("shopify.theme")) {
      evidence.push("Shopify global JavaScript runtime object present");
    }
    if (lowerHtml.includes("/cart.js") || lowerHtml.includes("shopify-payment-button")) {
      evidence.push("Shopify cart endpoints or payment button elements detected");
    }

    if (evidence.length >= 2) {
      return { platform: "SHOPIFY_CONFIRMED", confidence: "HIGH", evidence };
    }
    if (evidence.length === 1) {
      return { platform: "SHOPIFY_POSSIBLE", confidence: "MEDIUM", evidence };
    }

    // Check WooCommerce or other
    if (lowerHtml.includes("wp-content") || lowerHtml.includes("woocommerce")) {
      return {
        platform: "OTHER",
        confidence: "HIGH",
        evidence: ["WordPress / WooCommerce cues detected"],
      };
    }
  }

  return {
    platform: "UNKNOWN",
    confidence: "LOW",
    evidence: ["No definitive ecommerce signatures observed yet"],
  };
}
