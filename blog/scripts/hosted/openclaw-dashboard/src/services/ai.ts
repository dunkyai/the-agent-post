import {
  getSetting, setSetting, getIntegration, getOrCreateConversation, addMessage, getMessages,
  getConversationsByType, createScheduledJob, getAllScheduledJobs, getScheduledJob,
  deleteScheduledJob, addMemory, getAllMemories, deleteMemory, getMemory, findDuplicateMemory, getMonthlyTaskCount,
} from "./db";
import { decrypt } from "./encryption";
import { getNextRun, isValidCron, describeCron } from "./cron";
import {
  isGoogleRunning, getConnectedServices, getGoogleAccounts,
  gmailSearch, gmailReadMessage, gmailGetAttachment, gmailSend, gmailCreateDraft, gmailAddLabel, gmailGetSendAsAliases,
  calendarListEvents, calendarCreateEvent, calendarUpdateEvent,
  driveSearch, driveReadFile, extractDriveFileId,
  contactsSearch,
  docsCreate, docsRead, docsAppend, docsInsert, docsSuggestEdit, docsFormatText, docsParagraphStyle, docsCreateList, docsInsertImage, docsReplaceText,
  sheetsCreate, sheetsRead, sheetsWrite, sheetsAppend, sheetsListSheets,
} from "./google";
import { sendSlackMessage, isSlackRunning, getChannelMembers } from "./slack";
import { sendEmailMessage, isEmailRunning, checkInbox } from "./email";
import {
  isSupabaseRunning, getSupabaseProjectUrl, getSupabasePermissions,
  supabaseListTables, supabaseDescribeTable, supabaseQuery, supabaseInsert, supabaseUpdate,
} from "./supabase";
import {
  isAirtableRunning,
  airtableListBases, airtableListTables, airtableListRecords, airtableCreateRecords, airtableUpdateRecords,
} from "./airtable";
import {
  isNotionRunning, getNotionWorkspaceName,
  notionSearch, notionGetPage, notionGetPageContent, notionCreatePage, notionUpdatePage,
  notionQueryDatabase, notionGetDatabase,
} from "./notion";
import {
  isBufferRunning, getBufferOrgName, getSelectedChannels,
  bufferListChannels, bufferCreatePost, bufferListPosts, bufferDeletePost,
} from "./buffer";
import {
  isLumaRunning, getLumaUserName,
  lumaListEvents, lumaGetEvent, lumaCreateEvent, lumaUpdateEvent,
  lumaGetGuests, lumaAddGuests, lumaSendInvites,
} from "./luma";
import {
  isTwitterRunning, getTwitterUsername,
  twitterGetMe, twitterPostTweet, twitterPostThread, twitterGetRecentTweets, twitterDeleteTweet, twitterLookupTweet, twitterRetweet, twitterUndoRetweet,
} from "./twitter";
import {
  isBeehiivRunning, getBeehiivPublicationName,
  beehiivListTemplates, beehiivCreateDraft, beehiivListPosts, beehiivGetPost,
} from "./beehiiv";
import {
  isOneRunning, getOneConnections, getOneConnectionPlatforms, getConnectionKeyForPlatform,
  listConnections as oneListConnections, searchActions as oneSearchActions,
  getActionKnowledge as oneGetActionKnowledge, executeAction as oneExecuteAction,
} from "./one";

interface AIResponse {
  role: string;
  content: string;
}

export function getProvider(model: string): "anthropic" | "openai" {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  return "openai"; // default fallback
}

export function getApiKey(provider: "anthropic" | "openai"): string {
  const envKey = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const key = process.env[envKey];
  if (!key) {
    throw new Error(`No ${provider} API key configured. Contact support.`);
  }
  return key;
}

// --- Timezone conversion helper ---

/**
 * Convert a local datetime string (e.g. "2026-03-25T09:30:00") to UTC ISO string,
 * interpreting it in the given IANA timezone. Handles DST automatically.
 */
function localTimeToUtc(localDatetime: string, timezone: string): string {
  // Build a date string in the target timezone, then find the UTC equivalent
  // by comparing the local interpretation against UTC
  const naive = new Date(localDatetime); // parsed as local system time (not what we want)
  if (isNaN(naive.getTime())) return localDatetime; // unparseable, return as-is

  // Extract the date/time components from the input string
  const match = localDatetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return localDatetime;
  const [, year, month, day, hour, minute, second] = match;

  // Use Intl to find what UTC time corresponds to these local components
  // Strategy: start from a rough UTC guess, then adjust by the difference
  const roughUtc = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second || "00"}Z`);
  const localAtRough = new Date(roughUtc.toLocaleString("en-US", { timeZone: timezone }));
  const diffMs = roughUtc.getTime() - localAtRough.getTime();
  const corrected = new Date(roughUtc.getTime() + diffMs);

  // Verify: the corrected UTC time, when displayed in the target timezone, should match the input
  const verify = new Date(corrected.toLocaleString("en-US", { timeZone: timezone }));
  const verifyRough = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second || "00"}Z`);
  if (Math.abs(verify.getTime() - verifyRough.getTime()) > 60000) {
    // Edge case near DST transition — try one more correction
    const localAtCorrected = new Date(corrected.toLocaleString("en-US", { timeZone: timezone }));
    const diff2 = corrected.getTime() - localAtCorrected.getTime();
    const target = new Date(verifyRough.getTime() + diff2);
    return target.toISOString();
  }

  return corrected.toISOString();
}

// --- Scheduling Tools ---

const SCHEDULING_TOOLS = [
  {
    name: "create_scheduled_job",
    description: "Create a new scheduled job. Use this when the user asks to be reminded of something, schedule a task, or set up periodic actions. IMPORTANT: Before creating a job, you MUST ask the user where they want the results delivered (e.g. Slack channel, Gmail, email). Do NOT default to dashboard — results shown in the dashboard chat are unreliable. Only create the job once the user has confirmed a delivery channel. For one-time tasks (e.g. 'post a tweet tomorrow at 9am', 'send an email on Friday'), set run_once to true — the job will auto-disable after running once. For recurring tasks (e.g. 'every Monday', 'daily at 9am'), leave run_once as false.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "A short descriptive name for the job" },
        schedule: { type: "string", description: "A 5-field cron expression. Fields: minute hour day-of-month month day-of-week. Examples: '0 9 * * 1' (every Monday 9am), '*/30 * * * *' (every 30 min), '0 0 * * *' (daily midnight). IMPORTANT: For a specific date, use '*' for day-of-week — e.g. '30 9 28 3 *' (March 28 at 9:30am). Never combine a specific day-of-month with a specific day-of-week — the date may not fall on that weekday, causing the job to fail." },
        prompt: { type: "string", description: "The prompt/instruction sent to the AI when the job fires" },
        target_source: { type: "string", enum: ["slack", "email"], description: "Where to deliver results. Must be one of: slack, email." },
        target_external_id: { type: "string", description: "The delivery target ID. For Slack: must be a real Slack channel ID (C...), DM ID (D...), or user ID (U...) — e.g. C01HCS46FPB or U07FQCAACN8. NEVER use placeholder values like 'scheduler' or 'dashboard'. If you don't know the ID, ask the user. For email: recipient email address." },
        run_once: { type: "boolean", description: "Default: true (one-time). Set to false ONLY when the user explicitly asks for a recurring schedule (e.g. 'every Monday', 'daily', 'weekly'). If the user says a specific day like 'Friday' or 'tomorrow', that means once — not every Friday." },
      },
      required: ["name", "schedule", "prompt", "target_source", "target_external_id"],
    },
  },
  {
    name: "list_scheduled_jobs",
    description: "List all currently scheduled jobs. Use when the user asks what's scheduled or what reminders are set.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "delete_scheduled_job",
    description: "Delete a scheduled job by its ID. Use when the user asks to cancel a reminder or remove a scheduled task.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "number", description: "The ID of the job to delete" },
      },
      required: ["job_id"],
    },
  },
];

// --- Code Execution Tools ---

const CODE_EXECUTION_TOOLS = [
  {
    name: "run_command",
    description: "Execute a shell command in a sandboxed environment. Use this to run code, install packages, process data, or perform computations. The sandbox has Node.js 22, Python 3, bash, curl, jq, and git available. Network access is disabled. Files persist in /workspace across calls within the same conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The shell command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the sandbox workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to /workspace" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the sandbox workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to /workspace" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
];

// --- PDF Tools ---

const PDF_TOOLS = [
  {
    name: "pdf_get_fields",
    description: "List all fillable form fields in a PDF file. Returns field names, types, and current values. Use this first to inspect a PDF form before filling it.",
    input_schema: {
      type: "object" as const,
      properties: {
        file: { type: "string", description: "Path to the PDF file in /workspace (e.g. /workspace/form.pdf)" },
      },
      required: ["file"],
    },
  },
  {
    name: "pdf_fill_form",
    description: "Fill out a PDF form by providing field names and values as a JSON object. The filled PDF is saved to an output path. Use pdf_get_fields first to discover the field names.",
    input_schema: {
      type: "object" as const,
      properties: {
        file: { type: "string", description: "Path to the PDF form template in /workspace" },
        output: { type: "string", description: "Output path for the filled PDF (e.g. /workspace/filled.pdf)" },
        fields: {
          type: "object" as const,
          description: "JSON object mapping field names to values (e.g. {\"name\": \"John\", \"date\": \"2026-03-18\", \"agree\": true})",
        },
        flatten: { type: "boolean", description: "If true, flatten the form after filling (makes fields non-editable). Default: false." },
      },
      required: ["file", "output", "fields"],
    },
  },
  {
    name: "pdf_read_text",
    description: "Extract all text from a PDF file. Useful for reading and understanding PDF content. Returns the text content of each page.",
    input_schema: {
      type: "object" as const,
      properties: {
        file: { type: "string", description: "Path to the PDF file in /workspace" },
      },
      required: ["file"],
    },
  },
];

async function executePdfTool(toolName: string, input: any): Promise<string> {
  const provisioningUrl = process.env.PROVISIONING_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;

  if (!provisioningUrl || !instanceId || !gatewayToken) {
    return JSON.stringify({ error: "Code execution not configured on this instance" });
  }

  const install = "pip3 install -q PyPDFForm pypdf 2>/dev/null";
  let script: string;

  switch (toolName) {
    case "pdf_get_fields": {
      script = [
        "from PyPDFForm import PdfWrapper",
        `pdf = PdfWrapper("${input.file}")`,
        "fields = {}",
        "for name, field in (pdf.schema or {}).items():",
        "    fields[name] = {'type': field.get('type', 'unknown'), 'value': field.get('value', '')}",
        "import json; print(json.dumps(fields, indent=2))",
      ].join("\n");
      break;
    }
    case "pdf_fill_form": {
      const fieldsJson = JSON.stringify(input.fields).replace(/'/g, "\\'");
      const flatten = input.flatten ? "True" : "False";
      script = [
        "from PyPDFForm import PdfWrapper",
        "import json",
        `pdf = PdfWrapper("${input.file}")`,
        `fields = json.loads('${fieldsJson}')`,
        "filled = pdf.fill(fields)",
        ...(input.flatten ? ["filled = filled.flatten()"] : []),
        `with open("${input.output}", "wb") as f:`,
        "    f.write(filled.read())",
        `print(json.dumps({"success": True, "output": "${input.output}", "fields_filled": len(fields), "flattened": ${flatten}}))`,
      ].join("\n");
      break;
    }
    case "pdf_read_text": {
      script = [
        "from pypdf import PdfReader",
        "import json",
        `reader = PdfReader("${input.file}")`,
        "pages = []",
        "for i, page in enumerate(reader.pages):",
        "    pages.append({'page': i + 1, 'text': page.extract_text() or ''})",
        "print(json.dumps(pages, indent=2))",
      ].join("\n");
      break;
    }
    default:
      return JSON.stringify({ error: `Unknown PDF tool: ${toolName}` });
  }

  const command = `${install} && python3 -c "${script.replace(/"/g, '\\"')}"`;

  try {
    const res = await fetch(`${provisioningUrl}/instances/${instanceId}/sandbox/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({ command }),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: data.error || `Sandbox error (${res.status})` });
    }

    return JSON.stringify(await res.json());
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "PDF tool execution failed" });
  }
}

async function executeCodeTool(toolName: string, input: any): Promise<string> {
  const provisioningUrl = process.env.PROVISIONING_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;

  if (!provisioningUrl || !instanceId || !gatewayToken) {
    return JSON.stringify({ error: "Code execution not configured on this instance" });
  }

  try {
    let body: any;

    switch (toolName) {
      case "run_command":
        body = { command: input.command };
        break;
      case "read_file":
        body = { action: "read_file", path: input.path };
        break;
      case "write_file":
        body = { action: "write_file", path: input.path, content: input.content };
        break;
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }

    const res = await fetch(`${provisioningUrl}/instances/${instanceId}/sandbox/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: data.error || `Sandbox error (${res.status})` });
    }

    return JSON.stringify(await res.json());
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Sandbox execution failed" });
  }
}

// --- Browser Automation Tools ---

