interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== "*") {
        if (range.includes("-")) {
          [start, end] = range.split("-").map(Number);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes("-")) {
      const [s, e] = part.split("-").map(Number);
      for (let i = s; i <= e; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return values;
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    daysOfMonth: parseField(parts[2], 1, 31),
    months: parseField(parts[3], 1, 12),
    daysOfWeek: parseField(parts[4], 0, 6),
  };
}

/**
 * Get date parts in a specific timezone.
 * Returns { year, month (1-12), day, dow (0-6), hour, minute } in the given tz.
 */
function getPartsInTz(date: Date, tz: string): { month: number; day: number; dow: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    dow: dowMap[get("weekday")] ?? 0,
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
  };
}

export function getNextRun(expression: string, after: Date = new Date(), timezone?: string): Date {
  const cron = parseCron(expression);
  const tz = timezone || "UTC";

  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const p = getPartsInTz(candidate, tz);
    if (
      cron.months.has(p.month) &&
      cron.daysOfMonth.has(p.day) &&
      cron.daysOfWeek.has(p.dow) &&
      cron.hours.has(p.hour) &&
      cron.minutes.has(p.minute)
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`Could not find next run for cron expression: ${expression}`);
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hour, dom, , dow] = parts;
  const pieces: string[] = [];

  if (min === "*" && hour === "*") {
    pieces.push("Every minute");
  } else if (min.startsWith("*/")) {
    pieces.push(`Every ${min.slice(2)} minutes`);
  } else if (hour === "*") {
    pieces.push(`At minute ${min} of every hour`);
  } else {
    pieces.push(`At ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (dow !== "*") {
    const days = dow.split(",").map((d) => {
      if (d.includes("-")) {
        const [s, e] = d.split("-").map(Number);
        return `${dayNames[s]}-${dayNames[e]}`;
      }
      return dayNames[parseInt(d, 10)] || d;
    });
    pieces.push(`on ${days.join(", ")}`);
  }
  if (dom !== "*") {
    pieces.push(`on day ${dom} of the month`);
  }

  return pieces.join(" ");
}
