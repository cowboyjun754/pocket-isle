import { execFileSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildPocketIsleIco } from './make-ico.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'out')
const electronDist = resolve(root, 'node_modules/electron/dist')
const releaseDir = resolve(root, 'release/停靠岛')
const releaseStaging = resolve(root, 'release/停靠岛.staging')
const releaseBackup = resolve(root, 'release/停靠岛.backup')
const resourcesApp = resolve(releaseDir, 'resources/app')
const icoPath = resolve(root, 'build/icon.ico')
const exePath = resolve(releaseDir, '停靠岛.exe')
const rootLnk = resolve(root, '停靠岛.lnk')

function verifyBuiltOut(baseOut) {
  return (
    existsSync(resolve(baseOut, 'main/index.js')) &&
    existsSync(resolve(baseOut, 'preload/index.js')) &&
    existsSync(resolve(baseOut, 'renderer/index.html'))
  )
}

function writeAppPayload(targetAppDir, pkg) {
  rmSync(targetAppDir, { recursive: true, force: true })
  mkdirSync(targetAppDir, { recursive: true })
  cpSync(outDir, resolve(targetAppDir, 'out'), { recursive: true })
  writeFileSync(
    resolve(targetAppDir, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        main: './out/main/index.js'
      },
      null,
      2
    )
  )
  if (!verifyBuiltOut(resolve(targetAppDir, 'out'))) {
    throw new Error('Build output is incomplete; aborted replacing packaged directory.')
  }
}

function swapDirectories(stagingDir, targetDir, backupDir) {
  rmSync(backupDir, { recursive: true, force: true })
  const hadTarget = existsSync(targetDir)
  if (hadTarget) {
    renameSync(targetDir, backupDir)
  }
  try {
    renameSync(stagingDir, targetDir)
    rmSync(backupDir, { recursive: true, force: true })
  } catch (err) {
    if (hadTarget && !existsSync(targetDir) && existsSync(backupDir)) {
      try {
        renameSync(backupDir, targetDir)
      } catch {
        /* ignore rollback failure */
      }
    }
    throw err
  }
}

const srcElectronExe = resolve(electronDist, 'electron.exe')
const electronInstallScript = resolve(root, 'node_modules/electron/install.js')
if (!verifyBuiltOut(outDir)) {
  console.error('Please run `npm run build` first to generate complete out/ artifacts.')
  process.exit(1)
}
if (!existsSync(srcElectronExe) && existsSync(electronInstallScript)) {
  console.log('[package] Downloading missing Electron binary...')
  execFileSync(process.execPath, [electronInstallScript], { stdio: 'inherit' })
}
if (!existsSync(srcElectronExe)) {
  console.error('Missing node_modules/electron/dist/electron.exe. Run `node node_modules/electron/install.js` first.')
  process.exit(1)
}

buildPocketIsleIco(icoPath)
console.log('[package] Generated icon build/icon.ico')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const runtimeReady =
  existsSync(exePath) &&
  statSync(exePath).size === statSync(srcElectronExe).size &&
  existsSync(resolve(releaseDir, 'resources'))

if (!runtimeReady) {
  rmSync(releaseStaging, { recursive: true, force: true })
  mkdirSync(releaseStaging, { recursive: true })
  cpSync(electronDist, releaseStaging, { recursive: true })

  const defaultAsar = resolve(releaseStaging, 'resources/default_app.asar')
  if (existsSync(defaultAsar)) {
    rmSync(defaultAsar, { force: true })
  }
  const stagedOldExe = resolve(releaseStaging, 'electron.exe')
  const stagedExe = resolve(releaseStaging, '停靠岛.exe')
  if (existsSync(stagedOldExe)) {
    renameSync(stagedOldExe, stagedExe)
  }
  writeAppPayload(resolve(releaseStaging, 'resources/app'), pkg)
  if (!existsSync(stagedExe)) {
    console.error('[package] Staging directory is missing 停靠岛.exe; aborted swap.')
    process.exit(1)
  }
  try {
    swapDirectories(releaseStaging, releaseDir, releaseBackup)
  } catch (err) {
    console.error(
      '[package] Failed to replace packaged directory (close any running 停靠岛.exe and retry):',
      err.message
    )
    process.exit(1)
  }
} else {
  const appStaging = resolve(releaseDir, 'resources/app.staging')
  const appBackup = resolve(releaseDir, 'resources/app.backup')
  try {
    writeAppPayload(appStaging, pkg)
    swapDirectories(appStaging, resourcesApp, appBackup)
  } catch (err) {
    rmSync(appStaging, { recursive: true, force: true })
    console.error('[package] Failed to update resources/app (files may be locked by a running instance):', err.message)
    process.exit(1)
  }
}

// Create a desktop-style root shortcut with the generated watercolor icon (no console window)
try {
  const psScript = [
    '$wsh = New-Object -ComObject WScript.Shell',
    `$sc = $wsh.CreateShortcut('${rootLnk.replace(/'/g, "''")}')`,
    `$sc.TargetPath = '${exePath.replace(/'/g, "''")}'`,
    `$sc.WorkingDirectory = '${releaseDir.replace(/'/g, "''")}'`,
    `$sc.IconLocation = '${icoPath.replace(/'/g, "''")},0'`,
    "$sc.Description = '停靠岛：水彩桌面文件浮岛'",
    '$sc.Save()'
  ].join('; ')
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
  execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { stdio: 'ignore' })
  console.log('[package] Created shortcut 停靠岛.lnk')
} catch {
  console.warn('[package] Skipped shortcut creation (standalone exe still works directly)')
}

console.log(`[package] Packaging complete: ${exePath}`)
