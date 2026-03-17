import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Add Long-Term Memory to AI Agents — The Agent Post",
  description:
    "Learn how to add long-term memory to AI agents using Qdrant and OpenClaw. Store, retrieve, and recall context across conversations in 15 minutes.",
};

const steps: Record<string, any>[] = [
  {
    number: 1,
    title: "Why AI agents need long-term memory",
    description:
      "By default, AI agents lose all context when a conversation ends. Vector databases solve this by storing text as numerical embeddings — arrays of numbers that capture semantic meaning. When your agent needs to remember something, it searches the database for the most similar memories using cosine similarity. The result: agents with persistent long-term memory that learn and recall across sessions.",
  },
  {
    number: 2,
    title: "Install Qdrant locally with Docker",
    description:
      "Qdrant is an open-source vector database that runs locally with zero configuration. Pull and start the Docker container. It will listen on port 6333 for the REST API and 6334 for gRPC.",
    code: "docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant",
    label: "Start Qdrant in Docker",
    output: "Unable to find image 'qdrant/qdrant:latest' locally\nlatest: Pulling from qdrant/qdrant\nStatus: Downloaded newer image for qdrant/qdrant:latest\na1b2c3d4e5f6...",
    tip: "Don't have Docker? Install it with: brew install --cask docker",
  },
  {
    number: 3,
    title: "Verify the Qdrant vector database is running",
    description:
      "Hit the Qdrant health endpoint to confirm the server is up. You should get back a JSON response with the version number.",
    code: "curl http://localhost:6333/healthz",
    label: "Check Qdrant health",
    output: "{\"title\":\"qdrant\",\"version\":\"1.13.2\"}",
  },
  {
    number: 4,
    title: "Install the OpenClaw memory plugin",
    description:
      "OpenClaw has a plugin system for extending agent capabilities. The memory plugin handles embedding generation, vector storage, and semantic retrieval. Install it into your project.",
    code: "openclaw plugin install @openclaw/memory-qdrant",
    label: "Install the memory plugin",
    output: "✓ Installed @openclaw/memory-qdrant@0.4.1\n✓ Plugin registered in openclaw.config.ts",
  },
  {
    number: 5,
    title: "Create a vector collection for agent memories",
    description:
      "A collection is where your agent's memories live. Each memory is stored as a vector embedding alongside its original text. Create one now using the OpenClaw CLI. The default embedding size of 1536 dimensions matches OpenAI's text-embedding-3-small model, which the plugin uses by default.",
    code: "openclaw memory create-collection --name agent-memories --size 1536",
    label: "Create a memory collection",
    output: "✓ Collection 'agent-memories' created\n  Vectors: 1536 dimensions\n  Distance: Cosine\n  Endpoint: http://localhost:6333",
  },
  {
    number: 6,
    title: "Configure the memory plugin in openclaw.config.ts",
    description:
      "Open your openclaw.config.ts and add the memory plugin to your agent definition. The plugin needs to know which Qdrant collection to use and how many memories to retrieve per query. A retrieval window of 5 works well for most conversational AI agents.",
    code: `// openclaw.config.ts
import { defineConfig } from "openclaw";
import { memoryPlugin } from "@openclaw/memory-qdrant";

export default defineConfig({
  agents: {
    assistant: {
      model: "claude-sonnet-4-6",
      plugins: [
        memoryPlugin({
          collection: "agent-memories",
          qdrantUrl: "http://localhost:6333",
          retrieveCount: 5,
          autoSave: true,
        }),
      ],
    },
  },
});`,
    label: "openclaw.config.ts",
    tip: "Setting autoSave to true means the agent automatically stores important facts from each conversation. Set it to false if you want manual control.",
  },
  {
    number: 7,
    title: "Set your OpenAI embedding API key",
    description:
      "The memory plugin generates vector embeddings using an API. Export your API key as an environment variable. The plugin supports both OpenAI and Anthropic embedding models.",
    code: "export OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx",
    label: "Set the embedding API key",
    tip: "Add this to your ~/.zshrc or .env file so you don't have to set it every session.",
  },
  {
    number: 8,
    title: "Store a test memory as a vector embedding",
    description:
      "Use the CLI to manually store a memory and verify the full pipeline works end to end. This command converts the text to a vector embedding and writes it to Qdrant.",
    code: "openclaw memory store --collection agent-memories --text \"The user prefers responses in bullet-point format and works in the fintech industry.\"",
    label: "Store a test memory",
    output: "✓ Memory stored\n  ID: a7f3b2c1-9e4d-4a1b-8c5f-6d7e8f9a0b1c\n  Collection: agent-memories\n  Tokens: 18",
  },
  {
    number: 9,
    title: "Retrieve memories with semantic search",
    description:
      "Now query the collection with a natural-language question. The plugin converts your query to a vector embedding and finds the closest matches by cosine similarity. You should see the memory you just stored.",
    code: "openclaw memory search --collection agent-memories --query \"What format does the user like?\"",
    label: "Search for relevant memories",
    output: "1 result (score: 0.92)\n\n[0.92] \"The user prefers responses in bullet-point format and works in the fintech industry.\"\n  Stored: 2026-03-17T14:32:01Z",
  },
  {
    number: 10,
    title: "Run your agent with long-term memory enabled",
    description:
      "Start a conversation with your agent. Behind the scenes, the plugin retrieves relevant memories from Qdrant before each response and stores new ones after. You'll see memory activity in the logs.",
    code: "openclaw chat assistant --verbose",
    label: "Start a memory-enabled chat",
    output: "Agent 'assistant' ready (memory: agent-memories, 1 vector stored)\n\nYou: What do you remember about me?\nAssistant: Based on my memory, you prefer responses in bullet-point format and you work in the fintech industry.\n\n[memory] Retrieved 1 memory (top score: 0.92)\n[memory] Saved 0 new memories",
  },
  {
    number: 11,
    title: "Inspect and manage stored agent memories",
    description:
      "As your agent accumulates memories in the vector database, you'll want to inspect and occasionally prune them. The OpenClaw CLI gives you tools for listing, filtering, and deleting stored memories.",
    code: "openclaw memory list --collection agent-memories --limit 20",
    label: "List stored memories",
    tip: "To delete a specific memory: openclaw memory delete --collection agent-memories --id <memory-id>",
  },
];

const troubleshooting = [
  {
    problem: "Qdrant \"Connection refused\" when storing or searching memories",
    solution: "docker ps | grep qdrant\n# If no output, restart the container:\ndocker start qdrant",
  },
  {
    problem: "Low cosine similarity scores (below 0.7) on memory retrieval",
    solution: "openclaw memory rebuild-index --collection agent-memories\n# If still low, try a larger embedding model:\n# Set embeddingModel: \"text-embedding-3-large\" in plugin config",
  },
  {
    problem: "Qdrant \"Collection not found\" error during agent chat",
    solution: "openclaw memory create-collection --name agent-memories --size 1536",
  },
];

export default function AgentLongTermMemoryGuide() {
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
          How to Add Long-Term Memory to Your AI Agents
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Add persistent memory to your OpenClaw agents with Qdrant and
          vector embeddings — store context, search by semantic similarity,
          and recall what matters across conversations.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 10&ndash;15 minutes &middot; Requires: Docker, an
          OpenAI API key, OpenClaw installed
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
