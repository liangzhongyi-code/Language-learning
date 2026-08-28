/**
 * 英文閱讀短文題庫。
 *
 * 題目與選項一律用中文問。這裡考的是讀懂了沒有，
 * 用英文出選項會變成同時考閱讀與選項理解，錯了也分不出是哪一關卡住。
 *
 * 短文刻意埋進幾個中文母語者容易讀錯的地方，
 * note 就寫在那裡：時態透露的先後順序、代名詞指的是誰、
 * 片語動詞（run out of、put off）的字面與實際意思差很遠。
 */
export const readings = [
  {
    id: 'en-r-001',
    title: 'A Busy Monday',
    passage:
      'Emma woke up at six thirty on Monday morning. She had planned to go for a run, ' +
      'but it was raining, so she made breakfast instead. At eight she took the bus to work. ' +
      'The bus was late, and she arrived ten minutes after the meeting had started. ' +
      'Her manager did not say anything, but Emma felt bad about it all morning.',
    translation:
      '艾瑪星期一早上六點半醒來。她原本計畫要去跑步，但下著雨，所以改成做早餐。' +
      '八點她搭公車去上班。公車誤點，她在會議開始十分鐘後才到。' +
      '主管什麼都沒說，但艾瑪整個早上都為此感到過意不去。',
    category: 'daily',
    level: 2,
    questions: [
      {
        id: 'en-r-001-q1',
        ask: '艾瑪原本打算做什麼？',
        answer: '去跑步',
        options: ['去跑步', '做早餐', '搭公車', '開會'],
        note: 'had planned 是過去完成式，表示這個計畫比後面的事情更早發生，而且沒有實現。',
      },
      {
        id: 'en-r-001-q2',
        ask: '她為什麼改變計畫？',
        answer: '因為下雨',
        options: ['因為下雨', '因為起得太晚', '因為公車誤點', '因為要開會'],
        note: 'but it was raining, so she made breakfast instead——so 帶出結果，instead 表示這是替代方案。',
      },
      {
        id: 'en-r-001-q3',
        ask: '她到公司時會議的狀況是？',
        answer: '已經開始十分鐘了',
        options: ['已經開始十分鐘了', '再十分鐘才開始', '剛好準時開始', '已經結束了'],
        note: 'arrived ten minutes after the meeting had started——過去完成式 had started 表示會議先開始、她後到。',
      },
      {
        id: 'en-r-001-q4',
        ask: '主管的反應是什麼？',
        answer: '什麼都沒說',
        options: ['什麼都沒說', '責備了她', '要她提早出門', '也遲到了'],
        note: 'did not say anything 是完全沒說。後半句的 but 表示轉折：主管沒怪她，她自己還是很在意。',
      },
    ],
  },
  {
    id: 'en-r-002',
    title: 'The Lost Umbrella',
    passage:
      'Daniel left his umbrella on the train last Friday. He called the lost and found office the next day, ' +
      'but nobody had turned it in. On Monday he went to the station in person. ' +
      'The clerk looked through a large box and pulled out a black umbrella with a wooden handle. ' +
      'It was not his, but Daniel bought a new one at the shop next door and stopped worrying about it.',
    translation:
      '丹尼爾上星期五把傘忘在電車上。隔天他打電話給失物招領處，但沒有人把傘交上來。' +
      '星期一他親自去了車站。櫃員翻過一個大箱子，拿出一把木製握把的黑傘。' +
      '那不是他的，但丹尼爾在隔壁的店買了一把新的，就不再煩惱這件事了。',
    category: 'daily',
    level: 3,
    questions: [
      {
        id: 'en-r-002-q1',
        ask: '他隔天用什麼方式聯絡失物招領處？',
        answer: '打電話',
        options: ['打電話', '親自去', '寫電子郵件', '請朋友去問'],
        note: 'called 是打電話。親自去（in person）是星期一才發生的，兩件事差了兩天。',
      },
      {
        id: 'en-r-002-q2',
        ask: '「nobody had turned it in」是什麼意思？',
        answer: '沒有人把傘交上來',
        options: ['沒有人把傘交上來', '沒有人打開過那把傘', '沒有人轉身進去', '沒有人拿走那把傘'],
        note: 'turn in 是片語動詞，意思是把撿到的東西交出去，跟 turn（轉）與 in（裡面）的字面完全無關。',
      },
      {
        id: 'en-r-002-q3',
        ask: '櫃員拿出來的傘是誰的？',
        answer: '不是丹尼爾的',
        options: ['不是丹尼爾的', '是丹尼爾的', '是櫃員自己的', '文中沒有提到'],
        note: 'It was not his 直接否定了。前一句詳細描述那把傘的樣子，是為了讓這個轉折更明顯。',
      },
      {
        id: 'en-r-002-q4',
        ask: '最後他怎麼處理這件事？',
        answer: '買了一把新傘',
        options: ['買了一把新傘', '把黑傘帶回家', '繼續等失物招領', '跟車站抱怨'],
        note: 'bought a new one 的 one 代替前面的 umbrella，避免整個字重複——這是英文常見的代稱用法。',
      },
    ],
  },
  {
    id: 'en-r-003',
    title: 'Ordering Coffee',
    passage:
      'When Yuki first moved to London, ordering coffee was harder than she expected. ' +
      'At home she just said the name of the drink, but here the barista asked her three questions in a row: ' +
      'what size, whether she wanted it for here or to go, and what her name was. ' +
      'She did not understand the last question and gave her order again. The barista smiled and asked more slowly.',
    translation:
      '由紀剛搬到倫敦時，點咖啡比她想像的還難。在家鄉她只要說飲料的名字，' +
      '但這裡的店員一口氣問了三個問題：要什麼尺寸、內用還是外帶、還有她的名字。' +
      '她沒聽懂最後一個問題，又把餐點講了一次。店員笑了笑，再問一次，這次講得比較慢。',
    category: 'dining',
    level: 3,
    questions: [
      {
        id: 'en-r-003-q1',
        ask: '店員問的三個問題不包含下列哪一個？',
        answer: '要不要加糖',
        options: ['要不要加糖', '要什麼尺寸', '內用還是外帶', '她叫什麼名字'],
        note: '文中列出的三項是 what size、for here or to go、what her name was，沒有提到糖。',
      },
      {
        id: 'en-r-003-q2',
        ask: '「for here or to go」是在問什麼？',
        answer: '內用還是外帶',
        options: ['內用還是外帶', '要現在喝還是等一下', '要在這裡付錢還是刷卡', '要不要繼續往前走'],
        note: 'to go 是美式說法的外帶，英式常說 takeaway。字面上的 go 跟走路無關。',
      },
      {
        id: 'en-r-003-q3',
        ask: '她對哪一個問題沒有反應過來？',
        answer: '最後一個',
        options: ['最後一個', '第一個', '第二個', '全部三個'],
        note: 'the last question 指剛才列舉的三個裡的最後一項，也就是問名字那一題。',
      },
      {
        id: 'en-r-003-q4',
        ask: '店員接下來怎麼做？',
        answer: '放慢速度再問一次',
        options: ['放慢速度再問一次', '直接幫她做了', '請經理過來', '要她排到後面'],
        note: 'asked more slowly 的 more slowly 是比較級副詞，表示比剛才慢——不是慢慢地，而是「比剛才慢」。',
      },
    ],
  },
  {
    id: 'en-r-004',
    title: 'The Job Interview',
    passage:
      'Carlos had applied for six jobs before he got his first interview. ' +
      'He prepared for a week, reading about the company and practising his answers with a friend. ' +
      'On the day, the interviewer asked why he wanted to leave his current job. ' +
      'Carlos said he was looking for more responsibility, not more money. Two days later, they offered him the position.',
    translation:
      '卡洛斯投了六份工作才拿到第一個面試。他準備了一週，讀公司的資料、跟朋友練習回答。' +
      '面試當天，面試官問他為什麼想離開現在的工作。卡洛斯說他想要的是更多責任，不是更多薪水。' +
      '兩天後，他們錄取了他。',
    category: 'hr',
    level: 3,
    questions: [
      {
        id: 'en-r-004-q1',
        ask: '他投了幾份工作才拿到面試？',
        answer: '六份',
        options: ['六份', '一份', '兩份', '七份'],
        note: 'had applied for six jobs before he got his first interview——過去完成式表示投履歷發生在面試之前。',
      },
      {
        id: 'en-r-004-q2',
        ask: '他準備了多久？',
        answer: '一週',
        options: ['一週', '兩天', '六天', '一個月'],
        note: 'prepared for a week。文中的 two days 是拿到結果的時間，不是準備的時間。',
      },
      {
        id: 'en-r-004-q3',
        ask: '他說想換工作的理由是什麼？',
        answer: '想承擔更多責任',
        options: ['想承擔更多責任', '想要更高的薪水', '不喜歡現在的主管', '想搬到別的城市'],
        note: 'more responsibility, not more money——not 前後對照，正是為了排除「為了錢」這個常見答案。',
      },
      {
        id: 'en-r-004-q4',
        ask: '結果如何？',
        answer: '兩天後拿到錄取',
        options: ['兩天後拿到錄取', '兩天後被拒絕', '還在等消息', '要再面試一次'],
        note: 'offered him the position 是給他這個職位，也就是錄取。offer 當動詞是提供，當名詞就是錄取通知。',
      },
    ],
  },
  {
    id: 'en-r-005',
    title: 'Moving to a New City',
    passage:
      'When Mia moved to Chicago, she knew nobody. For the first month she ate dinner alone almost every night. ' +
      'Then she joined a running club that met on Saturday mornings. ' +
      'At first she could only finish half the route, but after two months she ran the whole thing without stopping. ' +
      'The running mattered less than the people she met there.',
    translation:
      '米亞搬到芝加哥時一個人也不認識。第一個月幾乎每天晚上都一個人吃晚餐。' +
      '後來她加入了一個週六早上聚會的跑步社團。一開始她只能跑完一半路線，' +
      '但兩個月後她可以不停地跑完全程。跑步本身的重要性，比不上她在那裡認識的人。',
    category: 'society',
    level: 3,
    questions: [
      {
        id: 'en-r-005-q1',
        ask: '她剛搬去的第一個月怎麼過？',
        answer: '幾乎每晚獨自吃晚餐',
        options: ['幾乎每晚獨自吃晚餐', '每晚跟同事聚餐', '每天都去跑步', '常常回老家'],
        note: 'ate dinner alone almost every night——almost 表示幾乎但不是全部，比 every night 保守一點。',
      },
      {
        id: 'en-r-005-q2',
        ask: '跑步社團什麼時候聚會？',
        answer: '星期六早上',
        options: ['星期六早上', '星期天早上', '每天晚上', '每個月一次'],
        note: 'that met on Saturday mornings 是關係子句，修飾前面的 club，說明這個社團的聚會時間。',
      },
      {
        id: 'en-r-005-q3',
        ask: '兩個月後她的進步是什麼？',
        answer: '能不停地跑完全程',
        options: ['能不停地跑完全程', '能跑完一半', '變成社團教練', '開始參加比賽'],
        note: 'ran the whole thing without stopping。the whole thing 指的是前一句提到的 route（路線）。',
      },
      {
        id: 'en-r-005-q4',
        ask: '最後一句想表達什麼？',
        answer: '認識的人比跑步本身更重要',
        options: [
          '認識的人比跑步本身更重要',
          '她後來不再跑步了',
          '跑步是她唯一的興趣',
          '社團裡的人跑得比她快',
        ],
        note: 'mattered less than 是「比…不重要」。matter 當動詞是「要緊」，不是「事情」。',
      },
    ],
  },
  {
    id: 'en-r-006',
    title: 'A Letter from Grandma',
    passage:
      'Last week a letter arrived for Tom. It was from his grandmother, who never uses email. ' +
      'She wrote that the apple tree in her garden had finally produced fruit after five years, ' +
      'and that she was sending him a jar of jam by post. She also asked him to visit before winter. ' +
      'Tom read the letter twice and put it in his desk drawer.',
    translation:
      '上星期湯姆收到一封信。是他祖母寄來的，她從來不用電子郵件。' +
      '她寫說花園裡的蘋果樹在五年之後終於結果了，還說要寄一罐果醬給他。' +
      '她也要他在冬天之前回來看看。湯姆把信讀了兩遍，放進書桌抽屜裡。',
    category: 'family',
    level: 3,
    questions: [
      {
        id: 'en-r-006-q1',
        ask: '祖母為什麼寫信而不是寄電子郵件？',
        answer: '她從來不用電子郵件',
        options: ['她從來不用電子郵件', '她的網路壞了', '信比較快', '她想寄果醬'],
        note: 'who never uses email 是關係子句，補充說明祖母這個人的特點——這就是她寫信的原因。',
      },
      {
        id: 'en-r-006-q2',
        ask: '蘋果樹的情況是什麼？',
        answer: '五年後終於結果了',
        options: ['五年後終於結果了', '已經枯死了', '每年都結很多果', '剛種下五年'],
        note: 'had finally produced fruit after five years——finally 帶著「等了很久」的語氣，也暗示前四年都沒結果。',
      },
      {
        id: 'en-r-006-q3',
        ask: '她要寄什麼給湯姆？',
        answer: '一罐果醬',
        options: ['一罐果醬', '一箱蘋果', '一棵樹苗', '一張照片'],
        note: 'a jar of jam。jar 是罐子，是不可數名詞 jam 的計量單位——英文的不可數名詞都要靠容器來計數。',
      },
      {
        id: 'en-r-006-q4',
        ask: '祖母希望他什麼時候來？',
        answer: '冬天之前',
        options: ['冬天之前', '冬天的時候', '明年春天', '果醬寄到之後'],
        note: 'before winter 是冬天之前。before 與 by 的差別在於 before 強調在那之前的任何時間點。',
      },
    ],
  },
  {
    id: 'en-r-007',
    title: 'The Broken Bicycle',
    passage:
      'Sam rides his bicycle to school every day. Last Tuesday the chain came off halfway there, ' +
      'and he had to push the bike the rest of the way. He was twenty minutes late. ' +
      'That evening his father showed him how to put the chain back on, ' +
      'and now Sam keeps a small tool and a pair of gloves in his backpack.',
    translation:
      '山姆每天騎腳踏車上學。上週二車鏈在半路上掉了，他只好推著車走完剩下的路，遲到了二十分鐘。' +
      '那天晚上他爸爸教他怎麼把車鏈裝回去，現在山姆的背包裡總是放著一支小工具和一副手套。',
    category: 'transport',
    level: 2,
    questions: [
      {
        id: 'en-r-007-q1',
        ask: '車鏈是在什麼時候掉的？',
        answer: '上學途中的一半路程',
        options: ['上學途中的一半路程', '出門前', '放學回家時', '到學校之後'],
        note: 'halfway there 的 there 指的是前一句的 school，所以是上學路上的一半。',
      },
      {
        id: 'en-r-007-q2',
        ask: '他怎麼走完剩下的路？',
        answer: '推著腳踏車走',
        options: ['推著腳踏車走', '搭公車', '請爸爸來接', '跑步'],
        note: 'push the bike 是推車。had to 表示這是不得已的選擇，不是他想這麼做。',
      },
      {
        id: 'en-r-007-q3',
        ask: '爸爸做了什麼？',
        answer: '教他怎麼把車鏈裝回去',
        options: ['教他怎麼把車鏈裝回去', '幫他修好車', '買了新腳踏車', '載他去上學'],
        note: 'showed him how to 是示範教學，跟直接幫他修好（fixed it for him）不一樣。',
      },
      {
        id: 'en-r-007-q4',
        ask: '這件事之後有什麼改變？',
        answer: '他背包裡固定帶工具和手套',
        options: [
          '他背包裡固定帶工具和手套',
          '他改成走路上學',
          '他每天提早出門',
          '他把腳踏車賣掉了',
        ],
        note: 'now Sam keeps... 的現在式表示這是持續到現在的習慣，而不是那一天發生的事。',
      },
    ],
  },
  {
    id: 'en-r-008',
    title: 'Working from Home',
    passage:
      'Since the company allowed remote work, Priya has worked from home three days a week. ' +
      'She likes not having to commute, but she misses the small conversations in the office. ' +
      'To make up for it, she now has lunch with a colleague every Thursday. ' +
      'Her manager says the team has been just as productive as before, though meetings take longer to arrange.',
    translation:
      '自從公司開放遠距工作，普莉雅每週有三天在家上班。她喜歡不用通勤，但想念辦公室裡那些閒聊。' +
      '為了彌補，她現在每週四跟一位同事一起吃午餐。' +
      '她的主管說團隊的產出跟以前一樣好，只是會議比較難約時間。',
    category: 'business',
    level: 4,
    questions: [
      {
        id: 'en-r-008-q1',
        ask: '她一週有幾天在家上班？',
        answer: '三天',
        options: ['三天', '五天', '一天', '每天'],
        note: 'three days a week 的 a 在這裡等於 per，是「每」的意思，不是冠詞。',
      },
      {
        id: 'en-r-008-q2',
        ask: '她想念辦公室的什麼？',
        answer: '同事之間的閒聊',
        options: ['同事之間的閒聊', '安靜的環境', '公司的咖啡', '主管的指導'],
        note: 'the small conversations 字面是小對話，指的是走廊上、茶水間那種不正式的交談。',
      },
      {
        id: 'en-r-008-q3',
        ask: '「To make up for it」是什麼意思？',
        answer: '為了彌補這件事',
        options: ['為了彌補這件事', '為了整理它', '為了編造理由', '為了往上爬'],
        note: 'make up for 是彌補，make up 單獨用則是「編造」或「化妝」——多一個 for 意思就完全不同。',
      },
      {
        id: 'en-r-008-q4',
        ask: '主管認為遠距工作帶來的唯一麻煩是什麼？',
        answer: '會議比較難約時間',
        options: ['會議比較難約時間', '產出變少了', '同事感情變差', '沒有人準時上線'],
        note: 'though meetings take longer to arrange——though 帶出唯一的例外，前半句才是主要評價（產出一樣好）。',
      },
    ],
  },
];
