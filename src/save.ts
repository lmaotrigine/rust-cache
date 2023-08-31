import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from './cleanup';
import { CacheConfig, isCacheUpToDate } from './config';
import { reportError } from './util';

process.on('uncaughtException', (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run(): Promise<void> {
  const save = core.getInput('save-if').toLowerCase() || 'true';
  if (!(cache.isFeatureAvailable() && save === 'true')) {
    return;
  }
  try {
    if (isCacheUpToDate()) {
      core.info('cache up-to-date.');
      return;
    }
    const config = CacheConfig.fromState();
    config.printInfo();
    core.info('');
    await macOsWorkaround();
    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackages();
      allPackages.push(...packages);
      try {
        core.info(`... Cleaning ${workspace.target} ...`);
        await cleanTargetDir(workspace.target, packages);
      } catch (e) {
        core.debug(`${(e as any).stack}`);
      }
    }
    try {
      const crates = core.getInput('cache-all-crates').toLowerCase() || 'false';
      core.info(`... Cleaning cargo registry (cache-all-crates: ${crates}) ...`);
      await cleanRegistry(allPackages, crates !== 'true');
    } catch (e) {
      core.debug(`${(e as any).stack}`);
    }
    try {
      core.info(`... Cleaning cargo/bin ...`);
      await cleanBin(config.cargoBins);
    } catch (e) {
      core.debug(`${(e as any).stack}`);
    }
    try {
      core.info('... Cleaning cargo git cache ...');
      await cleanGit(allPackages);
    } catch (e) {
      core.debug(`${(e as any).stack}`);
    }
    core.info('... Saving cache ...');
    await cache.saveCache(config.cachePaths.slice(), config.cacheKey);
  } catch (e) {
    reportError(e);
  }
}

run();

async function macOsWorkaround(): Promise<void> {
  try {
    await exec.exec('sudo', ['/usr/sbin/purge'], { silent: true });
  } catch {}
}
