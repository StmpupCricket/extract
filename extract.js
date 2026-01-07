import { chromium } from "playwright";
import fs from "fs";

const SOURCE_JSON =
  "https://raw.githubusercontent.com/cricstreamz745/Hit-Maal/refs/heads/main/hitmall.json";

const OUTPUT = "m3u8.json";
const MAX_WORKERS = 8;
const WAIT_TIME = 3500;

// Load existing progress
let DONE = {};
if (fs.existsSync(OUTPUT)) {
  DONE = JSON.parse(fs.readFileSync(OUTPUT)).map || {};
}

(async () => {
  const data = await (await fetch(SOURCE_JSON)).json();
  const episodes = data.episodes.filter(e => !DONE[e.link]);

  console.log(`🎯 Pending: ${episodes.length}`);

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext();

  // 🚫 Block heavy assets
  await context.route("**/*", route => {
    const type = route.request().resourceType();
    if (["image", "font", "stylesheet"].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  let index = 0;
  const results = DONE;

  async function worker(id) {
    const page = await context.newPage();

    while (index < episodes.length) {
      const ep = episodes[index++];
      console.log(`👷 Worker ${id} → ${ep.title}`);

      try {
        await page.goto(ep.link, { timeout: 30000 });
        await page.waitForTimeout(WAIT_TIME);

        const stream = await page.evaluate(() => {
          const text = document.documentElement.innerHTML;
          return (
            text.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/)?.[0] ||
            text.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/)?.[0] ||
            document.querySelector("video")?.src ||
            null
          );
        });

        if (stream) {
          results[ep.link] = {
            title: ep.title,
            upload_time: ep.upload_time,
            duration: ep.duration,
            page_url: ep.link,
            stream_type: stream.includes(".m3u8") ? "m3u8" : "mp4",
            stream_url: stream
          };

          fs.writeFileSync(
            OUTPUT,
            JSON.stringify(
              {
                updated: new Date().toISOString(),
                total: Object.keys(results).length,
                map: results
              },
              null,
              2
            )
          );

          console.log(`✅ Found (${id})`);
        } else {
          console.log(`❌ No stream`);
        }
      } catch (e) {
        console.log(`⚠️ Error on ${ep.title}`);
      }
    }

    await page.close();
  }

  // 🔥 Run workers
  await Promise.all(
    Array.from({ length: MAX_WORKERS }, (_, i) => worker(i + 1))
  );

  await browser.close();
  console.log("🎉 ALL DONE");
})();
