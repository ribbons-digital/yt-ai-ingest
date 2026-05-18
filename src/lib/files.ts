import { copyFile, mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function safeSlug(value: string, maxLength = 80): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, maxLength)
    .replace(/[.-]+$/, "")
    .toLowerCase();

  return slug || "youtube-video";
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function findFirstFile(
  dir: string,
  predicate: (name: string) => boolean
): Promise<string | undefined> {
  const names = await readdir(dir);
  const match = names.find(predicate);
  return match ? path.join(dir, match) : undefined;
}

export async function moveIfExists(from: string | undefined, to: string): Promise<boolean> {
  if (!from || !(await pathExists(from))) {
    return false;
  }
  if (path.resolve(from) === path.resolve(to)) {
    return true;
  }
  await rename(from, to);
  return true;
}

export async function copyIfExists(from: string | undefined, to: string): Promise<boolean> {
  if (!from || !(await pathExists(from))) {
    return false;
  }
  if (path.resolve(from) === path.resolve(to)) {
    return true;
  }
  await copyFile(from, to);
  return true;
}

export async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return await listFilesRecursive(fullPath);
      }
      return [fullPath];
    })
  );

  return files.flat().sort();
}
