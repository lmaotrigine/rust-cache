import * as core from '@actions/core';
import * as io from '@actions/io';
import fs from 'fs';
import path from 'path';
import { CARGO_HOME } from './config';
import { Packages } from './workspace';

export async function cleanTargetDir(targetDir: string, packages: Packages, checkTimestamp = false): Promise<void> {
  core.debug(`cleaning target directory "${targetDir}"`);
  const dir = await fs.promises.opendir(targetDir);
  for await (const dirent of dir) {
    if (dirent.isDirectory()) {
      const dirName = path.join(dir.path, dirent.name);
      const isNestedTarget = (await exists(path.join(dirName, 'CACHEDIR.TAG'))) || (await exists(path.join(dirName, '.rustc_info.json')));
      try {
        if (isNestedTarget) {
          await cleanTargetDir(dirName, packages, checkTimestamp);
        } else {
          await cleanProfileTarget(dirName, packages, checkTimestamp);
        }
      } catch {}
    } else if (dirent.name !== 'CACHEDIR.TAG') {
      await rm(dir.path, dirent);
    }
  }
}

async function cleanProfileTarget(profileDir: string, packages: Packages, checkTimestamp = false): Promise<void> {
  core.debug(`cleaning profile directory "${profileDir}"`);
  const keepProfile = new Set(['build', '.fingerprint', 'deps']);
  await rmExcept(profileDir, keepProfile);
  const keepPkg = new Set(packages.map((p) => p.name));
  await rmExcept(path.join(profileDir, 'build'), keepPkg, checkTimestamp);
  await rmExcept(path.join(profileDir, '.fingerprint'), keepPkg, checkTimestamp);
  const keepDeps = new Set(packages.flatMap((p) => {
    const names = [];
    for (const n of [p.name, ...p.targets]) {
      const name = n.replace(/-/g, '_');
      names.push(name, `lib${name}`);
    }
    return names;
  }));
  await rmExcept(path.join(profileDir, 'deps'), keepDeps, checkTimestamp);
}

export async function getCargoBins(): Promise<Set<string>> {
  const bins = new Set<string>();
  try {
    const { installs }: { installs: { [key: string]: { bins: Array<string> } } } = JSON.parse(await fs.promises.readFile(path.join(CARGO_HOME, '.crates2.json'), 'utf8'));
    for (const pkg of Object.values(installs)) {
      for (const bin of pkg.bins) {
        bins.add(bin);
      }
    }
  } catch {}
  return bins;
}

export async function cleanBin(oldBins: Array<string>) {
  const bins = await getCargoBins();
  for (const bin of oldBins) {
    bins.delete(bin);
  }
  const dir = await fs.promises.opendir(path.join(CARGO_HOME, 'bin'));
  for await (const dirent of dir) {
    if (dirent.isFile() && !bins.has(dirent.name)) {
      await rm(dir.path, dirent);
    }
  }
}

export async function cleanRegistry(packages: Packages, crates = true) {
  try {
    const credentials = path.join(CARGO_HOME, 'credentials.toml');
    core.debug(`deleting ${credentials}`);
    await fs.promises.unlink(credentials);
  } catch {}
  let pkgSet = new Set(packages.map((p) => p.name));
  const indexDir = await fs.promises.opendir(path.join(CARGO_HOME, 'registry', 'index'));
  for await (const dirent of indexDir) {
    if (dirent.isDirectory()) {
      const dirPath = path.join(indexDir.path, dirent.name);
      if (await exists(path.join(dirPath, '.git'))) {
        await rmRF(path.join(dirPath, '.cache'));
      } else {
        await cleanRegistryIndexCache(dirPath, pkgSet);
      }
    }
  }
  if (!crates) {
    core.debug('skipping registry cache and src cleanup');
    return;
  }
  pkgSet = new Set(packages.filter((p) => p.name.endsWith('-sys')).map((p) => `${p.name}-${p.version}`));
  const srcDir = await fs.promises.opendir(path.join(CARGO_HOME, 'registry', 'src'));
  for await (const dirent of srcDir) {
    if (dirent.isDirectory()) {
      const dir = await fs.promises.opendir(path.join(srcDir.path, dirent.name));
      for await (const dirent of dir) {
        if (dirent.isDirectory() && !pkgSet.has(dirent.name)) {
          await rmRF(path.join(dir.path, dirent.name));
        }
      }
    }
  }
  pkgSet = new Set(packages.map((p) => `${p.name}-${p.version}.crate`));
  const cacheDir = await fs.promises.opendir(path.join(CARGO_HOME, 'registry', 'cache'));
  for await (const dirent of cacheDir) {
    if (dirent.isDirectory()) {
      const dir = await fs.promises.opendir(path.join(cacheDir.path, dirent.name));
      for await (const dirent of dir) {
        if (dirent.isFile() && !pkgSet.has(dirent.name)) {
          await rm(dir.path, dirent);
        }
      }
    }
  }
}

