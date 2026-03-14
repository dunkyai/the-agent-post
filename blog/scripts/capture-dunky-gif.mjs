import puppeteer from "puppeteer";
import { execSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, "dunky-gif.html");
const framesDir = resolve(__dirname, "../tmp-frames");
const outputGif = resolve(__dirname, "../public/dunky-bots.gif");

const FPS = 20;
const DURATION_S = 3; // capture 3 seconds (covers longest animation cycle)
const TOTAL_FRAMES = FPS * DURATION_S;

// Clean up and create frames directory
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

console.log("Launching browser...");
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 700, height: 400 });
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });

console.log(`Capturing ${TOTAL_FRAMES} frames at ${FPS}fps...`);
for (let i = 0; i < TOTAL_FRAMES; i++) {
  const padded = String(i).padStart(4, "0");
  await page.screenshot({
    path: `${framesDir}/frame-${padded}.png`,
    type: "png",
  });
  // Wait for next frame interval
  await new Promise((r) => setTimeout(r, 1000 / FPS));
}

await browser.close();
console.log("Frames captured. Generating GIF with ffmpeg...");

execSync(
  `ffmpeg -y -framerate ${FPS} -i "${framesDir}/frame-%04d.png" -vf "fps=${FPS},scale=700:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" "${outputGif}"`,
  { stdio: "inherit" }
);

// Clean up frames
rmSync(framesDir, { recursive: true, force: true });
console.log(`Done! GIF saved to ${outputGif}`);
