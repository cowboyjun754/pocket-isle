import { describe, expect, it } from 'vitest'
import { isUnder, samePath, shouldCopy } from './pathRules'

const TEMP = ['C:\\Users\\me\\AppData\\Local\\Temp']

describe('shouldCopy', () => {
  it('copies files located under system temp directory', () => {
    expect(shouldCopy('C:\\Users\\me\\AppData\\Local\\Temp\\a\\图 1.png', TEMP)).toBe(true)
    expect(shouldCopy('c:/users/ME/appdata/local/temp/x.pdf', TEMP)).toBe(true)
  })

  it('stores references only for received WeChat files', () => {
    const p = 'C:\\Users\\me\\Documents\\xwechat_files\\wxid_x\\msg\\file\\2026-11\\计划 v2.md'
    expect(shouldCopy(p, TEMP)).toBe(false)
  })

  it('copies files under WeChat temp or cache directories', () => {
    expect(shouldCopy('C:\\Users\\me\\Documents\\xwechat_files\\wxid_x\\temp\\img\\a.jpg', TEMP)).toBe(true)
    expect(shouldCopy('D:\\WeChat Files\\wxid_x\\FileStorage\\Cache\\2026-11\\a.jpg', TEMP)).toBe(true)
    expect(shouldCopy('C:\\Users\\me\\AppData\\Roaming\\Tencent\\xwechat\\cache\\a.png', TEMP)).toBe(true)
  })

  it('stores references only for regular disk files', () => {
    expect(shouldCopy('D:\\资料\\报告 final.docx', TEMP)).toBe(false)
    // Filename containing "temp" outside a temp directory must not trigger copy
    expect(shouldCopy('D:\\work\\template.docx', TEMP)).toBe(false)
  })
})

describe('isUnder / samePath', () => {
  it('does not treat sibling directories sharing a prefix as subdirectories', () => {
    expect(isUnder('C:\\Temp2\\a.txt', 'C:\\Temp')).toBe(false)
    expect(isUnder('C:\\Temp\\a.txt', 'C:\\Temp\\')).toBe(true)
  })
  it('ignores case and slash direction during path comparison', () => {
    expect(samePath('D:/A/b.txt', 'd:\\a\\B.TXT')).toBe(true)
  })
})