async function cleanRegistryIndexCache(dirName: string, keepPkg: Set<string>): Promise<boolean> {
  let dirIsEmpty = true;
  const cacheDir = await fs.promises.opendir(dirName);
  for await (const dirent of cacheDir) {
    if (dirent.isDirectory()) {
      if (await cleanRegistryIndexCache(path.join(dirName, dirent.name), keepPkg)) {
        await rm(dirName, dirent);
      } else {
        dirIsEmpty &&= false;
      }
    } else {
      if (keepPkg.has(dirent.name)) {
        dirIsEmpty &&= false;
      } else {
        await rm(dirName, dirent);
      }
    }
  }
  return dirIsEmpty;
}

export async function cleanGit(packages: Packages) {
  const coPath = path.join(CARGO_HOME, 'git', 'checkouts');
  const dbPath = path.join(CARGO_HOME, 'git', 'db');
  const repos = new Map<string, Set<string>>();
  for (const p of packages) {
    if (!p.path.startsWith(coPath)) {
      continue;
    }
    const [repo, ref] = p.path.slice(coPath.length + 1).split(path.sep);
    const refs = repos.get(repo);
    if (refs) {
      refs.add(ref);
    } else {
      repos.set(repo, new Set([ref]));
    }
  }
  try {
    const dir = await fs.promises.opendir(dbPath);
    for await (const dirent of dir) {
      if (!repos.has(dirent.name)) {
        await rm(dir.path, dirent);
      }
    }
  } catch {}
  try {
    const dir = await fs.promises.opendir(coPath);
    for await (const dirent of dir) {
      const refs = repos.get(dirent.name);
      if (!refs) {
        await rm(dir.path, dirent);
        continue;
      }
      if (!dirent.isDirectory()) {
        continue;
      }
      const refsDir = await fs.promises.opendir(path.join(dir.path, dirent.name));
      for await (const dirent of refsDir) {
        if (!refs.has(dirent.name)) {
          await rm(refsDir.path, dirent);
        }
      }
    }
  } catch {}
}

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

async function rmExcept(dirName: string, keepPrefix: Set<string>, checkTimestamp = false) {
  const dir = await fs.promises.opendir(dirName);
  for await (const dirent of dir) {
    if (checkTimestamp) {
      const fileName = path.join(dir.path, dirent.name);
      const { mtime } = await fs.promises.stat(fileName);
      const isOutdated = Date.now() - mtime.getTime() > ONE_WEEK;
      if (isOutdated) {
        await rm(dir.path, dirent);
      }
      return;
    }
    let name = dirent.name;
    const idx = name.lastIndexOf('-');
    if (idx !== -1) {
      name = name.slice(0, idx);
    }
    if (!keepPrefix.has(name)) {
      await rm(dir.path, dirent);
    }
  }
}

async function rm(parent: string, dirent: fs.Dirent) {
  try {
    const fileName = path.join(parent, dirent.name);
    core.debug(`deleting "${fileName}"`);
    if (dirent.isFile()) {
      await fs.promises.unlink(fileName);
    } else if (dirent.isDirectory()) {
      await io.rmRF(fileName);
    }
  } catch {}
}

async function rmRF(dirName: string) {
  core.debug(`deleting "${dirName}"`);
  await io.rmRF(dirName);
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.promises.access(path);
    return true;
  } catch {
    return false;
  }
}
