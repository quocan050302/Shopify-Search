import { describe, it, expect } from "vitest";
import {
  calculateNetSales,
  calculateAverageOrderValue,
  calculatePlatformReportedRoas,
  calculateShopifyAttributedRoas,
  calculateCostPerAcquisition,
  calculateContributionProfit,
  getShopifyConnectionStatus,
} from "@/services/shopify/financialService";

describe("Future Commerce Financial Formulas", () => {
  it("calculates net sales correctly deducting discounts and returns", () => {
    expect(calculateNetSales(1000, 100, 50)).toBe(850);
    expect(calculateNetSales(100, 120, 0)).toBe(0);
  });

  it("calculates average order value", () => {
    expect(calculateAverageOrderValue(5000, 100)).toBe(50);
    expect(calculateAverageOrderValue(0, 0)).toBe(0);
  });

  it("calculates ROAS and CPA accurately", () => {
    expect(calculatePlatformReportedRoas(6000, 2000)).toBe(3.0);
    expect(calculateShopifyAttributedRoas(5000, 2000)).toBe(2.5);
    expect(calculateCostPerAcquisition(2000, 80)).toBe(25.0);
  });

  it("calculates true contribution profit", () => {
    const profit = calculateContributionProfit({
      netSales: 10000,
      cogs: 3000,
      adSpend: 4000,
      processingFees: 300,
      shippingCosts: 700,
    });
    expect(profit).toBe(2000);
  });

  it("returns honest NOT_CONNECTED status by default", () => {
    const status = getShopifyConnectionStatus();
    expect(status.status).toBe("NOT_CONNECTED");
    expect(status.isReadyForActivation).toBe(false);
  });
});
