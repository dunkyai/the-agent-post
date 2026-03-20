import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "How to Connect OpenClaw to Google Sheets via MCP — The Agent Post",
  description:
    "Learn how to connect OpenClaw to Google Sheets using MCP. This guide covers Google Cloud credentials, MCP server setup, and automating spreadsheet workflows.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw installation",
    description:
      "Before setting up the Google Sheets integration, make sure your OpenClaw installation is healthy. Run the doctor command to check for issues with your gateway, daemon, and any existing MCP servers. Everything should show green.",
    code: "openclaw doctor",
    label: "Run the diagnostics check",
    output:
      "Gateway: ✓ running on :18789\nDaemon: ✓ active\nMCP servers: ✓ 0 issues\nAll checks passed",
    tip: "If the gateway isn't running, start it with: openclaw gateway --daemon",
  },
  {
    number: 2,
    title: "Create a Google Cloud project for API credentials",
    description:
      "Your OpenClaw agents need API credentials to connect to Google Sheets. Go to the Google Cloud Console and create a new project. Name it something recognizable like \"openclaw-integrations\" — you can reuse this project for other Google API integrations later.",
    link: "https://console.cloud.google.com/projectcreate",
    linkLabel: "Create a new Google Cloud project",
  },
  {
    number: 3,
    title: "Enable the Google Sheets API in Cloud Console",
    description:
      "Inside your new Google Cloud project, navigate to APIs & Services > Library and search for \"Google Sheets API\". Click it and hit Enable. This allows your project to make API requests to Google Sheets. Without this step, every request your OpenClaw agent makes will be rejected with a 403 error.",
    link: "https://console.cloud.google.com/apis/library/sheets.googleapis.com",
    linkLabel: "Enable Google Sheets API",
    tip: "Enable the Google Drive API too if you want your agents to create or rename spreadsheets, not just read and write cells.",
  },
  {
    number: 4,
    title: "Create a Google Cloud service account and download the JSON key",
    description:
      "Go to IAM & Admin > Service Accounts and create a new service account. Name it \"openclaw-sheets-agent\" and skip the optional role assignments. Once created, click into it, go to the Keys tab, and add a new JSON key. Your browser will download a .json credentials file — your OpenClaw MCP server will use this to authenticate with Google.",
    link: "https://console.cloud.google.com/iam-admin/serviceaccounts/create",
    linkLabel: "Create a service account",
  },
  {
    number: 5,
    title: "Store the service account credentials in OpenClaw",
    description:
      "Move the downloaded JSON key file into your OpenClaw configuration directory. The Google Sheets MCP server will look for credentials here by default. Make sure the file permissions are restricted so only your user can read it.",
    code: "mv ~/Downloads/openclaw-integrations-*.json ~/.openclaw/google-credentials.json\nchmod 600 ~/.openclaw/google-credentials.json",
    label: "Move and secure the credentials file",
    tip: "Never commit this file to git. Add google-credentials.json to your .gitignore if your OpenClaw config is version-controlled.",
  },
  {
    number: 6,
    title: "Share your Google Sheet with the service account",
    description:
      "Open the Google Sheet you want your agent to access. Click Share in the top right, then paste in the service account's email address. You can find this email in the JSON file you downloaded — it ends in .iam.gserviceaccount.com. Give it Editor access if your agent needs to write, or Viewer for read-only.",
    code: "cat ~/.openclaw/google-credentials.json | grep client_email",
    label: "Find your service account email",
    output: '  "client_email": "openclaw-sheets-agent@openclaw-integrations.iam.gserviceaccount.com"',
  },
  {
    number: 7,
    title: "Install the Google Sheets MCP server",
    description:
      "OpenClaw's MCP registry has a community-maintained Google Sheets server. Install it with a single command. This downloads the server, registers it with your gateway, and makes its tools available for agents to use.",
    code: "openclaw mcp install google-sheets",
    label: "Install from the MCP registry",
    output:
      "Downloading google-sheets@0.5.1 from registry...\nVerifying checksum... ✓\nRegistered server with gateway\nAvailable tools: read_range, write_range, append_rows, list_sheets, get_metadata",
  },
  {
    number: 8,
    title: "Configure the server with your credentials and spreadsheet",
    description:
      "Point the MCP server at your credentials file. You can also set a default spreadsheet ID so your agent knows which sheet to use unless told otherwise. The spreadsheet ID is the long string in your Google Sheets URL between /d/ and /edit.",
    code: "openclaw mcp configure google-sheets \\\n  --set credentials_path=~/.openclaw/google-credentials.json \\\n  --set default_spreadsheet_id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ",
    label: "Set credentials and default spreadsheet",
  },
  {
    number: 9,
    title: "Test the connection",
    description:
      "Before attaching anything to an agent, verify that the MCP server can authenticate and reach your spreadsheet. The test command makes a real API call to Google and reports back what it finds.",
    code: "openclaw mcp test google-sheets",
    label: "Verify the integration works",
    output:
      "Authenticating with service account... ✓\nReading spreadsheet metadata... ✓\nSpreadsheet: \"Marketing Budget 2026\"\nSheets: Overview, Q1, Q2, Q3, Q4\nConnection successful",
  },
  {
    number: 10,
    title: "Attach the server to your agent",
    description:
      "Now give one of your agents access to the Google Sheets tools. The attach command wires the MCP server's tools into the agent's tool belt. After this, the agent can read cells, write data, append rows, and list sheets — all through natural language prompts.",
    code: "openclaw agent attach data-analyst --mcp google-sheets",
    label: "Give your agent spreadsheet access",
    output:
      "Attached google-sheets to agent: data-analyst\n5 tools now available to this agent",
  },
  {
    number: 11,
    title: "Try it out",
    description:
      "Send your agent a real task that uses the spreadsheet. Start with something simple like reading data, then work up to writes and analysis. Watch the agent use the MCP tools to interact with your Google Sheet in real time.",
    code: "openclaw run data-analyst \"Read all rows from the Q1 sheet and tell me which category has the highest total spend\"",
    label: "Run a test prompt against your spreadsheet",
    tip: "Use openclaw logs data-analyst --follow to watch the MCP tool calls as your agent processes the request.",
  },
];

