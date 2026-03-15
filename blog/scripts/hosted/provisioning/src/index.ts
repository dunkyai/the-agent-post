import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
import instancesRouter from "./routes/instances";
import healthRouter from "./routes/health";
import oauthRouter from "./routes/oauth";
import slackEventsRouter from "./routes/slack-events";

const app = express();
const PORT = parseInt(process.env.PORT || "3500", 10);

app.use(cors());

// Slack events must be mounted before express.json() — needs raw body for signature verification
app.use("/slack/events", slackEventsRouter);

app.use(express.json());

// Public health check
app.use(healthRouter);

// Public OAuth callbacks (Google/Slack redirect here, no auth needed)
app.use("/oauth", oauthRouter);

// Protected routes
app.use("/instances", authMiddleware, instancesRouter);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Provisioning API running on 127.0.0.1:${PORT}`);
});
