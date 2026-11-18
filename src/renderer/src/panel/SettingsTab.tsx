import type { MutableRefObject } from 'react'
import { getAiPresets } from '../../../shared/aiProvider'
import { SUPPORTED_LOCALES, getMessages } from '../../../shared/i18n'
import type {
  AiConfig,
  AiKeyStatus,
  AppEnv,
  AppLocale,
  Settings,
  SettingsPatch
} from '../../../shared/types'
import { formatSize } from '../util'
import { formatMb } from './panelShared'

interface SettingsTabProps {
  locale: AppLocale
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
    locale,
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

  const sm = getMessages(locale).panel.settings
  const presets = getAiPresets(locale)

  return (
    <div className="tab-body">
      <div className="settings-card">
        <div className="section-label">{sm.generalTitle}</div>

        <div className="toggle-row is-stacked">
          <div>
            <div className="toggle-title">{sm.languageTitle}</div>
            <div className="toggle-desc">{sm.languageDesc}</div>
          </div>
          <div className="preset-btns lang-switch-btns">
            {SUPPORTED_LOCALES.map((loc) => (
              <button
                key={loc.id}
                type="button"
                className={locale === loc.id ? 'active' : ''}
                onClick={() =>
                  onApplySettingsPatch(
                    { locale: loc.id },
                    getMessages(loc.id).panel.settings.languageSwitched
                  )
                }
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>

        <label className="toggle-row">
          <div>
            <div className="toggle-title">{sm.alwaysOnTopTitle}</div>
            <div className="toggle-desc">{sm.alwaysOnTopDesc}</div>
          </div>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(e) =>
              onApplySettingsPatch(
                { alwaysOnTop: e.target.checked },
                e.target.checked ? sm.alwaysOnTopOn : sm.alwaysOnTopOff
              )
            }
          />
        </label>

        <label className={`toggle-row ${!appEnv.isPackaged ? 'is-disabled' : ''}`}>
          <div>
            <div className="toggle-title">
              {sm.openAtLoginTitle}{' '}
              {!appEnv.isPackaged && <span className="pill-muted">{sm.packagedOnlyBadge}</span>}
            </div>
            <div className="toggle-desc">{sm.openAtLoginDesc}</div>
          </div>
          <input
            type="checkbox"
            disabled={!appEnv.isPackaged}
            checked={settings.openAtLogin}
            onChange={(e) =>
              onApplySettingsPatch(
                { openAtLogin: e.target.checked },
                e.target.checked ? sm.openAtLoginOn : sm.openAtLoginOff
              )
            }
          />
        </label>

        <label className="toggle-row">
          <div>
            <div className="toggle-title">{sm.focusNotifyTitle}</div>
            <div className="toggle-desc">{sm.focusNotifyDesc}</div>
          </div>
          <input
            type="checkbox"
            checked={settings.focusNotify !== false}
            onChange={(e) =>
              onApplySettingsPatch(
                { focusNotify: e.target.checked },
                e.target.checked ? sm.focusNotifyOn : sm.focusNotifyOff
              )
            }
          />
        </label>

        <div className="copy-limit-box">
          <div className="copy-limit-head">
            <span className="toggle-title">{sm.copyLimitTitle}</span>
            <span className="copy-usage-text">
              {sm.copyUsageText(formatSize(usage.used), formatMb(settings.copyLimitMB))}
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
              <button onClick={() => onApplyCopyLimitMB(Number(copyLimitDraft))}>{sm.applyBtn}</button>
            </div>
          </div>
        </div>

        <div className="settings-quick-row">
          <button
            onClick={() => {
              window.isle.resetPosition('left')
              onNotice(sm.dockLeftMsg)
            }}
          >
            {sm.dockLeftBtn}
          </button>
          <button
            onClick={() => {
              window.isle.resetPosition('right')
              onNotice(sm.dockRightMsg)
            }}
          >
            {sm.dockRightBtn}
          </button>
          <button onClick={() => window.isle.openDataDir()}>{sm.openDataDirBtn}</button>
          <span className="shortcut-hint" title={sm.shortcutTitle}>
            {sm.shortcutText(appEnv.shortcut.replace('Control+', 'Ctrl+'))}
          </span>
        </div>
      </div>

      <div className="settings-card">
        <div className="section-label">{sm.aiSectionTitle}</div>
        <div className="preset-btns">
          <span>{sm.presetsLabel}</span>
          {presets.map((p) => (
            <button
              key={p.baseUrl}
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
          <span>{sm.baseUrlLabel}</span>
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
          <span>{sm.modelLabel}</span>
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
            <span>{sm.apiKeyLabel}</span>
            <span className="key-origin-badge">
              {originKeyStatus.valid
                ? `${originKeyStatus.origin} · ${
                    clearSavedKey
                      ? sm.keyPendingClear
                      : originKeyStatus.hasApiKey
                        ? sm.keySaved
                        : originKeyStatus.requiresKey
                          ? sm.keyMissing
                          : sm.keyLocalOptional
                  }`
                : originKeyStatus.message || sm.keyInvalidUrl}
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
                {sm.clearKeyBtn}
              </button>
            )}
            {clearSavedKey && (
              <button
                type="button"
                className="key-clear-btn"
                onClick={() => setClearSavedKey(false)}
              >
                {sm.restoreKeyBtn}
              </button>
            )}
          </div>
          <input
            type="password"
            value={apiKeyDraft}
            placeholder={
              !originKeyStatus.requiresKey
                ? sm.keyPlaceholderOptional
                : originKeyStatus.hasApiKey && !clearSavedKey
                  ? sm.keyPlaceholderSaved
                  : sm.keyPlaceholderEmpty
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
            <div className="toggle-title">{sm.visionTitle}</div>
            <div className="toggle-desc">{sm.visionDesc}</div>
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
                onNotice(res.message || sm.saveFailed)
                return
              }
              aiDirtyRef.current = false
              setApiKeyDraft('')
              setClearSavedKey(false)
              onSyncOriginKeyStatus(aiCfg.baseUrl)
              onNotice(res.message || sm.saveSuccess)
            }}
          >
            {sm.saveBtn}
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
                onNotice(res.ok ? `${res.message}${sm.testTipSuffix}` : res.message)
              } finally {
                setTestingAi(false)
              }
            }}
          >
            {testingAi ? sm.testingBtn : sm.testBtn}
          </button>
        </div>
        <div className="settings-note">{sm.offlineNote}</div>
      </div>
    </div>
  )
}
