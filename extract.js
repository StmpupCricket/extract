import { chromium } from "playwright";
import fs from "fs";

const TARGET_URL =
  process.env.TARGET_URL ||
  "https://www.fancode.com/football/tour/laliga-2025-26-18801700/matches/elche-cf-vs-villarreal-cf-131009/live-match-info";

const FOUND = new Set();

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // 🔥 MOST RELIABLE: response-level capture
  page.on("response", async res => {
    const url = res.url();
    if (url.includes(".m3u8")) {
      FOUND.add(url.split("?")[0]);
    }
  });

  console.log("Opening page...");
  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });

  // ⏳ Let player & ads initialize
  await page.waitForTimeout(15000);

  // 🔍 Secondary DOM scan (fallback)
  await page.evaluate(() => {
    const re = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;

    document.querySelectorAll("script").forEach(s => {
      (s.textContent?.match(re) || []).forEach(u =>
        console.log("DOM_M3U8", u)
      );
    });

    document.querySelectorAll("video,source").forEach(v => {
      if (v.src && v.src.includes(".m3u8")) {
        console.log("VIDEO_M3U8", v.src);
      }
    });
  });

  await browser.close();

  const result = {
    source: TARGET_URL,
    total: FOUND.size,
    m3u8: [...FOUND],
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("m3u8.json", JSON.stringify(result, null, 2));

  console.log("Saved m3u8.json");
})();
