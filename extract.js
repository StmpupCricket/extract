import { chromium } from "playwright";
import fs from "fs";

const TARGET_URL = "https://peachify.top/embed/movie/1081003?accent=7c5cff&dub=Hindi&quality=1080";
const OUTPUT_FILE = "m3u8.json";

(async () => {
  console.log(`\n🎯 Target: ${TARGET_URL}`);
  console.log(`⏰ Started: ${new Date().toISOString()}\n`);

  let browser;
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-accelerated-video-decode',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-extensions',
        '--disable-infobars',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--no-first-run',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-hang-monitor',
        '--disable-default-apps'
      ]
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
      },
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    
    // Store captured URLs
    const capturedUrls = [];
    let proxyUrl = null;
    let m3u8Url = null;
    
    // Intercept network requests
    await page.route('**/*', (route) => {
      const url = route.request().url();
      
      // Look for worker.dev and mp4-proxy URLs
      if (url.includes('workers.dev') && url.includes('mp4-proxy')) {
        console.log(`✅ PROXY URL FOUND:`);
        console.log(`📡 ${url}\n`);
        proxyUrl = url;
        capturedUrls.push({
          url: url,
          type: 'proxy',
          timestamp: new Date().toISOString()
        });
      }
      
      // Look for m3u8 URLs
      if (url.includes('.m3u8')) {
        console.log(`📡 M3U8: ${url.substring(0, 100)}...`);
        m3u8Url = url;
        capturedUrls.push({
          url: url,
          type: 'm3u8',
          timestamp: new Date().toISOString()
        });
      }
      
      // Look for mp4 URLs
      if (url.includes('.mp4')) {
        console.log(`📡 MP4: ${url.substring(0, 100)}...`);
        capturedUrls.push({
          url: url,
          type: 'mp4',
          timestamp: new Date().toISOString()
        });
      }
      
      route.continue();
    });

    console.log(`🌐 Loading page...`);
    await page.goto(TARGET_URL, { 
      timeout: 60000, 
      waitUntil: 'domcontentloaded' 
    });

    console.log(`⏳ Waiting for video to load...`);
    await page.waitForTimeout(5000);
    
    // Try to trigger video loading
    try {
      await page.click('video, .video-player, button[aria-label*="play"], .play-button, .vjs-big-play-button');
      console.log(`🎮 Clicked play button`);
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log(`ℹ️ No play button found`);
    }

    // Scroll to load lazy content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    // Extract URLs from page source
    const pageData = await page.evaluate(() => {
      const urls = [];
      const html = document.documentElement.innerHTML;
      
      // Find worker.dev URLs
      const workerMatch = html.match(/https?:\/\/[a-zA-Z0-9-]+\.workers\.dev\/[^\s"'<>]*/g);
      if (workerMatch) {
        workerMatch.forEach(url => urls.push({ url, source: 'page' }));
      }
      
      // Find mp4-proxy URLs
      const proxyMatch = html.match(/https?:\/\/[a-zA-Z0-9-]+\.workers\.dev\/mp4-proxy[^\s"'<>]*/g);
      if (proxyMatch) {
        proxyMatch.forEach(url => urls.push({ url, source: 'page' }));
      }
      
      // Find m3u8 URLs
      const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
      if (m3u8Match) {
        m3u8Match.forEach(url => urls.push({ url, source: 'page' }));
      }
      
      // Find any video URLs
      const videoMatch = html.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|ts|m4s)[^\s"'<>]*/g);
      if (videoMatch) {
        videoMatch.forEach(url => urls.push({ url, source: 'page' }));
      }
      
      return urls;
    });

    // Add page data to captured URLs
    pageData.forEach(item => {
      if (!capturedUrls.some(c => c.url === item.url)) {
        capturedUrls.push({
          url: item.url,
          type: 'page_source',
          timestamp: new Date().toISOString()
        });
      }
    });

    await page.waitForTimeout(3000);

    // Save results
    const results = {
      created_at: new Date().toISOString(),
      target_url: TARGET_URL,
      proxy_url: proxyUrl,
      m3u8_url: m3u8Url,
      total_captured: capturedUrls.length,
      all_urls: capturedUrls
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

    // Save proxy URL separately
    if (proxyUrl) {
      fs.writeFileSync('proxy-url.txt', proxyUrl);
      console.log(`💾 Proxy URL saved to: proxy-url.txt`);
    }

    if (m3u8Url) {
      fs.writeFileSync('m3u8-url.txt', m3u8Url);
      console.log(`💾 M3U8 URL saved to: m3u8-url.txt`);
    }

    // Display summary
    console.log(`\n📊 Summary:`);
    console.log(`   Total URLs captured: ${capturedUrls.length}`);
    console.log(`   Proxy URL: ${proxyUrl ? '✅ Found' : '❌ Not found'}`);
    console.log(`   M3U8 URL: ${m3u8Url ? '✅ Found' : '❌ Not found'}`);

    if (proxyUrl) {
      console.log(`\n🎬 PROXY URL:`);
      console.log(`   ${proxyUrl}`);
    }

    console.log(`\n💾 Full data saved to: ${OUTPUT_FILE}`);
    console.log(`⏰ Finished: ${new Date().toISOString()}`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`🔒 Browser closed`);
    }
  }
})();
