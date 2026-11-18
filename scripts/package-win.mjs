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
    throw new Error('构建产物校验不完整，已中止替换打包目录')
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
  console.error('请先运行 npm run build 生成完整的 out/ 构建产物')
  process.exit(1)
}
if (!existsSync(srcElectronExe) && existsSync(electronInstallScript)) {
  console.log('[package] 正在补全 Electron 二进制文件...')
  execFileSync(process.execPath, [electronInstallScript], { stdio: 'inherit' })
}
if (!existsSync(srcElectronExe)) {
  console.error('未找到 node_modules/electron/dist/electron.exe，请先运行 node node_modules/electron/install.js')
  process.exit(1)
}

buildPocketIsleIco(icoPath)
console.log('[package] 已生成图标 build/icon.ico')

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
    console.error('[package] 临时打包目录缺少 停靠岛.exe，已取消替换')
    process.exit(1)
  }
  try {
    swapDirectories(releaseStaging, releaseDir, releaseBackup)
  } catch (err) {
    console.error(
      '[package] 替换打包目录失败（请先退出正在运行的 停靠岛.exe 再重试）：',
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
    console.error('[package] 更新 resources/app 失败（可能被正在运行的程序占用）：', err.message)
    process.exit(1)
  }
}

// 为项目根目录创建带水彩图标的快捷方式（无任何黑框命令行）
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
  console.log('[package] 已创建快捷方式 停靠岛.lnk')
} catch {
  console.warn('[package] 跳过创建快捷方式（不影响 exe 直接运行）')
}

console.log(`[package] 打包完成：${exePath}`)
