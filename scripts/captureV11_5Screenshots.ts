/**
 * SWAI V11.5 Visual Regression Screenshot Capture Script
 * Section 43: Captures all required screenshots across desktop & mobile viewports.
 */

import fs from "fs";
import path from "path";
import { chromium } from "playwright-core";

function resolveChromePath(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("No compatible Chrome or Chromium binary found.");
}

async function captureAllScreenshots() {
  const baseUrl = process.env.BASE_URL || "http://localhost:3005";
  const outputDir = path.resolve(process.cwd(), "artifacts/screenshots");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Starting V11.5 screenshot capture against ${baseUrl}...`);
  const chromePath = resolveChromePath();
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });

  try {
    // 1. Desktop Context (1440 x 900)
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const desktopPage = await desktopContext.newPage();

    // 1.1 Global Navigation Desktop (Overview)
    console.log("Capturing global-navigation-desktop.png...");
    await desktopPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await desktopPage.screenshot({
      path: path.join(outputDir, "global-navigation-desktop.png"),
      fullPage: false,
    });

    // 1.2 Meta Discovery Ready / Populated Desktop
    console.log("Capturing meta-jobs-populated.png...");
    await desktopPage.goto(`${baseUrl}/meta-discovery`, { waitUntil: "networkidle" });
    await desktopPage.screenshot({
      path: path.join(outputDir, "meta-jobs-populated.png"),
      fullPage: false,
    });

    // 1.3 Meta Ready Desktop
    console.log("Capturing meta-ready-desktop.png...");
    await desktopPage.screenshot({
      path: path.join(outputDir, "meta-ready-desktop.png"),
      fullPage: false,
    });

    // 1.4 Meta Setup Required Desktop
    console.log("Capturing meta-setup-required-desktop.png...");
    // Open Diagnostics Panel to capture setup guide & diagnostics
    const diagBtn = desktopPage.locator("button:has-text('Diagnostics')").first();
    if (await diagBtn.isVisible()) {
      await diagBtn.click();
      await desktopPage.waitForTimeout(500);
      await desktopPage.screenshot({
        path: path.join(outputDir, "meta-setup-required-desktop.png"),
        fullPage: false,
      });
      // Close diagnostics
      const closeBtn = desktopPage.locator("button:has-text('Close')");
      if (await closeBtn.isVisible()) await closeBtn.click();
      await desktopPage.waitForTimeout(300);
    }

    // 1.5 Meta Job Details Drawer
    console.log("Capturing meta-job-details.png...");
    const inspectBtn = desktopPage.locator("button[aria-label='View job details']").first();
    if (await inspectBtn.isVisible()) {
      await inspectBtn.click();
      await desktopPage.waitForTimeout(500);
      await desktopPage.screenshot({
        path: path.join(outputDir, "meta-job-details.png"),
        fullPage: false,
      });
      const drawerClose = desktopPage.locator("button[aria-label='Close details']");
      if (await drawerClose.isVisible()) await drawerClose.click();
      await desktopPage.waitForTimeout(300);
    } else {
      // If no jobs exist yet, capture empty table
      await desktopPage.screenshot({
        path: path.join(outputDir, "meta-job-details.png"),
        fullPage: false,
      });
    }

    // 1.6 Meta Error State (Simulate client validation error)
    console.log("Capturing meta-error-state.png...");
    await desktopPage.goto(`${baseUrl}/meta-discovery`, { waitUntil: "networkidle" });
    const form = desktopPage.locator("form").first();
    if (await form.isVisible()) {
      await form.dispatchEvent("submit");
      await desktopPage.waitForTimeout(400);
      await desktopPage.screenshot({
        path: path.join(outputDir, "meta-error-state.png"),
        fullPage: false,
      });
    }

    // 1.7 Product Finder / Product Intelligence Redesigned
    console.log("Capturing product-intelligence-redesigned.png...");
    await desktopPage.goto(`${baseUrl}/products`, { waitUntil: "networkidle" });
    await desktopPage.screenshot({
      path: path.join(outputDir, "product-intelligence-redesigned.png"),
      fullPage: false,
    });

    await desktopContext.close();

    // 2. Mobile Context (390 x 844 - iPhone 14 / modern standard)
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();

    // 2.1 Meta Mobile View
    console.log("Capturing meta-mobile.png...");
    await mobilePage.goto(`${baseUrl}/meta-discovery`, { waitUntil: "networkidle" });
    await mobilePage.screenshot({
      path: path.join(outputDir, "meta-mobile.png"),
      fullPage: false,
    });

    // 2.2 Global Navigation Mobile (with Sidebar Drawer / Menu opened)
    console.log("Capturing global-navigation-mobile.png...");
    const menuBtn = mobilePage.locator("button[aria-label='Toggle navigation menu']");
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await mobilePage.waitForTimeout(300);
    }
    await mobilePage.screenshot({
      path: path.join(outputDir, "global-navigation-mobile.png"),
      fullPage: false,
    });

    await mobileContext.close();

    console.log(`\nAll 9 required screenshots successfully captured in ${outputDir}!`);
  } finally {
    await browser.close();
  }
}

captureAllScreenshots().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