const BROWSER_TOOLS = [
  {
    name: "browse_webpage",
    description: "Navigate to a specific URL and get the page content. Use this to visit a known website URL, read articles, or start interacting with a web page. Do NOT use this to visit Google, Bing, Amazon, or other major sites that block bots — use web_search instead. Returns the page title, URL, and text content.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to navigate to (must be http or https)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the current page. Use a CSS selector (e.g., '#submit-btn', 'button[type=\"submit\"]') or text content (e.g., 'Sign In', 'Next'). Use browser_screenshot first to see available elements.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: { type: "string", description: "CSS selector or visible text of the element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input field on the current page. Use a CSS selector (e.g., '#email', 'input[name=\"username\"]') or the field's placeholder/label text. Use browser_screenshot first to see available fields.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: { type: "string", description: "CSS selector, placeholder text, or label text of the input field" },
        text: { type: "string", description: "The text to type into the field" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page and get a list of all visible interactive elements with their selectors. The screenshot shows you exactly what the page looks like. Use this to understand the page layout and find elements before clicking or typing.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "browser_get_content",
    description: "Get the full text content of the current page. Use this after navigating or clicking to read the updated page content.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

const IMAGE_SEARCH_TOOLS = [
  {
    name: "find_image",
    description: "Search for an image by topic and return direct image URLs you can embed. Use this whenever the user asks to see a picture, photo, illustration, or image of something. Returns a list of image URLs — pick the best one and embed it in your response as ![description](url). Works for photos, illustrations, clipart, cartoons, logos, and more.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "What to search for (e.g. 'cartoon hippo', 'golden gate bridge photo', 'cute cat illustration')" },
        style: { type: "string", enum: ["any", "photo", "illustration", "clipart"], description: "Image style preference. Use 'illustration' or 'clipart' for cartoons/drawings, 'photo' for real photographs. Defaults to 'any'." },
      },
      required: ["query"],
    },
  },
];

async function executeFindImage(input: { query: string; style?: string }): Promise<string> {
  const provisioningUrl = process.env.PROVISIONING_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;
  const style = input.style || "any";
  const isIllustration = style === "illustration" || style === "clipart" ||
    /cartoon|illustration|clipart|drawing|animated|cute|mascot|icon|logo|vector/i.test(input.query);

  const allImages: { source: string; url: string }[] = [];

  // Strategy 1: Pixabay API (free, direct image URLs, excellent for illustrations/vectors/photos)
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (pixabayKey) {
    try {
      const imageType = isIllustration ? "illustration" : "all";
      const pixabayUrl = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(input.query)}&image_type=${imageType}&per_page=8&safesearch=true`;
      const pixRes = await fetch(pixabayUrl);
      if (pixRes.ok) {
        const pixData: any = await pixRes.json();
        for (const hit of (pixData.hits || [])) {
          // webformatURL is 640px wide, good for chat display
          if (hit.webformatURL) {
            allImages.push({ source: "Pixabay", url: hit.webformatURL });
          }
        }
      }
    } catch {}
  }

  // Strategy 2: Wikimedia Commons API (free, direct image URLs, good for both photos and illustrations)
  if (allImages.length < 3) try {
    const commonsApiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(input.query)}&gsrlimit=10&gsrnamespace=6&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=800&format=json&origin=*`;
    const commonsRes = await fetch(commonsApiUrl);
    if (commonsRes.ok) {
      const commonsData: any = await commonsRes.json();
      const pages = commonsData?.query?.pages || {};
      for (const page of Object.values(pages) as any[]) {
        const info = page.imageinfo?.[0];
        if (!info) continue;
        const mime = info.mime || "";
        if (!mime.startsWith("image/")) continue;
        // Use the thumbnail URL (800px wide) if available, else full URL
        const imgUrl = info.thumburl || info.url;
        if (imgUrl && !imgUrl.includes("/icon") && !imgUrl.includes("OOjs")) {
          allImages.push({ source: "Wikimedia Commons", url: imgUrl });
        }
      }
    }
  } catch {}

  // Strategy 3: Wikipedia article images (good for real-world topics)
  if (!isIllustration && allImages.length < 3) {
    try {
      const wikiApiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(input.query.replace(/ /g, '_'))}&prop=images&imlimit=10&format=json&origin=*`;
      const wikiRes = await fetch(wikiApiUrl);
      if (wikiRes.ok) {
        const wikiData: any = await wikiRes.json();
        const pages = wikiData?.query?.pages || {};
        const imageNames: string[] = [];
        for (const page of Object.values(pages) as any[]) {
          for (const img of (page.images || [])) {
            const name = img.title as string;
            if (name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name) && !/Commons-logo|Wiki.*logo|Flag_of|Edit-clear|Ambox/i.test(name)) {
              imageNames.push(name);
            }
          }
        }
        // Fetch actual URLs for the image names
        if (imageNames.length > 0) {
          const titles = imageNames.slice(0, 5).join("|");
          const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`;
          const infoRes = await fetch(infoUrl);
          if (infoRes.ok) {
            const infoData: any = await infoRes.json();
            const infoPages = infoData?.query?.pages || {};
            for (const p of Object.values(infoPages) as any[]) {
              const url = p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url;
              if (url) allImages.push({ source: "Wikipedia", url });
            }
          }
        }
      }
    } catch {}
  }

  // Strategy 4: Browse Wikipedia page directly via browser (fallback if API didn't find enough)
  if (allImages.length < 2 && provisioningUrl && instanceId && gatewayToken) {
    try {
      const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(input.query.replace(/ /g, '_'))}`;
      const res = await fetch(`${provisioningUrl}/instances/${instanceId}/browser/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayToken}` },
        body: JSON.stringify({ url: wikiUrl }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const images = (data.images || []).filter((u: string) =>
          u.includes("upload.wikimedia.org") && !u.includes("/icon") && !u.includes("OOjs") &&
          !u.includes("edit-ltr") && !u.includes("static/images") &&
          /\.(jpg|jpeg|png|gif|webp)/i.test(u)
        );
        for (const u of images.slice(0, 3)) {
          const fullRes = u.replace(/\/\d+px-/, '/800px-');
          allImages.push({ source: "Wikipedia (browser)", url: fullRes });
        }
      }
    } catch {}
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueImages = allImages.filter(img => {
    if (seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  });

  if (uniqueImages.length > 0) {
    return JSON.stringify({
      images: uniqueImages.slice(0, 8).map(img => ({ url: img.url, source: img.source })),
      hint: "Pick the best image and embed it as: ![description](url). If none of these match what the user wants, try a different query or tell them what you found.",
    });
  }

  // No results from any source
  return JSON.stringify({
    error: "No images found from Wikipedia or Wikimedia Commons.",
    suggestion: "Use web_search with a query like: \"" + input.query + " image\" site:wikimedia.org OR site:flickr.com OR site:publicdomainpictures.net — then look for direct image URLs in the results and embed them.",
    hint: "You can also try web_search for the topic and look for pages that contain direct image URLs (ending in .jpg, .png, .gif, .webp). Then embed the URL directly as ![description](url).",
  });
}

async function executeBrowserTool(toolName: string, input: any): Promise<string | any[]> {
  const provisioningUrl = process.env.PROVISIONING_URL;
  const instanceId = process.env.INSTANCE_ID;
  const gatewayToken = process.env.GATEWAY_TOKEN;

  if (!provisioningUrl || !instanceId || !gatewayToken) {
    return JSON.stringify({ error: "Browser automation not configured on this instance" });
  }

  try {
    // Block search engines and image search sites — force use of web_search instead
    if (toolName === "browse_webpage" && input.url) {
      const blockedPatterns = [
        "google.com", "bing.com", "yahoo.com", "duckduckgo.com",
        "images.google", "google.com/search", "google.com/sorry",
        "pixabay.com", "unsplash.com", "pexels.com", "shutterstock.com",
        "gettyimages.com", "istockphoto.com", "flickr.com/search",
      ];
      const url = input.url.toLowerCase();
      const blocked = blockedPatterns.find((p) => url.includes(p));
      if (blocked) {
        return JSON.stringify({
          error: `Cannot browse ${blocked} — this site blocks automated browsers. Use web_search to find information or image URLs instead. To show an image, find a direct image URL (e.g. from Wikipedia/Wikimedia Commons) and embed it in your response as ![description](https://example.com/image.jpg).`,
        });
      }
    }

    const actionMap: Record<string, string> = {
      browse_webpage: "navigate",
      browser_click: "click",
      browser_type: "type",
      browser_screenshot: "screenshot",
      browser_get_content: "get_content",
    };

    const action = actionMap[toolName];
    if (!action) {
      return JSON.stringify({ error: `Unknown browser tool: ${toolName}` });
    }

    const body: any = {};
    if (toolName === "browse_webpage") body.url = input.url;
    if (toolName === "browser_click") body.selector = input.selector;
    if (toolName === "browser_type") {
      body.selector = input.selector;
      body.text = input.text;
    }

    const res = await fetch(`${provisioningUrl}/instances/${instanceId}/browser/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const error = data.error || `Browser action failed (${res.status})`;
      // Detect bot-blocked or timeout errors on navigate
      if (toolName === "browse_webpage" && (error.includes("Timeout") || error.includes("ERR_HTTP2") || error.includes("ERR_CONNECTION") || error.includes("net::ERR_"))) {
        return JSON.stringify({
          error: `Could not access this website. The site likely blocks automated browsers (bot detection). This is common with major commercial sites like hotels, airlines, and banks. Try searching for the information using web_search instead, or try a different website that provides similar content.`,
          original_error: error,
        });
      }
      return JSON.stringify({ error });
    }

    const data: any = await res.json();

    // Detect CAPTCHAs and bot-blocking pages
    const captchaSignals = [
      "google.com/sorry",
      "Making sure you're not a bot",
      "BotStopper",
      "captcha",
      "CAPTCHA",
      "recaptcha",
      "hCaptcha",
      "challenge-platform",
      "Checking your browser",
      "Just a moment...",       // Cloudflare
      "Attention Required",     // Cloudflare
      "Access denied",          // Generic WAF
      "Please verify you are a human",
      "unusual traffic",
    ];
    const pageContent = JSON.stringify(data);
    const captchaMatch = captchaSignals.find((s) => pageContent.includes(s));
    if (captchaMatch) {
      return JSON.stringify({
        error: `This website is showing a CAPTCHA or bot detection challenge ("${captchaMatch}"). Automated browsers cannot solve CAPTCHAs. Abandon this site and try a different approach — use web_search to find the information, or try a different website.`,
        blocked_url: data.url || input.url || "",
      });
    }

    // For screenshots, return multipart content with the image + element descriptions
    if (toolName === "browser_screenshot" && data.screenshot) {
      const { screenshot: img, ...rest } = data;
      return [
        { type: "image", source: { type: "base64", media_type: "image/png", data: img } },
        { type: "text", text: JSON.stringify(rest) },
      ];
    }

    // For browse_webpage, highlight discovered image URLs so the AI can embed them
    if (toolName === "browse_webpage" && Array.isArray(data.images) && data.images.length > 0) {
      const imageList = data.images.map((url: string) => `  - ${url}`).join("\n");
      const hint = `\n\n--- Images found on this page ---\n${imageList}\n\nTo show an image to the user, embed it in your response using markdown: ![description](url)`;
      return JSON.stringify({ ...data, content: (data.content || "") + hint });
    }

    return JSON.stringify(data);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Browser action failed" });
  }
}

const MEMORY_TOOLS = [
  {
    name: "save_memory",
    description: "Save an important fact, preference, or piece of information to long-term memory. Use this proactively when the user shares something worth remembering (preferences, facts about themselves, decisions, important context). Also use when they explicitly say 'remember this'.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "The fact or information to remember. Be concise but specific." },
      },
      required: ["content"],
    },
  },
  {
    name: "list_memories",
    description: "List all saved memories. Use when the user asks what you remember about them.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "delete_memory",
    description: "Delete a memory by its ID. Use when the user asks to forget something or when information is outdated.",
    input_schema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "number", description: "The ID of the memory to delete" },
      },
      required: ["memory_id"],
    },
  },
];

const CONTEXT_TOOLS = [
  {
    name: "update_context",
    description: "Update one of the user's structured context fields. Use this during onboarding or when the user shares important context about their company, role, rules, or domain knowledge that should persist across all conversations.",
    input_schema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          enum: ["context_company", "context_user", "context_rules", "context_knowledge"],
          description: "Which context field to update: context_company (about their company), context_user (about them), context_rules (rules/guidelines), context_knowledge (key facts/domain knowledge)",
        },
        content: { type: "string", description: "The content to save to this context field. This replaces the previous value." },
      },
      required: ["field", "content"],
    },
  },
];

// --- Messaging Tools (cross-channel) ---

const SLACK_MESSAGING_TOOLS = [
  {
    name: "send_slack",
    description: "Send a message to a Slack channel or DM. Only use this to send messages to OTHER channels — do NOT use this to reply to the current conversation (just return your reply text instead). When replying in a thread, always include thread_ts.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", description: "The Slack channel ID to send to" },
        message: { type: "string", description: "The message text to send" },
        thread_ts: { type: "string", description: "Thread timestamp to reply in a thread. Include this to keep the conversation threaded." },
      },
      required: ["channel", "message"],
    },
  },
  {
    name: "slack_channel_members",
    description: "List the members of a Slack channel. Use when you need to see who is in a channel, find someone's name or user ID, or understand the audience.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", description: "The Slack channel ID" },
      },
      required: ["channel"],
    },
  },
];

const EMAIL_MESSAGING_TOOLS = [
  {
    name: "check_lobstermail",
    description: "Check your LobsterMail inbox for recent emails. Use when the user asks you to check email, see if anyone emailed, or review your inbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_results: { type: "number", description: "Max emails to return (default: 10)" },
      },
    },
  },
  {
    name: "send_lobstermail",
    description: "Send an email from your LobsterMail address. Only works with a Tier 1+ LobsterMail API key. If this fails, suggest using gmail_send or gmail_create_draft instead (requires Google integration).",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (plain text)" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

async function executeMessagingTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "send_slack":
        await sendSlackMessage(input.channel, input.message, input.thread_ts);
        return JSON.stringify({ success: true, channel: "slack", channel_id: input.channel });
      case "slack_channel_members":
        return await getChannelMembers(input.channel);
      case "check_lobstermail":
        return await checkInbox(input.max_results);
      case "send_lobstermail":
        await sendEmailMessage(input.to, input.subject, input.body);
        return JSON.stringify({ success: true, channel: "email", to: input.to });
      default:
        return JSON.stringify({ error: `Unknown messaging tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send message" });
  }
}

// --- Supabase Tools ---

const SUPABASE_READ_TOOLS = [
  {
    name: "supabase_list_tables",
    description: "List all tables in the connected Supabase database.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "supabase_describe_table",
    description: "Describe a Supabase table's columns by fetching a sample row. ALWAYS call this before querying a table you haven't seen yet, so you know the correct column names and types.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
      },
      required: ["table"],
    },
  },
  {
    name: "supabase_query",
    description: "Query records from a Supabase table. You MUST specify a 'select' with only the columns you need — never omit it. Call supabase_describe_table first to learn column names and types. PostgREST filter syntax: {\"name\": \"eq.John\"}, {\"name\": \"ilike.*john*\"}, {\"age\": \"gte.18\"}. For array columns: {\"tags\": \"cs.{value}\"} (contains), {\"tags\": \"ov.{a,b}\"} (overlaps/any of). NEVER use eq/ilike on array columns. If a query times out, the tool will automatically retry without filters — you should then filter the returned results yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
        select: { type: "string", description: "REQUIRED. Columns to return (comma-separated), e.g. 'id,name,email'. Only request columns you need." },
        filters: {
          type: "object",
          description: "PostgREST filters as key-value pairs. Keys are column names, values use operators like eq.value, neq.value, gt.value, gte.value, lt.value, lte.value, like.pattern, ilike.pattern, in.(a,b,c), is.null, is.true. For array columns use cs.{value} or ov.{a,b}.",
          additionalProperties: { type: "string" },
        },
        limit: { type: "number", description: "Max records to return (default: 50, max: 200)" },
      },
      required: ["table", "select"],
    },
  },
];

const SUPABASE_INSERT_TOOLS = [
  {
    name: "supabase_insert",
    description: "Insert one or more records into a Supabase table.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
        records: {
          type: "array",
          description: "Array of objects to insert. Each object's keys are column names.",
          items: { type: "object" },
        },
      },
      required: ["table", "records"],
    },
  },
];

const SUPABASE_UPDATE_TOOLS = [
  {
    name: "supabase_update",
    description: "Update records in a Supabase table matching the given filters.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Table name" },
        match: {
          type: "object",
          description: "PostgREST filters to match records to update, e.g. {\"id\": \"eq.5\"}",
          additionalProperties: { type: "string" },
        },
        data: {
          type: "object",
          description: "Fields to update with their new values",
        },
      },
      required: ["table", "match", "data"],
    },
  },
];

async function executeSupabaseTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "supabase_list_tables":
        return await supabaseListTables();
      case "supabase_describe_table":
        return await supabaseDescribeTable(input.table);
      case "supabase_query":
        return await supabaseQuery(input.table, input.select, input.filters, input.limit);
      case "supabase_insert":
        return await supabaseInsert(input.table, input.records);
      case "supabase_update":
        return await supabaseUpdate(input.table, input.match, input.data);
      default:
        return JSON.stringify({ error: `Unknown Supabase tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Supabase operation failed" });
  }
}

// --- Airtable Tools ---

const AIRTABLE_TOOLS = [
  {
    name: "airtable_list_bases",
    description: "List all Airtable bases (workspaces) you have access to.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "airtable_list_tables",
    description: "List all tables and their fields in a specific Airtable base.",
    input_schema: {
      type: "object" as const,
      properties: {
        base_id: { type: "string", description: "The Airtable base ID (starts with 'app')" },
      },
      required: ["base_id"],
    },
  },
  {
    name: "airtable_list_records",
    description: "List records from an Airtable table. Supports filtering, sorting, and pagination.",
    input_schema: {
      type: "object" as const,
      properties: {
        base_id: { type: "string", description: "The Airtable base ID" },
        table: { type: "string", description: "Table name or ID" },
        view: { type: "string", description: "View name or ID (optional)" },
        filter_by_formula: { type: "string", description: "Airtable formula to filter records, e.g. \"{Status} = 'Active'\"" },
        sort_field: { type: "string", description: "Field name to sort by" },
        sort_direction: { type: "string", description: "'asc' or 'desc'" },
        max_records: { type: "number", description: "Maximum records to return (default: 100)" },
      },
      required: ["base_id", "table"],
    },
  },
];

async function executeAirtableTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "airtable_list_bases":
        return await airtableListBases();
      case "airtable_list_tables":
        return await airtableListTables(input.base_id);
      case "airtable_list_records": {
        const sort = input.sort_field ? [{ field: input.sort_field, direction: input.sort_direction }] : undefined;
        return await airtableListRecords(input.base_id, input.table, {
          view: input.view,
          filterByFormula: input.filter_by_formula,
          sort,
          maxRecords: input.max_records,
        });
      }
      default:
        return JSON.stringify({ error: `Unknown Airtable tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Airtable operation failed" });
  }
}

// --- Notion Tools ---

const NOTION_TOOLS = [
  {
    name: "notion_search",
    description: "Search for pages and databases in the connected Notion workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query text" },
        filter_type: { type: "string", enum: ["page", "database"], description: "Filter results by type (optional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "notion_get_page",
    description: "Get a Notion page's properties (title, dates, status, etc).",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: { type: "string", description: "The Notion page ID" },
      },
      required: ["page_id"],
    },
  },
  {
    name: "notion_get_page_content",
    description: "Read the content blocks of a Notion page (paragraphs, headings, lists, etc).",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: { type: "string", description: "The Notion page ID" },
      },
      required: ["page_id"],
    },
  },
  {
    name: "notion_create_page",
    description: "Create a new page in Notion, either as a child of a database or another page.",
    input_schema: {
      type: "object" as const,
      properties: {
        parent_id: { type: "string", description: "The parent database or page ID" },
        parent_type: { type: "string", enum: ["database_id", "page_id"], description: "Whether the parent is a database or page" },
        title: { type: "string", description: "Title of the new page" },
        properties: { type: "object", description: "Page properties (for database parents, match the database schema)" },
      },
      required: ["parent_id", "parent_type", "title"],
    },
  },
  {
    name: "notion_update_page",
    description: "Update properties of an existing Notion page.",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: { type: "string", description: "The Notion page ID to update" },
        properties: { type: "object", description: "Properties to update (use Notion property format)" },
      },
      required: ["page_id", "properties"],
    },
  },
  {
    name: "notion_query_database",
    description: "Query a Notion database with optional filters and sorts.",
    input_schema: {
      type: "object" as const,
      properties: {
        database_id: { type: "string", description: "The Notion database ID" },
        filter: { type: "object", description: "Notion filter object (optional)" },
        sorts: { type: "array", description: "Array of sort objects, e.g. [{property: 'Name', direction: 'ascending'}]" },
        page_size: { type: "number", description: "Max results to return (default: 20)" },
      },
      required: ["database_id"],
    },
  },
  {
    name: "notion_get_database",
    description: "Get a Notion database's schema (properties and their types). Use this before querying to understand the structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        database_id: { type: "string", description: "The Notion database ID" },
      },
      required: ["database_id"],
    },
  },
];

