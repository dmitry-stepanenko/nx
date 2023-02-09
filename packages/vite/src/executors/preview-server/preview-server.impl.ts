import {
  ExecutorContext,
  parseTargetString,
  runExecutor,
  Target,
} from '@nrwl/devkit';
import { InlineConfig, mergeConfig, preview, PreviewServer } from 'vite';
import {
  getNxTargetOptions,
  getViteSharedConfig,
  getViteBuildOptions,
  getVitePreviewOptions,
} from '../../utils/options-utils';
import { ViteBuildExecutorOptions } from '../build/schema';
import { VitePreviewServerExecutorOptions } from './schema';

export async function* vitePreviewServerExecutor(
  options: VitePreviewServerExecutorOptions,
  context: ExecutorContext
) {
  let buildTargetOptions: ViteBuildExecutorOptions | undefined;
  const target: Target =
    options.buildTarget &&
    parseTargetString(options.buildTarget, context.projectGraph);
  if (target) {
    const targetConfiguration =
      context.projectsConfigurations.projects[target.project]?.targets[
        target.target
      ];
    if (!targetConfiguration) {
      throw new Error(`Invalid buildTarget: ${options.buildTarget}`);
    }
    if (targetConfiguration.executor !== '@nrwl/vite:build') {
      throw new Error(
        `Invalid buildTarget: ${options.buildTarget}. ` +
          `Only "@nrwl/vite:build" executor is supported. ` +
          `If you need other executors to be used, remove "buildTarget" option and execute your task manually prior to the "preview"`
      );
    }
    // Retrieve the option for the configured buildTarget.
    buildTargetOptions = getNxTargetOptions(options.buildTarget, context);

    if (options.staticFilePath) {
      buildTargetOptions.outputPath = options.staticFilePath;
    }
  }

  if (!buildTargetOptions && !options.staticFilePath) {
    throw new Error(
      `Either "buildTarget" or "staticFilePath" option is required`
    );
  }

  const mergeableBuildTargetOptions = buildTargetOptions ?? {
    outputPath: options.staticFilePath,
  };

  // Merge the options from the build and preview-serve targets.
  // The latter takes precedence.
  const mergedOptions = {
    ...{ watch: {} },
    ...mergeableBuildTargetOptions,
    ...options,
  };

  // Retrieve the server configuration.
  const serverConfig: InlineConfig = mergeConfig(
    getViteSharedConfig(mergedOptions, options.clearScreen, context),
    {
      build: getViteBuildOptions(mergedOptions, context),
      preview: getVitePreviewOptions(mergedOptions, context),
    }
  );

  if (serverConfig.mode === 'production') {
    console.warn('WARNING: preview is not meant to be run in production!');
  }

  let server: PreviewServer | undefined;

  const processOnExit = async () => {
    await closeServer(server);
  };

  process.once('SIGINT', processOnExit);
  process.once('SIGTERM', processOnExit);
  process.once('exit', processOnExit);

  let build: AsyncIterableIterator<{
    success: boolean;
  }>;
  if (buildTargetOptions) {
    // if build target is specified, invoke it
    build = await runExecutor(target, mergedOptions, context);
  } else {
    // provide a dummy asyncIterable
    build = (async function* () {
      yield { success: true, test: 'hello1234' };
    })();
  }

  for await (const result of build) {
    if (result.success) {
      try {
        if (!server) {
          server = await preview(serverConfig);
        }
        server.printUrls();

        const resolvedUrls = [
          ...server.resolvedUrls.local,
          ...server.resolvedUrls.network,
        ];

        yield {
          success: true,
          baseUrl: resolvedUrls[0] ?? '',
        };
      } catch (e) {
        console.error(e);
        yield {
          success: false,
          baseUrl: '',
        };
      }
    } else {
      yield {
        success: false,
        baseUrl: '',
      };
    }
  }

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
    process.once('exit', () => resolve());
  });
}

function closeServer(server?: PreviewServer): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
    } else {
      const { httpServer } = server;
      // closeAllConnections was added in Node v18.2.0
      httpServer.closeAllConnections && httpServer.closeAllConnections();
      httpServer.close(() => resolve());
    }
  });
}

export default vitePreviewServerExecutor;
