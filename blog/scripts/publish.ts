/**
 * Full publish pipeline: deploy to Vercel, then sync new posts to Bluesky.
 *
 * Usage: npx tsx scripts/publish.ts
 */
import { execSync } from "child_process";

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function main() {
  console.log("=== Deploy to Vercel ===");
  run("npx vercel --prod --yes");

  console.log("\n=== Sync to Bluesky ===");
  run("npx tsx scripts/bluesky-sync.ts");

  console.log("\n=== Done ===");
}

main();