async function executeNotionTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "notion_search": {
        const filter = input.filter_type ? { property: "object", value: input.filter_type } : undefined;
        return await notionSearch(input.query, filter);
      }
      case "notion_get_page":
        return await notionGetPage(input.page_id);
      case "notion_get_page_content":
        return await notionGetPageContent(input.page_id);
      case "notion_create_page":
        return await notionCreatePage(input.parent_id, input.parent_type, input.title, input.properties);
      case "notion_update_page":
        return await notionUpdatePage(input.page_id, input.properties);
      case "notion_query_database":
        return await notionQueryDatabase(input.database_id, input.filter, input.sorts, input.page_size);
      case "notion_get_database":
        return await notionGetDatabase(input.database_id);
      default:
        return JSON.stringify({ error: `Unknown Notion tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Notion operation failed" });
  }
}

// --- Buffer Tools ---

const BUFFER_TOOLS = [
  {
    name: "buffer_list_channels",
    description: "List all connected social media channels in Buffer. Returns the service (twitter, instagram, linkedin, facebook, tiktok, mastodon, threads, bluesky, etc.), display name, and channel type for each.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "buffer_create_post",
    description: "Create or schedule a social media post via Buffer. Use buffer_list_channels first to get channel IDs. Modes: 'add_to_queue' (default — adds to Buffer's queue), 'custom_scheduled' (requires due_at with an ISO 8601 datetime), 'share_now' (post immediately).",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Buffer channel ID to post to" },
        text: { type: "string", description: "The post text content" },
        mode: { type: "string", enum: ["add_to_queue", "custom_scheduled", "share_now"], description: "Posting mode (default: add_to_queue)" },
        due_at: { type: "string", description: "ISO 8601 datetime for when to publish. Pass the user's LOCAL time without a Z suffix (e.g. '2026-03-25T09:30:00' for 9:30 AM in the user's timezone) — the system will convert to UTC automatically. Required when mode is custom_scheduled." },
        image_url: { type: "string", description: "URL of an image to attach to the post" },
        link_url: { type: "string", description: "URL to attach as a link preview" },
      },
      required: ["channel_id", "text"],
    },
  },
  {
    name: "buffer_list_posts",
    description: "List posts from Buffer with optional status filter. Use to view scheduled, sent, or draft posts.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "array", items: { type: "string", enum: ["draft", "scheduled", "sent", "error"] }, description: "Filter by post status (default: all)" },
        channel_ids: { type: "array", items: { type: "string" }, description: "Filter by channel IDs" },
        limit: { type: "number", description: "Max posts to return (default: 20, max: 50)" },
      },
    },
  },
  {
    name: "buffer_delete_post",
    description: "Delete a post from Buffer by its post ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_id: { type: "string", description: "The Buffer post ID to delete" },
      },
      required: ["post_id"],
    },
  },
];

async function executeBufferTool(toolName: string, input: any): Promise<string> {
  try {
    const selected = getSelectedChannels();
    switch (toolName) {
      case "buffer_list_channels": {
        const raw = await bufferListChannels();
        if (selected.length > 0) {
          const parsed = JSON.parse(raw);
          if (parsed.channels) {
            parsed.channels = parsed.channels.filter((ch: any) => selected.includes(ch.id));
            parsed.count = parsed.channels.length;
            return JSON.stringify(parsed);
          }
        }
        return raw;
      }
      case "buffer_create_post":
        if (selected.length > 0 && !selected.includes(input.channel_id)) {
          return JSON.stringify({ error: "This channel is not enabled. Use buffer_list_channels to see available channels." });
        }
        // Normalize due_at to UTC — convert local time using user's timezone
        let dueAt = input.due_at;
        if (dueAt && !dueAt.endsWith("Z") && !dueAt.match(/[+-]\d{2}:\d{2}$/)) {
          // No timezone indicator — treat as user's local time and convert to UTC
          dueAt = localTimeToUtc(dueAt, getSetting("timezone") || "America/Los_Angeles");
        } else if (dueAt && !dueAt.endsWith("Z") && dueAt.match(/[+-]\d{2}:\d{2}$/)) {
          // Has explicit offset — just normalize to ISO
          const parsed = new Date(dueAt);
          if (!isNaN(parsed.getTime())) dueAt = parsed.toISOString();
        }
        return await bufferCreatePost({
          channel_id: input.channel_id,
          text: input.text,
          mode: input.mode || "add_to_queue",
          due_at: dueAt,
          image_url: input.image_url,
          link_url: input.link_url,
        });
      case "buffer_list_posts":
        return await bufferListPosts({
          status: input.status,
          channel_ids: input.channel_ids,
          limit: input.limit,
        });
      case "buffer_delete_post":
        return await bufferDeletePost(input.post_id);
      default:
        return JSON.stringify({ error: `Unknown Buffer tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Buffer operation failed" });
  }
}

// --- Luma Tools ---

const LUMA_TOOLS = [
  {
    name: "luma_list_events",
    description: "List upcoming events from your Luma calendar. Returns event names, dates, URLs, and visibility.",
    input_schema: {
      type: "object" as const,
      properties: {
        after: { type: "string", description: "ISO 8601 datetime — only events after this time (default: now)" },
        before: { type: "string", description: "ISO 8601 datetime — only events before this time (optional)" },
        limit: { type: "number", description: "Max events to return (default: 20, max: 50)" },
      },
    },
  },
  {
    name: "luma_get_event",
    description: "Get full details of a specific Luma event by its ID. Returns name, description, dates, location, meeting URL, hosts, and visibility.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The Luma event ID" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "luma_create_event",
    description: "Create a new event on the user's Luma calendar. IMPORTANT: Before calling this tool, you MUST ask the user to confirm or provide: (1) exact date and time, (2) timezone, (3) duration/end time, (4) whether it's virtual or in-person (and location if in-person), and (5) any description. Do NOT guess or use defaults for these fields — always clarify with the user first.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Event title" },
        start_at: { type: "string", description: "ISO 8601 datetime for event start (e.g. 2026-04-01T18:00:00Z)" },
        end_at: { type: "string", description: "ISO 8601 datetime for event end" },
        timezone: { type: "string", description: "IANA timezone (e.g. America/New_York, America/Los_Angeles)" },
        description: { type: "string", description: "Event body/description shown on the event page. Supports markdown formatting." },
        location: { type: "string", description: "Physical location/address for in-person events (e.g. '123 Main St, San Francisco, CA'). Omit for virtual-only events." },
        meeting_url: { type: "string", description: "Virtual meeting link (Zoom, Google Meet, etc.) for virtual or hybrid events" },
        visibility: { type: "string", enum: ["public", "members-only", "private"], description: "Event visibility (default: public)" },
      },
      required: ["name", "start_at", "end_at", "timezone"],
    },
  },
  {
    name: "luma_update_event",
    description: "Update an existing Luma event. You MUST call this tool to make changes — never claim you updated an event without calling this tool. The tool will verify the update by re-fetching the event and returning its current state. Check the 'verified' response to confirm changes took effect.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The Luma event ID" },
        name: { type: "string", description: "New event title" },
        start_at: { type: "string", description: "New start time (ISO 8601)" },
        end_at: { type: "string", description: "New end time (ISO 8601)" },
        timezone: { type: "string", description: "New timezone (IANA format)" },
        description: { type: "string", description: "New event body/description. Supports markdown." },
        location: { type: "string", description: "Physical location/address (e.g. '123 Main St, San Francisco, CA'). Set to empty string to remove." },
        meeting_url: { type: "string", description: "New meeting link (or empty to remove)" },
        visibility: { type: "string", enum: ["public", "members-only", "private"], description: "New visibility" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "luma_get_guests",
    description: "List guests/RSVPs for a Luma event. Shows attendee names, emails, and approval status.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The Luma event ID" },
        approval_status: { type: "string", enum: ["approved", "pending_approval", "invited", "declined", "waitlist"], description: "Filter by RSVP status (optional)" },
        limit: { type: "number", description: "Max guests to return (default: 50)" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "luma_add_guests",
    description: "Add guests to a Luma event. Each guest needs at least an email address.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The Luma event ID" },
        guests: {
          type: "array",
          description: "Array of guest objects with email (required) and name (optional)",
          items: {
            type: "object",
            properties: {
              email: { type: "string", description: "Guest email address" },
              name: { type: "string", description: "Guest name (optional)" },
            },
            required: ["email"],
          },
        },
      },
      required: ["event_id", "guests"],
    },
  },
  {
    name: "luma_send_invites",
    description: "Send email invitations to guests who haven't been notified yet for a Luma event.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The Luma event ID" },
      },
      required: ["event_id"],
    },
  },
];

async function executeLumaTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "luma_list_events":
        return await lumaListEvents({ after: input.after, before: input.before, limit: input.limit });
      case "luma_get_event":
        return await lumaGetEvent(input.event_id);
      case "luma_create_event":
        return await lumaCreateEvent(input);
      case "luma_update_event":
        return await lumaUpdateEvent(input);
      case "luma_get_guests":
        return await lumaGetGuests(input.event_id, { approval_status: input.approval_status, limit: input.limit });
      case "luma_add_guests":
        return await lumaAddGuests(input.event_id, input.guests);
      case "luma_send_invites":
        return await lumaSendInvites(input.event_id);
      default:
        return JSON.stringify({ error: `Unknown Luma tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Luma operation failed" });
  }
}

// --- Twitter/X Tools ---

const TWITTER_TOOLS = [
  {
    name: "twitter_get_me",
    description: "Get your authenticated X/Twitter profile info — username, name, bio, follower count.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "twitter_post_tweet",
    description: "Post a single tweet on X/Twitter. Max 280 characters. Optionally reply to another tweet by providing reply_to_tweet_id.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The tweet text (max 280 characters)" },
        reply_to_tweet_id: { type: "string", description: "Tweet ID to reply to (for creating conversations or adding to threads)" },
      },
      required: ["text"],
    },
  },
  {
    name: "twitter_post_thread",
    description: "Post a thread (tweetstorm) on X/Twitter. Provide an array of tweet texts. Each tweet must be max 280 characters. Tweets are posted in order as a connected thread. Returns URLs for all posted tweets.",
    input_schema: {
      type: "object" as const,
      properties: {
        tweets: {
          type: "array",
          items: { type: "string" },
          description: "Array of tweet texts, in order. Each max 280 characters.",
        },
      },
      required: ["tweets"],
    },
  },
  {
    name: "twitter_get_recent_tweets",
    description: "Get your recent tweets from X/Twitter. Returns tweet text, URLs, timestamps, and engagement metrics. Use this to check if a tweet or thread was already posted, or to review recent activity.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_results: { type: "number", description: "Number of recent tweets to fetch (5-100, default 10)" },
      },
    },
  },
  {
    name: "twitter_delete_tweet",
    description: "Delete a tweet by its ID. Only works for tweets posted by the authenticated account.",
    input_schema: {
      type: "object" as const,
      properties: {
        tweet_id: { type: "string", description: "The ID of the tweet to delete" },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_lookup_tweet",
    description: "Look up a tweet by its ID or URL. Returns the tweet text, author, timestamp, and engagement metrics. Use this to verify a tweet before retweeting it.",
    input_schema: {
      type: "object" as const,
      properties: {
        tweet_id_or_url: { type: "string", description: "A tweet ID (numeric) or full URL (e.g. https://x.com/user/status/123)" },
      },
      required: ["tweet_id_or_url"],
    },
  },
  {
    name: "twitter_retweet",
    description: "Retweet (repost) a tweet. Accepts a tweet ID or URL. Returns confirmation with tweet details after retweeting.",
    input_schema: {
      type: "object" as const,
      properties: {
        tweet_id_or_url: { type: "string", description: "A tweet ID (numeric) or full URL (e.g. https://x.com/user/status/123)" },
      },
      required: ["tweet_id_or_url"],
    },
  },
  {
    name: "twitter_undo_retweet",
    description: "Undo a retweet (un-repost). Accepts a tweet ID or URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        tweet_id_or_url: { type: "string", description: "A tweet ID (numeric) or full URL (e.g. https://x.com/user/status/123)" },
      },
      required: ["tweet_id_or_url"],
    },
  },
];

async function executeTwitterTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "twitter_get_me":
        return await twitterGetMe();
      case "twitter_post_tweet":
        return await twitterPostTweet(input.text, input.reply_to_tweet_id);
      case "twitter_post_thread":
        return await twitterPostThread(input.tweets);
      case "twitter_get_recent_tweets":
        return await twitterGetRecentTweets(input.max_results);
      case "twitter_delete_tweet":
        return await twitterDeleteTweet(input.tweet_id);
      case "twitter_lookup_tweet":
        return await twitterLookupTweet(input.tweet_id_or_url);
      case "twitter_retweet":
        return await twitterRetweet(input.tweet_id_or_url);
      case "twitter_undo_retweet":
        return await twitterUndoRetweet(input.tweet_id_or_url);
      default:
        return JSON.stringify({ error: `Unknown Twitter tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Twitter operation failed" });
  }
}

// --- Beehiiv Tools ---

const BEEHIIV_TOOLS = [
  {
    name: "beehiiv_list_templates",
    description: "List the configured design templates for Beehiiv newsletters. Use this first to show template options before creating a draft.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "beehiiv_create_draft",
    description: "Create a draft newsletter post in Beehiiv. The draft can be reviewed and published from the Beehiiv dashboard. Use beehiiv_list_templates first to see available templates.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Newsletter title/heading" },
        body_content: { type: "string", description: "Newsletter body as HTML" },
        subtitle: { type: "string", description: "Optional subtitle" },
        email_subject_line: { type: "string", description: "Email subject line (defaults to title if not set)" },
        email_preview_text: { type: "string", description: "Email preview/preheader text" },
        content_tags: { type: "array", items: { type: "string" }, description: "Content tags/categories" },
        slug: { type: "string", description: "URL slug for the web version" },
        template_id: { type: "string", description: "Design template ID (from beehiiv_list_templates). If omitted, uses the default template." },
      },
      required: ["title", "body_content"],
    },
  },
  {
    name: "beehiiv_list_posts",
    description: "List newsletter posts from Beehiiv with optional status filter.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["draft", "confirmed", "archived"], description: "Filter by post status (default: all)" },
        limit: { type: "number", description: "Max posts to return (default: 20, max: 50)" },
      },
    },
  },
  {
    name: "beehiiv_get_post",
    description: "Get a single Beehiiv newsletter post by ID, including full content and stats.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_id: { type: "string", description: "The Beehiiv post ID" },
      },
      required: ["post_id"],
    },
  },
];

async function executeBeehiivTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "beehiiv_list_templates":
        return beehiivListTemplates();
      case "beehiiv_create_draft":
        return await beehiivCreateDraft({
          title: input.title,
          body_content: input.body_content,
          subtitle: input.subtitle,
          email_subject_line: input.email_subject_line,
          email_preview_text: input.email_preview_text,
          content_tags: input.content_tags,
          slug: input.slug,
          template_id: input.template_id,
        });
      case "beehiiv_list_posts":
        return await beehiivListPosts({
          status: input.status,
          limit: input.limit,
        });
      case "beehiiv_get_post":
        return await beehiivGetPost(input.post_id);
      default:
        return JSON.stringify({ error: `Unknown Beehiiv tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Beehiiv operation failed" });
  }
}

// --- One (withone.ai) Meta-Tools ---

const ONE_TOOLS = [
  {
    name: "one_list_connections",
    description: "List all platforms the user has connected through One. Use this first to see what third-party services are available (e.g. HubSpot, Salesforce, Shopify, Zendesk, etc.).",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "one_search_actions",
    description: "Search for available actions on a connected platform. Use this after one_list_connections to discover what you can do with a specific platform (e.g. 'create contact' on HubSpot, 'list orders' on Shopify).",
    input_schema: {
      type: "object" as const,
      properties: {
        platform: { type: "string", description: "The platform name (e.g. 'hubspot', 'salesforce', 'shopify')" },
        query: { type: "string", description: "What you want to do (e.g. 'create contact', 'list deals', 'search orders')" },
      },
      required: ["platform", "query"],
    },
  },
  {
    name: "one_get_action_knowledge",
    description: "Get detailed information about a specific action — required parameters, expected request body, and endpoint details. Call this before executing an action to understand exactly what data is needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string", description: "The action ID from one_search_actions results" },
      },
      required: ["action_id"],
    },
  },
  {
    name: "one_execute_action",
    description: "Execute an action on a connected platform. Use one_get_action_knowledge first to understand the required parameters and request format.",
    input_schema: {
      type: "object" as const,
      properties: {
        platform: { type: "string", description: "The platform name (must match a connected platform)" },
        action_id: { type: "string", description: "The action ID from one_search_actions" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method for the action" },
        path: { type: "string", description: "API path for the action (from action knowledge)" },
        body: { type: "object", description: "Request body (for POST/PUT/PATCH)" },
      },
      required: ["platform", "action_id", "method", "path"],
    },
  },
];

async function executeOneTool(toolName: string, input: any): Promise<string> {
  try {
    switch (toolName) {
      case "one_list_connections":
        return await oneListConnections();
      case "one_search_actions":
        return await oneSearchActions(input.platform, input.query);
      case "one_get_action_knowledge":
        return await oneGetActionKnowledge(input.action_id);
      case "one_execute_action": {
        const connectionKey = getConnectionKeyForPlatform(input.platform);
        if (!connectionKey) {
          return JSON.stringify({ error: `Platform "${input.platform}" is not connected. Use one_list_connections to see available platforms.` });
        }
        return await oneExecuteAction(input.method, input.path, connectionKey, input.action_id, input.body);
      }
      default:
        return JSON.stringify({ error: `Unknown One tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "One operation failed" });
  }
}

// --- Public Google Doc Tool (no OAuth needed) ---

const PUBLIC_GDOC_TOOLS = [
  {
    name: "open_google_doc",
    description: "Open and read a publicly shared Google Docs, Sheets, or Slides URL. Works without Google OAuth — the document must be shared as 'Anyone with the link can view'. Use this when someone pastes a Google Doc link.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The Google Docs/Sheets/Slides URL" },
      },
      required: ["url"],
    },
  },
];

