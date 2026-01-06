/**
 * OPTION 1 – MANUAL LOGIN LOCALLY → HEADLESS CAPTURE ANYWHERE
 * ----------------------------------------------------------
 * 1) FIRST RUN (LOCAL PC / TERMUX WITH GUI):
 *    - Browser opens
 *    - Login manually (OTP)
 *    - hotstar-session.json is saved
 *
 * 2) NEXT RUNS (LOCAL / CLOUD / GITHUB ACTIONS):
 *    - Headless
 *    - Session reused
 *    - No GUI required
 */

import { chromium } from "playwright";
import fs from "fs";

const TARGET_URL =
  "https://www.icc-cricket.com/videos/ricky-ponting-previews-the-ashes-and-reacts-to-south-africa-s-test-win-over-india-the-icc-review"; // change later to content page

const SESSION_FILE = "hotstar-session.json";
const FOUND = new Set();
const DEBUG = [];

(async () => {
  // ─────────────────────────────
  // 1️⃣ FIRST RUN → MANUAL LOGIN
  // ─────────────────────────────
  if (!fs.existsSync(SESSION_FILE)) {
    console.log("🔐 No session found");
    console.log("👉 OPENING BROWSER FOR MANUAL LOGIN");

    const browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      locale: "en-IN",
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    await page.goto("https://www.hotstar.com/in", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("📱 LOGIN MANUALLY (OTP)");
    console.log("⏳ WAITING 120 SECONDS...");

    await page.waitForTimeout(120000);

    await context.storageState({ path: SESSION_FILE });
    console.log("✅ SESSION SAVED:", SESSION_FILE);

    await browser.close();
    console.log("🔁 RE-RUN SCRIPT (SESSION READY)");
    process.exit(0);
  }

  // ─────────────────────────────
  // 2️⃣ HEADLESS RUN → CAPTURE
  // ─────────────────────────────
  console.log("🚀 SESSION FOUND – RUNNING HEADLESS");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "en-IN",
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  // ───────── Network interception ─────────
  page.on("request", req => {
    const url = req.url();
    if (
      url.includes(".m3u8") ||
      url.includes(".mpd") ||
      url.includes("manifest") ||
      url.includes("playlist")
    ) {
      FOUND.add(url.split("?")[0]);
      console.log("🔍 REQUEST:", url);
    }
  });

  page.on("response", async res => {
    const url = res.url();
    const type = res.request().resourceType();

    if (type === "media" || url.includes(".m3u8") || url.includes(".mpd")) {
      DEBUG.push({
        url,
        type,
        status: res.status()
      });
      console.log(`📡 RESPONSE [${type}]:`, url);
    }
  });

  console.log("🌐 OPENING TARGET PAGE");
  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 60000
  });

  // Wait for player init
  await page.waitForTimeout(15000);

  // Try clicking Play (safe)
  try {
    const play = page.locator(
      'button[aria-label*="Play"], button[class*="play"]'
    );
    if (await play.first().isVisible({ timeout: 5000 })) {
      console.log("▶️ CLICKING PLAY");
      await play.first().click();
    }
  } catch {}

  // Extra wait for late streams
  await page.waitForTimeout(20000);

  await browser.close();

  // ───────── Save result ─────────
  const result = {
    source: TARGET_URL,
    total: FOUND.size,
    streams: [...FOUND],
    debugSamples: DEBUG.slice(0, 10),
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("m3u8.json", JSON.stringify(result, null, 2));

  console.log(`✅ DONE – FOUND ${FOUND.size} STREAM URLS`);

  if (FOUND.size === 0) {
    console.log("❌ DRM-PROTECTED (EXPECTED FOR HOTSTAR)");
  }
})();
