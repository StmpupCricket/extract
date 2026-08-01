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
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        'Referer': 'https://peachify.top/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    
    const capturedUrls = [];
    let proxyUrl = null;
    let m3u8Url = null;
    
    // Intercept network requests
    await page.route('**/*', (route) => {
      const url = route.request().url();
      
      if (url.includes('workers.dev') && url.includes('mp4-proxy')) {
        console.log(`✅ PROXY URL FOUND:`);
        console.log(`📡 ${url}\n`);
        proxyUrl = url;
        capturedUrls.push({ url, type: 'proxy', timestamp: new Date().toISOString() });
      }
      
      if (url.includes('.m3u8')) {
        console.log(`📡 M3U8: ${url.substring(0, 100)}...`);
        m3u8Url = url;
        capturedUrls.push({ url, type: 'm3u8', timestamp: new Date().toISOString() });
      }
      
      if (url.includes('.mp4')) {
        console.log(`📡 MP4: ${url.substring(0, 100)}...`);
        capturedUrls.push({ url, type: 'mp4', timestamp: new Date().toISOString() });
      }
      
      route.continue();
    });

    console.log(`🌐 Loading page...`);
    await page.goto(TARGET_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });

    console.log(`⏳ Waiting for video to load...`);
    await page.waitForTimeout(5000);
    
    // Try to trigger video
    try {
      await page.click('video, .play-button, button[aria-label*="play"]');
      console.log(`🎮 Clicked play`);
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log(`ℹ️ No play button found`);
    }

    // Scroll to load content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    // Extract from page source
    const pageData = await page.evaluate(() => {
      const urls = [];
      const html = document.documentElement.innerHTML;
      
      const patterns = [
        /https?:\/\/[a-zA-Z0-9-]+\.workers\.dev\/[^\s"'<>]*/g,
        /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g,
        /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g
      ];
      
      patterns.forEach(pattern => {
        const matches = html.match(pattern);
        if (matches) {
          matches.forEach(url => urls.push(url));
        }
      });
      
      return urls;
    });

    // Add page data
    pageData.forEach(url => {
      if (!capturedUrls.some(c => c.url === url)) {
        capturedUrls.push({ url, type: 'page_source', timestamp: new Date().toISOString() });
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

    if (proxyUrl) {
      fs.writeFileSync('proxy-url.txt', proxyUrl);
      console.log(`💾 Proxy URL saved to: proxy-url.txt`);
    }

    if (m3u8Url) {
      fs.writeFileSync('m3u8-url.txt', m3u8Url);
      console.log(`💾 M3U8 URL saved to: m3u8-url.txt`);
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total URLs captured: ${capturedUrls.length}`);
    console.log(`   Proxy URL: ${proxyUrl ? '✅ Found' : '❌ Not found'}`);
    console.log(`   M3U8 URL: ${m3u8Url ? '✅ Found' : '❌ Not found'}`);

    if (proxyUrl) {
      console.log(`\n🎬 PROXY URL:\n   ${proxyUrl}`);
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