async function executePublicGDocTool(input: any): Promise<string> {
  const url: string = input.url;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return JSON.stringify({ error: "Could not extract file ID from URL. Make sure it's a Google Docs, Sheets, or Slides link." });
  }
  const fileId = match[1];

  // Determine export format from URL
  let exportUrl: string;
  if (url.includes("docs.google.com/document")) {
    exportUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
  } else if (url.includes("docs.google.com/spreadsheets")) {
    exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`;
  } else if (url.includes("docs.google.com/presentation")) {
    exportUrl = `https://docs.google.com/presentation/d/${fileId}/export?format=txt`;
  } else {
    // Generic Drive file — try text export
    exportUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;
  }

  try {
    const res = await fetch(exportUrl, { redirect: "follow" });
    if (res.status === 403 || res.status === 401) {
      return JSON.stringify({ error: "This document is not publicly shared. The owner needs to set sharing to 'Anyone with the link can view', or you can connect Google OAuth on the Integrations page to access private documents." });
    }
    if (!res.ok) {
      return JSON.stringify({ error: `Failed to fetch document (${res.status})` });
    }
    const text = await res.text();
    if (text.includes("<!DOCTYPE html>") && text.includes("ServiceLogin")) {
      return JSON.stringify({ error: "This document is not publicly shared. The owner needs to set sharing to 'Anyone with the link can view', or you can connect Google OAuth on the Integrations page to access private documents." });
    }
    return JSON.stringify({ content: text.slice(0, 50000) });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to fetch document" });
  }
}

// --- Google Tools ---

const GOOGLE_GMAIL_TOOLS = [
  {
    name: "gmail_search",
    description: "Search Gmail messages. Use Gmail search syntax: 'from:john@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d'. If multiple Google accounts are connected, specify which account to search.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "number", description: "Max results (default: 10, max: 20)" },
        account: { type: "string", description: "Google account email to use (optional, defaults to first account)" },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_read_message",
    description: "Read the full content of a Gmail message by ID. Returns message body, headers, and a list of attachments with their IDs. Use gmail_get_attachment to download attachment content.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "The Gmail message ID" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "gmail_get_attachment",
    description: "Download an email attachment by its attachment ID. Returns text content for text-based files (CSV, JSON, TXT, HTML) or base64 for binary files (PDF, images, etc). Get the attachment_id from gmail_read_message results.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "The Gmail message ID containing the attachment" },
        attachment_id: { type: "string", description: "The attachment ID from gmail_read_message" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["message_id", "attachment_id"],
    },
  },
  {
    name: "gmail_label",
    description: "Add a label to a Gmail message.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "The Gmail message ID" },
        label_name: { type: "string", description: "Label name (e.g., 'IMPORTANT', 'STARRED', or custom)" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["message_id", "label_name"],
    },
  },
  {
    name: "gmail_list_aliases",
    description: "List available send-as addresses (aliases) for a Gmail account. Use this to see which email addresses can be used as the 'from' address when sending or drafting.",
    input_schema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Google account email to use (optional)" },
      },
    },
  },
];

