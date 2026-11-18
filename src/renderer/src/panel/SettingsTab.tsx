import type { MutableRefObject } from 'react'
import { AI_PRESETS } from '../../../shared/aiProvider'
import type { AiConfig, AiKeyStatus, AppEnv, Settings, SettingsPatch } from '../../../shared/types'
import { formatSize } from '../util'
import { formatMb } from './panelShared'

interface SettingsTabProps {
  settings: Settings
  appEnv: AppEnv
  usage: { used: number; limit: number }
  copyLimitDraft: string
  setCopyLimitDraft: (val: string) => void
  aiCfg: AiConfig
  setAiCfg: React.Dispatch<React.SetStateAction<AiConfig>>
  apiKeyDraft: string
  setApiKeyDraft: (val: string) => void
  clearSavedKey: boolean
  setClearSavedKey: (val: boolean) => void
  originKeyStatus: AiKeyStatus
  testingAi: boolean
  setTestingAi: (val: boolean) => void
  aiDirtyRef: MutableRefObject<boolean>
  onSyncOriginKeyStatus: (baseUrl: string) => void
  onApplySettingsPatch: (patch: SettingsPatch, msg?: string) => Promise<void>
  onApplyCopyLimitMB: (mb: number) => Promise<void>
  onNotice: (msg: string) => void
}

