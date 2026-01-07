import { chromium } from "playwright";
import fs from "fs";

const SOURCE_JSON =
  "https://raw.githubusercontent.com/cricstreamz745/Hit-Maal/refs/heads/main/hitmall.json";

const OUTPUT_FILE = "m3u8.json";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const data = await (await fetch(SOURCE_JSON)).json();
  const episodes = data.episodes;

  const results = [];

  for (const ep of episodes.slice(0, 50)) {
    console.log("🔎 Opening:", ep.title);

    try {
      await page.goto(ep.link, { timeout: 60000 });
      await page.waitForTimeout(5000);

      const stream = await page.evaluate(() => {
        const scripts = [...document.scripts].map(s => s.innerHTML).join("\n");

        const m3u8 =
          scripts.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/)?.[0] || null;

        const mp4 =
          scripts.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/)?.[0] || null;

        const videoTag =
          document.querySelector("video")?.src || null;

        return m3u8 || mp4 || videoTag;
      });

      if (stream) {
        results.push({
          title: ep.title,
          upload_time: ep.upload_time,
          duration: ep.duration,
          page_url: ep.link,
          stream_type: stream.includes(".m3u8") ? "m3u8" : "mp4",
          stream_url: stream
        });

        console.log("✅ Found:", stream);
      } else {
        console.log("❌ No stream found");
      }
    } catch (err) {
      console.log("⚠️ Error:", ep.title);
    }
  }

  await browser.close();

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        total: results.length,
        videos: results
      },
      null,
      2
    )
  );

  console.log(`🎉 Done → ${OUTPUT_FILE}`);
})();