const GOOGLE_GMAIL_SEND_TOOLS = [
  {
    name: "gmail_create_draft",
    description: "Create a real draft email in the user's Gmail Drafts folder. The draft will appear in Gmail and can be reviewed and sent by the user. You MUST call this tool to actually create the draft — do not just write the email text in your response. If you don't know the recipient, ask the user. Use 'from' to send from an alias (use gmail_list_aliases to see available addresses). When replying to an email thread, ALWAYS include thread_id, in_reply_to, and cc from the original message to keep the reply in-thread and reply-all.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma-separated for multiple" },
        subject: { type: "string", description: "Email subject line. For replies, use 'Re: <original subject>'" },
        body: { type: "string", description: "Full email body (plain text)" },
        cc: { type: "string", description: "CC recipients, comma-separated (include all original To/CC addresses for reply-all)" },
        thread_id: { type: "string", description: "Gmail thread ID to keep the reply in the same thread (from gmail_read_message threadId)" },
        in_reply_to: { type: "string", description: "Message-ID header of the email being replied to (from gmail_read_message messageId)" },
        account: { type: "string", description: "Google account email to use (optional)" },
        from: { type: "string", description: "Send-as alias address (optional, use gmail_list_aliases to see options)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_send",
    description: "Send an email immediately from the user's Gmail account. The email will be sent right away — use gmail_create_draft if you want to save it as a draft instead. Use 'from' to send from an alias. When replying to an email thread, ALWAYS include thread_id, in_reply_to, and cc from the original message to keep the reply in-thread and reply-all.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma-separated for multiple" },
        subject: { type: "string", description: "Email subject line. For replies, use 'Re: <original subject>'" },
        body: { type: "string", description: "Full email body (plain text)" },
        cc: { type: "string", description: "CC recipients, comma-separated (include all original To/CC addresses for reply-all)" },
        thread_id: { type: "string", description: "Gmail thread ID to keep the reply in the same thread (from gmail_read_message threadId)" },
        in_reply_to: { type: "string", description: "Message-ID header of the email being replied to (from gmail_read_message messageId)" },
        account: { type: "string", description: "Google account email to use (optional)" },
        from: { type: "string", description: "Send-as alias address (optional, use gmail_list_aliases to see options)" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

const GOOGLE_CALENDAR_TOOLS = [
  {
    name: "calendar_list_events",
    description: "List upcoming calendar events.",
    input_schema: {
      type: "object" as const,
      properties: {
        time_min: { type: "string", description: "Start of range (ISO 8601). Defaults to now." },
        time_max: { type: "string", description: "End of range (ISO 8601). Defaults to 7 days." },
        max_results: { type: "number", description: "Max events (default: 10)" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
    },
  },
  {
    name: "calendar_create_event",
    description: "Create a new calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start time (ISO 8601)" },
        end: { type: "string", description: "End time (ISO 8601)" },
        description: { type: "string", description: "Event description" },
        attendees: { type: "string", description: "Comma-separated attendee emails" },
        location: { type: "string", description: "Event location" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "calendar_update_event",
    description: "Update an existing calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Event ID" },
        summary: { type: "string", description: "New title" },
        start: { type: "string", description: "New start time" },
        end: { type: "string", description: "New end time" },
        description: { type: "string", description: "New description" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["event_id"],
    },
  },
];

const GOOGLE_DRIVE_TOOLS = [
  {
    name: "drive_search",
    description: "Search Google Drive files by name or content. Searches Google Docs, Sheets, Slides, PDFs, and all other files. Use mime_type to filter by type.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query — matches file names and document content" },
        max_results: { type: "number", description: "Max files (default: 10)" },
        mime_type: { type: "string", description: "Filter by MIME type. Common: 'application/vnd.google-apps.document' (Google Docs), 'application/vnd.google-apps.spreadsheet' (Sheets), 'application/vnd.google-apps.presentation' (Slides)" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_read_file",
    description: "Read the full text content of a Google Drive file by its ID. Google Docs and Slides are exported as plain text, Sheets as CSV. Use after drive_search to read a specific file.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID (from drive_search results)" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "drive_open_url",
    description: "Open and read a Google Docs, Sheets, Slides, or Drive URL. Use this when the user pastes a Google document link.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The Google Docs/Sheets/Slides/Drive URL" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["url"],
    },
  },
];

const GOOGLE_CONTACTS_TOOLS = [
  {
    name: "contacts_search",
    description: "Search Google Contacts by name, email, or phone.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["query"],
    },
  },
];

const GOOGLE_DOCS_TOOLS = [
  {
    name: "docs_create",
    description: "Create a new Google Doc with a title and optional initial text content. Returns the document ID and URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Document title" },
        content: { type: "string", description: "Optional initial text content for the document" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["title"],
    },
  },
  {
    name: "docs_read",
    description: "Read the text content of a Google Doc by its document ID. Returns the title and full text content. If the doc has multiple tabs, returns all tabs with their names, IDs, and content. Use drive_search to find document IDs, or extract from a Google Docs URL (the ID is the long string after /d/ in the URL).",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        tab_name: { type: "string", description: "Read a specific tab by name (case-insensitive). Omit to get all tabs." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "docs_append",
    description: "Append text to the end of a Google Doc (or a specific tab). Use this to add new content at the bottom of an existing document. If the doc has tabs, use docs_read first to find the tab ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        text: { type: "string", description: "Text to append to the end of the document" },
        tab_id: { type: "string", description: "Tab ID to append to (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "docs_insert",
    description: "Insert text at a specific character index position in a Google Doc (or a specific tab). Index 1 is the start of the document. Use docs_read first to understand the document structure and find the right insertion point.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        text: { type: "string", description: "Text to insert" },
        index: { type: "number", description: "Character index position to insert at (1 = start of document)" },
        tab_id: { type: "string", description: "Tab ID to insert into (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "text", "index"],
    },
  },
  {
    name: "docs_suggest_edit",
    description: "Suggest an edit to existing text in a Google Doc by marking the original text with red strikethrough and inserting the replacement text in blue right next to it. The user can then review and accept or reject the change in the document. Use docs_read first to find the exact text to replace.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        old_text: { type: "string", description: "The exact text to mark for replacement (must match text in the document)" },
        new_text: { type: "string", description: "The suggested replacement text" },
        tab_id: { type: "string", description: "Tab ID to edit in (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "old_text", "new_text"],
    },
  },
  {
    name: "docs_format_text",
    description: "Change the formatting of existing text in a Google Doc. Find the text and apply formatting changes like bold, italic, underline, strikethrough, font size, font family, or text color. Use docs_read first to find the exact text to format.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        text: { type: "string", description: "The exact text to format (must match text in the document)" },
        bold: { type: "boolean", description: "Set bold (true) or remove bold (false)" },
        italic: { type: "boolean", description: "Set italic (true) or remove italic (false)" },
        underline: { type: "boolean", description: "Set underline (true) or remove underline (false)" },
        strikethrough: { type: "boolean", description: "Set strikethrough (true) or remove strikethrough (false)" },
        font_size: { type: "number", description: "Font size in points (e.g. 11, 14, 18, 24)" },
        font_family: { type: "string", description: "Font family name (e.g. 'Arial', 'Times New Roman', 'Roboto')" },
        text_color: {
          type: "object",
          description: "Text color as RGB values 0-1 (e.g. {red: 1, green: 0, blue: 0} for red)",
          properties: {
            red: { type: "number" },
            green: { type: "number" },
            blue: { type: "number" },
          },
        },
        link: { type: "string", description: "URL to link the text to. Use empty string to remove an existing link." },
        tab_id: { type: "string", description: "Tab ID to format in (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "docs_paragraph_style",
    description: "Change paragraph-level formatting in a Google Doc: headings, alignment, and spacing. Find the text and apply paragraph styles. Use docs_read first to find the exact text.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        text: { type: "string", description: "The exact text in the paragraph(s) to style (must match text in the document)" },
        heading: { type: "string", enum: ["TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6", "NORMAL_TEXT"], description: "Set the paragraph heading level" },
        alignment: { type: "string", enum: ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"], description: "Set paragraph alignment" },
        line_spacing: { type: "number", description: "Line spacing as percentage (100 = single, 150 = 1.5x, 200 = double)" },
        space_above: { type: "number", description: "Space above paragraph in points" },
        space_below: { type: "number", description: "Space below paragraph in points" },
        tab_id: { type: "string", description: "Tab ID (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "docs_list",
    description: "Convert paragraphs in a Google Doc into a bulleted list, numbered list, or remove list formatting. Find the text and apply list style. The text should span the paragraphs you want to convert.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        text: { type: "string", description: "The exact text spanning the paragraphs to convert (must match text in the document)" },
        list_type: { type: "string", enum: ["BULLET", "NUMBER", "NONE"], description: "BULLET for bullet points, NUMBER for numbered list, NONE to remove list formatting" },
        tab_id: { type: "string", description: "Tab ID (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "text", "list_type"],
    },
  },
  {
    name: "docs_insert_image",
    description: "Insert an inline image into a Google Doc from a URL. The image URL must be publicly accessible. If no index is provided, the image is inserted at the end of the document.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        image_url: { type: "string", description: "Public URL of the image to insert" },
        index: { type: "number", description: "Character index to insert the image at (from docs_read). Omit to insert at the end." },
        width: { type: "number", description: "Image width in points (72 points = 1 inch)" },
        height: { type: "number", description: "Image height in points (72 points = 1 inch)" },
        tab_id: { type: "string", description: "Tab ID (from docs_read). Omit for default/first tab." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "image_url"],
    },
  },
  {
    name: "docs_replace_text",
    description: "Find and replace all occurrences of a text string in a Google Doc. WARNING: This is a destructive bulk operation — it replaces text instantly with no way to review. Only use for mechanical replacements like removing emojis, fixing a repeated typo, or renaming a term across the document. To edit or revise content, use docs_suggest_edit instead (it shows changes as redlines for user review).",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string", description: "The Google Docs document ID" },
        find_text: { type: "string", description: "The text to find (all occurrences will be replaced)" },
        replace_text: { type: "string", description: "The replacement text (use empty string to delete the found text)" },
        match_case: { type: "boolean", description: "Whether to match case (default: true)" },
        tab_id: { type: "string", description: "Tab ID to restrict replacement to (from docs_read). Omit to replace in all tabs." },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["document_id", "find_text", "replace_text"],
    },
  },
];

const GOOGLE_SHEETS_TOOLS = [
  {
    name: "sheets_create",
    description: "Create a new Google Spreadsheet. Optionally specify names for the initial sheet tabs.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Spreadsheet title" },
        sheet_titles: { type: "array", items: { type: "string" }, description: "Optional list of sheet tab names (default: one sheet called 'Sheet1')" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["title"],
    },
  },
  {
    name: "sheets_read",
    description: "Read a range of cells from a Google Spreadsheet. Returns the values as a 2D array. Use A1 notation for the range (e.g. 'Sheet1!A1:D10', 'Sheet1!A:A' for a full column). Use sheets_list_sheets first to see available sheet tabs.",
    input_schema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string", description: "The spreadsheet ID (from the URL or sheets_create result)" },
        range: { type: "string", description: "Cell range in A1 notation, e.g. 'Sheet1!A1:D10'" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["spreadsheet_id", "range"],
    },
  },
  {
    name: "sheets_write",
    description: "Write values to a specific range of cells in a Google Spreadsheet. Overwrites existing values in the range. Values are a 2D array where each inner array is a row.",
    input_schema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string", description: "The spreadsheet ID" },
        range: { type: "string", description: "Cell range in A1 notation, e.g. 'Sheet1!A1:C3'" },
        values: { type: "array", items: { type: "array", items: {} }, description: "2D array of values. Each inner array is a row, e.g. [['Name','Age'],['Alice',30]]" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "sheets_append",
    description: "Append rows to the end of data in a Google Spreadsheet. Finds the last row with data and adds new rows below it. Values are a 2D array where each inner array is a row.",
    input_schema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string", description: "The spreadsheet ID" },
        range: { type: "string", description: "Sheet range to append to, e.g. 'Sheet1!A:E' or 'Sheet1'" },
        values: { type: "array", items: { type: "array", items: {} }, description: "2D array of rows to append, e.g. [['Alice',30],['Bob',25]]" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "sheets_list_sheets",
    description: "List all sheet tabs in a Google Spreadsheet. Returns tab names, IDs, and grid dimensions. Use this to discover available sheets before reading or writing.",
    input_schema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string", description: "The spreadsheet ID" },
        account: { type: "string", description: "Google account email to use (optional)" },
      },
      required: ["spreadsheet_id"],
    },
  },
];

function checkGmailRecipientRules(to?: string, cc?: string): string | null {
  try {
    const rules = JSON.parse(getSetting("gmail_email_rules") || "{}");
    if (!rules.mode || rules.mode === "all") return null;

    const allRecipients = [to, cc]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map(r => r.trim().toLowerCase())
      .filter(Boolean);

    if (rules.mode === "domains" && rules.domains?.length > 0) {
      const allowed = rules.domains.map((d: string) => d.toLowerCase());
      const blocked = allRecipients.filter(r => {
        const domain = r.split("@")[1];
        return !domain || !allowed.includes(domain);
      });
      if (blocked.length > 0) {
        return JSON.stringify({ error: `Email rules only allow sending to domains: ${allowed.join(", ")}. Blocked recipients: ${blocked.join(", ")}` });
      }
    }

    if (rules.mode === "addresses" && rules.addresses?.length > 0) {
      const allowed = rules.addresses.map((a: string) => a.toLowerCase());
      const blocked = allRecipients.filter(r => !allowed.includes(r));
      if (blocked.length > 0) {
        return JSON.stringify({ error: `Email rules only allow sending to: ${allowed.join(", ")}. Blocked recipients: ${blocked.join(", ")}` });
      }
    }
  } catch {}
  return null;
}

async function executeGoogleTool(toolName: string, input: any): Promise<string> {
  if (!isGoogleRunning()) {
    return JSON.stringify({ error: "Google is not connected. Ask the user to connect Google in the integrations page." });
  }

  const acct = input.account || undefined;

  try {
    switch (toolName) {
      case "gmail_search":
        return await gmailSearch(input.query, input.max_results, acct);
      case "gmail_read_message":
        return await gmailReadMessage(input.message_id, acct);
      case "gmail_get_attachment":
        return await gmailGetAttachment(input.message_id, input.attachment_id, acct);
      case "gmail_send":
      case "gmail_create_draft": {
        const ruleCheck = checkGmailRecipientRules(input.to, input.cc);
        if (ruleCheck) return ruleCheck;
        if (toolName === "gmail_send") {
          return await gmailSend(input.to, input.subject, input.body, acct, input.from, input.cc, input.thread_id, input.in_reply_to);
        }
        return await gmailCreateDraft(input.to, input.subject, input.body, acct, input.from, input.cc, input.thread_id, input.in_reply_to);
      }
      case "gmail_label":
        return await gmailAddLabel(input.message_id, input.label_name, acct);
      case "gmail_list_aliases":
        return await gmailGetSendAsAliases(acct);
      case "calendar_list_events":
        return await calendarListEvents(input.time_min, input.time_max, input.max_results, acct);
      case "calendar_create_event":
        return await calendarCreateEvent(input, acct);
      case "calendar_update_event":
        return await calendarUpdateEvent(input.event_id, input, acct);
      case "drive_search":
        return await driveSearch(input.query, input.max_results, input.mime_type, acct);
      case "drive_read_file":
        return await driveReadFile(input.file_id, acct);
      case "drive_open_url": {
        const fileId = extractDriveFileId(input.url);
        if (!fileId) return JSON.stringify({ error: "Could not extract file ID from URL. Make sure it's a Google Docs, Sheets, Slides, or Drive link." });
        return await driveReadFile(fileId, acct);
      }
      case "contacts_search":
        return await contactsSearch(input.query, acct);
      case "docs_create":
        return await docsCreate(input.title, input.content, acct);
      case "docs_read":
        return await docsRead(input.document_id, input.tab_name, acct);
      case "docs_append":
        return await docsAppend(input.document_id, input.text, input.tab_id, acct);
      case "docs_insert":
        return await docsInsert(input.document_id, input.text, input.index, input.tab_id, acct);
      case "docs_suggest_edit":
        return await docsSuggestEdit(input.document_id, input.old_text, input.new_text, input.tab_id, acct);
      case "docs_format_text":
        return await docsFormatText(input.document_id, input.text, {
          bold: input.bold, italic: input.italic, underline: input.underline, strikethrough: input.strikethrough,
          fontSize: input.font_size, fontFamily: input.font_family, foregroundColor: input.text_color, link: input.link,
        }, input.tab_id, acct);
      case "docs_paragraph_style":
        return await docsParagraphStyle(input.document_id, input.text, {
          heading: input.heading, alignment: input.alignment, lineSpacing: input.line_spacing,
          spaceAbove: input.space_above, spaceBelow: input.space_below,
        }, input.tab_id, acct);
      case "docs_list":
        return await docsCreateList(input.document_id, input.text, input.list_type, input.tab_id, acct);
      case "docs_insert_image":
        return await docsInsertImage(input.document_id, input.image_url, input.index, input.width, input.height, input.tab_id, acct);
      case "docs_replace_text":
        return await docsReplaceText(input.document_id, input.find_text, input.replace_text, input.match_case ?? true, input.tab_id, acct);
      case "sheets_create":
        return await sheetsCreate(input.title, input.sheet_titles, acct);
      case "sheets_read":
        return await sheetsRead(input.spreadsheet_id, input.range, acct);
      case "sheets_write":
        return await sheetsWrite(input.spreadsheet_id, input.range, input.values, acct);
      case "sheets_append":
        return await sheetsAppend(input.spreadsheet_id, input.range, input.values, acct);
      case "sheets_list_sheets":
        return await sheetsListSheets(input.spreadsheet_id, acct);
      default:
        return JSON.stringify({ error: `Unknown Google tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Google API call failed" });
  }
}

function executeMemoryTool(toolName: string, input: any): string {
  switch (toolName) {
    case "save_memory": {
      // Check for near-duplicate before saving
      const existing = findDuplicateMemory(input.content);
      if (existing) {
        return JSON.stringify({
          success: false,
          duplicate: true,
          existing_memory_id: existing.id,
          existing_content: existing.content,
          message: "A similar memory already exists. Use delete_memory to remove the old one first if you want to replace it.",
        });
      }
      const id = addMemory(input.content);
      return JSON.stringify({ success: true, memory_id: id, content: input.content });
    }
    case "list_memories": {
      const memories = getAllMemories();
      return JSON.stringify({
        memories: memories.map((m) => ({ id: m.id, content: m.content, created_at: m.created_at })),
      });
    }
    case "delete_memory": {
      const mem = getMemory(input.memory_id);
      if (!mem) return JSON.stringify({ error: `Memory #${input.memory_id} not found.` });
      deleteMemory(input.memory_id);
      return JSON.stringify({ success: true, deleted: mem.content });
    }
    case "update_context": {
      const validFields = ["context_company", "context_user", "context_rules", "context_knowledge"];
      if (!validFields.includes(input.field)) {
        return JSON.stringify({ error: `Invalid field: ${input.field}. Must be one of: ${validFields.join(", ")}` });
      }
      setSetting(input.field, (input.content || "").trim());
      // Check how many fields are now filled (>=20 chars)
      const filledCount = validFields.filter((f) => {
        const val = getSetting(f);
        return val && val.trim().length >= 20;
      }).length;
      return JSON.stringify({ success: true, field: input.field, saved: true, fields_filled: filledCount, fields_total: validFields.length });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

function executeSchedulingTool(toolName: string, input: any): string {
  switch (toolName) {
    case "create_scheduled_job": {
      if (!isValidCron(input.schedule)) {
        return JSON.stringify({ error: `Invalid cron expression: "${input.schedule}"` });
      }
      if (!input.target_source || !input.target_external_id) {
        return JSON.stringify({ error: "You must specify target_source and target_external_id. Ask the user where they want results delivered (Slack or email)." });
      }
      const validSources = ["slack", "email"];
      if (!validSources.includes(input.target_source)) {
        return JSON.stringify({ error: `target_source must be one of: ${validSources.join(", ")}` });
      }
      if (input.target_source === "slack" && !/^[CDGU][A-Z0-9]+$/.test(input.target_external_id)) {
        return JSON.stringify({ error: `Invalid Slack channel/user ID "${input.target_external_id}". Slack IDs start with C (channel), D (DM), G (group), or U (user) followed by uppercase letters and numbers (e.g. C01HCS46FPB or U07FQCAACN8). Ask the user for their Slack channel or user ID.` });
      }
      const jobTimezone = getSetting("timezone") || "America/Los_Angeles";
      const nextRun = getNextRun(input.schedule, new Date(), jobTimezone);
      const runOnce = input.run_once === false ? 0 : 1;
      const id = createScheduledJob({
        name: input.name,
        schedule: input.schedule,
        prompt: input.prompt,
        target_source: input.target_source,
        target_external_id: input.target_external_id,
        run_once: runOnce,
        created_by: "ai",
        next_run: nextRun.toISOString(),
      });
      return JSON.stringify({
        success: true,
        job_id: id,
        name: input.name,
        schedule_description: describeCron(input.schedule),
        run_once: !!runOnce,
        target: `${input.target_source}:${input.target_external_id}`,
        next_run: nextRun.toISOString(),
      });
    }
    case "list_scheduled_jobs": {
      const jobs = getAllScheduledJobs();
      return JSON.stringify({
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          schedule: j.schedule,
          schedule_description: describeCron(j.schedule),
          prompt: j.prompt.slice(0, 100),
          enabled: !!j.enabled,
          created_by: j.created_by,
          next_run: j.next_run,
        })),
      });
    }
    case "delete_scheduled_job": {
      const job = getScheduledJob(input.job_id);
      if (!job) return JSON.stringify({ error: `Job #${input.job_id} not found.` });
      deleteScheduledJob(input.job_id);
      return JSON.stringify({ success: true, deleted_job: job.name });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// --- Status callback for streaming thinking updates ---

type StatusCallback = (status: string) => void;

function extractDomain(url?: string): string {
  if (!url) return "a webpage";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "a webpage"; }
}

const THINKING_MESSAGES = [
  "Thinking...",
  "Working on it...",
  "Let me figure this out...",
  "Processing...",
  "On it...",
  "Looking into it...",
  "Give me a moment...",
  "Pulling it together...",
];

function getThinkingMessage(round: number): string {
  if (round === 0) return THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)];
  // Later rounds = still working messages
  const laterMessages = ["Still working...", "Almost there...", "Digging deeper...", "Gathering more info...", "Pulling it together..."];
  return laterMessages[Math.floor(Math.random() * laterMessages.length)];
}

const TOOL_STATUS_MAP: Record<string, string | ((input: any) => string)> = {
  find_image: (input) => `Searching for images of ${input?.query || "that"}...`,
  browse_webpage: (input) => `Browsing ${extractDomain(input?.url)}...`,
  browser_click: "Clicking on the page...",
  browser_type: "Typing on the page...",
  browser_screenshot: "Taking a screenshot...",
  browser_get_content: "Reading page content...",
  pdf_get_fields: "Reading PDF fields...",
  pdf_fill_form: "Filling PDF form...",
  pdf_read_text: "Reading your PDF...",
  save_memory: "Saving to memory...",
  list_memories: "Checking memory...",
  delete_memory: "Updating memory...",
  run_command: "Running a command...",
  read_file: "Reading your files...",
  write_file: "Writing a file...",
  send_slack: "Sending Slack message...",
  slack_channel_members: "Checking Slack members...",
  send_lobstermail: "Sending an email...",
  check_lobstermail: "Checking your inbox...",
  gmail_search: "Searching Gmail...",
  gmail_read_message: "Reading an email...",
  gmail_get_attachment: "Downloading attachment...",
  gmail_send: "Sending an email...",
  gmail_create_draft: "Drafting an email...",
  gmail_label: "Labeling email...",
  gmail_list_aliases: "Checking email aliases...",
  calendar_list_events: "Checking your calendar...",
  calendar_create_event: "Creating a calendar event...",
  calendar_update_event: "Updating a calendar event...",
  drive_search: "Searching Google Drive...",
  drive_read_file: "Reading a Drive file...",
  drive_open_url: "Opening a document...",
  contacts_search: "Searching contacts...",
  docs_create: "Creating a document...",
  docs_read: "Reading a document...",
  docs_append: "Editing a document...",
  docs_insert: "Editing a document...",
  docs_suggest_edit: "Suggesting edits...",
  docs_format_text: "Formatting text...",
  docs_paragraph_style: "Styling paragraph...",
  docs_list: "Updating list...",
  docs_insert_image: "Inserting image...",
  docs_replace_text: "Replacing text...",
  sheets_create: "Creating a spreadsheet...",
  sheets_read: "Reading a spreadsheet...",
  sheets_write: "Writing to a spreadsheet...",
  sheets_append: "Adding to a spreadsheet...",
  sheets_list_sheets: "Checking spreadsheet tabs...",
  supabase_list_tables: "Listing database tables...",
  supabase_describe_table: "Examining table schema...",
  supabase_query: "Querying your database...",
  supabase_insert: "Inserting a record...",
  supabase_update: "Updating a record...",
  airtable_list_bases: "Listing Airtable bases...",
  airtable_list_tables: "Listing Airtable tables...",
  airtable_list_records: "Reading Airtable records...",
  notion_search: "Searching Notion...",
  notion_get_page: "Reading a Notion page...",
  notion_get_page_content: "Reading Notion content...",
  notion_create_page: "Creating a Notion page...",
  notion_update_page: "Updating a Notion page...",
  notion_query_database: "Querying Notion database...",
  notion_get_database: "Reading Notion database...",
  buffer_list_channels: "Listing social channels...",
  buffer_create_post: "Creating a social post...",
  buffer_list_posts: "Checking Buffer posts...",
  buffer_delete_post: "Deleting a Buffer post...",
  luma_list_events: "Checking Luma events...",
  luma_get_event: "Reading event details...",
  luma_create_event: "Creating a Luma event...",
  luma_update_event: "Updating a Luma event...",
  luma_get_guests: "Checking guest list...",
  luma_add_guests: "Adding guests to event...",
  luma_send_invites: "Sending event invitations...",
  twitter_get_me: "Checking Twitter profile...",
  twitter_post_tweet: "Posting to X...",
  beehiiv_list_templates: "Listing newsletter templates...",
  beehiiv_create_draft: "Creating newsletter draft...",
  beehiiv_list_posts: "Checking Beehiiv posts...",
  beehiiv_get_post: "Reading newsletter post...",
  twitter_post_thread: "Posting thread to X...",
  twitter_get_recent_tweets: "Checking recent tweets...",
  twitter_delete_tweet: "Deleting a tweet...",
  twitter_lookup_tweet: "Looking up tweet...",
  twitter_retweet: "Retweeting...",
  twitter_undo_retweet: "Undoing retweet...",
  create_scheduled_job: "Creating a scheduled job...",
  list_scheduled_jobs: "Listing scheduled jobs...",
  delete_scheduled_job: "Deleting a scheduled job...",
  one_list_connections: "Checking connected platforms...",
  one_search_actions: (input) => `Searching ${input?.platform || "platform"} actions...`,
  one_get_action_knowledge: "Reading action details...",
  one_execute_action: (input) => `Running ${input?.platform || "platform"} action...`,
};

// --- Anthropic API with tool use loop ---

export type ToolCallCallback = (toolName: string, input: Record<string, unknown>, output: string, durationMs: number) => void;

export async function callAnthropic(
  model: string,
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number,
  onStatus?: StatusCallback,
  onToolCall?: ToolCallCallback
): Promise<AIResponse> {
  const tools: any[] = [
    { type: "web_search_20250305", name: "web_search" },
    ...SCHEDULING_TOOLS,
    ...MEMORY_TOOLS,
    ...CONTEXT_TOOLS,
    ...CODE_EXECUTION_TOOLS,
    ...PDF_TOOLS,
    ...BROWSER_TOOLS,
    ...IMAGE_SEARCH_TOOLS,
  ];

  // Conditionally add messaging tools based on connected integrations
  if (isSlackRunning()) tools.push(...SLACK_MESSAGING_TOOLS);
  if (isEmailRunning()) tools.push(...EMAIL_MESSAGING_TOOLS);
  if (isSupabaseRunning()) {
    const perms = getSupabasePermissions();
    tools.push(...SUPABASE_READ_TOOLS);
    if (perms.includes("insert")) tools.push(...SUPABASE_INSERT_TOOLS);
    if (perms.includes("update")) tools.push(...SUPABASE_UPDATE_TOOLS);
  }
  if (isAirtableRunning()) tools.push(...AIRTABLE_TOOLS);
  if (isNotionRunning()) tools.push(...NOTION_TOOLS);
  if (isBufferRunning()) tools.push(...BUFFER_TOOLS);
  if (isLumaRunning()) tools.push(...LUMA_TOOLS);
  if (isTwitterRunning()) tools.push(...TWITTER_TOOLS);
  if (isBeehiivRunning()) tools.push(...BEEHIIV_TOOLS);
  if (isOneRunning()) tools.push(...ONE_TOOLS);

  // Conditionally add Google tools based on connected services
  const googleServices = getConnectedServices();
  if (googleServices) {
    if (googleServices.includes("gmail")) {
      tools.push(...GOOGLE_GMAIL_TOOLS);
      if (googleServices.includes("gmail_send")) tools.push(...GOOGLE_GMAIL_SEND_TOOLS);
    }
    if (googleServices.includes("calendar")) tools.push(...GOOGLE_CALENDAR_TOOLS);
    if (googleServices.includes("drive")) tools.push(...GOOGLE_DRIVE_TOOLS);
    if (googleServices.includes("contacts")) tools.push(...GOOGLE_CONTACTS_TOOLS);
    if (googleServices.includes("docs")) tools.push(...GOOGLE_DOCS_TOOLS);
    if (googleServices.includes("sheets")) tools.push(...GOOGLE_SHEETS_TOOLS);
  }

  // Only add public Google Doc tool if Drive is not connected (Drive has full OAuth access)
  if (!googleServices || !googleServices.includes("drive")) {
    tools.push(...PUBLIC_GDOC_TOOLS);
  }

  const apiMessages: any[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const MAX_TOOL_ROUNDS = 50;
  const toolCallLog: string[] = []; // track tool+input fingerprints for loop detection
  const MAX_REPEAT_CALLS = 2; // allow same tool+input at most twice
  let lastScreenshot: string | null = null; // track the most recent screenshot base64
  let lastTwitterResult: string | null = null; // track last twitter tool result for fallback

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (round > 0 && round % 10 === 0) console.log(`Tool loop round ${round}/${MAX_TOOL_ROUNDS}`);
    onStatus?.(getThinkingMessage(round));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        messages: apiMessages,
        temperature,
        tools,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${body}`);
    }

    const data: any = await res.json();

    // Find our custom tool_use blocks (not web_search which is server-side)
    const customToolUseBlocks = (data.content || []).filter(
      (b: any) => b.type === "tool_use" && b.name !== "web_search"
    );

    // Detect built-in web_search (server-side tool)
    const hasWebSearch = (data.content || []).some(
      (b: any) => b.type === "web_search_tool_result" || (b.type === "server_tool_use" && b.name === "web_search")
    );
    if (hasWebSearch) onStatus?.("Searching the web...");

    if (data.stop_reason === "tool_use" && customToolUseBlocks.length > 0) {
      // Append assistant response with tool_use blocks
      apiMessages.push({ role: "assistant", content: data.content });

      // Execute each tool and build results
      const toolResults: any[] = [];
      const memoryTools = ["save_memory", "list_memories", "delete_memory", "update_context"];
      const codeTools = ["run_command", "read_file", "write_file"];
      const pdfTools = ["pdf_get_fields", "pdf_fill_form", "pdf_read_text"];
      const googleToolNames = [
        "gmail_search", "gmail_read_message", "gmail_get_attachment", "gmail_send", "gmail_create_draft", "gmail_label", "gmail_list_aliases",
        "calendar_list_events", "calendar_create_event", "calendar_update_event",
        "drive_search", "drive_read_file", "drive_open_url",
        "contacts_search",
        "docs_create", "docs_read", "docs_append", "docs_insert", "docs_suggest_edit", "docs_format_text", "docs_paragraph_style", "docs_list", "docs_insert_image", "docs_replace_text",
        "sheets_create", "sheets_read", "sheets_write", "sheets_append", "sheets_list_sheets",
      ];
      const browserToolNames = ["browse_webpage", "browser_click", "browser_type", "browser_screenshot", "browser_get_content"];
      const messagingToolNames = ["send_slack", "slack_channel_members", "send_lobstermail", "check_lobstermail"];
      const supabaseToolNames = ["supabase_list_tables", "supabase_describe_table", "supabase_query", "supabase_insert", "supabase_update"];
      const airtableToolNames = ["airtable_list_bases", "airtable_list_tables", "airtable_list_records"];
      const notionToolNames = ["notion_search", "notion_get_page", "notion_get_page_content", "notion_create_page", "notion_update_page", "notion_query_database", "notion_get_database"];
      const bufferToolNames = ["buffer_list_channels", "buffer_create_post", "buffer_list_posts", "buffer_delete_post"];
      const lumaToolNames = ["luma_list_events", "luma_get_event", "luma_create_event", "luma_update_event", "luma_get_guests", "luma_add_guests", "luma_send_invites"];
      const twitterToolNames = ["twitter_get_me", "twitter_post_tweet", "twitter_post_thread", "twitter_get_recent_tweets", "twitter_delete_tweet", "twitter_lookup_tweet", "twitter_retweet", "twitter_undo_retweet"];
      const beehiivToolNames = ["beehiiv_list_templates", "beehiiv_create_draft", "beehiiv_list_posts", "beehiiv_get_post"];
      const oneToolNames = ["one_list_connections", "one_search_actions", "one_get_action_knowledge", "one_execute_action"];
      for (const toolBlock of customToolUseBlocks) {
        console.log(`Tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input).slice(0, 200));

        // Emit tool-specific status
        const statusEntry = TOOL_STATUS_MAP[toolBlock.name];
        if (statusEntry && onStatus) {
          onStatus(typeof statusEntry === "function" ? statusEntry(toolBlock.input) : statusEntry);
        }

        // Loop detection: skip if same tool+input called too many times
        const fingerprint = `${toolBlock.name}:${JSON.stringify(toolBlock.input)}`;
        const repeatCount = toolCallLog.filter((f) => f === fingerprint).length;
        toolCallLog.push(fingerprint);
        if (repeatCount >= MAX_REPEAT_CALLS) {
          console.log(`Loop detected: ${toolBlock.name} called ${repeatCount + 1} times with same input, skipping`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: "This tool was already called with the same input. Try a different approach or provide your answer based on the information you already have." }),
          });
          continue;
        }

        const toolStartTime = Date.now();
        let result: string | any[];
        if (memoryTools.includes(toolBlock.name)) {
          result = executeMemoryTool(toolBlock.name, toolBlock.input);
        } else if (codeTools.includes(toolBlock.name)) {
          result = await executeCodeTool(toolBlock.name, toolBlock.input);
        } else if (pdfTools.includes(toolBlock.name)) {
          result = await executePdfTool(toolBlock.name, toolBlock.input);
        } else if (toolBlock.name === "open_google_doc") {
          result = await executePublicGDocTool(toolBlock.input);
        } else if (toolBlock.name === "find_image") {
          result = await executeFindImage(toolBlock.input);
        } else if (browserToolNames.includes(toolBlock.name)) {
          result = await executeBrowserTool(toolBlock.name, toolBlock.input);
        } else if (messagingToolNames.includes(toolBlock.name)) {
          result = await executeMessagingTool(toolBlock.name, toolBlock.input);
        } else if (googleToolNames.includes(toolBlock.name)) {
          result = await executeGoogleTool(toolBlock.name, toolBlock.input);
        } else if (supabaseToolNames.includes(toolBlock.name)) {
          result = await executeSupabaseTool(toolBlock.name, toolBlock.input);
        } else if (airtableToolNames.includes(toolBlock.name)) {
          result = await executeAirtableTool(toolBlock.name, toolBlock.input);
        } else if (notionToolNames.includes(toolBlock.name)) {
          result = await executeNotionTool(toolBlock.name, toolBlock.input);
        } else if (bufferToolNames.includes(toolBlock.name)) {
          result = await executeBufferTool(toolBlock.name, toolBlock.input);
        } else if (lumaToolNames.includes(toolBlock.name)) {
          result = await executeLumaTool(toolBlock.name, toolBlock.input);
        } else if (twitterToolNames.includes(toolBlock.name)) {
          result = await executeTwitterTool(toolBlock.name, toolBlock.input);
        } else if (beehiivToolNames.includes(toolBlock.name)) {
          result = await executeBeehiivTool(toolBlock.name, toolBlock.input);
        } else if (oneToolNames.includes(toolBlock.name)) {
          result = await executeOneTool(toolBlock.name, toolBlock.input);
        } else {
          result = executeSchedulingTool(toolBlock.name, toolBlock.input);
        }
        const toolDurationMs = Date.now() - toolStartTime;
        console.log(`Tool result: ${toolBlock.name}`, typeof result === "string" ? result.slice(0, 300) : "[multipart content]");
        const toolOutputStr = typeof result === "string" ? result : JSON.stringify(result);
        onToolCall?.(toolBlock.name, toolBlock.input, toolOutputStr.slice(0, 2000), toolDurationMs);

        // Save the latest screenshot so we can include it in the final response
        if (toolBlock.name === "browser_screenshot" && Array.isArray(result)) {
          const imgBlock = result.find((b: any) => b.type === "image" && b.source?.type === "base64");
          if (imgBlock) lastScreenshot = imgBlock.source.data;
        }

        // Track Twitter post results for empty-response fallback
        if ((toolBlock.name === "twitter_post_tweet" || toolBlock.name === "twitter_post_thread") && typeof result === "string") {
          lastTwitterResult = result;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        } as any);
      }

      apiMessages.push({ role: "user", content: toolResults });
      continue;
    }

    // No more custom tool calls — extract final text (and inline images)
    onStatus?.("Writing response...");

    // Log empty responses for debugging
    const contentTypes = (data.content || []).map((b: any) => b.type);
    if (!contentTypes.includes("text")) {
      console.log(`Empty response — stop_reason: ${data.stop_reason}, content types: [${contentTypes.join(", ")}], round: ${round}, messages: ${apiMessages.length}`);
    }

    const parts: string[] = [];
    for (const block of data.content || []) {
      if (block.type === "text") parts.push(block.text);
      else if (block.type === "image" && block.source?.type === "base64") {
        parts.push(`![image](data:${block.source.media_type};base64,${block.source.data})`);
        lastScreenshot = null; // Claude included an image, don't duplicate
      }
    }
    // If Claude took a screenshot but didn't include it in the response, append it
    const hasImage = parts.some((p) => p.includes("![") && (p.includes("data:image") || p.includes("https://")));
    if (lastScreenshot && !hasImage) {
      parts.push(`![screenshot](data:image/png;base64,${lastScreenshot})`);
    }

    // Auto-convert bare image URLs in the response to markdown images
    let text = parts.join("\n\n").trim();
    text = text.replace(/(^|[\s(])((https?:\/\/[^\s"'<>)]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s"'<>)]*)?))(?=[\s),.]|$)/gim, (match, prefix, url) => {
      // Don't convert if already inside markdown image syntax
      const pos = text.indexOf(match);
      const before = text.slice(Math.max(0, pos - 5), pos);
      if (before.includes("](")) return match;
      return `${prefix}\n\n![image](${url})\n\n`;
    });

    // Clean up malformed nested image markdown: ![alt](\n![image](url)\n) -> ![image](url)
    text = text.replace(/!\[[^\]]*\]\(\s*\n*!\[([^\]]*)\]\(([^)\s]+)\)\s*\n*\)/g, '![$1]($2)');
    // Remove image tags with empty/whitespace-only URLs
    text = text.replace(/!\[[^\]]*\]\(\s*\)/g, '');
    // Collapse excessive blank lines
    text = text.replace(/\n{3,}/g, '\n\n');

    // If the model returned empty text but we have a Twitter result, build a fallback response
    if (!text.trim() && lastTwitterResult) {
      try {
        const twitterData = JSON.parse(lastTwitterResult);
        if (twitterData.success && twitterData.thread_url) {
          const tweetLines = (twitterData.tweets || []).map((t: any, i: number) => `${i + 1}. ${t.url}`).join("\n");
          text = `Your thread was posted successfully! (${twitterData.count} tweets)\n\n${tweetLines}\n\nThread: ${twitterData.thread_url}`;
        } else if (twitterData.success && twitterData.tweet_id) {
          text = `Tweet posted successfully!\n\n${twitterData.url}`;
        } else if (twitterData.error) {
          text = `Twitter error: ${twitterData.error}`;
        }
      } catch { /* not valid JSON, ignore */ }
    }

    return { role: "assistant", content: text.trim() || "Sorry, I wasn't able to generate a response. Could you try again?" };
  }

  return { role: "assistant", content: "Hmmm...this was pretty complex and I hit a tool limit. Could you break this into smaller steps or ask again in a simpler way? For example, instead of asking me to do everything at once, try one piece at a time." };
}

