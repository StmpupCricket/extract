import { chromium } from "playwright";
import fs from "fs";

const TARGET_URL = process.env.TARGET_URL || 
  "https://hitmaal.com/innocent-episode-1/";

const FOUND = new Set();
const DEBUG_REQUESTS = [];

(async () => {
  const browser = await chromium.launch({ 
    headless: true, // Must be true for CI/GitHub Actions
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-gpu",
      "--single-process", // May help in constrained environments
      "--no-zygote"
    ]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    // Add permissions that might be needed
    permissions: ["geolocation"],
    geolocation: { latitude: 28.6139, longitude: 77.2090 }, // Delhi coordinates
    locale: "en-IN"
  });

  const page = await context.newPage();

  // 🔥 Intercept ALL network requests
  page.on("request", req => {
    const url = req.url();
    if (url.includes(".m3u8") || url.includes("master") || url.includes("playlist")) {
      console.log("🔍 REQUEST:", url);
      FOUND.add(url.split("?")[0]);
    }
  });

  page.on("response", async res => {
    const url = res.url();
    const type = res.request().resourceType();
    
    // Log all media-related requests
    if (type === "media" || url.includes(".m3u8") || url.includes(".ts") || 
        url.includes("manifest") || url.includes("playlist")) {
      console.log(`📡 RESPONSE [${type}]:`, url);
      DEBUG_REQUESTS.push({ url, type, status: res.status() });
      
      if (url.includes(".m3u8")) {
        FOUND.add(url.split("?")[0]);
        
        // Try to get the response body
        try {
          const body = await res.text();
          console.log("📄 M3U8 Content preview:", body.substring(0, 200));
        } catch (e) {
          console.log("⚠️ Couldn't read response body");
        }
      }
    }
  });

  // Capture console logs from the page
  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("m3u8") || text.includes("stream")) {
      console.log("🌐 PAGE CONSOLE:", text);
    }
  });

  console.log("🚀 Opening page...");
  try {
    await page.goto(TARGET_URL, { 
      waitUntil: "networkidle", 
      timeout: 60000 
    });
  } catch (e) {
    console.log("⚠️ Navigation timeout, continuing anyway...");
  }

  console.log("⏳ Waiting for player to initialize...");
  await page.waitForTimeout(5000);

  // Try to find and click play button
  try {
    const playButton = await page.locator('button[aria-label*="play"], button[class*="play"], .play-button, [data-testid*="play"]').first();
    if (await playButton.isVisible({ timeout: 5000 })) {
      console.log("▶️ Clicking play button...");
      await playButton.click();
      await page.waitForTimeout(10000);
    }
  } catch (e) {
    console.log("ℹ️ No play button found or already playing");
  }

  // 🔍 Deep DOM inspection
  console.log("🔎 Scanning page source...");
  const pageContent = await page.content();
  const m3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
  const matches = pageContent.match(m3u8Regex) || [];
  matches.forEach(url => {
    console.log("📄 DOM M3U8:", url);
    FOUND.add(url.split("?")[0]);
  });

  // Check video elements
  const videoSources = await page.evaluate(() => {
    const sources = [];
    document.querySelectorAll("video, source").forEach(el => {
      if (el.src) sources.push(el.src);
      if (el.currentSrc) sources.push(el.currentSrc);
    });
    return sources;
  });
  
  console.log("🎥 Video sources found:", videoSources);
  videoSources.forEach(src => {
    if (src.includes(".m3u8")) FOUND.add(src.split("?")[0]);
  });

  // Check for common streaming player objects
  const streamData = await page.evaluate(() => {
    const data = { player: null, hls: null, dash: null };
    
    // Check common player libraries
    if (window.Hls) data.hls = "HLS.js detected";
    if (window.dashjs) data.dash = "Dash.js detected";
    if (window.jwplayer) data.player = "JWPlayer detected";
    if (window.videojs) data.player = "Video.js detected";
    
    // Try to extract from window object
    const checkObj = (obj, depth = 0) => {
      if (depth > 2) return;
      for (let key in obj) {
        try {
          if (typeof obj[key] === 'string' && obj[key].includes('.m3u8')) {
            console.log(`Found m3u8 in window.${key}:`, obj[key]);
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            checkObj(obj[key], depth + 1);
          }
        } catch (e) {}
      }
    };
    
    checkObj(window);
    return data;
  });
  
  console.log("🎬 Player info:", streamData);

  // Wait a bit more to catch late-loading streams
  console.log("⏳ Waiting for late requests...");
  await page.waitForTimeout(15000);

  await browser.close();

  const result = {
    source: TARGET_URL,
    total: FOUND.size,
    m3u8: [...FOUND],
    debug: {
      mediaRequests: DEBUG_REQUESTS.length,
      allRequests: DEBUG_REQUESTS.slice(0, 10) // First 10 for reference
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("m3u8.json", JSON.stringify(result, null, 2));
  console.log(`\n✅ Saved m3u8.json with ${FOUND.size} URLs found`);
  
  if (FOUND.size === 0) {
    console.log("\n❌ No M3U8 URLs found. Possible reasons:");
    console.log("   • Stream requires authentication/login");
    console.log("   • Geo-blocking (try VPN to India)");
    console.log("   • DRM-protected content");
    console.log("   • Match not live/available");
    console.log("   • Anti-bot detection");
  }
})();
