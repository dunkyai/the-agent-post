let clamscan: any = null;
let initPromise: Promise<any> | null = null;
let available = false;

const CLAMD_HOST = process.env.CLAMD_HOST || "host.docker.internal";
const CLAMD_PORT = parseInt(process.env.CLAMD_PORT || "3310", 10);

async function getScanner(): Promise<any> {
  if (clamscan) return clamscan;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const NodeClam = require("clamscan");
      const scanner = await new NodeClam().init({
        clamdscan: {
          host: CLAMD_HOST,
          port: CLAMD_PORT,
          timeout: 30000,
        },
      });
      clamscan = scanner;
      available = true;
      console.log(`[antivirus] ClamAV connected (${CLAMD_HOST}:${CLAMD_PORT})`);
      return scanner;
    } catch (err) {
      console.warn("[antivirus] ClamAV not available — file scanning disabled:", err instanceof Error ? err.message : err);
      available = false;
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Scan a file buffer for viruses.
 * Returns { safe: true } if clean or ClamAV is unavailable.
 * Returns { safe: false, threat: string } if infected.
 */
export async function scanBuffer(buffer: Buffer, filename: string): Promise<{ safe: boolean; threat?: string }> {
  try {
    const scanner = await getScanner();
    if (!scanner) return { safe: true }; // ClamAV not available — fail open

    const { isInfected, viruses } = await scanner.scanBuffer(buffer);

    if (isInfected) {
      console.warn(`[antivirus] THREAT DETECTED in ${filename}: ${viruses.join(", ")}`);
      return { safe: false, threat: viruses.join(", ") };
    }

    return { safe: true };
  } catch (err) {
    console.error("[antivirus] Scan error:", err instanceof Error ? err.message : err);
    return { safe: true }; // Fail open on scan errors to not block uploads
  }
}

export function isAntivirusAvailable(): boolean {
  return available;
}