export async function callOpenAI(
  model: string,
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number,
  onStatus?: StatusCallback,
  onToolCall?: ToolCallCallback
): Promise<AIResponse> {
  // Build tools list (same as Anthropic minus server-side web_search)
  const customTools: any[] = [
    ...SCHEDULING_TOOLS,
    ...MEMORY_TOOLS,
    ...CONTEXT_TOOLS,
    ...CODE_EXECUTION_TOOLS,
    ...PDF_TOOLS,
    ...BROWSER_TOOLS,
    ...IMAGE_SEARCH_TOOLS,
  ];
  if (isSlackRunning()) customTools.push(...SLACK_MESSAGING_TOOLS);
  if (isEmailRunning()) customTools.push(...EMAIL_MESSAGING_TOOLS);
  if (isSupabaseRunning()) {
    const perms = getSupabasePermissions();
    customTools.push(...SUPABASE_READ_TOOLS);
    if (perms.includes("insert")) customTools.push(...SUPABASE_INSERT_TOOLS);
    if (perms.includes("update")) customTools.push(...SUPABASE_UPDATE_TOOLS);
  }
  if (isAirtableRunning()) customTools.push(...AIRTABLE_TOOLS);
  if (isNotionRunning()) customTools.push(...NOTION_TOOLS);
  if (isBufferRunning()) customTools.push(...BUFFER_TOOLS);
  if (isLumaRunning()) customTools.push(...LUMA_TOOLS);
  if (isTwitterRunning()) customTools.push(...TWITTER_TOOLS);
  if (isBeehiivRunning()) customTools.push(...BEEHIIV_TOOLS);
  if (isOneRunning()) customTools.push(...ONE_TOOLS);
  const googleServices = getConnectedServices();
  if (googleServices) {
    if (googleServices.includes("gmail")) {
      customTools.push(...GOOGLE_GMAIL_TOOLS);
      if (googleServices.includes("gmail_send")) customTools.push(...GOOGLE_GMAIL_SEND_TOOLS);
    }
    if (googleServices.includes("calendar")) customTools.push(...GOOGLE_CALENDAR_TOOLS);
    if (googleServices.includes("drive")) customTools.push(...GOOGLE_DRIVE_TOOLS);
    if (googleServices.includes("contacts")) customTools.push(...GOOGLE_CONTACTS_TOOLS);
    if (googleServices.includes("docs")) customTools.push(...GOOGLE_DOCS_TOOLS);
    if (googleServices.includes("sheets")) customTools.push(...GOOGLE_SHEETS_TOOLS);
  }
  if (!googleServices || !googleServices.includes("drive")) {
    customTools.push(...PUBLIC_GDOC_TOOLS);
  }

  // Convert to OpenAI function calling format
  const openaiTools = customTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));

  const allMessages: any[] = [];
  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }
  allMessages.push(
    ...messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }))
  );

  // Tool dispatch categories
  const memoryTools = ["save_memory", "list_memories", "delete_memory", "update_context"];
  const codeTools = ["run_command", "read_file", "write_file"];
  const pdfTools = ["pdf_get_fields", "pdf_fill_form", "pdf_read_text"];
  const googleToolNames = [
    "gmail_search", "gmail_read_message", "gmail_get_attachment", "gmail_send", "gmail_create_draft", "gmail_label", "gmail_list_aliases",
    "calendar_list_events", "calendar_create_event", "calendar_update_event",
    "drive_search", "drive_read_file", "drive_open_url",
    "contacts_search",
    "docs_create", "docs_read", "docs_append", "docs_insert", "docs_suggest_edit", "docs_format_text", "docs_paragraph_style", "docs_list", "docs_insert_image", "docs_replace_text",
    "sheets_create", "sheets_read", "sheets_write", "sheets_append", "sheets_list_sheets",
  ];
  const browserToolNames = ["browse_webpage", "browser_click", "browser_type", "browser_screenshot", "browser_get_content"];
  const messagingToolNames = ["send_slack", "slack_channel_members", "send_lobstermail", "check_lobstermail"];
  const supabaseToolNames = ["supabase_list_tables", "supabase_describe_table", "supabase_query", "supabase_insert", "supabase_update"];
  const airtableToolNames = ["airtable_list_bases", "airtable_list_tables", "airtable_list_records"];
  const notionToolNames = ["notion_search", "notion_get_page", "notion_get_page_content", "notion_create_page", "notion_update_page", "notion_query_database", "notion_get_database"];
  const bufferToolNames = ["buffer_list_profiles", "buffer_create_post", "buffer_get_pending", "buffer_get_sent"];
  const lumaToolNames = ["luma_list_events", "luma_get_event", "luma_create_event", "luma_update_event", "luma_get_guests", "luma_add_guests", "luma_send_invites"];
  const twitterToolNames = ["twitter_get_me", "twitter_post_tweet", "twitter_post_thread", "twitter_get_recent_tweets", "twitter_delete_tweet", "twitter_lookup_tweet", "twitter_retweet", "twitter_undo_retweet"];
  const beehiivToolNames = ["beehiiv_list_templates", "beehiiv_create_draft", "beehiiv_list_posts", "beehiiv_get_post"];
  const oneToolNames = ["one_list_connections", "one_search_actions", "one_get_action_knowledge", "one_execute_action"];

  const MAX_TOOL_ROUNDS = 50;
  const toolCallLog: string[] = [];
  const MAX_REPEAT_CALLS = 2;
  let lastTwitterResult: string | null = null; // track last twitter tool result for fallback

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (round > 0 && round % 10 === 0) console.log(`Tool loop round ${round}/${MAX_TOOL_ROUNDS}`);
    onStatus?.(getThinkingMessage(round));

    const reqBody: any = {
      model,
      messages: allMessages,
      temperature,
      max_tokens: maxTokens,
    };
    if (openaiTools.length > 0) reqBody.tools = openaiTools;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${body}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    // Check for tool calls
    if (message?.tool_calls && message.tool_calls.length > 0) {
      // Append assistant message (includes tool_calls metadata)
      allMessages.push(message);

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        let toolInput: any;
        try {
          toolInput = JSON.parse(toolCall.function.arguments);
        } catch {
          toolInput = {};
        }

        console.log(`Tool call: ${toolName}`, JSON.stringify(toolInput).slice(0, 200));

        // Emit tool-specific status
        const statusEntry = TOOL_STATUS_MAP[toolName];
        if (statusEntry && onStatus) {
          onStatus(typeof statusEntry === "function" ? statusEntry(toolInput) : statusEntry);
        }

        // Loop detection
        const fingerprint = `${toolName}:${JSON.stringify(toolInput)}`;
        const repeatCount = toolCallLog.filter((f) => f === fingerprint).length;
        toolCallLog.push(fingerprint);
        if (repeatCount >= MAX_REPEAT_CALLS) {
          console.log(`Loop detected: ${toolName} called ${repeatCount + 1} times with same input, skipping`);
          allMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: "This tool was already called with the same input. Try a different approach." }),
          });
          continue;
        }

        const toolStartTime = Date.now();
        let result: string | any[];
        if (memoryTools.includes(toolName)) {
          result = executeMemoryTool(toolName, toolInput);
        } else if (codeTools.includes(toolName)) {
          result = await executeCodeTool(toolName, toolInput);
        } else if (pdfTools.includes(toolName)) {
          result = await executePdfTool(toolName, toolInput);
        } else if (toolName === "open_google_doc") {
          result = await executePublicGDocTool(toolInput);
        } else if (toolName === "find_image") {
          result = await executeFindImage(toolInput);
        } else if (browserToolNames.includes(toolName)) {
          result = await executeBrowserTool(toolName, toolInput);
        } else if (messagingToolNames.includes(toolName)) {
          result = await executeMessagingTool(toolName, toolInput);
        } else if (googleToolNames.includes(toolName)) {
          result = await executeGoogleTool(toolName, toolInput);
        } else if (supabaseToolNames.includes(toolName)) {
          result = await executeSupabaseTool(toolName, toolInput);
        } else if (airtableToolNames.includes(toolName)) {
          result = await executeAirtableTool(toolName, toolInput);
        } else if (notionToolNames.includes(toolName)) {
          result = await executeNotionTool(toolName, toolInput);
        } else if (bufferToolNames.includes(toolName)) {
          result = await executeBufferTool(toolName, toolInput);
        } else if (lumaToolNames.includes(toolName)) {
          result = await executeLumaTool(toolName, toolInput);
        } else if (twitterToolNames.includes(toolName)) {
          result = await executeTwitterTool(toolName, toolInput);
        } else if (beehiivToolNames.includes(toolName)) {
          result = await executeBeehiivTool(toolName, toolInput);
        } else if (oneToolNames.includes(toolName)) {
          result = await executeOneTool(toolName, toolInput);
        } else {
          result = executeSchedulingTool(toolName, toolInput);
        }
        const toolDurationMs = Date.now() - toolStartTime;

        console.log(`Tool result: ${toolName}`, typeof result === "string" ? result.slice(0, 300) : "[multipart content]");

        // Track Twitter post results for empty-response fallback
        if ((toolName === "twitter_post_tweet" || toolName === "twitter_post_thread") && typeof result === "string") {
          lastTwitterResult = result;
        }

        // OpenAI tool results must be strings
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        onToolCall?.(toolName, toolInput, resultStr.slice(0, 2000), toolDurationMs);

        allMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultStr,
        });
      }
      continue;
    }

    // No tool calls — return final text
    onStatus?.("Writing response...");
    let text = (message?.content || "").trim();

    // Clean up malformed markdown
    text = text.replace(/!\[[^\]]*\]\(\s*\n*!\[([^\]]*)\]\(([^)\s]+)\)\s*\n*\)/g, '![$1]($2)');
    text = text.replace(/!\[[^\]]*\]\(\s*\)/g, '');
    text = text.replace(/\n{3,}/g, '\n\n');

    // If the model returned empty text but we have a Twitter result, build a fallback response
    if (!text && lastTwitterResult) {
      try {
        const twitterData = JSON.parse(lastTwitterResult);
        if (twitterData.success && twitterData.thread_url) {
          const tweetLines = (twitterData.tweets || []).map((t: any, i: number) => `${i + 1}. ${t.url}`).join("\n");
          text = `Your thread was posted successfully! (${twitterData.count} tweets)\n\n${tweetLines}\n\nThread: ${twitterData.thread_url}`;
        } else if (twitterData.success && twitterData.tweet_id) {
          text = `Tweet posted successfully!\n\n${twitterData.url}`;
        } else if (twitterData.error) {
          text = `Twitter error: ${twitterData.error}`;
        }
      } catch { /* not valid JSON, ignore */ }
    }

    return { role: "assistant", content: text || "Sorry, I wasn't able to generate a response. Could you try again?" };
  }

  return { role: "assistant", content: "Hmmm...this was pretty complex and I hit a tool limit. Could you break this into smaller steps or ask again in a simpler way? For example, instead of asking me to do everything at once, try one piece at a time." };
}

