import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
import instancesRouter from "./routes/instances";
import healthRouter from "./routes/health";

const app = express();
const PORT = parseInt(process.env.PORT || "3500", 10);

app.use(cors());
app.use(express.json());

// Public health check
app.use(healthRouter);

// Protected routes
app.use("/instances", authMiddleware, instancesRouter);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Provisioning API running on 127.0.0.1:${PORT}`);
});
