import { NextRequest, NextResponse } from "next/server";
import { listInstances } from "@/lib/provisioning";

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const instances = await listInstances();
    return NextResponse.json(instances);
  } catch (err: unknown) {
    console.error("Failed to list instances:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to list instances",
      },
      { status: 500 }
    );
  }
}