/**
 * Generate a plain-text email reply with NO tools, NO conversation history.
 * Used by the Gmail poller to get draft text without side effects.
 */
export async function generateEmailReply(emailContent: string, memories: string[], senderEmail: string): Promise<string> {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const provider = getProvider(model);
  const apiKey = getApiKey(provider);
  const userName = getSetting("user_name") || senderEmail;

  const systemPrompt = [
    `You are ghostwriting a Gmail reply as ${userName} (${senderEmail}).`,
    `YOUR OUTPUT IS THE EMAIL BODY. It will be placed directly into a Gmail draft with zero editing.`,
    ``,
    `RULES:`,
    `- Output ONLY the email text. Nothing else.`,
    `- Do NOT include any thinking, analysis, reasoning, or commentary.`,
    `- Do NOT start with "Here's", "I'll", "Let me", "Sure", "Based on", or any meta-commentary.`,
    `- Do NOT mention that you are drafting, writing, or composing anything.`,
    `- Do NOT analyze whether to reply or not — always write the reply.`,
    `- Do NOT discuss the sender, the thread, or your decision process.`,
    `- Start directly with the greeting (e.g. "Hi [Name],") or the first sentence of the reply.`,
    `- Write as ${userName}, in their voice. Be concise and professional.`,
    `- Do not reveal that you are an AI.`,
    memories.length > 0 ? `\nContext about ${userName}:\n${memories.map(m => `- ${m}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const messages = [{ role: "user" as const, content: emailContent }];

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${body}`);
    }
    const data: any = await res.json();
    const raw = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return cleanEmailDraft(raw);
  } else {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${body}`);
    }
    const data: any = await res.json();
    return cleanEmailDraft(data.choices?.[0]?.message?.content || "");
  }
}

