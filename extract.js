import { chromium } from "playwright";
import fs from "fs";

// 🎯 Target page that contains the video
const TARGET_URL = "https://peachify.top/embed/movie/1081003?accent=7c5cff&dub=Hindi&quality=1080";
const OUTPUT = "m3u8.json";

(async () => {
  console.log(`🎯 Extracting from: ${TARGET_URL}`);

  const browser = await chromium.launch({ 
    headless: false, // Set to false for debugging, true for production
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      'Referer': 'https://peachify.top/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site'
    }
  });

  const page = await context.newPage();
  
  // 🔍 Intercept ALL network requests
  const videoUrls = [];
  const allRequests = [];
  
  // Enable request interception
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const headers = route.request().headers();
    const resourceType = route.request().resourceType();
    
    allRequests.push({
      url: url,
      method: method,
      resourceType: resourceType,
      timestamp: new Date().toISOString()
    });
    
    // Log all XHR/Fetch requests
    if (resourceType === 'xhr' || resourceType === 'fetch') {
      console.log(`🌐 ${method} ${url.substring(0, 120)}...`);
    }
    
    // Capture any requests to worker/proxy URLs or video streams
    if (url.includes('workers.dev') || 
        url.includes('.m3u8') || 
        url.includes('.mp4') ||
        url.includes('tripplestream.online') ||
        url.includes('mp4-proxy') ||
        url.includes('hls')) {
      
      console.log(`📡 CAPTURED: ${url}`);
      videoUrls.push({
        url: url,
        timestamp: new Date().toISOString(),
        type: resourceType,
        method: method,
        headers: headers
      });
    }
    
    route.continue();
  });

  try {
    // Navigate to the page with proper wait
    console.log(`🌐 Loading page...`);
    await page.goto(TARGET_URL, { 
      timeout: 60000, 
      waitUntil: 'domcontentloaded' 
    });

    // Wait for the page to initialize
    await page.waitForTimeout(3000);
    
    console.log(`⏳ Monitoring network requests...`);
    
    // Monitor for 15 seconds to catch all dynamic requests
    await page.waitForTimeout(15000);
    
    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    await page.waitForTimeout(3000);

    // Try to click play button if exists
    try {
      await page.click('button[aria-label*="play" i], .play-button, .vjs-big-play-button, [class*="play"]');
      console.log('🎮 Clicked play button');
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('ℹ️ No play button found or already playing');
    }

    // Extract all video sources from page
    const pageData = await page.evaluate(() => {
      const videos = [];
      
      // Check all script tags for URLs
      document.querySelectorAll('script').forEach(script => {
        const content = script.textContent || script.innerText;
        if (content) {
          // Look for various patterns
          const patterns = [
            /(?:https?:\/\/[^\s"'<>]+\.workers\.dev[^\s"'<>]*)/g,
            /(?:https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/g,
            /(?:https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/g,
            /(?:https?:\/\/[^\s"'<>]+tripplestream\.online[^\s"'<>]*)/g,
            /(?:https?:\/\/[^\s"'<>]+mp4-proxy[^\s"'<>]*)/g,
            /(?:https?:\/\/[^\s"'<>]+hls[^\s"'<>]*)/g
          ];
          
          patterns.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) {
              matches.forEach(url => {
                videos.push({
                  type: 'script',
                  url: decodeURIComponent(url)
                });
              });
            }
          });
        }
      });
      
      // Check video elements
      document.querySelectorAll('video source, video').forEach(el => {
        const src = el.getAttribute('src') || el.getAttribute('data-src');
        if (src) {
          videos.push({
            type: 'video_element',
            url: src
          });
        }
      });
      
      // Check all elements with data attributes
      document.querySelectorAll('[data-src], [data-video], [data-url], [data-href]').forEach(el => {
        const src = el.getAttribute('data-src') || 
                   el.getAttribute('data-video') || 
                   el.getAttribute('data-url') || 
                   el.getAttribute('data-href');
        if (src && (src.includes('workers.dev') || src.includes('.m3u8') || src.includes('.mp4'))) {
          videos.push({
            type: 'data_attribute',
            url: src
          });
        }
      });
      
      return videos;
    });

    // Also try to intercept via console.log
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('workers.dev') || text.includes('.m3u8') || text.includes('mp4-proxy')) {
        console.log(`📝 Console: ${text}`);
        const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) {
          videoUrls.push({
            url: urlMatch[0],
            timestamp: new Date().toISOString(),
            type: 'console',
            source: 'console_log'
          });
        }
      }
    });

    // Wait a bit more to catch any late requests
    await page.waitForTimeout(5000);

    // Combine all captured URLs
    const allUrls = [...videoUrls, ...pageData];
    
    // Remove duplicates (case insensitive and query params)
    const uniqueUrls = [];
    const seen = new Set();
    allUrls.forEach(item => {
      // Normalize URL for deduplication (remove timestamp/random params)
      let urlKey = item.url;
      try {
        const urlObj = new URL(item.url);
        // Remove cache-busting params
        const paramsToRemove = ['_', 't', 'timestamp', 'cache', 'rand', 'random'];
        paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
        urlKey = urlObj.toString();
      } catch (e) {
        // If URL parsing fails, use original
      }
      
      if (!seen.has(urlKey)) {
        seen.add(urlKey);
        uniqueUrls.push(item);
      }
    });

    console.log(`\n🔍 Found ${uniqueUrls.length} unique video-related URLs`);

    // Filter to find the actual video stream
    const videoStreams = uniqueUrls.filter(item => 
      item.url.includes('workers.dev') || 
      item.url.includes('.m3u8') || 
      item.url.includes('.mp4') ||
      item.url.includes('tripplestream.online') ||
      item.url.includes('mp4-proxy')
    );

    // Save results
    const results = {
      created_at: new Date().toISOString(),
      target_url: TARGET_URL,
      total_captured: uniqueUrls.length,
      video_streams: videoStreams.map(v => ({
        type: v.type || 'network',
        url: v.url,
        timestamp: v.timestamp || new Date().toISOString(),
        method: v.method || 'GET',
        headers: v.headers || {}
      })),
      all_requests: allRequests.slice(-50), // Last 50 requests for debugging
      all_urls: uniqueUrls.map(v => v.url)
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

    // Display results
    if (videoStreams.length > 0) {
      console.log(`\n✅ Found ${videoStreams.length} video streams:`);
      videoStreams.forEach((v, i) => {
        console.log(`\n  ${i+1}. URL: ${v.url}`);
        if (v.headers) {
          console.log(`     Headers:`, v.headers);
        }
      });
      
      // Find the proxy URL
      const proxyStream = videoStreams.find(v => v.url.includes('workers.dev') || v.url.includes('mp4-proxy'));
      if (proxyStream) {
        console.log(`\n🎬 PROXY STREAM URL:`);
        console.log(proxyStream.url);
        console.log(`\n📋 You can use this URL directly with headers:`);
        console.log(proxyStream.headers || {});
      }
    } else {
      console.log('❌ No video streams found');
      console.log('\n💡 Debug: Check the "all_requests" array in the JSON output');
    }

    console.log(`\n💾 Data saved to ${OUTPUT}`);

    // Take a screenshot for debugging
    await page.screenshot({ path: 'page-screenshot.png', fullPage: true });
    console.log(`📸 Screenshot saved to page-screenshot.png`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
})();
