/**
 * 英文句型題庫的匯總入口。
 *
 * 題庫是分批寫的，一批一個檔案放在 sentences/ 底下，這裡只負責串起來。
 * 理由與單字題庫相同：全部擠在一個檔案裡，每加一批就產生一個沒人看得完的 diff。
 *
 * 每一句的 chunks 陣列順序＝英文語序，串接每塊的 target 會等於整句 target；
 * 每塊的 zhIndex＝該塊在中文句子裡的位置（0 起算、連號不重複），
 * 依 zhIndex 排序後串接 zh 會等於整句 zh。
 * 兩者不一致的句子，正是文法頁上下兩排色塊要畫出來的語序落差。
 *
 * 英文沒有助詞，所以不會出現 role: 'particle' 的區塊——那是日文題庫才有的東西。
 */

import { sentences as core } from './sentences/core.js';
import { sentences as b01 } from './sentences/01.js';
import { sentences as b02 } from './sentences/02.js';

export const sentences = [...core, ...b01, ...b02];
