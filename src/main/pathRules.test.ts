import { describe, expect, it } from 'vitest'
import { isUnder, samePath, shouldCopy } from './pathRules'

const TEMP = ['C:\\Users\\me\\AppData\\Local\\Temp']

describe('shouldCopy', () => {
  it('系统临时目录里的文件需要复制', () => {
    expect(shouldCopy('C:\\Users\\me\\AppData\\Local\\Temp\\a\\图 1.png', TEMP)).toBe(true)
    expect(shouldCopy('c:/users/ME/appdata/local/temp/x.pdf', TEMP)).toBe(true)
  })

  it('微信已接收的文件只存路径', () => {
    const p = 'C:\\Users\\me\\Documents\\xwechat_files\\wxid_x\\msg\\file\\2026-11\\计划 v2.md'
    expect(shouldCopy(p, TEMP)).toBe(false)
  })

  it('微信临时、缓存目录需要复制', () => {
    expect(shouldCopy('C:\\Users\\me\\Documents\\xwechat_files\\wxid_x\\temp\\img\\a.jpg', TEMP)).toBe(true)
    expect(shouldCopy('D:\\WeChat Files\\wxid_x\\FileStorage\\Cache\\2026-11\\a.jpg', TEMP)).toBe(true)
    expect(shouldCopy('C:\\Users\\me\\AppData\\Roaming\\Tencent\\xwechat\\cache\\a.png', TEMP)).toBe(true)
  })

  it('普通磁盘文件只存路径', () => {
    expect(shouldCopy('D:\\资料\\报告 final.docx', TEMP)).toBe(false)
    // 名字里带 temp 但不是目录，不应误判
    expect(shouldCopy('D:\\work\\template.docx', TEMP)).toBe(false)
  })
})

describe('isUnder / samePath', () => {
  it('不把同前缀的兄弟目录当成子目录', () => {
    expect(isUnder('C:\\Temp2\\a.txt', 'C:\\Temp')).toBe(false)
    expect(isUnder('C:\\Temp\\a.txt', 'C:\\Temp\\')).toBe(true)
  })
  it('路径比较忽略大小写和斜杠方向', () => {
    expect(samePath('D:/A/b.txt', 'd:\\a\\B.TXT')).toBe(true)
  })
})
