import packageJson from "../../package.json";

import { areInAppUpdatesDisabled } from "@/lib/deployment";

export type UpdateInfo = {
  ok: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  assetName: string | null;
  downloadUrl: string | null;
  releaseUrl: string | null;
  message: string;
};

type GitHubRelease = {
  html_url?: unknown;
  name?: unknown;
  tag_name?: unknown;
  assets?: Array<{
    name?: unknown;
    browser_download_url?: unknown;
  }>;
};

type UpdateManifest = {
  version?: unknown;
  assetName?: unknown;
  downloadUrl?: unknown;
  releaseUrl?: unknown;
};

const DEFAULT_UPDATE_REPOSITORY = "MelodyJayai/jeff-order-tool";

export function getCurrentVersion() {
  return packageJson.version;
}

function versionParts(version: string) {
  return version
    .trim()
    .replace(/^v/iu, "")
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
}

function normalizeVersion(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^v/iu, "") : "";
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function findInstallerAsset(release: GitHubRelease) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installers = assets
    .map((asset) => ({
      name: typeof asset.name === "string" ? asset.name : "",
      downloadUrl:
        typeof asset.browser_download_url === "string"
          ? asset.browser_download_url
          : "",
    }))
    .filter(
      (asset) =>
        asset.name.toLowerCase().endsWith(".exe") &&
        asset.name.toLowerCase().includes("setup") &&
        isHttpsUrl(asset.downloadUrl),
    );

  return (
    installers.find((asset) =>
      asset.name.toLowerCase().startsWith("jeffordertoolsetup"),
    ) ??
    installers[0] ??
    null
  );
}

function info(value: Omit<UpdateInfo, "currentVersion">): UpdateInfo {
  return {
    currentVersion: getCurrentVersion(),
    ...value,
  };
}

async function checkManifestUpdate(manifestUrl: string) {
  const response = await fetch(manifestUrl, {
    cache: "no-store",
    headers: { "User-Agent": "jeff-order-tool" },
  });

  if (!response.ok) {
    throw new Error(`更新清单请求失败：HTTP ${response.status}`);
  }

  const manifest = (await response.json()) as UpdateManifest;
  const latestVersion = normalizeVersion(manifest.version);
  const downloadUrl =
    typeof manifest.downloadUrl === "string" && isHttpsUrl(manifest.downloadUrl)
      ? manifest.downloadUrl
      : "";
  const releaseUrl =
    typeof manifest.releaseUrl === "string" && isHttpsUrl(manifest.releaseUrl)
      ? manifest.releaseUrl
      : downloadUrl;

  if (!latestVersion) {
    return info({
      ok: false,
      latestVersion: null,
      updateAvailable: false,
      assetName: null,
      downloadUrl: null,
      releaseUrl: null,
      message: "更新清单里没有版本号",
    });
  }

  const updateAvailable = compareVersions(latestVersion, getCurrentVersion()) > 0;

  return info({
    ok: true,
    latestVersion,
    updateAvailable,
    assetName:
      typeof manifest.assetName === "string"
        ? manifest.assetName
        : `JeffOrderToolSetup-v${latestVersion}.exe`,
    downloadUrl: updateAvailable && downloadUrl ? downloadUrl : null,
    releaseUrl: releaseUrl || null,
    message: updateAvailable ? "发现新版本" : "当前已是最新版本",
  });
}

async function checkGitHubReleaseUpdate(repository: string) {
  const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
  const response = await fetch(apiUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "jeff-order-tool",
    },
  });

  if (response.status === 404) {
    return info({
      ok: false,
      latestVersion: null,
      updateAvailable: false,
      assetName: null,
      downloadUrl: null,
      releaseUrl: `https://github.com/${repository}/releases`,
      message: "还没有发布 GitHub Release",
    });
  }

  if (!response.ok) {
    throw new Error(`GitHub 更新检查失败：HTTP ${response.status}`);
  }

  const release = (await response.json()) as GitHubRelease;
  const latestVersion = normalizeVersion(release.tag_name);

  if (!latestVersion) {
    return info({
      ok: false,
      latestVersion: null,
      updateAvailable: false,
      assetName: null,
      downloadUrl: null,
      releaseUrl:
        typeof release.html_url === "string"
          ? release.html_url
          : `https://github.com/${repository}/releases`,
      message: "最新 Release 没有版本号",
    });
  }

  const updateAvailable = compareVersions(latestVersion, getCurrentVersion()) > 0;
  const installer = findInstallerAsset(release);
  const releaseUrl =
    typeof release.html_url === "string"
      ? release.html_url
      : `https://github.com/${repository}/releases/latest`;

  return info({
    ok: true,
    latestVersion,
    updateAvailable,
    assetName: installer?.name ?? null,
    downloadUrl: updateAvailable ? (installer?.downloadUrl ?? null) : null,
    releaseUrl,
    message: updateAvailable
      ? installer
        ? "发现新版本"
        : "发现新版本，但 Release 里没有安装包"
      : "当前已是最新版本",
  });
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  if (areInAppUpdatesDisabled()) {
    return info({
      ok: true,
      latestVersion: getCurrentVersion(),
      updateAvailable: false,
      assetName: null,
      downloadUrl: null,
      releaseUrl: null,
      message: "云端版本由服务器维护更新",
    });
  }

  const manifestUrl = process.env.JEFF_UPDATE_MANIFEST_URL?.trim();
  const repository =
    process.env.JEFF_UPDATE_REPOSITORY?.trim() || DEFAULT_UPDATE_REPOSITORY;

  try {
    if (manifestUrl) {
      return await checkManifestUpdate(manifestUrl);
    }

    return await checkGitHubReleaseUpdate(repository);
  } catch (error) {
    return info({
      ok: false,
      latestVersion: null,
      updateAvailable: false,
      assetName: null,
      downloadUrl: null,
      releaseUrl: `https://github.com/${repository}/releases`,
      message: error instanceof Error ? error.message : "检查更新失败",
    });
  }
}
