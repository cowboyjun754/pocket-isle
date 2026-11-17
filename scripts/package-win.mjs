import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { buildPocketIsleIco } from './make-ico.mjs'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'out')
const electronDist = resolve(root, 'node_modules/electron/dist')
const releaseDir = resolve(root, 'release/停靠岛')
const resourcesApp = resolve(releaseDir, 'resources/app')
const icoPath = resolve(root, 'build/icon.ico')
const exePath = resolve(releaseDir, '停靠岛.exe')
const rootLnk = resolve(root, '停靠岛.lnk')

const srcElectronExe = resolve(electronDist, 'electron.exe')
if (!existsSync(resolve(outDir, 'main/index.js'))) {
  console.error('请先运行 npm run build 生成 out/ 构建产物')
  process.exit(1)
}
if (!existsSync(srcElectronExe)) {
  console.error('未找到 node_modules/electron/dist/electron.exe')
  process.exit(1)
}

buildPocketIsleIco(icoPath)
console.log('[package] 已生成图标 build/icon.ico')

const runtimeReady =
  existsSync(exePath) &&
  statSync(exePath).size === statSync(srcElectronExe).size &&
  existsSync(resolve(releaseDir, 'resources'))

if (!runtimeReady) {
  if (existsSync(releaseDir)) {
    try {
      rmSync(releaseDir, { recursive: true, force: true })
    } catch (err) {
      console.error(
        '[package] 清理旧打包目录失败（请先退出正在运行的 停靠岛.exe 再重试）：',
        err.message
      )
      process.exit(1)
    }
  }
  mkdirSync(releaseDir, { recursive: true })
  cpSync(electronDist, releaseDir, { recursive: true })

  const defaultAsar = resolve(releaseDir, 'resources/default_app.asar')
  if (existsSync(defaultAsar)) {
    rmSync(defaultAsar, { force: true })
  }
  const oldExe = resolve(releaseDir, 'electron.exe')
  if (existsSync(oldExe)) {
    renameSync(oldExe, exePath)
  }
}

mkdirSync(resourcesApp, { recursive: true })
const appOut = resolve(resourcesApp, 'out')
if (existsSync(appOut)) {
  rmSync(appOut, { recursive: true, force: true })
}
cpSync(outDir, appOut, { recursive: true })

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
writeFileSync(
  resolve(resourcesApp, 'package.json'),
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
