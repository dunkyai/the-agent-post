import { Router, Request, Response } from "express";
import { getAllShortcuts, getShortcut, createShortcut, updateShortcut, deleteShortcut } from "../services/db";

const router = Router();

router.get("/shortcuts", (req: Request, res: Response) => {
  const shortcuts = getAllShortcuts();
  res.render("shortcuts", {
    shortcuts,
    active: "shortcuts",
    flash: req.query.flash || null,
  });
});

router.post("/shortcuts", (req: Request, res: Response) => {
  const { trigger, name, description, prompt } = req.body;
  if (!trigger?.trim() || !name?.trim() || !prompt?.trim()) {
    res.redirect(303, "/shortcuts?flash=Trigger,+name,+and+prompt+are+required");
    return;
  }

  // Normalize trigger: strip leading ; if user included it
  const cleanTrigger = trigger.trim().replace(/^;/, "").toLowerCase();
  if (!cleanTrigger) {
    res.redirect(303, "/shortcuts?flash=Invalid+trigger");
    return;
  }

  try {
    createShortcut(cleanTrigger, name.trim(), (description || "").trim(), prompt.trim());
    res.redirect(303, "/shortcuts?flash=Shortcut+created");
  } catch (err: any) {
    const msg = err.message?.includes("UNIQUE") ? "A shortcut with that trigger already exists" : "Failed to create shortcut";
    res.redirect(303, "/shortcuts?flash=" + encodeURIComponent(msg));
  }
});

router.post("/shortcuts/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || !getShortcut(id)) {
    res.redirect(303, "/shortcuts?flash=Shortcut+not+found");
    return;
  }

  const { trigger, name, description, prompt } = req.body;
  if (!trigger?.trim() || !name?.trim() || !prompt?.trim()) {
    res.redirect(303, "/shortcuts?flash=Trigger,+name,+and+prompt+are+required");
    return;
  }

  const cleanTrigger = trigger.trim().replace(/^;/, "").toLowerCase();
  try {
    updateShortcut(id, {
      trigger: cleanTrigger,
      name: name.trim(),
      description: (description || "").trim(),
      prompt: prompt.trim(),
    });
    res.redirect(303, "/shortcuts?flash=Shortcut+updated");
  } catch (err: any) {
    const msg = err.message?.includes("UNIQUE") ? "A shortcut with that trigger already exists" : "Failed to update shortcut";
    res.redirect(303, "/shortcuts?flash=" + encodeURIComponent(msg));
  }
});

// API endpoint for autocomplete
router.get("/shortcuts/api", (req: Request, res: Response) => {
  const shortcuts = getAllShortcuts().map((s) => ({
    trigger: s.trigger,
    name: s.name,
    description: s.description,
  }));
  res.json({ shortcuts });
});

router.post("/shortcuts/:id/delete", (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || !getShortcut(id)) {
    res.redirect(303, "/shortcuts?flash=Shortcut+not+found");
    return;
  }
  deleteShortcut(id);
  res.redirect(303, "/shortcuts?flash=Shortcut+deleted");
});

export default router;
