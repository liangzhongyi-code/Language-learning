# 2026-10-05-008：每日計畫、跨日續答與複習身份

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）
- 類型：排程／修復；狀態：實作中，核心已存在、尚未接正式 UI。
- 核准依據：已核准完整模式任務清單；本次使用者要求修正 review 發現的全部問題。
- 規格：`openspec/changes/add-daily-learning/`；前次紀錄：[004 固定學習日](2026-10-05-004-study-day.md)。
- 分支：`feature/add-offline-study-suite`；未提交、未發布。

## 需求與原因

每日以固定時區、語言與級別建立固定清單，先複習再介紹新字。已介紹但未完成的題目跨日續答，不重複領取新字額度。先前 review 發現 legacy 身份在作答後變成 skill 身份，造成完成的題目反覆排入；缺 due 的合法舊紀錄又同時被新字與複習排除。

## 變更前後與規則

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 舊紀錄 n>0 但沒有 due | 不進新字，也不進複習 | 共用既有 isDue 規則，缺 due 視為待複習 |
| 跨日首次作答建立 skillKey | 原 legacy carry 再次出現 | 未提交 carry 由固定題面的能力與方向取得相同身份 |
| 同字另一方向到期 | 可能被 source 級去重誤排除 | 可辨識能力的題面只解除該能力，不解除其他方向 |
| choice 外形的聽力／文法 | 僅看 kind，誤當一般辨認題而重排 | 與提交事件共用能力／模式解析；矛盾資料拒絕 |
| 舊方向別名 | 與 canonical 方向對不上 | 比較及事件使用同一 canonical 方向，不改写原快照 |

`prepareEntry` 保存固定題面與 session，首次介紹才 claim 新字；重送不重新產生選項。`skipEntry` 只處理尚未開始的新字。`queueReinforcement` 每段每字最多一次，不改長期排程。`resumeStudySession` 只讀當前 plan/session，不需完整歷史；建立下一段才重新規劃。新字與干擾詞維持同語言、同級別。

## 取捨、相容與回復

不新增持久欄位、不改寫原始題庫或學習紀錄。極舊且缺少題型／方向的簡略快照保留原題次身份，不能臆測其能力，也不因同來源另一個完成題而抹除。prepare 對這種無法合法提交的題面明確回 UNSUPPORTED，保留原資料；這不是自動修復或已完成。只有無題面／題次的原始摘要沿用 source 級 legacy 身份。所有函式回傳交易候選值，由 repository 整合層負責原子保存，核心通過不等於整合已完成。

## 影響範圍

- `assets/js/core/daily-plan.js`：規劃、固定段、舊進度、carry 去重。
- `assets/js/core/study-session.js`：prepare／skip／reinforcement／resume。
- `tests/daily-plan.test.js`、`tests/study-session.test.js`、`tests/review-fixes.test.js`：正常及跨模組回歸。

## 驗證紀錄

2026-10-05：先新增兩個回歸測試，修正前均實際失敗（漏排 0≠1、完成 carry 1≠0），初次39/39通過。交叉複查再補聽力／文法、方向別名、共用模式契約、極簡快照與首次非法題面測試，均取得對應RED。最終執行 `node --test --test-reporter=spec tests/review-fixes.test.js tests/daily-plan.test.js tests/study-session.test.js`，46/46通過；跨日案例涵蓋實際英日題庫 × 五級 × 雙方向共20組，並驗同字另一能力仍可排入。整套Node 649/649通過。

## 未完成與後續更正

正式 UI/repository 領題與提交整合、真手機大量歷史效能尚待驗收。未提交／未部署；本文件不宣稱整體每日學習功能已完成。後續更正：無。
