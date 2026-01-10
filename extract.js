import { chromium } from "playwright";
import fs from "fs";

const TARGET_URL = process.env.TARGET_URL || 
  "https://crickettv.site/willow";

const FOUND_M3U8 = new Set();
const FOUND_MPD = new Set();
const DEBUG_REQUESTS = [];

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-gpu",
      "--single-process",
      "--no-zygote"
    ]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    permissions: ["geolocation"],
    geolocation: { latitude: 28.6139, longitude: 77.2090 },
    locale: "en-IN"
  });

  const page = await context.newPage();

  // Intercept network requests for both HLS and DASH
  page.on("request", req => {
    const url = req.url();
    if (url.includes(".m3u8") || url.includes("master") || url.includes("playlist") || 
        url.includes(".mpd") || url.includes("dash") || url.includes("manifest")) {
      console.log("🔍 REQUEST:", url);
      if (url.includes(".m3u8") || url.includes("master.m3u8") || url.includes("playlist.m3u8")) {
        FOUND_M3U8.add(url.split("?")[0]);
      }
      if (url.includes(".mpd") || url.includes("dash") || url.includes("manifest.mpd")) {
        FOUND_MPD.add(url.split("?")[0]);
      }
    }
  });

  page.on("response", async res => {
    const url = res.url();
    const type = res.request().resourceType();
    const status = res.status();
    
    // Log all streaming-related responses
    if (type === "media" || url.includes(".m3u8") || url.includes(".ts") || 
        url.includes(".mpd") || url.includes("manifest") || url.includes("playlist") ||
        url.includes("dash") || url.includes("segment") || url.includes("chunk")) {
      console.log(`📡 RESPONSE [${type}][${status}]:`, url);
      DEBUG_REQUESTS.push({ url, type, status });
      
      // Handle M3U8 files
      if (url.includes(".m3u8")) {
        FOUND_M3U8.add(url.split("?")[0]);
        try {
          const body = await res.text();
          console.log("📄 M3U8 Content preview:", body.substring(0, 200));
          // Check for nested playlists in the M3U8 content
          const lines = body.split('\n');
          lines.forEach(line => {
            if (line.includes('.m3u8') && !line.startsWith('#')) {
              const fullUrl = new URL(line, url).href;
              console.log("   ↳ Nested M3U8:", fullUrl);
              FOUND_M3U8.add(fullUrl.split("?")[0]);
            }
          });
        } catch (e) {
          console.log("⚠️ Couldn't read M3U8 response body");
        }
      }
      
      // Handle MPD files
      if (url.includes(".mpd") || url.includes("/dash/") || url.includes("manifest.mpd")) {
        FOUND_MPD.add(url.split("?")[0]);
        try {
          const body = await res.text();
          console.log("📄 MPD Content preview:", body.substring(0, 200));
          // Check for MPD specific patterns
          if (body.includes('MPD') || body.includes('MediaPresentationDescriptor')) {
            console.log("✅ Confirmed MPD (DASH) manifest");
          }
        } catch (e) {
          console.log("⚠️ Couldn't read MPD response body");
        }
      }
    }
  });

  // Capture console logs from the page
  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("m3u8") || text.includes("mpd") || text.includes("stream") || 
        text.includes("dash") || text.includes("hls")) {
      console.log("🌐 PAGE CONSOLE:", text);
      
      // Extract URLs from console logs
      const urlRegex = /(https?:\/\/[^\s"'<>]+\.(m3u8|mpd)[^\s"'<>]*)/gi;
      const matches = text.match(urlRegex) || [];
      matches.forEach(url => {
        console.log("   ↳ Extracted from console:", url);
        if (url.includes('.m3u8')) {
          FOUND_M3U8.add(url.split("?")[0]);
        }
        if (url.includes('.mpd')) {
          FOUND_MPD.add(url.split("?")[0]);
        }
      });
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

  // Try different play button selectors
  const playButtonSelectors = [
    'button[aria-label*="play" i]',
    'button[class*="play" i]',
    '.play-button',
    '[data-testid*="play" i]',
    'button.ytp-play-button',
    '.ytp-play-button',
    'video',
    'button:has-text("Play")',
    'button:has-text("▶")'
  ];

  for (const selector of playButtonSelectors) {
    try {
      const playButton = page.locator(selector).first();
      if (await playButton.count() > 0 && await playButton.isVisible({ timeout: 2000 })) {
        console.log(`▶️ Clicking play button (${selector})...`);
        await playButton.click();
        await page.waitForTimeout(10000);
        break;
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  // 🔍 Deep DOM inspection for both HLS and DASH URLs
  console.log("🔎 Scanning page source...");
  const pageContent = await page.content();
  
  // Search for M3U8 URLs
  const m3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
  const m3u8Matches = pageContent.match(m3u8Regex) || [];
  m3u8Matches.forEach(url => {
    console.log("📄 DOM M3U8:", url);
    FOUND_M3U8.add(url.split("?")[0]);
  });
  
  // Search for MPD URLs
  const mpdRegex = /(https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*)/gi;
  const mpdMatches = pageContent.match(mpdRegex) || [];
  mpdMatches.forEach(url => {
    console.log("📄 DOM MPD:", url);
    FOUND_MPD.add(url.split("?")[0]);
  });
  
  // Search for DASH manifests without .mpd extension
  const dashRegex = /(https?:\/\/[^\s"'<>]+\/(dash|manifest)[^\s"'<>]*)/gi;
  const dashMatches = pageContent.match(dashRegex) || [];
  dashMatches.forEach(url => {
    if (!url.includes('.m3u8')) {
      console.log("📄 DASH Manifest:", url);
      FOUND_MPD.add(url.split("?")[0]);
    }
  });

  // Check video elements for src attributes
  const videoSources = await page.evaluate(() => {
    const sources = [];
    document.querySelectorAll("video, source, audio").forEach(el => {
      if (el.src) sources.push(el.src);
      if (el.currentSrc) sources.push(el.currentSrc);
      if (el.getAttribute && el.getAttribute('data-src')) {
        sources.push(el.getAttribute('data-src'));
      }
    });
    
    // Also check for video.js and other player data attributes
    document.querySelectorAll('[data-setup], [data-player], [data-source]').forEach(el => {
      try {
        const setup = el.getAttribute('data-setup');
        if (setup) {
          const config = JSON.parse(setup);
          if (config.sources && Array.isArray(config.sources)) {
            config.sources.forEach(source => {
              if (source.src) sources.push(source.src);
            });
          }
        }
      } catch (e) {}
    });
    
    return [...new Set(sources)];
  });
  
  console.log("🎥 Media sources found:", videoSources);
  videoSources.forEach(src => {
    if (src.includes(".m3u8")) FOUND_M3U8.add(src.split("?")[0]);
    if (src.includes(".mpd") || src.includes("/dash/")) FOUND_MPD.add(src.split("?")[0]);
  });

  // Check for streaming player objects and APIs
  const streamData = await page.evaluate(() => {
    const data = {
      players: {},
      hls: null,
      dash: null,
      videoElement: null,
      streamingUrls: []
    };
    
    // Check common player libraries
    if (window.Hls) {
      data.hls = "HLS.js detected";
      if (window.Hls.isSupported()) data.hls += " (supported)";
    }
    if (window.dashjs) {
      data.dash = "Dash.js detected";
      if (window.dashjs.supportsMediaSource) data.dash += " (MediaSource supported)";
    }
    if (window.jwplayer) data.players.jwplayer = "JWPlayer detected";
    if (window.videojs) data.players.videojs = "Video.js detected";
    if (window.Shaka) data.players.shaka = "Shaka Player detected";
    if (window.flowplayer) data.players.flowplayer = "Flowplayer detected";
    if (window.clappr) data.players.clappr = "Clappr detected";
    if (window.bitmovin) data.players.bitmovin = "Bitmovin detected";
    
    // Check for video elements and their sources
    const videos = document.querySelectorAll('video');
    if (videos.length > 0) {
      data.videoElement = {
        count: videos.length,
        sources: []
      };
      videos.forEach((video, idx) => {
        if (video.src) data.videoElement.sources.push(video.src);
        if (video.currentSrc) data.videoElement.sources.push(video.currentSrc);
      });
    }
    
    // Try to extract from window object
    const extractUrls = (obj, path = 'window', depth = 0) => {
      if (depth > 3) return;
      for (let key in obj) {
        try {
          if (typeof obj[key] === 'string') {
            const value = obj[key];
            if (value.includes('.m3u8') || value.includes('.mpd') || 
                value.includes('manifest') || value.includes('/dash/')) {
              console.log(`Found streaming URL in ${path}.${key}:`, value);
              data.streamingUrls.push(value);
            }
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            extractUrls(obj[key], `${path}.${key}`, depth + 1);
          }
        } catch (e) {}
      }
    };
    
    extractUrls(window);
    return data;
  });
  
  console.log("🎬 Player detection:", JSON.stringify(streamData, null, 2));
  
  // Extract URLs from player data
  if (streamData.videoElement && streamData.videoElement.sources) {
    streamData.videoElement.sources.forEach(src => {
      if (src.includes('.m3u8')) FOUND_M3U8.add(src.split("?")[0]);
      if (src.includes('.mpd')) FOUND_MPD.add(src.split("?")[0]);
    });
  }
  
  streamData.streamingUrls.forEach(url => {
    if (url.includes('.m3u8')) FOUND_M3U8.add(url.split("?")[0]);
    if (url.includes('.mpd')) FOUND_MPD.add(url.split("?")[0]);
  });

  // Try to trigger quality change to reveal more streams
  try {
    console.log("🔄 Attempting to trigger quality settings...");
    
    // Try to right-click on video to get context menu
    const video = page.locator('video').first();
    if (await video.count() > 0) {
      await video.click({ button: 'right' });
      await page.waitForTimeout(1000);
      
      // Try to find and click quality settings
      const qualitySelectors = [
        'text=Quality',
        'text=Settings',
        'text=Gear',
        '.ytp-settings-button',
        '[aria-label*="quality" i]',
        '[aria-label*="settings" i]'
      ];
      
      for (const selector of qualitySelectors) {
        try {
          const elem = page.locator(selector).first();
          if (await elem.count() > 0 && await elem.isVisible({ timeout: 1000 })) {
            await elem.click();
            await page.waitForTimeout(2000);
            break;
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    console.log("ℹ️ Couldn't trigger quality settings");
  }

  // Wait for late-loading streams
  console.log("⏳ Waiting for late requests...");
  await page.waitForTimeout(15000);

  // One more check after waiting
  const finalContent = await page.content();
  const finalM3u8Matches = finalContent.match(m3u8Regex) || [];
  finalM3u8Matches.forEach(url => FOUND_M3U8.add(url.split("?")[0]));
  
  const finalMpdMatches = finalContent.match(mpdRegex) || [];
  finalMpdMatches.forEach(url => FOUND_MPD.add(url.split("?")[0]));

  await browser.close();

  // Prepare result
  const result = {
    source: TARGET_URL,
    totals: {
      m3u8: FOUND_M3U8.size,
      mpd: FOUND_MPD.size,
      total: FOUND_M3U8.size + FOUND_MPD.size
    },
    hls: {
      count: FOUND_M3U8.size,
      urls: [...FOUND_M3U8]
    },
    dash: {
      count: FOUND_MPD.size,
      urls: [...FOUND_MPD]
    },
    debug: {
      totalRequests: DEBUG_REQUESTS.length,
      sampleRequests: DEBUG_REQUESTS.slice(0, 20)
    },
    timestamp: new Date().toISOString()
  };

  // Save results
  fs.writeFileSync("stream-manifests.json", JSON.stringify(result, null, 2));
  
  console.log("\n" + "=".repeat(50));
  console.log("📊 RESULTS SUMMARY:");
  console.log("=".repeat(50));
  console.log(`✅ HLS (M3U8) URLs found: ${FOUND_M3U8.size}`);
  if (FOUND_M3U8.size > 0) {
    console.log("   M3U8 URLs:");
    [...FOUND_M3U8].forEach((url, i) => console.log(`   ${i+1}. ${url}`));
  }
  
  console.log(`\n✅ DASH (MPD) URLs found: ${FOUND_MPD.size}`);
  if (FOUND_MPD.size > 0) {
    console.log("   MPD URLs:");
    [...FOUND_MPD].forEach((url, i) => console.log(`   ${i+1}. ${url}`));
  }
  
  console.log(`\n💾 Saved to stream-manifests.json`);
  
  if (FOUND_M3U8.size === 0 && FOUND_MPD.size === 0) {
    console.log("\n❌ No streaming URLs found. Possible reasons:");
    console.log("   • Stream requires authentication/login");
    console.log("   • Geo-blocking (try VPN to India)");
    console.log("   • DRM-protected content (Widevine, PlayReady)");
    console.log("   • Content not available/live");
    console.log("   • Anti-bot detection (try adding more delays)");
    console.log("   • Content might use WebRTC or other protocols");
  }
})();
