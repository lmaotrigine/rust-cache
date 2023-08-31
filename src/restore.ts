import * as core from '@actions/core';
import * as cache from '@actions/cache';
import { cleanTargetDir } from './cleanup';
import { reportError } from './util';
import { CacheConfig } from './config';

process.on('uncaughtException', (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run(): Promise<void> {
  if (!cache.isFeatureAvailable()) {
    setCacheHitOutput(false);
    return;
  }
  try {
    let cacheOnFailure = core.getInput('cache-on-failure').toLowerCase();
    if (cacheOnFailure !== 'true') {
      cacheOnFailure = 'false';
    }
    core.exportVariable('CACHE_ON_FAILURE', cacheOnFailure);
    core.exportVariable('CARGO_INCREMENTAL', '0');
    const config = await CacheConfig.new();
    config.printInfo();
    core.info('');
    core.info(`... Restoring cache ...`);
    const key = config.cacheKey;
    const restoreKey = await cache.restoreCache(config.cachePaths.slice(), key, [config.restoreKey]);
    if (restoreKey) {
      const match = restoreKey === key;
      core.info(`Restored from cache key "${restoreKey}" full match: ${match}`);
      if (!match) {
        for (const workspace of config.workspaces) {
          try {
            await cleanTargetDir(workspace.target, [], true);
          } catch {}
        }
        config.saveState();
      }
      setCacheHitOutput(match);
    } else {
      core.info('No cache found.');
      config.saveState();
      setCacheHitOutput(false);
    }
  } catch (e) {
    setCacheHitOutput(false);
    reportError(e);
  }
}

function setCacheHitOutput(cacheHit: boolean): void {
  core.setOutput('cache-hit', cacheHit.toString());
}

run();
