import { Router, Request, Response } from "express";

const router = Router();

router.post("/bug-report", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Please describe the issue." });
      return;
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error("RESEND_API_KEY not set — cannot send bug report");
      res.status(500).json({ error: "Bug reporting is not configured." });
      return;
    }

    const instanceId = process.env.INSTANCE_ID || "unknown";
    const timestamp = new Date().toISOString();

    // Look up account email from provisioning service
    let accountEmail = "unknown";
    try {
      const provUrl = process.env.PROVISIONING_URL;
      const provSecret = process.env.PROVISIONING_API_SECRET;
      if (provUrl && provSecret && instanceId !== "unknown") {
        const infoRes = await fetch(`${provUrl}/instances/${instanceId}`, {
          headers: { Authorization: `Bearer ${provSecret}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (infoRes.ok) {
          const info: any = await infoRes.json();
          accountEmail = info.email || "unknown";
        }
      }
    } catch {}

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Dunky Bug Reports <noreply@dunky.ai>",
        to: "elizabeth@hustlefundvc.com",
        subject: `Bug Report — ${accountEmail}`,
        html: `<p><strong>Account:</strong> ${accountEmail}</p>
<p><strong>Instance:</strong> ${instanceId}</p>
<p><strong>Time:</strong> ${timestamp}</p>
<hr>
<p>${message.trim().replace(/\n/g, "<br>")}</p>`,
      }),
    });

    if (!emailRes.ok) {
      const body = await emailRes.text();
      console.error("Bug report email failed:", body);
      res.status(500).json({ error: "Failed to send bug report." });
      return;
    }

    console.log(`Bug report sent from instance ${instanceId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Bug report error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to send bug report." });
  }
});

export default router;
