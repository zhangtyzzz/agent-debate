import test from "node:test";
import assert from "node:assert/strict";

let playwright;
try {
  playwright = await import("playwright");
} catch {
  // Skip e2e tests if Playwright browsers aren't installed
  console.log("Playwright not available, skipping e2e tests.");
  process.exit(0);
}

const { chromium } = playwright;

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";

test("e2e: app loads and shows Agent Debate title", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { timeout: 10000 });
    const title = await page.textContent("h1");
    assert.match(title, /Agent Debate/);
  } finally {
    await browser.close();
  }
});

test("e2e: settings tab redirects when no config", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Clear storage to simulate first visit
    await page.goto(BASE_URL, { timeout: 10000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ timeout: 10000 });

    // Should redirect to settings since no agent is configured
    const settingsPanel = await page.locator('.panel.active').first();
    const text = await settingsPanel.textContent();
    // The settings panel should be visible with agent config options
    assert.ok(
      text.includes("Base URL") || text.includes("API Key") || text.includes("设置"),
      "Settings panel should be visible",
    );
  } finally {
    await browser.close();
  }
});

test("e2e: nav tabs switch panels", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { timeout: 10000 });

    // Click History tab
    const tabs = page.locator(".nav-tab");
    const historyTab = tabs.filter({ hasText: /History|历史/ }).first();
    if (await historyTab.isVisible()) {
      await historyTab.click();
      await page.waitForTimeout(200);
      const activePanel = await page.locator('.panel.active').first();
      const text = await activePanel.textContent();
      assert.ok(
        text.includes("History") || text.includes("历史") || text.includes("history"),
        "History panel should be active",
      );
    }
  } finally {
    await browser.close();
  }
});

test("e2e: locale switch changes UI language", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { timeout: 10000 });

    // Find the locale select and switch to English
    const localeSelect = page.locator(".locale-switch select");
    if (await localeSelect.isVisible()) {
      await localeSelect.selectOption("en");
      await page.waitForTimeout(300);
      const bodyText = await page.textContent("body");
      assert.ok(
        bodyText.includes("Settings") || bodyText.includes("Debate"),
        "UI should show English text",
      );

      // Switch to Chinese
      await localeSelect.selectOption("zh-CN");
      await page.waitForTimeout(300);
      const bodyTextZh = await page.textContent("body");
      assert.ok(
        bodyTextZh.includes("设置") || bodyTextZh.includes("辩论"),
        "UI should show Chinese text",
      );
    }
  } finally {
    await browser.close();
  }
});
