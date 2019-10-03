#!/usr/bin/env node
import process = require('process');
import yargs = require('yargs');
import logging = require('../lib/logging');
import { Timers } from '../lib/timer';
import { VERSION_DESC } from '../lib/version';
import { findJsiiModules, updateAllNpmIgnores } from '../lib/npm-modules';
import { JsiiModule } from '../lib/packaging';
import { Thunk, ConcurrencyLimiter } from '../lib/util';
import { ALL_BUILDERS, TargetName } from '../lib/targets';
import pLimit from 'p-limit';

(async function main() {
  const argv = yargs
    .usage('Usage: jsii-pacmak [-t target,...] [-o outdir] [package-dir]')
    .env('JSII_PACMAK')
    .option('targets', {
      alias: ['target', 't'],
      type: 'array',
      desc: 'target languages for which to generate bindings',
      defaultDescription: 'all targets defined in `package.json` will be generated',
      choices: Object.keys(ALL_BUILDERS),
      required: false
    })
    .option('concurrency', {
      alias: 'C',
      type: 'boolean',
      desc: 'whether to work in parallel when possible',
      default: true,
    })
    .option('outdir', {
      alias: 'o',
      type: 'string',
      desc: 'directory where artifacts will be generated',
      defaultDescription: 'based on `jsii.output` in `package.json`',
      required: false
    })
    .option('code-only', {
      alias: 'c',
      type: 'boolean',
      desc: 'generate code only (instead of building and packaging)',
      default: false
    })
    .option('fingerprint', {
      type: 'boolean',
      desc: 'attach a fingerprint to the generated artifacts, and skip generation if outdir contains artifacts that have a matching fingerprint',
      default: true
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      desc: 'force generation of new artifacts, even if the fingerprints match',
      default: false
    })
    .option('force-subdirectory', {
      type: 'boolean',
      desc: 'force generation into a target-named subdirectory, even in single-target mode',
      default: true,
    })
    .option('recurse', {
      alias: 'R',
      type: 'boolean',
      desc: 'recursively generate and build all dependencies into `outdir`',
      default: false
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      desc: 'emit verbose build output',
      count: true,
      default: 0
    })
    .option('clean', {
      type: 'boolean',
      desc: 'clean up temporary files upon success (use --no-clean to disable)',
      default: true,
    })
    .option('npmignore', {
      type: 'boolean',
      desc: 'Auto-update .npmignore to exclude the output directory and include the .jsii file',
      default: true
    })
    .version(VERSION_DESC)
    .argv;

  logging.level = argv.verbose !== undefined ? argv.verbose : 0;

  // Default to 4 threads in case of concurrency, good enough for most situations
  const limit = argv.concurrency ? pLimit(4) : pLimit(1);
  const awaitAll = makeAwaitAll(limit);

  logging.debug('command line arguments:', argv);

  const timers = new Timers();

  const modulesToPackage = await findJsiiModules(argv._, argv.recurse);

  if (argv.outdir) {
    for (const module of modulesToPackage) {
      module.outputDirectory = argv.outdir;
    }
  } else if (argv.npmignore) {
    // if outdir is coming from package.json, verify it is excluded by .npmignore. if it is explicitly
    // defined via --out, don't perform this verification.
    await updateAllNpmIgnores(modulesToPackage);
  }

  await timers.recordAsync('npm pack', () => {
    logging.info('Packaging NPM bundles');
    return awaitAll(modulesToPackage
      .map(m => () => m.npmPack()));
  });

  await timers.recordAsync('load jsii', () => {
    logging.info('Loading jsii assemblies');
    return awaitAll(modulesToPackage
      .map(m => () => m.load()));
  });

  try {
    const requestedTargets = argv.targets && argv.targets.map(t => `${t}`)
    const targetSets = sliceTargets(modulesToPackage, requestedTargets);

    const perLanguageDirectory = targetSets.length > 1 || argv["force-subdirectory"];

    // We run all target sets in parallel for minimal wall clock time
    await awaitAll(targetSets.map(targetSet => async () => {
    // for (const targetSet of targetSets) {
      logging.info(`Packaging '${targetSet.targetType}' for ${describePackages(targetSet)}`);
      await timers.recordAsync(targetSet.targetType, () =>
        buildTargetsForLanguage(targetSet.targetType, targetSet.modules, perLanguageDirectory)
      );
      logging.info(`${targetSet.targetType} finished`);
    }));

  } finally {
    if (argv.clean) {
      logging.debug('Cleaning up');
      await timers.recordAsync('cleanup', () =>
        awaitAll(modulesToPackage
          .map(m => () => m.cleanup()))
      );
    } else {
      logging.debug(`Temporary directories retained (--no-clean)`);
    }
  }

  logging.info(`Packaged. ${timers.display()}`);

  async function buildTargetsForLanguage(targetLanguage: string, modules: JsiiModule[], perLanguageDirectory: boolean) {
    // ``argv.target`` is guaranteed valid by ``yargs`` through the ``choices`` directive.
    const builder = ALL_BUILDERS[targetLanguage as TargetName];
    if (!builder) {
      throw new Error(`Unsupported target: "${targetLanguage}"`);
    }

    await builder.buildModules(modules, {
      clean: argv.clean,
      codeOnly: argv["code-only"],
      force: argv.force,
      fingerprint: argv.fingerprint,
      arguments: argv,
      languageSubdirectory: perLanguageDirectory,
    });
  }
})().catch(err => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});

/**
 * A set of packages (targets) translated into the same language
 */
interface TargetSet {
  targetType: string;
  modules: JsiiModule[];
}

function sliceTargets(modules: JsiiModule[], requestedTargets?: string[]) {
  if (requestedTargets === undefined) {
    requestedTargets = allAvailableTargets(modules);
  }

  const ret = new Array<TargetSet>();
  for (const target of requestedTargets) {
    ret.push({
      targetType: target,
      modules: modules.filter(m => m.availableTargets.includes(target))
    });
  }

  return ret;
}

function allAvailableTargets(modules: JsiiModule[]) {
  const ret = new Set<string>();
  for (const module of modules) {
    for (const target of module.availableTargets) {
      ret.add(target)
    }
  }
  return Array.from(ret);
}

/**
 * Await all with automatic work limit
 */
function makeAwaitAll(limit: ConcurrencyLimiter) {
  return function awaitAll<A>(work: Thunk<A>[]) {
    return Promise.all(work.map(limit));
  }
}


function describePackages(target: TargetSet) {
  if (target.modules.length > 0 && target.modules.length < 5) {
    return target.modules.map(m => m.name).join(', ');
  }
  return `${target.modules.length} modules`;
}