/**
 * 日文 JLPT 模擬題的匯總入口。
 *
 * 每個區段一個批次檔，依文字 → 語彙 → 文法的順序接續連號（目前 0001–0100、0101–0199、0200–0255；
 * 排除題目後後面的號碼往前補，schema 要求整份從 0001 連號）。
 * 由 tools/import-jlptsuccess.mjs 對照上游 JLPTSuccess 的固定 commit。
 * excluded 是上游有、但本專案不收的題目，每題都要寫原因。
 */
import { jlpt as moji, excluded as mojiExcluded } from './jlpt/n5-moji.js';
import { jlpt as goi, excluded as goiExcluded } from './jlpt/n5-goi.js';
import { jlpt as bunpou, excluded as bunpouExcluded } from './jlpt/n5-bunpou.js';

export const jlpt = [...moji, ...goi, ...bunpou];

export const jlptExcluded = [...mojiExcluded, ...goiExcluded, ...bunpouExcluded];