/** Strip AI preamble/thinking that leaks into email drafts */
function cleanEmailDraft(text: string): string {
  if (!text) return text;
  // Remove common preamble lines at the start
  const preamblePatterns = [
    /^(here'?s?\s+(a\s+)?(draft|my|the)\s+(reply|response|email).*?:\s*\n*)/i,
    /^(i'?ll\s+draft.*?:\s*\n*)/i,
    /^(let\s+me\s+draft.*?:\s*\n*)/i,
    /^(sure[,!.]?\s*(here'?s?.*?)?\s*\n*)/i,
    /^(based\s+on.*?:\s*\n*)/i,
    /^(draft\s+(reply|response|email).*?:\s*\n*)/i,
    /^(i\s+should\s+(not\s+)?.*?\.\s*\n*)/i,
    /^(this\s+email\s+(is|was|appears).*?\.\s*\n*)/i,
    /^(the\s+(latest|last|most recent)\s+(message|email).*?\.\s*\n*)/i,
    /^(since\s+this.*?\.\s*\n*)/i,
  ];
  let cleaned = text;
  for (const pattern of preamblePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  // Remove trailing "---" or "Note:" meta-commentary
  cleaned = cleaned.replace(/\n---\n[\s\S]*$/m, "");
  cleaned = cleaned.replace(/\n\*?Note:?\*?\s+.*$/im, "");
  return cleaned.trim();
}

export function buildSystemPrompt(extraContext?: string, options?: { skipMemories?: boolean }): string {
  let systemPrompt = getSetting("system_prompt") || "";

  // Inject agent name
  const agentName = getSetting("agent_name");
  if (agentName) {
    const nameContext = `Your name is ${agentName}. Always refer to yourself as ${agentName}, never as Claude or any other name.`;
    systemPrompt = nameContext + (systemPrompt ? `\n\n${systemPrompt}` : "");
  }

  // Inject user timezone with explicit UTC offset for accurate conversions
  const userTimezone = getSetting("timezone") || "America/Los_Angeles";
  const now = new Date();
  const localNow = new Intl.DateTimeFormat("en-US", { timeZone: userTimezone, dateStyle: "full", timeStyle: "long" }).format(now);
  // Compute the exact current UTC offset for this timezone (handles DST automatically)
  const utcOffsetMinutes = (() => {
    const utcStr = now.toLocaleString("en-US", { timeZone: "UTC" });
    const localStr = now.toLocaleString("en-US", { timeZone: userTimezone });
    const diffMs = new Date(localStr).getTime() - new Date(utcStr).getTime();
    return Math.round(diffMs / 60000);
  })();
  const offsetHours = Math.floor(Math.abs(utcOffsetMinutes) / 60);
  const offsetMins = Math.abs(utcOffsetMinutes) % 60;
  const offsetSign = utcOffsetMinutes >= 0 ? "+" : "-";
  const utcOffsetStr = `UTC${offsetSign}${offsetHours}${offsetMins ? `:${String(offsetMins).padStart(2, "0")}` : ""}`;
  const tzContext = `The current date and time is ${localNow} (${userTimezone}, currently ${utcOffsetStr}). The user's timezone is ${userTimezone} which is currently ${utcOffsetStr}. ALWAYS convert any timestamps, dates, or times to the user's local timezone (${userTimezone}) before presenting them. This applies to ALL responses — event times from Luma/Calendar, email timestamps, scheduled job times, or any other time data from tools. Never show raw UTC or ISO timestamps to the user. Format times naturally (e.g. "Tuesday, March 25 at 3:00 PM PT"). When providing ISO 8601 timestamps to tools (e.g. due_at, start_at), you may pass the time in the user's local timezone as an ISO 8601 string WITHOUT a Z suffix (e.g. '2026-03-25T09:30:00') — the system will convert it to UTC using the user's timezone (${userTimezone}, ${utcOffsetStr}). You can also pass UTC directly with a Z suffix. Cron expressions in create_scheduled_job are interpreted in the user's local timezone, so use the user's local time directly — do NOT convert to UTC for cron.`;
  systemPrompt = systemPrompt ? `${systemPrompt}\n\n${tzContext}` : tzContext;

  if (extraContext) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${extraContext}` : extraContext;
  }

  // Inject structured context fields
  const contextSections: string[] = [];
  const ctxCompany = getSetting("context_company");
  if (ctxCompany) contextSections.push(`[Company Context]\n${ctxCompany}`);
  const ctxUser = getSetting("context_user");
  if (ctxUser) contextSections.push(`[About the User]\n${ctxUser}`);
  const ctxRules = getSetting("context_rules");
  if (ctxRules) contextSections.push(`[Rules & Guidelines]\n${ctxRules}`);
  const ctxKnowledge = getSetting("context_knowledge");
  if (ctxKnowledge) contextSections.push(`[Knowledge Base]\n${ctxKnowledge}`);
  if (contextSections.length > 0) {
    const structuredContext = contextSections.join("\n\n");
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${structuredContext}` : structuredContext;
  }

  // Inject connected email address and recent email conversations
  try {
    const emailIntegration = getIntegration("email");
    if (emailIntegration && emailIntegration.status === "connected") {
      const emailConfig = JSON.parse(decrypt(emailIntegration.config));
      if (emailConfig.email_address) {
        let emailContext = `You are connected to LobsterMail and can receive and send emails. Never reveal your email address to users in chat — just say you're connected to LobsterMail.`;

        const emailConversations = getConversationsByType("email");
        if (emailConversations.length > 0) {
          const summaries: string[] = [];
          for (const conv of emailConversations.slice(0, 5)) {
            const msgs = getMessages(conv.id, 10);
            if (msgs.length === 0) continue;
            const lines = msgs.map((m) => `  ${m.role === "user" ? conv.external_id : "You"}: ${m.content.slice(0, 200)}`);
            summaries.push(`Email thread with ${conv.external_id}:\n${lines.join("\n")}`);
          }
          if (summaries.length > 0) {
            emailContext += `\n\nRecent email conversations:\n${summaries.join("\n\n")}`;
          }
        }

        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${emailContext}` : emailContext;
      }
    }
  } catch {}

  // Inject cross-channel messaging context
  {
    const channels: string[] = [];
    if (isSlackRunning()) channels.push("Slack (use send_slack tool to message other channels — never use it to reply to the current Slack conversation). You can also receive and transcribe audio messages and voice clips shared in Slack — transcription happens automatically.");
    if (isEmailRunning()) channels.push("Email/LobsterMail (use check_lobstermail to check inbox, send_lobstermail to send)");
    if (channels.length > 0) {
      const msgContext = `You can send messages on the following channels at any time: ${channels.join(", ")}. Use these tools to proactively reach out or relay messages across channels when asked.`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msgContext}` : msgContext;
    }
  }

  // Inject Google context (multi-account)
  try {
    const accounts = getGoogleAccounts();
    if (accounts.length > 0) {
      const allSvcs = new Set<string>();
      for (const a of accounts) {
        for (const s of a.services) allSvcs.add(s);
      }
      let googleContext = `You are connected to ${accounts.length} Google account${accounts.length > 1 ? 's' : ''}. Never reveal the connected email addresses to users in chat — just say you're connected to Google.`;
      if (accounts.length > 1) {
        googleContext += ` When performing Google actions, you can specify which account to use with the 'account' parameter. If not specified, the first account is used.`;
      }
      if (allSvcs.has("gmail")) {
        if (allSvcs.has("gmail_send")) {
          googleContext += " You can search, read, draft, send, and label Gmail messages. Use gmail_list_aliases to see available send-as addresses, and use the 'from' parameter to send from an alias. IMPORTANT: When replying to an email, ALWAYS use reply-all by default — include all original To/CC recipients in the 'cc' field, set 'thread_id' from the original message's threadId, and set 'in_reply_to' from the original message's messageId. This keeps the reply in the same Gmail thread and ensures everyone stays in the loop.";
        } else {
          googleContext += " You can search, read, and label Gmail messages. Drafting and sending are not enabled.";
        }
      }
      // Gmail email rules
      try {
        const gmailRules = JSON.parse(getSetting("gmail_email_rules") || "{}");
        if (gmailRules.mode === "domains" && gmailRules.domains?.length > 0) {
          googleContext += ` IMPORTANT: You may only read and respond to Gmail emails from these domains: ${gmailRules.domains.join(", ")}. Do not draft, send, or respond to emails from anyone outside these domains.`;
        } else if (gmailRules.mode === "addresses" && gmailRules.addresses?.length > 0) {
          googleContext += ` IMPORTANT: You may only read and respond to Gmail emails from these addresses: ${gmailRules.addresses.join(", ")}. Do not draft, send, or respond to emails from anyone else.`;
        }
      } catch {}
      if (allSvcs.has("calendar")) googleContext += " You can view, create, update, and delete Google Calendar events.";
      if (allSvcs.has("drive")) googleContext += " You can search and read Google Drive files including Google Docs, Sheets, and Slides.";
      if (allSvcs.has("contacts")) googleContext += " You can search Google Contacts.";
      if (allSvcs.has("docs")) googleContext += " You can create, read, and edit Google Docs using the docs_* tools. Use docs_create to make new documents, docs_read to read content (including all tabs), and docs_append or docs_insert to add text. Use docs_format_text to change text formatting (bold, italic, underline, strikethrough, font size, font family, text color, and hyperlinks). Use docs_paragraph_style to change paragraph-level formatting (headings, alignment, line spacing). Use docs_list to convert text into bullet or numbered lists. Use docs_insert_image to add images from URLs. IMPORTANT — EDITING EXISTING TEXT: When the user asks you to edit, revise, rewrite, or update existing text in a Google Doc, ALWAYS use docs_suggest_edit. This marks the original text in red strikethrough and inserts the replacement in blue, so the user can review the change. NEVER use docs_replace_text to edit content — that does a destructive overwrite with no way to review. Only use docs_replace_text for mechanical bulk operations (like removing all emojis or fixing a repeated typo). For docs with multiple tabs: docs_read returns all tabs with their tabId and title. To write to a specific tab, pass the tab_id parameter. If the user refers to a tab by name or content, use docs_read first to find the matching tab, then use its tabId. IMPORTANT: When docs_append returns success, the text IS at the end of the document — do NOT re-read to verify and do NOT retry with docs_insert.";
      if (allSvcs.has("sheets")) googleContext += " You can create, read, and write Google Sheets using the sheets_* tools. Use sheets_list_sheets to see tabs, sheets_read to read cell ranges, sheets_write to update cells, and sheets_append to add rows.";
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${googleContext}` : googleContext;
    }
  } catch {}

  // Inject Supabase context
  if (isSupabaseRunning()) {
    const projectUrl = getSupabaseProjectUrl();
    const perms = getSupabasePermissions();
    const abilities = ["list tables and query records"];
    if (perms.includes("insert")) abilities.push("insert new records");
    if (perms.includes("update")) abilities.push("update existing records");
    const supabaseContext = `You are connected to a Supabase database${projectUrl ? ` (${projectUrl})` : ""}. You can ${abilities.join(", ")} using the supabase_* tools.
CRITICAL Supabase query rules:
1. ALWAYS call supabase_describe_table first to see column names and types before querying.
2. If you're unsure which columns contain the data the user needs, show them a list of relevant column names and ask which ones to query. Don't guess — ask.
3. For array columns (type: "array"), use cs.{value} to filter (contains), NEVER use eq or ilike on arrays.
4. If a query times out or returns a 500 error, do NOT keep retrying different tables. After 2 failed queries, STOP and tell the user which tables/views timed out and suggest they try a smaller query or ask their database admin to add indexes.
5. Select ONLY 2-5 columns per query. Never select more than 5 columns at once.
6. Always use a small limit (10-20). You can ask for more if the first batch works.
7. Prefer fetching a broader set with a small limit and filtering the results yourself rather than using complex PostgREST filters that may timeout on unindexed tables.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${supabaseContext}` : supabaseContext;
  }

  // Inject Airtable context
  if (isAirtableRunning()) {
    const airtableContext = "You are connected to Airtable. You can list bases, list tables, and read/create/update records using the airtable_* tools. Use airtable_list_bases first to discover available bases, then airtable_list_tables to see table schemas.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${airtableContext}` : airtableContext;
  }

  // Inject Notion context
  if (isNotionRunning()) {
    const workspaceName = getNotionWorkspaceName();
    const notionContext = `You are connected to Notion${workspaceName ? ` (workspace: ${workspaceName})` : ""}. You can search pages and databases, read page content, create and update pages, and query databases using the notion_* tools. Use notion_search to find content, notion_get_database to see a database's schema before querying it, and notion_query_database to list records. You can create pages with notion_create_page and update them with notion_update_page. You cannot delete pages or databases.

IMPORTANT — Notion workspaces can be large and complex with many pages, databases, and nested structures. Before creating or editing Notion content, ALWAYS ask clarifying questions first:
- Where should the page go? (Which database, parent page, or section?)
- What properties or fields should it have?
- What format or structure do they want?
- If updating, confirm which specific page they mean (search first and present options if ambiguous).
Do NOT guess or assume — ask the user to confirm before making changes. When the request is vague (e.g. "add a page to Notion"), search first to understand the workspace structure, then ask where they want it and what it should contain.
Before actually creating or updating a page, show the user a preview of what you plan to write (title, content, properties) and get their explicit approval. Never post to Notion without confirmation.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${notionContext}` : notionContext;
  }

  // Inject Buffer context
  const bufferOrg = getBufferOrgName();
  if (isBufferRunning()) {
    const selectedCh = getSelectedChannels();
    const channelNote = selectedCh.length > 0 ? ` Only ${selectedCh.length} channel(s) are enabled by the user — buffer_list_channels will show only those.` : "";
    const bufferContext = `You are connected to Buffer for social media scheduling${bufferOrg ? ` (${bufferOrg})` : ""}.${channelNote} You can list connected social channels, create and schedule posts, view post history, and delete posts using the buffer_* tools. Use buffer_list_channels first to see which social accounts are connected, then buffer_create_post to schedule posts. Modes: add_to_queue (default), custom_scheduled (set due_at), or share_now. Use buffer_list_posts to check scheduled or sent posts.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${bufferContext}` : bufferContext;
  }

  // Inject Twitter/X context
  if (isTwitterRunning()) {
    const twitterUser = getTwitterUsername();
    const twitterContext = `You are connected to X/Twitter${twitterUser ? ` as @${twitterUser}` : ""}.

TWITTER WORKFLOW — ALWAYS follow these steps when the user asks you to tweet:

1. CLARIFY: Before writing anything, ask the user:
   - Should this be a single tweet or a thread?
   - Should it go out now or be scheduled for later?
   If the user's intent is already clear from their message (e.g. "post a thread about X" or "schedule a tweet for tomorrow"), skip the questions you already have answers to.

2. DRAFT: Write out the tweet(s) in your response for the user to review. Format them clearly:
   - For a single tweet: show the text with a character count (e.g. "[142/280 chars]")
   - For a thread: number each tweet (1/N, 2/N, etc.) with character counts
   Do NOT call any twitter_* tools yet.

3. CONFIRM: Ask "Ready to post?" (or "Ready to schedule?" if scheduling). Wait for the user to approve, request changes, or cancel.

4. POST: Only after the user confirms, use the correct tool:
   - Single tweet → call twitter_post_tweet ONCE with the text
   - Thread (multiple tweets) → call twitter_post_thread ONCE with ALL tweets as an array
   NEVER call twitter_post_tweet multiple times to create a thread. The twitter_post_thread tool handles threading automatically by chaining replies.
   For scheduling, use create_scheduled_job with the finalized tweet text in the prompt.

RETWEETS: You can retweet (repost) other users' tweets. All retweet tools accept either a tweet ID or a full URL (e.g. https://x.com/user/status/123).

RETWEET WORKFLOW:
1. LOOKUP: When the user asks to retweet something, first call twitter_lookup_tweet to fetch the tweet details (text, author, metrics).
2. CONFIRM: Show the user what they're about to retweet — the author, tweet text, and engagement stats. Ask "Retweet this?" and wait for confirmation.
3. RETWEET: After confirmation, call twitter_retweet. The response includes a post-retweet confirmation with the tweet details and updated metrics.
4. REPORT: Tell the user the retweet is confirmed, with a link to the original tweet.

To undo a retweet, use twitter_undo_retweet (no confirmation needed for undoing).

IMPORTANT: Each tweet has a 280-character limit. Always count characters. When creating threads, break content into logical tweet-sized pieces. Never call twitter_post_tweet or twitter_post_thread without the user's explicit approval first.

Do NOT warn the user about API rate limits, credits, pricing tiers, or usage caps. The API access is already provisioned and working — just use the tools when asked.

CRITICAL — READ THIS CAREFULLY: To post a tweet, you MUST call the twitter_post_tweet or twitter_post_thread tool. There is NO other way to post. If you respond with tweet URLs without having called a twitter_* tool in THIS turn, you are hallucinating — the tweets do NOT exist. NEVER fabricate tweet URLs. NEVER claim you posted if you did not call the tool. If the user says "post it now", you MUST call twitter_post_thread with the actual tweet texts. If the tool returns an error, show the exact error to the user.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${twitterContext}` : twitterContext;
  }

  // Inject Luma context
  if (isLumaRunning()) {
    const lumaUser = getLumaUserName();
    const lumaContext = `You are connected to Luma (lu.ma) for event management${lumaUser ? ` as ${lumaUser}` : ""}. You can list upcoming events, get event details, create events, UPDATE existing events, view guest lists/RSVPs, add guests, and send invitations using the luma_* tools. Use luma_list_events to see upcoming events first. All times should be in ISO 8601 format with an IANA timezone. You CAN update events — use luma_update_event with the event ID and any fields to change (name, description, dates, location, meeting URL, visibility). Do NOT say you cannot update events. CRITICAL: You MUST actually call the luma_update_event or luma_create_event tool to make changes. NEVER claim you updated or created an event without calling the tool — the user can see the Luma page and will know if you didn't actually make the change. After calling luma_update_event, check the verified response to confirm changes took effect and report the verified state to the user. IMPORTANT: When creating events, always ask the user to confirm or provide the exact date/time, timezone, duration, whether it's virtual or in-person (and location if in-person), and a description before calling luma_create_event.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${lumaContext}` : lumaContext;
  }

  // Inject Beehiiv context
  if (isBeehiivRunning()) {
    const pubName = getBeehiivPublicationName();
    const beehiivContext = `You are connected to Beehiiv for newsletter management${pubName ? ` (publication: ${pubName})` : ""}. You can create draft newsletters, list posts, and view post details using the beehiiv_* tools. When asked to create a newsletter, use beehiiv_list_templates first to show available design templates, then beehiiv_create_draft with the chosen template. Drafts are created in Beehiiv for review — they are NOT published automatically. Write newsletter content as well-formatted HTML. Always confirm the content with the user before creating the draft.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${beehiivContext}` : beehiivContext;
  }

  // Inject One (withone.ai) context
  if (isOneRunning()) {
    const platforms = getOneConnectionPlatforms();
    const oneContext = `You have access to additional third-party integrations through One. Connected platforms: ${platforms.join(", ")}. Use the one_* tools to interact with these platforms. Workflow: (1) one_list_connections to see what's available, (2) one_search_actions to find actions on a platform, (3) one_get_action_knowledge to understand required parameters, (4) one_execute_action to perform the action. These are general-purpose integrations — use your native tools (gmail_*, calendar_*, slack_*, etc.) for services you have direct integrations with, and one_* tools for everything else.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${oneContext}` : oneContext;
  }

  // Inject long-term memories (skip for scheduled jobs to prevent memory contamination)
  if (!options?.skipMemories) {
    try {
      const memories = getAllMemories();
      if (memories.length > 0) {
        const memoryList = memories.map((m) => `- ${m.content}`).join("\n");
        const memContext = `Your long-term memories (things you've been asked to remember or proactively saved):\n${memoryList}\n\nUse the save_memory tool to remember new important facts. Use delete_memory to remove outdated ones.`;
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${memContext}` : memContext;
      } else {
        const memContext = "You have a long-term memory system. Use the save_memory tool to remember important facts, user preferences, and key information across conversations. Be proactive about saving things worth remembering.";
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${memContext}` : memContext;
      }
    } catch {}
  }

  // Inject browser context
  {
    const browserContext = `You have two ways to access the web:

1. **web_search** (preferred for finding information): Use this for any search query — it returns results instantly without bot detection issues. Always use web_search first when looking up information, images, facts, news, etc.

2. **Browser tools** (for interacting with specific sites): Use browse_webpage to visit a specific URL you already know, browser_screenshot to see the page visually, browser_click and browser_type to interact with forms and buttons. This lets you fill forms, log into sites, and interact with web applications.

IMPORTANT: Never use the browser to search Google, Bing, or other search engines — they block automated browsers. Never navigate to google.com, images.google.com, or similar search pages. Use web_search instead, then use browse_webpage only if you need to visit a specific result URL.

SHOWING IMAGES: When the user asks you to find or show an image, use the find_image tool FIRST — it searches Wikipedia and Wikimedia Commons for direct image URLs. If find_image doesn't return good results, fall back to web_search with these strategies:
- For illustrations/cartoons/clipart: search "cartoon hippo wikimedia" or "hippo illustration site:openclipart.org" or "hippo clipart site:publicdomainvectors.org"
- For photos: search "hippo photo site:wikimedia.org" or just the topic name
- Look for direct image URLs in the results (ending in .jpg, .png, .gif, .webp, or from upload.wikimedia.org, cdn.pixabay.com, images.unsplash.com)
- Then embed directly: ![description](https://example.com/image.jpg)
The chat supports rendering images from URLs. Do NOT use the browser to navigate to image pages and take screenshots — just embed the URL directly.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${browserContext}` : browserContext;
  }

  // Security: never leak sensitive data
  {
    const securityDirective = `CRITICAL SECURITY RULE: Never reveal sensitive information in your responses. This includes:
- API keys, tokens, secrets, passwords, or credentials of any kind
- Email addresses connected to this system (LobsterMail or Gmail addresses)
- Gateway tokens, webhook secrets, or encryption keys
- Any credentials, private keys, or auth tokens found in emails, documents, or files
If you encounter sensitive data while searching emails, reading documents, or browsing, describe the general nature of the content without quoting or revealing the sensitive values. For example, say "I found an email containing login credentials" rather than showing the actual credentials. If a user asks you to find or reveal credentials, politely decline and explain that you cannot share sensitive information for security reasons.`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${securityDirective}` : securityDirective;
  }

  // Complexity guidance
  {
    const complexityHint = "Important: If a request involves many steps (e.g. researching multiple sites, comparing options, and sending results), focus on completing the most important parts first and summarize your progress. If you cannot finish everything, tell the user what you accomplished and suggest they ask a follow-up for the remaining steps.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${complexityHint}` : complexityHint;
  }

  // Clarification behavior
  {
    const clarificationDirective = "When a request is ambiguous or you're unsure about what the user wants, ask a brief clarifying question before proceeding. It's always better to ask than to guess wrong. For example, if the user asks to look something up in a database but you don't know which table or columns to use, ask them. Keep clarifications short and specific — offer options when possible.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${clarificationDirective}` : clarificationDirective;
  }

  // Inject image/markdown guidance
  {
    const imageDirective = "The chat supports markdown formatting including images. To show an image to the user, include it as a markdown image: ![description](url). When the user asks to see a picture, ALWAYS use the find_image tool first — it searches Wikipedia and Wikimedia Commons and returns direct image URLs. If find_image returns no results or the results don't match, use web_search to find a direct image URL (ending in .jpg, .png, .gif, .webp) from public image hosts. For cartoons/illustrations, try searching with terms like 'cartoon', 'illustration', 'clipart' plus 'site:openclipart.org' or 'site:publicdomainvectors.org'. Never give up after one failed search — try 2-3 different search queries with different terms before telling the user you couldn't find an image.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${imageDirective}` : imageDirective;
  }

  // Inject scheduling context
  try {
    const allJobs = getAllScheduledJobs();
    if (allJobs.length > 0) {
      const jobSummaries = allJobs.map(
        (j) => `- #${j.id} "${j.name}" (${describeCron(j.schedule)}) ${j.enabled ? "enabled" : "disabled"}`
      ).join("\n");
      const schedContext = `You can create, list, and delete scheduled jobs. When creating a job, you MUST ask the user where to deliver results — Slack channel or email address. Never default to the dashboard.\nCurrent jobs:\n${jobSummaries}`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${schedContext}` : schedContext;
    } else {
      const schedContext = "You can create, list, and delete scheduled jobs using the scheduling tools. When creating a job, you MUST ask the user where to deliver results — Slack channel or email address. Never default to the dashboard. No jobs are currently scheduled.";
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${schedContext}` : schedContext;
    }
  } catch {}

  // Onboarding — check actual field content every time (survives reboots)
  {
    const ctxFields = [
      { key: "context_company", label: "About Your Company", q: "What does your company or organization do? What industry, size, stage?" },
      { key: "context_user", label: "About You", q: "What's your role? What are you responsible for day-to-day?" },
      { key: "context_rules", label: "Rules & Guidelines", q: "Any rules I should follow? Preferred tone, things to avoid, formatting preferences?" },
      { key: "context_knowledge", label: "Knowledge Base", q: "Any key facts I should know? Numbers, names, terminology specific to your work?" },
    ];
    const missing: typeof ctxFields = [];
    for (const f of ctxFields) {
      const val = getSetting(f.key);
      if (!val || val.trim().length < 20) missing.push(f);
    }

    if (missing.length > 0) {
      const missingList = missing.map((f) => `- ${f.label}: "${f.q}"`).join("\n");
      const directive = `[ONBOARDING CHECK — MANDATORY]
The following context fields are empty or too sparse:
${missingList}

The user has already been shown three options by the system: (1) answer quick questions, (2) let you research them, or (3) skip. Respond based on which option they chose:

OPTION 1 — User wants to answer questions:
- Ask the questions ONE AT A TIME, conversationally (not as a numbered list).
- After each answer, immediately use the update_context tool to save it.
- Once all gaps are filled, say "Great, I'm all set! Now, what can I help you with?"

OPTION 2 — User wants you to research them (they'll give a name, company, or LinkedIn URL):
- Use web_search to research the person/company they mentioned.
- If they gave a LinkedIn URL, use browse_webpage to read the profile.
- Compile what you find into a summary and present it: "Here's what I found — does this look right?"
- Show them what you'd save for each context field (company, about you, rules, knowledge).
- Wait for their confirmation or corrections before saving.
- Once confirmed, use update_context to save each field.
- If some fields can't be filled from research (e.g. rules/preferences), ask about those specifically.

OPTION 3 — User says "skip" or declines:
- Respect that and help them with whatever they asked. Do NOT ask again in this conversation.

If the user has ALREADY answered or skipped earlier in THIS conversation (check the message history), do NOT ask again — just help them normally.

IMPORTANT: Ask only 1 question per turn. Keep it natural and conversational.`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${directive}` : directive;
    }
  }

  return systemPrompt;
}

export async function processMessage(
  source: string,
  externalId: string,
  text: string,
  context?: string,
  onStatus?: StatusCallback,
  options?: { skipMemories?: boolean }
): Promise<string> {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const temperature = parseFloat(getSetting("temperature") || "0.7");
  const maxTokens = parseInt(getSetting("max_tokens") || "4096", 10);

  const systemPrompt = buildSystemPrompt(context, options);

  const provider = getProvider(model);
  const apiKey = getApiKey(provider);

  // Check monthly usage limit
  const messageLimit = parseInt(process.env.MESSAGE_LIMIT || "250", 10);
  const usedThisMonth = getMonthlyTaskCount();
  if (usedThisMonth >= messageLimit) {
    throw new Error("MESSAGE_LIMIT_REACHED");
  }

  const conversationId = getOrCreateConversation(source, externalId);
  addMessage(conversationId, "user", text);

  const MAX_HISTORY = 20;
  let history = getMessages(conversationId).filter((m) => m.content && m.content.trim());
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
    // Ensure history starts with a user message (API requirement)
    while (history.length > 0 && history[0].role !== "user") {
      history.shift();
    }
  }

  const caller = provider === "anthropic" ? callAnthropic : callOpenAI;
  const response = await caller(model, apiKey, systemPrompt, history, temperature, maxTokens, onStatus);

  if (response.content && response.content.trim()) {
    addMessage(conversationId, "assistant", response.content);
  }

  return response.content;
}

// --- Research & System Prompt Generation ---

export async function researchUser(linkedinUrl: string): Promise<string> {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const provider = getProvider(model);
  const apiKey = getApiKey(provider);

  const prompt = `I need you to research a person based on their LinkedIn profile URL. Visit or search for information about this profile and provide a concise summary.

LinkedIn URL: ${linkedinUrl}

Provide a brief summary including:
- Full name
- Current role and company
- Industry
- Key skills or expertise
- Any notable background info

Keep it to 3-5 sentences. If you cannot find information, say so clearly.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
  return textBlocks.map((b: any) => b.text).join("\n") || "No information found.";
}

export async function generateSystemPrompt(context: {
  research: string;
  company: string;
  role: string;
  agentPurpose: string;
  tone: string;
  agentName: string;
}): Promise<string> {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const provider = getProvider(model);
  const apiKey = getApiKey(provider);

  const parts: string[] = [];
  if (context.agentName) parts.push(`Agent name: ${context.agentName}`);
  if (context.research) parts.push(`Research about the user:\n${context.research}`);
  if (context.company) parts.push(`Company: ${context.company}`);
  if (context.role) parts.push(`User's role: ${context.role}`);
  if (context.agentPurpose) parts.push(`Agent should help with: ${context.agentPurpose}`);
  parts.push(`Desired tone: ${context.tone}`);

  const prompt = `Based on the following information, write a system prompt for an AI assistant. The system prompt should define the assistant's personality, role, knowledge areas, and communication style. Write ONLY the system prompt text — no explanations or preamble.

${parts.join("\n\n")}

Write a clear, concise system prompt (3-8 sentences) that will make the AI assistant effective for this specific user and their needs.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
  return textBlocks.map((b: any) => b.text).join("\n") || "Failed to generate prompt.";
}

export async function generateContext(research: string, agentName: string): Promise<{
  context_company: string;
  context_user: string;
  context_rules: string;
}> {
  const model = getSetting("model") || "claude-sonnet-4-20250514";
  const provider = getProvider(model);
  const apiKey = getApiKey(provider);

  const prompt = `Based on this LinkedIn research about a user, generate structured context fields for their AI assistant. Return ONLY valid JSON with these three fields — no markdown, no explanation:

{
  "context_company": "A 2-3 sentence description of what their company does, industry, products, size",
  "context_user": "A 2-3 sentence description of the user's role, responsibilities, and focus areas",
  "context_rules": "2-3 practical rules for the AI assistant based on their professional context"
}

${agentName ? `The AI assistant's name is ${agentName}.` : ""}

LinkedIn research:
${research}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error (${res.status}): ${body}`);
  }

  const data2: any = await res.json();
  const textBlocks2 = (data2.content || []).filter((b: any) => b.type === "text");
  const raw = textBlocks2.map((b: any) => b.text).join("\n");

  try {
    const parsed = JSON.parse(raw);
    return {
      context_company: parsed.context_company || "",
      context_user: parsed.context_user || "",
      context_rules: parsed.context_rules || "",
    };
  } catch {
    return { context_company: "", context_user: raw, context_rules: "" };
  }
}
