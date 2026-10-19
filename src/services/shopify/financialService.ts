/**
 * Future Shopify & Advertising Financial Service Contracts.
 *
 * NOTE: These mathematical contracts and service interfaces are prepared for future activation
 * when the user connects a real Shopify store and ad accounts.
 * In RESEARCH_ONLY mode, they are completely inactive and NEVER produce synthetic or fake records.
 */

export interface FinancialSummary {
  grossSales: number;
  discounts: number;
  returns: number;
  netSales: number;
  totalOrders: number;
  averageOrderValue: number;
  adSpend: number;
  cogs: number;
  processingFees: number;
  shippingCosts: number;
  contributionProfit: number;
  platformReportedRoas: number;
  shopifyAttributedRoas: number;
  costPerAcquisition: number;
}

export function calculateNetSales(
  grossSales: number,
  discounts: number = 0,
  returns: number = 0
): number {
  return Math.max(0, grossSales - discounts - returns);
}

export function calculateAverageOrderValue(
  netSales: number,
  totalOrders: number
): number {
  if (!totalOrders || totalOrders <= 0) return 0;
  return Number((netSales / totalOrders).toFixed(2));
}

export function calculatePlatformReportedRoas(
  platformReportedRevenue: number,
  adSpend: number
): number {
  if (!adSpend || adSpend <= 0) return 0;
  return Number((platformReportedRevenue / adSpend).toFixed(2));
}

export function calculateShopifyAttributedRoas(
  shopifyAttributedRevenue: number,
  adSpend: number
): number {
  if (!adSpend || adSpend <= 0) return 0;
  return Number((shopifyAttributedRevenue / adSpend).toFixed(2));
}

export function calculateCostPerAcquisition(
  adSpend: number,
  conversions: number
): number {
  if (!conversions || conversions <= 0) return 0;
  return Number((adSpend / conversions).toFixed(2));
}

export function calculateContributionProfit(params: {
  netSales: number;
  cogs: number;
  adSpend: number;
  processingFees?: number;
  shippingCosts?: number;
}): number {
  const fees = params.processingFees || 0;
  const shipping = params.shippingCosts || 0;
  return Number(
    (params.netSales - params.cogs - params.adSpend - fees - shipping).toFixed(2)
  );
}

export function getShopifyConnectionStatus(): {
  status: "NOT_CONNECTED";
  message: string;
  isReadyForActivation: boolean;
} {
  return {
    status: "NOT_CONNECTED",
    message: "Connect your Shopify store when you are ready to analyze real orders, revenue, and advertising profitability.",
    isReadyForActivation: false,
  };
}
