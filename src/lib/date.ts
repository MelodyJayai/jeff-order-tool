const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function chinaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
}

export function nowIso() {
  return new Date().toISOString();
}

export function cleanDate(value: unknown, fallback = chinaToday()) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return DATE_RE.test(trimmed) ? trimmed : fallback;
}

export function optionalDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return DATE_RE.test(trimmed) ? trimmed : null;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
