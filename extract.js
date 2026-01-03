import { chromium } from "playwright";
import fs from "fs";

const TARGET_URL = process.env.TARGET_URL || "https://example.com";
const FOUND = new Set();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Network-level capture (MOST RELIABLE)
  page.on("request", req => {
    const url = req.url();
    if (url.includes(".m3u8")) {
      FOUND.add(url.split("?")[0]);
    }
  });

  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 60000 });

  // DOM injection (your bookmarklet logic simplified)
  await page.evaluate(() => {
    const scan = text => {
      const re = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
      return text?.match(re) || [];
    };

    document.querySelectorAll("script").forEach(s => {
      scan(s.textContent).forEach(u => console.log("DOM_M3U8", u));
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
})();
