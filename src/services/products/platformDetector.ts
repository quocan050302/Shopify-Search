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

export interface CommercePlatformInspection {
  domain: string;
  html?: string | null;
  headers?: Record<string, string>;
}

export interface CommercePlatformAssessment {
  platform: "SHOPIFY_CONFIRMED" | "SHOPIFY_POSSIBLE" | "OTHER" | "UNKNOWN";
  engineName: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  technicalIndicators: string[];
  disclaimer: string;
}

/**
 * Evaluates technical evidence from DOM, headers, and domain to classify ecommerce platform.
 *
 * Requirements:
 * - Real domain suffix/subdomain verification for myshopify.com
 * - Multi-factor indicator detection (CDN, script objects, cart endpoints, headers)
 * - Identifies conflicting WooCommerce, BigCommerce, or custom architectures
 * - Clearly disclaims that Shopify detection is not proof of sales or success
 */
export function verifyCommercePlatformEvidence(
  input: CommercePlatformInspection
): CommercePlatformAssessment {
  const indicators: string[] = [];
  const cleanDomain = input.domain.trim().toLowerCase().replace(/^www\./, "");

  // 1. Strict domain suffix / subdomain check
  if (cleanDomain.endsWith(".myshopify.com") || cleanDomain === "myshopify.com") {
    indicators.push("Subdomain matches *.myshopify.com");
    return {
      platform: "SHOPIFY_CONFIRMED",
      engineName: "Shopify",
      confidence: "HIGH",
      technicalIndicators: indicators,
      disclaimer: "Shopify detection is a technical storefront observation, not evidence of sales volume or profitability.",
    };
  }

  // 2. HTTP response headers analysis
  if (input.headers) {
    const headerKeys = Object.keys(input.headers).map((k) => k.toLowerCase());
    if (headerKeys.includes("x-shopid") || headerKeys.includes("x-shardid")) {
      indicators.push("Shopify server routing headers detected (x-shopid / x-shardid)");
    }
    const poweredBy = (input.headers["x-powered-by"] || input.headers["server"] || "").toLowerCase();
    if (poweredBy.includes("shopify")) {
      indicators.push(`Server header explicitly declares: '${poweredBy}'`);
    }
  }

  // 3. HTML inspection
  if (input.html) {
    const lowerHtml = input.html.toLowerCase();

    // Check Shopify markers
    if (lowerHtml.includes("cdn.shopify.com") || lowerHtml.includes("shopifycloud.com")) {
      indicators.push("Storefront static assets hosted on cdn.shopify.com or shopifycloud.com");
    }
    if (lowerHtml.includes("window.shopify") || lowerHtml.includes("shopify.shop") || lowerHtml.includes("shopify.theme")) {
      indicators.push("Global window.Shopify JavaScript runtime metadata verified");
    }
    if (lowerHtml.includes("/cart.js") || lowerHtml.includes("shopify-payment-button") || lowerHtml.includes("shopify-section-")) {
      indicators.push("Shopify liquid template structure and cart endpoints observed");
    }
    if (lowerHtml.includes("name=\"shopify-digital-wallet\"") || lowerHtml.includes("id=\"shopify-features\"")) {
      indicators.push("Shopify digital checkout & wallet features observed in DOM");
    }

    // Check WooCommerce markers
    const isWoo =
      lowerHtml.includes("wp-content/plugins/woocommerce") ||
      lowerHtml.includes("woocommerce-price-amount") ||
      lowerHtml.includes("class=\"woocommerce");

    // Check BigCommerce markers
    const isBigCommerce =
      lowerHtml.includes("cdn11.bigcommerce.com") || lowerHtml.includes("stencil-utils");

    if (indicators.length >= 2) {
      return {
        platform: "SHOPIFY_CONFIRMED",
        engineName: "Shopify",
        confidence: "HIGH",
        technicalIndicators: indicators,
        disclaimer: "Shopify detection is a technical storefront observation, not evidence of sales volume or profitability.",
      };
    }

    if (indicators.length === 1 && !isWoo && !isBigCommerce) {
      return {
        platform: "SHOPIFY_POSSIBLE",
        engineName: "Shopify (Unconfirmed)",
        confidence: "MEDIUM",
        technicalIndicators: indicators,
        disclaimer: "Possible Shopify storefront based on isolated asset cue. Full verification pending.",
      };
    }

    if (isWoo) {
      return {
        platform: "OTHER",
        engineName: "WooCommerce / WordPress",
        confidence: "HIGH",
        technicalIndicators: ["WordPress / WooCommerce plugin structure observed in DOM"],
        disclaimer: "Storefront runs on WooCommerce, not Shopify.",
      };
    }

    if (isBigCommerce) {
      return {
        platform: "OTHER",
        engineName: "BigCommerce",
        confidence: "HIGH",
        technicalIndicators: ["BigCommerce CDN and stencil assets observed in DOM"],
        disclaimer: "Storefront runs on BigCommerce, not Shopify.",
      };
    }
  }

  if (indicators.length > 0) {
    return {
      platform: "SHOPIFY_POSSIBLE",
      engineName: "Shopify (Partial)",
      confidence: "LOW",
      technicalIndicators: indicators,
      disclaimer: "Technical cues are inconclusive.",
    };
  }

  return {
    platform: "UNKNOWN",
    engineName: "Unknown",
    confidence: "LOW",
    technicalIndicators: ["No definitive ecommerce platform signatures observed."],
    disclaimer: "Platform could not be confirmed from available evidence.",
  };
}
