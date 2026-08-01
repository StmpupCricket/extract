import { chromium } from "playwright";
import fs from "fs";

// 🎯 Target page that contains the video
const TARGET_URL = "https://peachify.top/embed/movie/1081003?accent=7c5cff&dub=Hindi&quality=1080";
const OUTPUT = "m3u8.json";

(async () => {
  console.log(`🎯 Extracting from: ${TARGET_URL}`);

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-web-security'] // Allow cross-origin requests
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      'Referer': 'https://peachify.top/'
    }
  });

  const page = await context.newPage();
  
  // 🔍 Intercept network requests to capture video URLs
  const videoUrls = [];
  
  await page.route('**/*', (route) => {
    const url = route.request().url();
    
    // Capture any requests to worker/proxy URLs or video streams
    if (url.includes('workers.dev') || 
        url.includes('.m3u8') || 
        url.includes('.mp4') ||
        url.includes('tripplestream.online')) {
      console.log(`📡 Captured: ${url.substring(0, 100)}...`);
      videoUrls.push({
        url: url,
        timestamp: new Date().toISOString(),
        type: route.request().resourceType()
      });
    }
    route.continue();
  });

  try {
    // Navigate to the page
    console.log(`🌐 Loading page...`);
    await page.goto(TARGET_URL, { 
      timeout: 60000, 
      waitUntil: 'networkidle' 
    });

    // Wait for video player to load
    console.log(`⏳ Waiting for video sources to load...`);
    
    // Method 1: Wait for specific elements (adjust selectors as needed)
    await page.waitForSelector('video, .video-player, [data-video], iframe', { 
      timeout: 30000 
    }).catch(() => console.log('⏱️ No video element found, continuing...'));

    // Wait additional time for dynamic content
    await page.waitForTimeout(8000);

    // Method 2: Extract from page
    const pageData = await page.evaluate(() => {
      const videos = [];
      const html = document.documentElement.innerHTML;
      
      // Find all proxy/worker URLs
      const workerMatches = html.match(/https?:\/\/[^\s"'<>]+\.workers\.dev[^\s"'<>]*/g);
      if (workerMatches) {
        workerMatches.forEach(url => videos.push({ 
          type: 'proxy_worker', 
          url: decodeURIComponent(url) 
        }));
      }
      
      // Find m3u8 streams
      const m3u8Matches = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
      if (m3u8Matches) {
        m3u8Matches.forEach(url => videos.push({ 
          type: 'm3u8', 
          url: decodeURIComponent(url) 
        }));
      }
      
      // Find mp4 streams
      const mp4Matches = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (mp4Matches) {
        mp4Matches.forEach(url => videos.push({ 
          type: 'mp4', 
          url: decodeURIComponent(url) 
        }));
      }
      
      // Check script tags
      document.querySelectorAll('script').forEach(script => {
        const content = script.textContent;
        const matches = content.match(/(?:src|url|file|source|video|stream|proxy)[\s]*[:=][\s]*["']([^"']+\.(?:m3u8|mp4|workers\.dev)[^"']*)["']/gi);
        if (matches) {
          matches.forEach(match => {
            const urlMatch = match.match(/["']([^"']+)["']/);
            if (urlMatch) videos.push({ 
              type: 'script', 
              url: decodeURIComponent(urlMatch[1]) 
            });
          });
        }
      });
      
      return videos;
    });

    // Combine network captures + page data
    const allUrls = [...videoUrls, ...pageData];
    
    // Remove duplicates
    const uniqueUrls = [];
    const seen = new Set();
    allUrls.forEach(item => {
      const key = item.url;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueUrls.push(item);
      }
    });

    console.log(`\n🔍 Found ${uniqueUrls.length} unique video-related URLs`);

    // Filter to find the actual video stream
    const videoStreams = uniqueUrls.filter(item => 
      item.url.includes('workers.dev') || 
      item.url.includes('.m3u8') || 
      item.url.includes('.mp4') ||
      item.url.includes('tripplestream.online')
    );

    // Save results
    const results = {
      created_at: new Date().toISOString(),
      target_url: TARGET_URL,
      total_captured: uniqueUrls.length,
      video_streams: videoStreams.map(v => ({
        type: v.type || 'network',
        url: v.url,
        timestamp: v.timestamp || new Date().toISOString()
      })),
      all_urls: uniqueUrls.map(v => v.url)
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

    // Display results
    if (videoStreams.length > 0) {
      console.log(`\n✅ Found ${videoStreams.length} video streams:`);
      videoStreams.forEach((v, i) => {
        console.log(`  ${i+1}. ${v.url.substring(0, 120)}...`);
      });
      
      // Show the most likely stream URL
      const proxyStream = videoStreams.find(v => v.url.includes('workers.dev'));
      if (proxyStream) {
        console.log(`\n🎬 PROXY STREAM URL:`);
        console.log(proxyStream.url);
      }
    } else {
      console.log('❌ No video streams found');
    }

    console.log(`\n💾 Data saved to ${OUTPUT}`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
})();
