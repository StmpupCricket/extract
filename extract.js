import { chromium } from "playwright";
import fs from "fs";

const SOURCE_JSON =
  "https://raw.githubusercontent.com/cricstreamz745/Hit-Maal/refs/heads/main/hitmall.json";

const OUTPUT = "m3u8.json";

/* 🔥 SPEED CONFIG */
const MAX_WORKERS = 8;
const WAIT_TIME = 3500;
const LIMIT = 200; // 👈 ONLY FETCH 200 VIDEOS

(async () => {
  const data = await (await fetch(SOURCE_JSON)).json();

  // ✅ TAKE ONLY FIRST 200
  const episodes = data.episodes.slice(0, LIMIT);

  console.log(`🎯 Fetching only ${episodes.length} videos`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // 🚫 Block heavy resources
  await context.route("**/*", route => {
    const type = route.request().resourceType();
    if (["image", "font", "stylesheet"].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  let index = 0;
  const results = [];

  async function worker(id) {
    const page = await context.newPage();

    while (index < episodes.length) {
      const ep = episodes[index++];
      console.log(`👷 Worker ${id} → ${ep.title}`);

      try {
        await page.goto(ep.link, { timeout: 30000 });
        await page.waitForTimeout(WAIT_TIME);

        const stream = await page.evaluate(() => {
          const html = document.documentElement.innerHTML;
          return (
            html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/)?.[0] ||
            html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/)?.[0] ||
            document.querySelector("video")?.src ||
            null
          );
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

          console.log(`✅ Found (${id})`);
        } else {
          console.log(`❌ No stream`);
        }
      } catch (e) {
        console.log(`⚠️ Error → ${ep.title}`);
      }
    }

    await page.close();
  }

  // 🔥 Run workers
  await Promise.all(
    Array.from({ length: MAX_WORKERS }, (_, i) => worker(i + 1))
  );

  await browser.close();

  // 💾 Save output
  fs.writeFileSync(
    OUTPUT,
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

  console.log(`🎉 DONE → ${results.length} videos saved`);
})();
