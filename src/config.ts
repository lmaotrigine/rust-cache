import * as core from '@actions/core';
import * as glob from '@actions/glob';
import crypto from 'crypto';
import fs from 'fs';
import fs_promises from 'fs/promises';
import os from 'os';
import path from 'path';
import { parse } from './lib/toml/parse';
import { getCargoBins } from './cleanup';
import { getCmdOutput } from './util';
import { Workspace } from './workspace';
import { Primitive } from './lib/toml/util';

const HOME = os.homedir();
export const CARGO_HOME = process.env.CARGO_HOME || path.join(HOME, '.cargo');

const STATE_CONFIG = 'RUST_CACHE_CONFIG';
const HASH_LENGTH = 8;

export class CacheConfig {
  public cachePaths: Array<string> = [];
  public cacheKey = '';
  public restoreKey = '';
  public workspaces: Array<Workspace> = [];
  public cargoBins: Array<string> = [];
  private keyPrefix = '';
  private keyRust = '';
  private keyEnvs: Array<string> = [];
  private keyFiles: Array<string> = [];
  
  private constructor() {}

  static async new(): Promise<CacheConfig> {
    const self = new CacheConfig();
    let key = core.getInput('prefix-key') || 'v0-rust';
    const sharedKey = core.getInput('shared-key');
    if (sharedKey) {
      key += `-${sharedKey}`;
    } else {
      const inputKey = core.getInput('key');
      if (inputKey) {
        key += `-${inputKey}`;
      }
      const job = process.env.GITHUB_JOB;
      if (job) {
        key += `-${job}`;
      }
    }
    self.keyPrefix = key;
    let hasher = crypto.createHash('sha1');
    const rustVersion = await getRustVersion();
    let keyRust = `${rustVersion.release} ${rustVersion.host}`;
    hasher.update(keyRust);
    hasher.update(rustVersion['commit-hash']);
    keyRust += ` (${rustVersion['commit-hash']})`;
    self.keyRust = keyRust;
    const envPrefixes = ['CARGO', 'CC', 'CFLAGS', 'CXX', 'CMAKE', 'RUST'];
    envPrefixes.push(...core.getInput('env-vars').split(/\s+/).filter(Boolean));
    const keyEnvs = [];
    const envKeys = Object.keys(process.env);
    envKeys.sort((a, b) => a.localeCompare(b));
    for (const key of envKeys) {
      const value = process.env[key];
      if (envPrefixes.some((prefix) => key.startsWith(prefix)) && value) {
        hasher.update(`${key}=${value}`);
        keyEnvs.push(key);
      }
    }
    self.keyEnvs = keyEnvs;
    key += `-${digest(hasher)}`;
    self.restoreKey = key;
    const workspaces: Array<Workspace> = [];
    const workspacesInput = core.getInput('workspaces') || '.';
    for (const workspace of workspacesInput.trim().split('\n')) {
      let [root, target = 'target'] = workspace.split('->').map((s) => s.trim());
      root = path.resolve(root);
      target = path.join(root, target);
      workspaces.push(new Workspace(root, target));
    }
    self.workspaces = workspaces;
    let keyFiles = await globFiles('.cargo/config.toml\nrust-toolchain\nrust-toolchain.toml');
    const parsedKeyFiles = [];
    hasher = crypto.createHash('sha1');
    for (const workspace of workspaces) {
      const root = workspace.root;
      keyFiles.push(...await( globFiles(`${root}/**/.cargo/config.toml\n${root}/**/rust-toolchain\n${root}/**/rust-toolchain.toml`)));
      const cargoManifests = sortAndUnique(await globFiles(`${root}/**/Cargo.toml`));
      for (const cargoManifest of cargoManifests) {
        try {
          const content = await fs_promises.readFile(cargoManifest, { encoding: 'utf-8' });
          const parsed = parse(content) as { [key: string]: Primitive };
          if ('package' in parsed) {
            const pack = parsed.package as { [key: string]: Primitive };
            if ('version' in pack) {
              pack['version'] = '0.0.0';
            }
          }
          for (const prefix of ['', 'build-', 'dev-']) {
            const sectionName = `${prefix}dependencies`;
            if (!(sectionName in parsed)) {
              continue;
            }
            const deps = parsed[sectionName] as { [key: string]: Primitive };
            for (const key of Object.keys(deps)) {
              const dep = deps[key] as { [key: string]: Primitive };
              try {
                if ('path' in dep) {
                  dep.version = '0.0.0';
                  dep.path = '';
                }
              } catch (_e) {
                continue;
              }
            }
          }
          hasher.update(JSON.stringify(parsed));
          parsedKeyFiles.push(cargoManifest);
        } catch (e) {
          core.warning(`Error parsing Cargo.toml manifest, falling back to caching entire file: ${e}`);
          keyFiles.push(cargoManifest);
        }
      }
      const cargoLocks = sortAndUnique(await globFiles(`${root}/**/Cargo.lock`));
      for (const cargoLock of cargoLocks) {
        try {
          const content = await fs_promises.readFile(cargoLock, { encoding: 'utf-8' });
          const parsed = parse(content);
          if (parsed.version !== 3 || !('package' in parsed)) {
            core.warning('Unsupported Cargo.lock format, falling back to caching entire file');
            keyFiles.push(cargoLock);
            continue;
          }
          const packages = (parsed.package as any[]).filter((p) => 'source' in p || 'checksum' in p);
          hasher.update(JSON.stringify(packages));
          parsedKeyFiles.push(cargoLock);
        } catch (e) {
          core.warning(`Error parsing Cargo.lock manifest, falling back to caching entire file: ${e}`);
          keyFiles.push(cargoLock);
        }
      }
    }
    keyFiles = sortAndUnique(keyFiles);
    for (const file of keyFiles) {
      for await (const chunk of fs.createReadStream(file)) {
        hasher.update(chunk);
      }
    }
    const lockHash = digest(hasher);
    keyFiles.push(...parsedKeyFiles);
    self.keyFiles = keyFiles;
    key += `-${lockHash}`;
    self.cacheKey = key;
    self.cachePaths = [CARGO_HOME];
    const cacheTargets = core.getInput('cache-targets').toLowerCase() || 'true';
    if (cacheTargets === 'true') {
      self.cachePaths.push(...workspaces.map((ws) => ws.target));
    }
    const cacheDirectories = core.getInput('cache-directories');
    for (const dir of cacheDirectories.trim().split(/\s+/).filter(Boolean)) {
      self.cachePaths.push(dir);
    }
    const bins = await getCargoBins();
    self.cargoBins = Array.from(bins.values());
    return self;
  }

