import express from "express";
import { navigate, click, type, screenshot, getContent, closeBrowser, getActiveCount } from "./browser-manager";
import { validateUrl, checkRateLimit } from "./security";

const app = express();
const PORT = parseInt(process.env.PORT || "3600", 10);
const BROWSER_SERVICE_SECRET = process.env.BROWSER_SERVICE_SECRET || "";

app.use(express.json());

// Auth middleware
app.use("/browser", (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${BROWSER_SERVICE_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", activeBrowsers: getActiveCount() });
});

// Browser actions
app.post("/browser/:instanceId/:action", async (req, res) => {
  const { instanceId, action } = req.params;

  // Rate limit
  const rateCheck = checkRateLimit(instanceId);
  if (!rateCheck.allowed) {
    res.status(429).json({ error: rateCheck.error });
    return;
  }

  try {
    switch (action) {
      case "navigate": {
        const { url } = req.body;
        if (!url) {
          res.status(400).json({ error: "url is required" });
          return;
        }
        const urlCheck = validateUrl(url);
        if (!urlCheck.valid) {
          res.status(400).json({ error: urlCheck.error });
          return;
        }
        const result = await navigate(instanceId, url);
        res.json(result);
        break;
      }

      case "click": {
        const { selector } = req.body;
        if (!selector) {
          res.status(400).json({ error: "selector is required" });
          return;
        }
        const result = await click(instanceId, selector);
        res.json(result);
        break;
      }

      case "type": {
        const { selector, text } = req.body;
        if (!selector || text === undefined) {
          res.status(400).json({ error: "selector and text are required" });
          return;
        }
        const result = await type(instanceId, selector, text);
        res.json(result);
        break;
      }

      case "screenshot": {
        const result = await screenshot(instanceId);
        res.json(result);
        break;
      }

      case "get_content": {
        const result = await getContent(instanceId);
        res.json(result);
        break;
      }

      case "close": {
        const result = await closeBrowser(instanceId);
        res.json(result);
        break;
      }

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: unknown) {
    console.error(`Browser action error [${instanceId}/${action}]:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Browser service running on port ${PORT}`);
});
