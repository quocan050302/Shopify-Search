import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  getProviderBudget,
  updateProviderBudget,
  authorizePaidApiCall,
  recordPaidApiUsage,
  loadProviderBudgets,
} from "@/services/providers/budgetService";
import {
  isProviderAuthorizedForRequest,
  PROVIDER_CATALOG,
} from "@/services/credentials/credentialService";
import { GET as budgetsGet, POST as budgetsPost } from "@/app/api/v1/settings/budgets/route";
import { NextRequest } from "next/server";

const BUDGET_FILE = path.join(process.cwd(), ".provider-budgets.json");

describe("Provider Usage Budgets & Credit Protection", () => {
  let originalBudgetContent: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(BUDGET_FILE)) {
      originalBudgetContent = fs.readFileSync(BUDGET_FILE, "utf-8");
    } else {
      originalBudgetContent = null;
    }
  });

  afterEach(() => {
    if (originalBudgetContent !== null) {
      fs.writeFileSync(BUDGET_FILE, originalBudgetContent);
    } else if (fs.existsSync(BUDGET_FILE)) {
      fs.unlinkSync(BUDGET_FILE);
    }
  });

  it("ensures Captapi is marked optional, paid, and disabled by default in provider catalog", () => {
    const captapiConfig = PROVIDER_CATALOG.captapi;
    expect(captapiConfig).toBeDefined();
    expect(captapiConfig.isOptional).toBe(true);
    expect(captapiConfig.isPaid).toBe(true);
    expect(captapiConfig.defaultEnabled).toBe(false);
  });

  it("defaults Captapi to disabled with automatic requests blocked", () => {
    const budget = getProviderBudget("captapi");
    expect(budget.provider).toBe("captapi");
    expect(budget.enabled).toBe(false);
    expect(budget.allowAutomaticRequests).toBe(false);
    expect(budget.monthlyCreditLimit).toBeGreaterThanOrEqual(10);
  });

  it("blocks Captapi requests by default until authorized", () => {
    // Reset budget to default disabled
    updateProviderBudget("captapi", { enabled: false, allowAutomaticRequests: false });

    // Automatic check via credentialService
    const autoAuth = isProviderAuthorizedForRequest("captapi", true);
    expect(autoAuth.authorized).toBe(false);
    expect(autoAuth.reason).toContain("disabled by default");

    // Manual check while disabled
    const manualAuth = isProviderAuthorizedForRequest("captapi", false);
    expect(manualAuth.authorized).toBe(false);
    expect(manualAuth.reason).toContain("disabled by default");

    // authorizePaidApiCall check
    const callAuth = authorizePaidApiCall({ provider: "captapi", estimatedCredits: 1, isAutomaticRequest: true });
    expect(callAuth.allowed).toBe(false);
    expect(callAuth.reason).toContain("disabled by default");
  });

  it("blocks automatic requests even when enabled if allowAutomaticRequests is false", () => {
    updateProviderBudget("captapi", {
      enabled: true,
      allowAutomaticRequests: false,
      monthlyCreditLimit: 100,
      creditsUsedThisMonth: 0,
    });

    // Automatic request blocked
    const autoCheck = authorizePaidApiCall({ provider: "captapi", estimatedCredits: 1, isAutomaticRequest: true });
    expect(autoCheck.allowed).toBe(false);
    expect(autoCheck.reason).toContain("Automatic paid API requests are disabled");

    // Manual request permitted if budget is available
    const manualCheck = authorizePaidApiCall({ provider: "captapi", estimatedCredits: 1, isAutomaticRequest: false });
    expect(manualCheck.allowed).toBe(true);
  });

  it("enforces monthly budget cap and blocks requests exceeding the credit limit", () => {
    updateProviderBudget("captapi", {
      enabled: true,
      allowAutomaticRequests: true,
      monthlyCreditLimit: 100,
      creditsUsedThisMonth: 95,
    });

    // Request costing 10 credits would push spend to 105 > 100 limit
    const overBudgetCheck = authorizePaidApiCall({ provider: "captapi", estimatedCredits: 10, isAutomaticRequest: false });
    expect(overBudgetCheck.allowed).toBe(false);
    expect(overBudgetCheck.reason).toContain("Credit budget exceeded");

    // Request costing 3 credits fits within budget (95 + 3 = 98 <= 100)
    const underBudgetCheck = authorizePaidApiCall({ provider: "captapi", estimatedCredits: 3, isAutomaticRequest: false });
    expect(underBudgetCheck.allowed).toBe(true);
  });

  it("records paid API usage and accumulates credits", () => {
    updateProviderBudget("captapi", {
      enabled: true,
      creditsUsedThisMonth: 10,
    });

    recordPaidApiUsage("captapi", 5);
    const updated = getProviderBudget("captapi");
    expect(updated.creditsUsedThisMonth).toBe(15);
  });

  it("supports budget management via GET and POST API route", async () => {
    // Test GET
    const getRes = await budgetsGet();
    const getData = await getRes.json();

    expect(getRes.status).toBe(200);
    expect(getData.success).toBe(true);
    expect(getData.data.captapi).toBeDefined();

    // Test POST to update budget
    const postReq = new NextRequest("http://localhost:3000/api/v1/settings/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "captapi",
        enabled: true,
        allowAutomaticRequests: false,
        monthlyCreditLimit: 250,
      }),
    });

    const postRes = await budgetsPost(postReq);
    const postData = await postRes.json();

    expect(postRes.status).toBe(200);
    expect(postData.success).toBe(true);
    expect(postData.data.enabled).toBe(true);
    expect(postData.data.allowAutomaticRequests).toBe(false);
    expect(postData.data.monthlyCreditLimit).toBe(250);
  });
});
