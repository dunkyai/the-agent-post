import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Running Agents on a Schedule — The Agent Post",
  description:
    "Learn how to schedule your OpenClaw agents to run tasks automatically — daily reports, monitoring, content generation, data syncing, and more.",
};

const steps = [
  {
    number: 1,
    title: "Why schedule agents",
    description:
      "Agents are most powerful when they work for you in the background. Instead of manually triggering tasks, you can schedule agents to run automatically — generating daily reports, monitoring systems, creating content, syncing data between services, or anything else you can describe in natural language. Schedules turn your agents from tools you use into workers that run on their own.",
  },
  {
    number: 2,
    title: "View current schedules",
    description:
      "Start by checking if you have any existing scheduled tasks. If this is your first time, the list will be empty.",
    code: "openclaw schedule list",
    label: "List all scheduled tasks",
    output: "No scheduled tasks found.",
  },
  {
    number: 3,
    title: "Create a simple schedule",
    description:
      "Create your first scheduled task by specifying which agent to run, when to run it using a cron expression, and what task to perform. This example runs every day at 9am.",
    code: 'openclaw schedule create --agent my-agent --cron "0 9 * * *" --task "Generate a daily summary of yesterday\'s news"',
    label: "Create a daily schedule",
    output: "Schedule created: my-schedule\nAgent: my-agent\nCron: 0 9 * * *\nNext run: tomorrow at 9:00 AM",
  },
  {
    number: 4,
    title: "Understand cron syntax",
    description:
      "Cron expressions have five fields: minute, hour, day of month, month, and day of week. An asterisk (*) means \"every.\" Here are some common patterns you can use:",
    code: '"*/30 * * * *"   # Every 30 minutes\n"0 */2 * * *"    # Every 2 hours\n"0 9 * * 1-5"    # Weekdays at 9am\n"0 9 * * *"      # Every day at 9am\n"0 0 1 * *"      # First of every month at midnight',
    label: "Common cron patterns",
    tip: "Cron fields in order: minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-6, where 0 is Sunday).",
  },
  {
    number: 5,
    title: "Test a schedule",
    description:
      "Before waiting for the next scheduled run, trigger the task immediately to make sure everything works as expected.",
    code: "openclaw schedule run my-schedule --now",
    label: "Trigger a schedule immediately",
    output: "Running my-schedule now...\nAgent my-agent started\nTask completed successfully",
  },
  {
    number: 6,
    title: "View schedule output",
    description:
      "Check what your agent produced during its scheduled run. The logs show each execution with timestamps and the full output.",
    code: "openclaw schedule logs my-schedule",
    label: "View schedule logs",
  },
  {
    number: 7,
    title: "Set up output routing",
    description:
      "Scheduled tasks are more useful when their output goes somewhere. Route results to Slack, email, a webhook, or any connected MCP service.",
    code: 'openclaw schedule set-output my-schedule --to slack --channel #daily-digest',
    label: "Route output to Slack",
    tip: "Make sure the destination is connected first. Run openclaw mcp list to see available output targets.",
  },
  {
    number: 8,
    title: "Pause and resume",
    description:
      "You can temporarily pause a schedule without deleting it. This is useful during maintenance windows or when you want to stop a task without losing its configuration.",
    code: "openclaw schedule pause my-schedule",
    label: "Pause a schedule",
    output: "Schedule my-schedule paused\nNext run: none (paused)",
  },
  {
    number: 9,
    title: "Resume a paused schedule",
    description:
      "When you're ready to start the schedule again, resume it. It will pick up from the next cron interval.",
    code: "openclaw schedule resume my-schedule",
    label: "Resume a schedule",
    output: "Schedule my-schedule resumed\nNext run: tomorrow at 9:00 AM",
  },
  {
    number: 10,
    title: "Delete a schedule",
    description:
      "If you no longer need a scheduled task, delete it. This removes the schedule and all its configuration. Past logs are retained.",
    code: "openclaw schedule delete my-schedule",
    label: "Delete a schedule",
    output: "Schedule my-schedule deleted",
  },
];

const troubleshooting = [
  {
    problem: "Schedule didn't fire",
    solution:
      "openclaw schedule logs my-schedule --verbose\n# Also check that the daemon is running:\nopenclaw status",
  },
  {
    problem: "Agent timed out",
    solution:
      "openclaw schedule update my-schedule --timeout 300\n# Increases the timeout to 5 minutes",
  },
  {
    problem: "Output not delivered",
    solution:
      "openclaw mcp test slack\n# Verifies the output destination is connected",
  },
];

export default function SchedulingAgentsGuidePage() {
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
          Running Agents on a Schedule
        </h1>
        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-4">
          Automate your agents to run tasks on their own — daily reports,
          monitoring, content generation, and more.
        </p>
        <p className="text-sm text-text-secondary mb-10">
          Estimated time: 5&ndash;10 minutes &middot; Requires: A running
          OpenClaw installation with a deployed agent
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
