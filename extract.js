import { chromium } from "playwright";
import fs from "fs";

// 🔥 SINGLE URL TO EXTRACT
const TARGET_URL = "https://peachify.top/embed/movie/1081003?accent=7c5cff&dub=Hindi&quality=1080"; // 👈 CHANGE THIS
const OUTPUT = "m3u8.json";

(async () => {
  console.log(`🎯 Extracting from single URL: ${TARGET_URL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // 🚫 Block heavy resources for speed
  await context.route("**/*", route => {
    const type = route.request().resourceType();
    if (["image", "font", "stylesheet"].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  const page = await context.newPage();
  const results = [];

  try {
    console.log(`🌐 Navigating to page...`);
    await page.goto(TARGET_URL, { timeout: 60000, waitUntil: "networkidle" });
    
    // Wait for content to load
    await page.waitForTimeout(5000);
    
    // Get page title
    const pageTitle = await page.title();
    
    console.log(`📄 Page title: ${pageTitle}`);

    // 🔥 Extract video URLs using multiple methods
    const videoData = await page.evaluate(() => {
      const videos = [];
      
      // Method 1: Check all video elements
      document.querySelectorAll("video").forEach(video => {
        if (video.src) {
          videos.push({
            type: "video_element",
            url: video.src,
            element: "video"
          });
        }
      });
      
      // Method 2: Check source elements
      document.querySelectorAll("video source, source").forEach(source => {
        if (source.src) {
          videos.push({
            type: "source_element",
            url: source.src,
            element: "source"
          });
        }
      });
      
      // Method 3: Search full HTML for m3u8 URLs with query params
      const html = document.documentElement.innerHTML;
      const m3u8Matches = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
      if (m3u8Matches) {
        m3u8Matches.forEach(url => {
          videos.push({
            type: "m3u8_html",
            url: url,
            element: "html"
          });
        });
      }
      
      // Method 4: Search for mp4 URLs
      const mp4Matches = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (mp4Matches) {
        mp4Matches.forEach(url => {
          videos.push({
            type: "mp4_html",
            url: url,
            element: "html"
          });
        });
      }
      
      // Method 5: Check script tags for video URLs
      const scripts = Array.from(document.querySelectorAll("script"));
      scripts.forEach(script => {
        const content = script.textContent;
        // Look for URLs in JavaScript objects/strings
        const urlMatches = content.match(/(?:src|url|file|source|video|stream)[\s]*[:=][\s]*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi);
        if (urlMatches) {
          urlMatches.forEach(match => {
            const urlMatch = match.match(/["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/);
            if (urlMatch) {
              videos.push({
                type: "script",
                url: urlMatch[1],
                element: "script"
              });
            }
          });
        }
      });
      
      // Method 6: Check iframe src attributes
      document.querySelectorAll("iframe").forEach(iframe => {
        if (iframe.src && (iframe.src.includes(".m3u8") || iframe.src.includes(".mp4"))) {
          videos.push({
            type: "iframe",
            url: iframe.src,
            element: "iframe"
          });
        }
      });
      
      // Method 7: Check for data attributes
      document.querySelectorAll("[data-src], [data-video], [data-url]").forEach(el => {
        const attr = el.getAttribute("data-src") || el.getAttribute("data-video") || el.getAttribute("data-url");
        if (attr && (attr.includes(".m3u8") || attr.includes(".mp4"))) {
          videos.push({
            type: "data_attribute",
            url: attr,
            element: "data"
          });
        }
      });
      
      return videos;
    });

    // Remove duplicates (keep first occurrence)
    const uniqueVideos = [];
    const seenUrls = new Set();
    
    videoData.forEach(item => {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        uniqueVideos.push(item);
      }
    });

    // Process and save results
    if (uniqueVideos.length > 0) {
      console.log(`🎬 Found ${uniqueVideos.length} video streams:`);
      
      uniqueVideos.forEach((video, index) => {
        const cleanUrl = decodeURIComponent(video.url);
        const isM3U8 = cleanUrl.includes(".m3u8");
        const isMP4 = cleanUrl.includes(".mp4");
        
        console.log(`  ${index + 1}. [${video.type}] ${cleanUrl.substring(0, 100)}...`);
        
        results.push({
          found_at: new Date().toISOString(),
          page_url: TARGET_URL,
          page_title: pageTitle,
          source_type: video.type,
          stream_type: isM3U8 ? "m3u8" : isMP4 ? "mp4" : "unknown",
          stream_url: cleanUrl,
          full_url: video.url // Keep original
        });
      });
    } else {
      console.log("❌ No video streams found on this page");
    }

  } catch (error) {
    console.error(`❌ Error loading page: ${error.message}`);
  } finally {
    await page.close();
    await browser.close();
  }

  // 💾 Save output
  if (results.length > 0) {
    fs.writeFileSync(
      OUTPUT,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          target_url: TARGET_URL,
          total_found: results.length,
          videos: results
        },
        null,
        2
      )
    );
    console.log(`🎉 DONE → ${results.length} videos saved to ${OUTPUT}`);
  } else {
    console.log("💡 No videos found to save");
    // Create empty result file
    fs.writeFileSync(
      OUTPUT,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          target_url: TARGET_URL,
          total_found: 0,
          videos: [],
          message: "No video streams found on this page"
        },
        null,
        2
      )
    );
  }
})();
