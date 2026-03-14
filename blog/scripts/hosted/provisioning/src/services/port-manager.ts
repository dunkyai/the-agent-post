import Database from "better-sqlite3";

const PORT_MIN = 19000;
const PORT_MAX = 19999;

const DB_PATH = process.env.DB_PATH || "/opt/agentpost/data/instances.db";
const db = new Database(DB_PATH);

export function allocatePort(): number {
  const used = db
    .prepare(
      "SELECT port FROM instances WHERE status != 'deleted' ORDER BY port"
    )
    .all() as { port: number }[];

  const usedPorts = new Set(used.map((r) => r.port));

  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  throw new Error("No available ports");
}
