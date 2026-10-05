/**
 * 原始 JSON 與解壓後 bytes 共用 10 MiB 上限；不從備份內容取得設定。
 */
export const BACKUP_JSON_MAX_BYTES = 10 * 1024 * 1024;

/**
 * 清理前整段代碼輸入的 UTF-8 bytes 上限，包含包裝文字與不可見字元。
 */
export const BACKUP_CODE_MAX_BYTES = 16 * 1024 * 1024;