export function SettingsTab(props: SettingsTabProps): JSX.Element {
  const {
    settings,
    appEnv,
    usage,
    copyLimitDraft,
    setCopyLimitDraft,
    aiCfg,
    setAiCfg,
    apiKeyDraft,
    setApiKeyDraft,
    clearSavedKey,
    setClearSavedKey,
    originKeyStatus,
    testingAi,
    setTestingAi,
    aiDirtyRef,
    onSyncOriginKeyStatus,
    onApplySettingsPatch,
    onApplyCopyLimitMB,
    onNotice
  } = props

  return (
    <div className="tab-body">
      <div className="settings-card">
        <div className="section-label">通用与停靠设置</div>

        <label className="toggle-row">
          <div>
            <div className="toggle-title">窗口始终置顶</div>
            <div className="toggle-desc">让小岛浮窗保持在其他桌面应用前方（同步系统托盘）</div>
          </div>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(e) =>
              onApplySettingsPatch(
                { alwaysOnTop: e.target.checked },
                e.target.checked ? '已开启小岛置顶' : '已取消小岛置顶'
              )
            }
          />
        </label>

        <label className={`toggle-row ${!appEnv.isPackaged ? 'is-disabled' : ''}`}>
          <div>
            <div className="toggle-title">
              开机自动启动 {!appEnv.isPackaged && <span className="pill-muted">打包后可用</span>}
            </div>
            <div className="toggle-desc">登录 Windows 时自动在后台启动停靠岛</div>
          </div>
          <input
            type="checkbox"
            disabled={!appEnv.isPackaged}
            checked={settings.openAtLogin}
            onChange={(e) =>
              onApplySettingsPatch(
                { openAtLogin: e.target.checked },
                e.target.checked ? '已开启开机自启' : '已关闭开机自启'
              )
            }
          />
        </label>

        <label className="toggle-row">
          <div>
            <div className="toggle-title">专注与休息结束轻柔提醒</div>
            <div className="toggle-desc">计时结束时播送轻柔三音铃声并弹出系统桌面通知</div>
          </div>
          <input
            type="checkbox"
            checked={settings.focusNotify !== false}
            onChange={(e) =>
              onApplySettingsPatch(
                { focusNotify: e.target.checked },
                e.target.checked ? '已开启专注结束轻柔提醒' : '已静音专注结束提醒'
              )
            }
          />
        </label>

        <div className="copy-limit-box">
          <div className="copy-limit-head">
            <span className="toggle-title">临时目录副本容量上限</span>
            <span className="copy-usage-text">
              已用 {formatSize(usage.used)} / {formatMb(settings.copyLimitMB)}
            </span>
          </div>
          <div className="usage-bar-track">
            <div
              className="usage-bar-fill"
              style={{
                width: `${
                  usage.limit > 0
                    ? Math.min(100, Math.round((usage.used / usage.limit) * 100))
                    : 0
                }%`
              }}
            />
          </div>
          <div className="preset-btns">
            {[512, 1024, 2048, 4096].map((mb) => (
              <button
                key={mb}
                className={settings.copyLimitMB === mb ? 'active' : ''}
                onClick={() => onApplyCopyLimitMB(mb)}
              >
                {formatMb(mb)}
              </button>
            ))}
            <div className="limit-custom-inline">
              <input
                type="number"
                min={64}
                max={20480}
                value={copyLimitDraft}
                onChange={(e) => setCopyLimitDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onApplyCopyLimitMB(Number(copyLimitDraft))
                }}
              />
              <span>MB</span>
              <button onClick={() => onApplyCopyLimitMB(Number(copyLimitDraft))}>应用</button>
            </div>
          </div>
        </div>

        <div className="settings-quick-row">
          <button
            onClick={() => {
              window.isle.resetPosition('left')
              onNotice('小岛已停靠至屏幕左边缘')
            }}
          >
            停靠左边缘
          </button>
          <button
            onClick={() => {
              window.isle.resetPosition('right')
              onNotice('小岛已停靠至屏幕右边缘')
            }}
          >
            停靠右边缘
          </button>
          <button onClick={() => window.isle.openDataDir()}>打开数据目录</button>
          <span className="shortcut-hint" title="全局显隐快捷键">
            快捷键：{appEnv.shortcut.replace('Control+', 'Ctrl+')}
          </span>
        </div>
      </div>

      <div className="settings-card">
        <div className="section-label">AI 水獭搭档接口配置（分源加密保存在本地，不写入日志）</div>
        <div className="preset-btns">
          <span>快速填入模板：</span>
          {AI_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                aiDirtyRef.current = true
                setAiCfg((prev) => ({ ...prev, baseUrl: p.baseUrl, model: p.model }))
                setApiKeyDraft('')
                setClearSavedKey(false)
                onSyncOriginKeyStatus(p.baseUrl)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="field-label">
          <span>接口地址 (Base URL，兼容 OpenAI `/v1/chat/completions`)</span>
          <input
            value={aiCfg.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) => {
              const nextUrl = e.target.value
              aiDirtyRef.current = true
              setAiCfg({ ...aiCfg, baseUrl: nextUrl })
              onSyncOriginKeyStatus(nextUrl)
            }}
          />
        </label>

        <label className="field-label">
          <span>模型名称 (Model)</span>
          <input
            value={aiCfg.model}
            placeholder="deepseek-chat / qwen-plus / gpt-4o-mini"
            onChange={(e) => {
              aiDirtyRef.current = true
              setAiCfg({ ...aiCfg, model: e.target.value })
            }}
          />
        </label>

        <label className="field-label">
          <div className="key-label-row">
            <span>API 密钥（按服务源独立加密保管）</span>
            <span className="key-origin-badge">
              {originKeyStatus.valid
                ? `${originKeyStatus.origin} · ${
                    clearSavedKey
                      ? '待清除'
                      : originKeyStatus.hasApiKey
                        ? '已存密钥'
                        : originKeyStatus.requiresKey
                          ? '未设密钥'
                          : '本地免密'
                  }`
                : originKeyStatus.message || '地址格式无效'}
            </span>
            {originKeyStatus.hasApiKey && !clearSavedKey && (
              <button
                type="button"
                className="key-clear-btn"
                onClick={() => {
                  aiDirtyRef.current = true
                  setApiKeyDraft('')
                  setClearSavedKey(true)
                }}
              >
                清除该源密钥
              </button>
            )}
            {clearSavedKey && (
              <button
                type="button"
                className="key-clear-btn"
                onClick={() => setClearSavedKey(false)}
              >
                恢复沿用
              </button>
            )}
          </div>
          <input
            type="password"
            value={apiKeyDraft}
            placeholder={
              !originKeyStatus.requiresKey
                ? '本地模型可留空（仅本次输入时发送）'
                : originKeyStatus.hasApiKey && !clearSavedKey
                  ? '••••••••（已加密保存，留空沿用，输入新密钥可替换）'
                  : 'sk-...（仅对当前服务源加密保存）'
            }
            onChange={(e) => {
              aiDirtyRef.current = true
              setClearSavedKey(false)
              setApiKeyDraft(e.target.value)
            }}
          />
        </label>

        <label className="toggle-row">
          <div>
            <div className="toggle-title">启用截图 / 图片识别（Vision 多模态）</div>
            <div className="toggle-desc">
              开启后整理或联合速览时将图片压缩后发给模型读图（需模型支持视觉，如 gpt-4o-mini / qwen-vl）
            </div>
          </div>
          <input
            type="checkbox"
            checked={!!aiCfg.enableVision}
            onChange={(e) => {
              aiDirtyRef.current = true
              setAiCfg({ ...aiCfg, enableVision: e.target.checked })
            }}
          />
        </label>

        <div className="settings-actions">
          <button
            className="btn-primary"
            onClick={async () => {
              const res = await window.isle.saveAiConfig({
                baseUrl: aiCfg.baseUrl,
                model: aiCfg.model,
                enableVision: aiCfg.enableVision,
                apiKey: apiKeyDraft,
                clearApiKey: clearSavedKey
              })
              if (!res.ok) {
                onNotice(res.message || '保存 AI 配置失败')
                return
              }
              aiDirtyRef.current = false
              setApiKeyDraft('')
              setClearSavedKey(false)
              onSyncOriginKeyStatus(aiCfg.baseUrl)
              onNotice(res.message || '已保存 AI 配置')
            }}
          >
            保存配置
          </button>
          <button
            disabled={testingAi}
            onClick={async () => {
              setTestingAi(true)
              try {
                const res = await window.isle.testAiConnection({
                  baseUrl: aiCfg.baseUrl,
                  model: aiCfg.model,
                  enableVision: aiCfg.enableVision,
                  apiKey: apiKeyDraft,
                  clearApiKey: clearSavedKey
                })
                onNotice(
                  res.ok
                    ? `${res.message}（测试不会自动覆写配置，如需生效请点「保存配置」）`
                    : res.message
                )
              } finally {
                setTestingAi(false)
              }
            }}
          >
            {testingAi ? '测试中...' : '测试连接'}
          </button>
        </div>
        <div className="settings-note">
          未配置密钥或网络异常时，文件中转、自由桌搭、减压互动与专注计时仍可正常离线使用。
        </div>
      </div>
    </div>
  )
}
