import { chromium, Browser, Page } from "playwright";

interface BrowserSession {
  browser: Browser;
  page: Page;
  lastUsed: number;
}

const sessions = new Map<string, BrowserSession>();
const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || "5", 10);
const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT_MS || "300000", 10); // 5 minutes
const ACTION_TIMEOUT = 30000; // 30 seconds

// Cleanup idle sessions every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [instanceId, session] of sessions) {
    if (now - session.lastUsed > IDLE_TIMEOUT) {
      console.log(`Cleaning up idle browser for instance ${instanceId}`);
      session.browser.close().catch(() => {});
      sessions.delete(instanceId);
    }
  }
}, 60000);

async function getOrCreateSession(instanceId: string): Promise<BrowserSession> {
  const existing = sessions.get(instanceId);
  if (existing) {
    // Check if browser is still alive
    try {
      if (existing.browser.isConnected()) {
        existing.lastUsed = Date.now();
        return existing;
      }
    } catch {}
    // Browser died, clean up
    sessions.delete(instanceId);
  }

  // Check max concurrent browsers
  if (sessions.size >= MAX_BROWSERS) {
    // Evict oldest session
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastUsed < oldestTime) {
        oldestTime = s.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) {
      console.log(`Evicting oldest browser session: ${oldestId}`);
      const old = sessions.get(oldestId);
      await old?.browser.close().catch(() => {});
      sessions.delete(oldestId);
    }
  }

  // Launch new browser process (separate OS process for isolation)
  const browser = await chromium.launch({
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-http2",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  // Hide webdriver flag from navigator
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();
  const session: BrowserSession = { browser, page, lastUsed: Date.now() };
  sessions.set(instanceId, session);
  console.log(`Launched new browser for instance ${instanceId} (${sessions.size} active)`);
  return session;
}

const MAX_CONTENT_LENGTH = 50000;

function truncate(text: string): string {
  if (text.length <= MAX_CONTENT_LENGTH) return text;
  return text.slice(0, MAX_CONTENT_LENGTH) + "\n...(truncated)";
}

export async function navigate(
  instanceId: string,
  url: string
): Promise<{ title: string; url: string; content: string }> {
  const session = await getOrCreateSession(instanceId);
  await session.page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: ACTION_TIMEOUT,
  });
  // Wait a bit for dynamic content
  await session.page.waitForTimeout(1000);

  const title = await session.page.title();
  const content = await session.page.innerText("body").catch(() => "");

  return { title, url: session.page.url(), content: truncate(content) };
}

export async function click(
  instanceId: string,
  selector: string
): Promise<{ success: boolean; url: string; title: string }> {
  const session = await getOrCreateSession(instanceId);

  // Try CSS selector first, then text-based
  try {
    await session.page.click(selector, { timeout: ACTION_TIMEOUT });
  } catch {
    // Fall back to text matching
    await session.page.getByText(selector, { exact: false }).first().click({
      timeout: ACTION_TIMEOUT,
    });
  }

  // Wait for navigation or content change
  await session.page.waitForTimeout(1500);

  const title = await session.page.title();
  return { success: true, url: session.page.url(), title };
}

export async function type(
  instanceId: string,
  selector: string,
  text: string
): Promise<{ success: boolean }> {
  const session = await getOrCreateSession(instanceId);

  try {
    await session.page.fill(selector, text, { timeout: ACTION_TIMEOUT });
  } catch {
    // Fall back to label/placeholder matching
    await session.page
      .getByPlaceholder(selector)
      .or(session.page.getByLabel(selector))
      .first()
      .fill(text, { timeout: ACTION_TIMEOUT });
  }

  return { success: true };
}

export async function screenshot(
  instanceId: string
): Promise<{ title: string; url: string; elements: any[]; screenshot: string }> {
  const session = await getOrCreateSession(instanceId);

  const title = await session.page.title();
  const url = session.page.url();

  // Capture visual screenshot as base64 PNG
  const screenshotBuffer = await session.page.screenshot({ type: "png", fullPage: false });
  const screenshotBase64 = screenshotBuffer.toString("base64");

  // Extract visible interactive elements
  const elements = await session.page.evaluate(() => {
    const result: {
      tag: string;
      type?: string;
      text: string;
      selector: string;
      placeholder?: string;
      href?: string;
      value?: string;
    }[] = [];

    const interactiveSelectors = "a, button, input, select, textarea, [role='button'], [onclick]";
    const els = document.querySelectorAll(interactiveSelectors);

    els.forEach((el, i) => {
      const htmlEl = el as HTMLElement;
      // Skip hidden elements
      if (htmlEl.offsetParent === null && htmlEl.style.position !== "fixed") return;

      const tag = el.tagName.toLowerCase();
      const text = (htmlEl.innerText || htmlEl.getAttribute("aria-label") || "").trim().slice(0, 100);
      const type = el.getAttribute("type") || undefined;
      const placeholder = el.getAttribute("placeholder") || undefined;
      const href = el.getAttribute("href") || undefined;
      const value = (el as HTMLInputElement).value || undefined;

      // Build a useful selector
      let selector = "";
      if (el.id) {
        selector = `#${el.id}`;
      } else if (el.getAttribute("name")) {
        selector = `${tag}[name="${el.getAttribute("name")}"]`;
      } else if (placeholder) {
        selector = `${tag}[placeholder="${placeholder}"]`;
      } else if (text) {
        selector = `text="${text.slice(0, 50)}"`;
      } else {
        selector = `${tag}:nth-of-type(${i + 1})`;
      }

      result.push({
        tag,
        ...(type && { type }),
        text: text || "(no text)",
        selector,
        ...(placeholder && { placeholder }),
        ...(href && { href: href.slice(0, 200) }),
        ...(value && { value: value.slice(0, 100) }),
      });
    });

    return result.slice(0, 50); // Limit to 50 elements
  });

  return { title, url, elements, screenshot: screenshotBase64 };
}

export async function getContent(
  instanceId: string
): Promise<{ title: string; url: string; content: string }> {
  const session = await getOrCreateSession(instanceId);
  const title = await session.page.title();
  const content = await session.page.innerText("body").catch(() => "");
  return { title, url: session.page.url(), content: truncate(content) };
}

export async function closeBrowser(
  instanceId: string
): Promise<{ success: boolean }> {
  const session = sessions.get(instanceId);
  if (session) {
    await session.browser.close().catch(() => {});
    sessions.delete(instanceId);
    console.log(`Browser closed for instance ${instanceId}`);
  }
  return { success: true };
}

export function getActiveCount(): number {
  return sessions.size;
}
