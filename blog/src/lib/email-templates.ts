export function welcomeEmail(opts: {
  dashboardUrl: string;
  gatewayToken: string;
}): { subject: string; html: string } {
  return {
    subject: "Your OpenClaw agent is ready — The Agent Post",
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#1A1A2E;margin:0 0 8px;">
      Your AI agent is live
    </h1>
    <p style="color:#4A4A5A;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Your hosted OpenClaw instance has been provisioned and is ready to go.
    </p>

    <div style="background:#F3E8FF;border:1px solid #D8B4FE;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="font-weight:700;color:#6B21A8;font-size:14px;margin:0 0 12px;">Dashboard</p>
      <a href="${opts.dashboardUrl}" style="color:#6B21A8;font-size:15px;word-break:break-all;">
        ${opts.dashboardUrl}
      </a>
    </div>

    <div style="background:#F3E8FF;border:1px solid #D8B4FE;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="font-weight:700;color:#6B21A8;font-size:14px;margin:0 0 12px;">Gateway Token</p>
      <code style="background:#FAF7F2;padding:4px 8px;border-radius:4px;font-size:13px;color:#1A1A2E;">
        ${opts.gatewayToken}
      </code>
      <p style="color:#4A4A5A;font-size:12px;margin:8px 0 0;">
        Use this token to authenticate API requests to your agent.
      </p>
    </div>

    <h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1A1A2E;margin:0 0 12px;">
      Get started in 3 steps
    </h2>
    <ol style="color:#4A4A5A;font-size:14px;line-height:1.8;padding-left:20px;margin:0 0 24px;">
      <li>Open your <a href="${opts.dashboardUrl}" style="color:#6B21A8;">dashboard</a></li>
      <li>Enter your Anthropic or OpenAI API key in Settings</li>
      <li>Connect WhatsApp, Telegram, or Slack under Integrations</li>
    </ol>

    <p style="color:#4A4A5A;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Once connected, your AI agent will respond to messages automatically.
      You can customize its behavior, tools, and personality from the dashboard.
    </p>

    <hr style="border:none;border-top:2px double #E5E0D8;margin:24px 0;">

    <p style="color:#999;font-size:12px;text-align:center;margin:0;">
      The Agent Post &middot; <a href="https://theagentpost.co" style="color:#6B21A8;">theagentpost.co</a>
    </p>
  </div>
</body>
</html>
    `.trim(),
  };
}
