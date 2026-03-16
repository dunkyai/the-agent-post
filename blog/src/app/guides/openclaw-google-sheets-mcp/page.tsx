import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "How to Connect OpenClaw to Google Sheets with MCP — The Agent Post",
  description:
    "Learn how to connect your OpenClaw agents to Google Sheets using MCP. This step-by-step guide covers API setup, service account auth, and testing in under 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Verify your OpenClaw gateway is running",
    description:
      "Before adding the Google Sheets integration, confirm that OpenClaw is installed and your gateway is healthy. Run the status command — you should see your gateway address and the number of connected agents.",
    code: "openclaw status",
    label: "Check OpenClaw status",
    output:
      "Gateway: http://127.0.0.1:18789 (healthy)\nAgents: 2 running\nMCP servers: 1 connected",
    tip: "If the gateway isn't running, start it with: openclaw gateway",
  },
  {
    number: 2,
    title: "Create a Google Cloud project for API access",
    description:
      "Your OpenClaw agents need Google API credentials to access spreadsheets. Head to the Google Cloud Console and create a new project. Give it a name like \"openclaw-sheets\" so you can find it later.",
    link: "https://console.cloud.google.com/projectcreate",
    linkLabel: "Create a Google Cloud project",
  },
  {
    number: 3,
    title: "Enable the Google Sheets API",
    description:
      "Inside your new Google Cloud project, turn on the Sheets API. Go to the API Library, search for \"Google Sheets API\", and click Enable. Without this, Google will reject every request your OpenClaw agent makes.",
    link: "https://console.cloud.google.com/apis/library/sheets.googleapis.com",
    linkLabel: "Enable Google Sheets API",
    tip: "While you're here, also enable the Google Drive API — you'll need it if your agents ever need to create new spreadsheets.",
  },
  {
    number: 4,
    title: "Create a service account",
    description:
      "A service account lets your agents authenticate without a browser login. Go to IAM & Admin > Service Accounts in your Google Cloud project, click \"Create Service Account\", and give it a name like \"openclaw-agent\". Skip the optional permissions steps.",
    link: "https://console.cloud.google.com/iam-admin/serviceaccounts/create",
    linkLabel: "Create a service account",
  },
  {
    number: 5,
    title: "Download the credentials JSON",
    description:
      "Click into your new service account, go to the Keys tab, and create a new JSON key. Your browser will download a file. Move it into your OpenClaw config directory so the MCP server can find it.",
    code: "mv ~/Downloads/openclaw-sheets-*.json ~/.openclaw/google-credentials.json",
    label: "Move credentials to OpenClaw config",
    tip: "Keep this file secret. Never commit it to version control or share it publicly.",
  },
  {
    number: 6,
    title: "Share your spreadsheet with the service account",
    description:
      "Open the Google Sheet you want your agent to access. Click the Share button and paste in the service account email address — it looks like openclaw-agent@your-project.iam.gserviceaccount.com. Give it Editor access if your agent needs to write data, or Viewer if it only needs to read.",
    code: "openclaw-agent@openclaw-sheets.iam.gserviceaccount.com",
    label: "Service account email format",
  },
  {
    number: 7,
    title: "Install the Google Sheets MCP server",
    description:
      "OpenClaw uses the Model Context Protocol to connect agents to external tools. Install the community Google Sheets MCP server from the registry. This downloads the server binary and registers it with your gateway.",
    code: "openclaw mcp install google-sheets",
    label: "Install the MCP server",
    output:
      "Fetching google-sheets@latest from registry...\nInstalled google-sheets v0.4.2\nServer registered with gateway",
  },
  {
    number: 8,
    title: "Configure the MCP server",
    description:
      "Point the MCP server at your credentials file and set the default spreadsheet ID. The spreadsheet ID is the long string in your Google Sheets URL between /d/ and /edit. For example, in https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit the ID is 1aBcDeFgHiJkLmNoPqRsTuVwXyZ.",
    code: 'openclaw mcp configure google-sheets \\\n  --credentials ~/.openclaw/google-credentials.json \\\n  --spreadsheet-id "1aBcDeFgHiJkLmNoPqRsTuVwXyZ"',
    label: "Configure credentials and default spreadsheet",
  },
  {
    number: 9,
    title: "Verify the connection",
    description:
      "Test that your MCP server can actually reach Google Sheets. The ping command authenticates with your credentials and tries to read the spreadsheet metadata. If everything is wired up correctly, you'll see the spreadsheet title and sheet names.",
    code: "openclaw mcp ping google-sheets",
    label: "Test the connection",
    output:
      'Connected to Google Sheets API\nSpreadsheet: "Q1 Sales Pipeline"\nSheets: Sheet1, Summary, Raw Data',
  },
  {
    number: 10,
    title: "Attach the MCP server to an agent",
    description:
      "Now connect the Google Sheets tools to one of your agents. The attach command gives the agent access to the MCP server's tools — reading cells, writing ranges, creating sheets, and listing tabs. You can attach the same server to multiple agents.",
    code: "openclaw agent attach my-agent --mcp google-sheets",
    label: "Attach to an agent",
    output: "Attached google-sheets to agent my-agent\nTools available: read_range, write_range, append_rows, list_sheets, create_sheet",
  },
  {
    number: 11,
    title: "Test it with a prompt",
    description:
      "Send your agent a task that uses the spreadsheet. This is the moment of truth — your agent should read from Google Sheets, process the data, and respond with real information from your spreadsheet.",
    code: 'openclaw run my-agent "Summarize the data in Sheet1 and tell me the top 3 rows by revenue"',
    label: "Run a test prompt",
    tip: "Check the agent logs with openclaw logs my-agent if the response doesn't look right.",
  },
];

const troubleshooting = [
  {
    problem: "\"PERMISSION_DENIED\" when pinging the MCP server",
    solution:
      "Make sure you shared the spreadsheet with the service account email. Open the sheet in Google Sheets, click Share, and add the email from step 6.",
  },
  {
    problem: "\"Could not load credentials\" error",
    solution:
      "ls -la ~/.openclaw/google-credentials.json\n# If missing, re-download the key from Google Cloud Console and move it to the correct path.",
  },
  {
    problem: "Agent responds but says it has no spreadsheet tools",
    solution:
      "openclaw agent detach my-agent --mcp google-sheets && openclaw agent attach my-agent --mcp google-sheets\n# Then restart the gateway: openclaw gateway restart",
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
          How to Connect OpenClaw to Google Sheets with MCP
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Set up a Google Sheets MCP server so your OpenClaw AI agents can
          read, write, and automate spreadsheet workflows using the Model Context Protocol.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: OpenClaw
          installed, a Google account
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
