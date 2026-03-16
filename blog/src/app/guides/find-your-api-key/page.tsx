import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Find Your API Key — The Agent Post",
  description:
    "Step-by-step instructions for finding your API key on Anthropic, OpenAI, Google, Mistral, Groq, and Supabase. Everything you need to connect your AI agent.",
};

const providers = [
  {
    name: "Anthropic (Claude)",
    steps: [
      {
        number: 1,
        title: "Create an Anthropic account",
        description:
          "Go to console.anthropic.com and sign up or log in. You can use Google, GitHub, or email to create an account.",
        link: "https://console.anthropic.com",
        linkLabel: "Open Anthropic Console",
      },
      {
        number: 2,
        title: "Navigate to API Keys",
        description:
          "Once logged in, click on the Settings icon in the left sidebar, then select \"API Keys\". You can also go directly to the URL below.",
        link: "https://console.anthropic.com/settings/keys",
        linkLabel: "Go to API Keys page",
      },
      {
        number: 3,
        title: "Create a new key",
        description:
          "Click \"Create Key\", give it a name (e.g. \"My OpenClaw Agent\"), and click \"Create\". Your key will be displayed once. Copy it immediately.",
        code: "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        label: "Key format",
        tip: "You won't be able to see this key again after you close the dialog. Store it somewhere safe.",
      },
      {
        number: 4,
        title: "Add billing",
        description:
          "Anthropic requires a payment method before API calls will work. Go to Settings > Billing and add a credit card. New accounts typically get a small amount of free credits to start.",
        link: "https://console.anthropic.com/settings/billing",
        linkLabel: "Go to Billing",
      },
    ],
  },
  {
    name: "OpenAI (GPT)",
    steps: [
      {
        number: 1,
        title: "Create an OpenAI account",
        description:
          "Go to platform.openai.com and sign up or log in. This is different from ChatGPT — you need the developer platform.",
        link: "https://platform.openai.com",
        linkLabel: "Open OpenAI Platform",
      },
      {
        number: 2,
        title: "Navigate to API Keys",
        description:
          "Click your profile icon in the top-right, then select \"API Keys\" from the dropdown. Or go directly to the URL below.",
        link: "https://platform.openai.com/api-keys",
        linkLabel: "Go to API Keys page",
      },
      {
        number: 3,
        title: "Create a new secret key",
        description:
          "Click \"Create new secret key\", optionally give it a name, and click \"Create secret key\". Copy the key immediately.",
        code: "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        label: "Key format",
        tip: "OpenAI only shows the key once. If you lose it, you'll need to create a new one.",
      },
      {
        number: 4,
        title: "Add billing",
        description:
          "Go to Settings > Billing and add a payment method. OpenAI's API is pay-as-you-go. You can set usage limits to control spending.",
        link: "https://platform.openai.com/settings/organization/billing",
        linkLabel: "Go to Billing",
      },
    ],
  },
  {
    name: "Google (Gemini)",
    steps: [
      {
        number: 1,
        title: "Open Google AI Studio",
        description:
          "Go to Google AI Studio and sign in with your Google account. This is the easiest way to get a Gemini API key.",
        link: "https://aistudio.google.com",
        linkLabel: "Open Google AI Studio",
      },
      {
        number: 2,
        title: "Get your API key",
        description:
          "Click \"Get API key\" in the left sidebar. Then click \"Create API key\" and select a Google Cloud project (or create a new one). Your key will be generated instantly.",
        link: "https://aistudio.google.com/apikey",
        linkLabel: "Go to API Keys page",
      },
      {
        number: 3,
        title: "Copy your key",
        description:
          "Click the copy button next to your new key. Google Gemini API keys start with \"AIza\" and are about 39 characters long.",
        code: "AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        label: "Key format",
        tip: "Google offers a generous free tier for Gemini. You can make a significant number of calls before needing to pay.",
      },
    ],
  },
  {
    name: "Mistral",
    steps: [
      {
        number: 1,
        title: "Create a Mistral account",
        description:
          "Go to console.mistral.ai and sign up. You can use email, Google, or GitHub to create your account.",
        link: "https://console.mistral.ai",
        linkLabel: "Open Mistral Console",
      },
      {
        number: 2,
        title: "Navigate to API Keys",
        description:
          "In the console, go to \"API Keys\" in the left sidebar. You can also navigate directly to the URL below.",
        link: "https://console.mistral.ai/api-keys",
        linkLabel: "Go to API Keys page",
      },
      {
        number: 3,
        title: "Create a new key",
        description:
          "Click \"Create new key\", give it a name, and set an optional expiration date. Copy the key when it appears.",
        code: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        label: "Key format (32 characters)",
        tip: "Mistral offers a free tier with rate limits. Paid plans unlock higher throughput and larger models.",
      },
    ],
  },
  {
    name: "Groq",
    steps: [
      {
        number: 1,
        title: "Create a Groq account",
        description:
          "Go to console.groq.com and sign up. Groq is known for extremely fast inference speeds on open-source models like Llama and Mixtral.",
        link: "https://console.groq.com",
        linkLabel: "Open Groq Console",
      },
      {
        number: 2,
        title: "Navigate to API Keys",
        description:
          "In the console, click \"API Keys\" in the left sidebar. Or go directly to the URL below.",
        link: "https://console.groq.com/keys",
        linkLabel: "Go to API Keys page",
      },
      {
        number: 3,
        title: "Create a new key",
        description:
          "Click \"Create API Key\", give it a name, and copy the key that appears. Groq keys start with \"gsk_\".",
        code: "gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        label: "Key format",
        tip: "Groq offers a free tier with generous rate limits. Great for testing and prototyping.",
      },
    ],
  },
  {
    name: "Supabase",
    steps: [
      {
        number: 1,
        title: "Create a Supabase project",
        description:
          "Go to supabase.com and sign up or log in. Create a new project if you don't already have one. Each project gets its own Postgres database, API, and unique URL.",
        link: "https://supabase.com/dashboard",
        linkLabel: "Open Supabase Dashboard",
      },
      {
        number: 2,
        title: "Go to API Settings",
        description:
          "In your project dashboard, click \"Settings\" in the left sidebar, then select \"API\". You'll see your Project URL and two API keys.",
        link: "https://supabase.com/dashboard/project/_/settings/api",
        linkLabel: "Go to API Settings",
      },
      {
        number: 3,
        title: "Copy your Project URL",
        description:
          "At the top of the API settings page, copy your Project URL. This is the base URL your agent will use to connect to your database.",
        code: "https://your-project-id.supabase.co",
        label: "Project URL format",
      },
      {
        number: 4,
        title: "Copy the anon key",
        description:
          "Under \"Project API keys\", you'll see two keys. Copy the \"anon public\" key. This key respects your Row Level Security (RLS) policies, making it safe to use with your agent. Only use the \"service_role\" key if you specifically need to bypass RLS.",
        code: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxxxxx...",
        label: "Key format (JWT)",
        tip: "The anon key is recommended for most use cases. It can only access data that your RLS policies allow, so your database stays protected.",
      },
    ],
  },
];