const troubleshooting = [
  {
    problem: "\"PERMISSION_DENIED: The caller does not have permission\" on test",
    solution:
      "Double-check that you shared the spreadsheet with the service account email.\nOpen Google Sheets > Share > paste the client_email from your credentials JSON.",
  },
  {
    problem: "\"Could not load credentials\" or \"file not found\" error",
    solution:
      "ls -la ~/.openclaw/google-credentials.json\n# If missing, re-download the JSON key from Google Cloud Console > IAM > Service Accounts > Keys.",
  },
  {
    problem: "Agent says it has no tools for spreadsheets",
    solution:
      "openclaw mcp list\n# If google-sheets isn't listed, re-run: openclaw mcp install google-sheets\n# Then re-attach: openclaw agent attach <agent-name> --mcp google-sheets",
  },
];

export default function GoogleSheetsMcpGuidePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center">
        <Link
          href="/guides"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-accent transition-colors mb-8"
        >
          &larr; All Guides
        </Link>

        <h1 className="font-serif text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
          Connecting OpenClaw Agents to Google Sheets via MCP
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Give your AI agents the ability to read, write, and analyze Google
          Sheets data using the Model Context Protocol.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, a Google account with Cloud Console access
        </p>

        <hr className="section-rule mb-10" />
      </div>

      <div className="space-y-10">
        {steps.map((step) => (
          <section key={step.number} id={`step-${step.number}`}>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center">
                {step.number}
              </span>
              <h2 className="font-serif text-xl font-bold">{step.title}</h2>
            </div>

            <div className="ml-11">
              <p className="text-text-secondary leading-relaxed mb-4">
                {step.description}
              </p>

              {step.link && (
                <a
                  href={step.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-accent hover:underline font-semibold text-sm mb-4"
                >
                  {step.linkLabel || step.link} &rarr;
                </a>
              )}

              {step.code && (
                <div className="bg-tag-bg rounded px-4 py-3 mb-3">
                  {step.label && (
                    <p className="text-xs text-text-secondary mb-1">
                      {step.label}
                    </p>
                  )}
                  <pre className="text-sm font-mono bg-background rounded p-3 overflow-x-auto whitespace-pre-wrap">
                    {step.code}
                  </pre>
                </div>
              )}

              {step.output && (
                <div className="bg-tag-bg rounded px-4 py-3 mb-3">
                  <p className="text-xs text-text-secondary mb-1">
                    Expected output
                  </p>
                  <pre className="text-sm font-mono bg-background rounded p-3 overflow-x-auto whitespace-pre-wrap text-green-600 dark:text-green-400">
                    {step.output}
                  </pre>
                </div>
              )}

              {step.tip && (
                <p className="text-sm text-text-secondary italic">
                  Tip: {step.tip}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      <hr className="section-rule my-10" />

      <section className="mb-10">
        <h2 className="font-serif text-2xl font-bold mb-6">Troubleshooting</h2>
        <div className="space-y-4">
          {troubleshooting.map((item) => (
            <div key={item.problem} className="bg-tag-bg rounded px-4 py-3">
              <p className="text-sm font-semibold mb-1">{item.problem}</p>
              <pre className="text-sm font-mono bg-background rounded p-2 overflow-x-auto">
                {item.solution}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 text-center">
        <hr className="masthead-rule mb-6" />
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline font-semibold"
        >
          &larr; Return to front page
        </Link>
      </footer>
    </div>
  );
}
