import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findPackageJSON } from "node:module";
import { download, ElectronDownloadCacheMode, type ElectronDownloadRequestOptions } from '@electron/get';
import { rebuild, type RebuildOptions } from '@electron/rebuild';
import extract from '@electron-internal/extract-zip';

function getInstallPath(version: string, runtimesRoot: string) {
  return path.join(
    runtimesRoot,
    'electron',
    version,
    `${process.platform}-${process.arch}`
  );
}

function getExecutablePath(installPath: string) {
  switch (process.platform) {
    case 'win32': return path.join(installPath, 'electron.exe');
    case 'linux': return path.join(installPath, 'electron');
    case 'darwin':
      return path.join(
        installPath,
        'Electron.app',
        'Contents',
        'MacOS',
        'Electron'
      );

    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

export type InstallElectronRequest = {
  electronVersion: string;
  runtimesRoot: string;
  downloadOptions?: Omit<ElectronDownloadRequestOptions, 'cacheMode'>;
};

export async function installElectron({ electronVersion, runtimesRoot, downloadOptions }: InstallElectronRequest) {
  const installPath = getInstallPath(electronVersion, runtimesRoot);
  const executablePath = getExecutablePath(installPath);

  if (fs.existsSync(executablePath))
    return executablePath;

  console.log(`installing Electron version ${electronVersion} at '${installPath}'...`);

  // download zip, extract to temp, rename on success to guarantee install succeeds
  const zipPath = await download(electronVersion, {
    ...downloadOptions,
    cacheMode: ElectronDownloadCacheMode.Bypass,
  });
  try {
    const tempPath = `${installPath}.tmp`;
    const tempExecutable = getExecutablePath(tempPath);

    // recreate the temp install path to ensure it is fresh
    await fs.promises.rm(tempPath, { recursive: true, force: true });
    await fs.promises.mkdir(tempPath, { recursive: true });

    // extract zip into temp install path and ensure the executable exists
    await extract(zipPath, { dir: tempPath });
    if (!fs.existsSync(tempExecutable))
      throw new Error(`Electron ${electronVersion} extracted but executable missing from temp '${tempExecutable}'`);

    // delete real install path if it exists, so the rename succeeds
    await fs.promises.rm(installPath, { recursive: true, force: true });
    await fs.promises.rename(tempPath, installPath);
  } finally {
    await fs.promises.rm(zipPath, { force: true });
    console.log(`deleted ${electronVersion} zip file at '${zipPath}'...`);
  }

  return executablePath;
}

export type RebuildElectronRequest = {
  electronVersion: string;
  buildPath: string;
  rebuildOptions?: Omit<RebuildOptions, 'electronVersion' | 'buildPath'>;
};

export async function rebuildElectron({ electronVersion, buildPath, rebuildOptions }: RebuildElectronRequest) {
  const options: RebuildOptions = {
    useCache: true,
    ...(rebuildOptions || {}),
    electronVersion,
    buildPath,
  };

  console.log(`Rebuilding with options:\n${JSON.stringify(options, null, 2)}`);
  await rebuild(options);
}

export async function getDefaultElectronVersion(meta: ImportMeta) {
  const electronPackagePath = findPackageJSON('electron', meta.url);
  if (!electronPackagePath)
    throw new Error(`Failed to findPackageJSON electron package.json from ${meta.url}`);

  const electronPackage = JSON.parse(await fs.promises.readFile(electronPackagePath, 'utf8'));
  return electronPackage.version as string;
}

export function getDefaultRuntimesRoot() {
  return path.join(os.homedir(), '.cmdless', 'runtimes');
}

export function getDefaultBuildPath(meta: ImportMeta) {
  const packagePath = findPackageJSON('.', meta.url);
  if (!packagePath)
    throw new Error(`Failed to findPackageJSON package.json from ${meta.url}`);

  return path.dirname(packagePath);
}

export type EnsureElectronRequest = {
  meta: ImportMeta;
  electronVersion?: string;
  runtimesRoot?: string;
  downloadOptions?: Omit<ElectronDownloadRequestOptions, 'cacheMode'>;
  rebuild?: boolean;
  buildPath?: string;
  rebuildOptions?: Omit<RebuildOptions, 'buildPath' | 'electronVersion'>;
};

export async function ensureElectron(request: EnsureElectronRequest) {
  request.electronVersion ||= await getDefaultElectronVersion(request.meta);
  request.runtimesRoot ||= getDefaultRuntimesRoot();
  request.downloadOptions ||= {};
  request.buildPath ||= getDefaultBuildPath(request.meta);
  request.rebuildOptions ||= {};

  const { electronVersion, runtimesRoot, downloadOptions, buildPath, rebuildOptions } = request;
  const executablePath = await installElectron({ electronVersion, runtimesRoot, downloadOptions });

  if (request.rebuild)
    await rebuildElectron({ electronVersion, buildPath, rebuildOptions });

  return executablePath;
}