export default function ApiKeyGuidePage() {
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
          How to Find Your API Key
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          An API key is a password that lets your AI agent talk to a language
          model. Every provider gives you one for free in a few clicks. Here's
          where to find yours.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 2&ndash;5 minutes per provider
        </p>

        <hr className="section-rule mb-10" />
      </div>

      {providers.map((provider, pi) => (
        <div key={provider.name} id={provider.name.toLowerCase().split(" ")[0]}>
          <h2 className="font-serif text-2xl font-bold mb-6">
            {provider.name}
          </h2>

          <div className="space-y-8 mb-10">
            {provider.steps.map((step) => (
              <section key={`${pi}-${step.number}`}>
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center">
                    {step.number}
                  </span>
                  <h3 className="font-serif text-xl font-bold">
                    {step.title}
                  </h3>
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

                  {step.tip && (
                    <p className="text-sm text-text-secondary italic">
                      Tip: {step.tip}
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>

          {pi < providers.length - 1 && <hr className="section-rule mb-10" />}
        </div>
      ))}

      <hr className="section-rule my-10" />

      <section className="mb-10">
        <h2 className="font-serif text-2xl font-bold mb-6">
          Keeping Your Key Safe
        </h2>
        <div className="space-y-4">
          {[
            {
              rule: "Never share your key publicly",
              detail:
                "Don't paste it in GitHub repos, public chats, or social media. Anyone with your key can make API calls on your account.",
            },
            {
              rule: "Set spending limits",
              detail:
                "Most providers let you set monthly spending caps. Do this before you start building — it prevents surprises.",
            },
            {
              rule: "Rotate keys if compromised",
              detail:
                "If you think your key was leaked, delete it immediately and create a new one. All providers make this easy from their dashboard.",
            },
            {
              rule: "Use one key per project",
              detail:
                "Create separate keys for each app or agent. If one is compromised, you only need to rotate that one.",
            },
          ].map((item) => (
            <div key={item.rule} className="bg-tag-bg rounded px-4 py-3">
              <p className="text-sm font-semibold mb-1">{item.rule}</p>
              <p className="text-sm text-text-secondary">{item.detail}</p>
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