  static fromState(): CacheConfig {
    const source = core.getState(STATE_CONFIG);
    if (!source) {
      throw new Error('Cache configuration not found in state');
    }
    const self = new CacheConfig();
    Object.assign(self, JSON.parse(source));
    self.workspaces = self.workspaces.map((w) => new Workspace(w.root, w.target));
    return self;
  }

  printInfo(): void {
    core.startGroup('Cache configuration');
    core.info('Workspaces:');
    for (const workspace of this.workspaces) {
      core.info(`    ${workspace.root}`);
    }
    core.info('Cache paths:');
    for (const cachePath of this.cachePaths) {
      core.info(`    ${cachePath}`);
    }
    core.info('Restore key:');
    core.info(`    ${this.restoreKey}`);
    core.info('Cache key:');
    core.info(`    ${this.cacheKey}`);
    core.info('.. Prefix:');
    core.info(`  - ${this.keyPrefix}`);
    core.info('.. Environment considered:');
    core.info(`  - Rust version: ${this.keyRust}`);
    for (const env of this.keyEnvs) {
      core.info(`  - ${env}`);
    }
    core.info('.. Lockfiles considered:');
    for (const file of this.keyFiles) {
      core.info(`  - ${file}`);
    }
    core.endGroup();
  }

  saveState(): void {
    core.saveState(STATE_CONFIG, this);
  }
}

export function isCacheUpToDate(): boolean {
  return core.getState(STATE_CONFIG) === '';
}

function digest(hasher: crypto.Hash): string {
  return hasher.digest('hex').substring(0, HASH_LENGTH);
}

interface RustVersion {
  host: string;
  release: string;
  'commit-hash': string;
}

async function getRustVersion(): Promise<RustVersion> {
  const stdout = await getCmdOutput('rustc', ['-Vv']);
  const splits = stdout.split(/[\r\n]+/).filter(Boolean).map((s) => s.split(':').map((s) => s.trim())).filter((s) => s.length === 2);
  return Object.fromEntries(splits);
}

async function globFiles(pattern: string): Promise<string[]> {
  const globber = await glob.create(pattern, { followSymbolicLinks: false });
  return (await globber.glob()).filter((file) => fs.statSync(file).isFile());
}

function sortAndUnique(a: string[]): string[] {
  return a.sort((a, b) => a.localeCompare(b)).reduce((acc: string[], cur: string) => {
    const len = acc.length;
    if (len === 0 || acc[len - 1].localeCompare(cur) !== 0) {
      acc.push(cur);
    }
    return acc;
  }, []);
}
