import os from "node:os";

type LanCandidate = {
  address: string;
  name: string;
  score: number;
};

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function interfaceScore(name: string, address: string) {
  const lowerName = name.toLowerCase();
  let score = 0;

  if (/wi-?fi|wlan|wireless|无线/.test(lowerName)) {
    score -= 20;
  }

  if (/ethernet|以太网/.test(lowerName)) {
    score -= 10;
  }

  if (/virtual|vmware|vbox|docker|tailscale|zerotier|vethernet/.test(lowerName)) {
    score += 50;
  }

  if (address.startsWith("10.")) {
    score += 5;
  }

  if (address.startsWith("172.")) {
    score += 8;
  }

  return score;
}

export function getLanAccessUrls(port = process.env.PORT || "3000") {
  const publicUrl = process.env.JEFF_PUBLIC_URL?.trim();

  if (publicUrl) {
    return [publicUrl.replace(/\/+$/u, "")];
  }

  const candidates: LanCandidate[] = [];
  const seen = new Set<string>();

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      if (!isPrivateIpv4(entry.address) || seen.has(entry.address)) {
        continue;
      }

      seen.add(entry.address);
      candidates.push({
        address: entry.address,
        name,
        score: interfaceScore(name, entry.address),
      });
    }
  }

  return candidates
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 4)
    .map((item) => `http://${item.address}:${port}`);
}
