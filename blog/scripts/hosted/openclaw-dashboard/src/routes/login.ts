import { Router, Request, Response } from "express";
import { createSession, destroySession } from "../middleware/auth";
import { getSetting } from "../services/db";

const router = Router();

router.get("/login", (req: Request, res: Response) => {
  res.render("login", { error: null });
});

router.post("/login", (req: Request, res: Response) => {
  const { token } = req.body;
  if (token === process.env.GATEWAY_TOKEN) {
    createSession(res);
    const agentName = getSetting("agent_name");
    res.redirect(agentName ? "/settings" : "/agent");
  } else {
    res.render("login", { error: "Invalid token" });
  }
});

router.post("/logout", (_req: Request, res: Response) => {
  destroySession(res);
  res.redirect("/login");
});

export default router;
