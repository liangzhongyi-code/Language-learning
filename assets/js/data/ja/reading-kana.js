/**
 * 日文閱讀短文的逐句假名讀音（手寫）。
 *
 * 另開一檔而不是寫進 readings.js：題庫本身維持乾淨好讀，
 * 讀音資料只給「逐句朗讀」與「標假名」顯示用，兩邊可以各自修改。
 * 日文漢字直接餵給語音引擎容易唸錯，所以朗讀一律改讀 reading。
 *
 * 切句規則：以「。」「？」「！」結尾切開，句尾標點留在該句；
 * 引號「」內的句號不切，整段引用和後面的「と言いました。」算同一句。
 * 每篇所有 text 依序串起來必須和 readings.js 的 passage 完全相同。
 *
 * 讀音規則：reading 是整句平假名，片假名外來語轉成平假名，
 * 助詞は、へ、を照原字寫，數字照實際唸法，標點與原文一致。
 * ruby 依出現順序以詞為單位列出漢字片段（送假名不放進去），
 * 相連的兩個詞會拆成兩筆，例如「毎朝六時」拆成「毎朝」「六時」。
 * 把 text 裡的漢字片段依序換成 ruby 的 reading、片假名轉平假名後，必須等於 reading。
 */
export const readingKana = {
  'ja-r-001': [
    {
      text: '田中さんは毎朝六時に起きます。',
      reading: 'たなかさんはまいあさろくじにおきます。',
      ruby: [
        { text: '田中', reading: 'たなか' },
        { text: '毎朝', reading: 'まいあさ' },
        { text: '六時', reading: 'ろくじ' },
        { text: '起', reading: 'お' },
      ],
    },
    {
      text: 'まず新聞を読んで、それから朝ご飯を食べます。',
      reading: 'まずしんぶんをよんで、それからあさごはんをたべます。',
      ruby: [
        { text: '新聞', reading: 'しんぶん' },
        { text: '読', reading: 'よ' },
        { text: '朝', reading: 'あさ' },
        { text: '飯', reading: 'はん' },
        { text: '食', reading: 'た' },
      ],
    },
    {
      text: '七時半に家を出て、電車で会社へ行きます。',
      reading: 'しちじはんにいえをでて、でんしゃでかいしゃへいきます。',
      ruby: [
        { text: '七時半', reading: 'しちじはん' },
        { text: '家', reading: 'いえ' },
        { text: '出', reading: 'で' },
        { text: '電車', reading: 'でんしゃ' },
        { text: '会社', reading: 'かいしゃ' },
        { text: '行', reading: 'い' },
      ],
    },
    {
      text: '会社は駅から歩いて十分ぐらいです。',
      reading: 'かいしゃはえきからあるいてじゅっぷんぐらいです。',
      ruby: [
        { text: '会社', reading: 'かいしゃ' },
        { text: '駅', reading: 'えき' },
        { text: '歩', reading: 'ある' },
        { text: '十分', reading: 'じゅっぷん' },
      ],
    },
    {
      text: '昼はいつも会社の近くの食堂で定食を食べますが、金曜日だけは同僚とラーメンを食べに行きます。',
      reading: 'ひるはいつもかいしゃのちかくのしょくどうでていしょくをたべますが、きんようびだけはどうりょうとらーめんをたべにいきます。',
      ruby: [
        { text: '昼', reading: 'ひる' },
        { text: '会社', reading: 'かいしゃ' },
        { text: '近', reading: 'ちか' },
        { text: '食堂', reading: 'しょくどう' },
        { text: '定食', reading: 'ていしょく' },
        { text: '食', reading: 'た' },
        { text: '金曜日', reading: 'きんようび' },
        { text: '同僚', reading: 'どうりょう' },
        { text: '食', reading: 'た' },
        { text: '行', reading: 'い' },
      ],
    },
    {
      text: '夜は七時ごろ家に帰って、晩ご飯の後で少し本を読みます。',
      reading: 'よるはしちじごろいえにかえって、ばんごはんのあとですこしほんをよみます。',
      ruby: [
        { text: '夜', reading: 'よる' },
        { text: '七時', reading: 'しちじ' },
        { text: '家', reading: 'いえ' },
        { text: '帰', reading: 'かえ' },
        { text: '晩', reading: 'ばん' },
        { text: '飯', reading: 'はん' },
        { text: '後', reading: 'あと' },
        { text: '少', reading: 'すこ' },
        { text: '本', reading: 'ほん' },
        { text: '読', reading: 'よ' },
      ],
    },
    {
      text: '十一時には寝ます。',
      reading: 'じゅういちじにはねます。',
      ruby: [
        { text: '十一時', reading: 'じゅういちじ' },
        { text: '寝', reading: 'ね' },
      ],
    },
  ],
  'ja-r-002': [
    {
      text: '今日は山田さんが会社に入って初めての日です。',
      reading: 'きょうはやまださんがかいしゃにはいってはじめてのひです。',
      ruby: [
        { text: '今日', reading: 'きょう' },
        { text: '山田', reading: 'やまだ' },
        { text: '会社', reading: 'かいしゃ' },
        { text: '入', reading: 'はい' },
        { text: '初', reading: 'はじ' },
        { text: '日', reading: 'ひ' },
      ],
    },
    {
      text: '朝、部長に会って「山田と申します。よろしくお願いいたします」と言いました。',
      reading: 'あさ、ぶちょうにあって「やまだともうします。よろしくおねがいいたします」といいました。',
      ruby: [
        { text: '朝', reading: 'あさ' },
        { text: '部長', reading: 'ぶちょう' },
        { text: '会', reading: 'あ' },
        { text: '山田', reading: 'やまだ' },
        { text: '申', reading: 'もう' },
        { text: '願', reading: 'ねが' },
        { text: '言', reading: 'い' },
      ],
    },
    {
      text: '部長は「こちらこそ。分からないことがあったら、いつでも聞いてください」と答えました。',
      reading: 'ぶちょうは「こちらこそ。わからないことがあったら、いつでもきいてください」とこたえました。',
      ruby: [
        { text: '部長', reading: 'ぶちょう' },
        { text: '分', reading: 'わ' },
        { text: '聞', reading: 'き' },
        { text: '答', reading: 'こた' },
      ],
    },
    {
      text: '昼休みに、同期の鈴木さんと食堂へ行きました。',
      reading: 'ひるやすみに、どうきのすずきさんとしょくどうへいきました。',
      ruby: [
        { text: '昼休', reading: 'ひるやす' },
        { text: '同期', reading: 'どうき' },
        { text: '鈴木', reading: 'すずき' },
        { text: '食堂', reading: 'しょくどう' },
        { text: '行', reading: 'い' },
      ],
    },
    {
      text: '鈴木さんには「僕もまだ慣れてないんだ」と気楽に話しました。',
      reading: 'すずきさんには「ぼくもまだなれてないんだ」ときらくにはなしました。',
      ruby: [
        { text: '鈴木', reading: 'すずき' },
        { text: '僕', reading: 'ぼく' },
        { text: '慣', reading: 'な' },
        { text: '気楽', reading: 'きらく' },
        { text: '話', reading: 'はな' },
      ],
    },
    {
      text: '帰る前に部長のところへ行って「本日はありがとうございました。お先に失礼します」と挨拶しました。',
      reading: 'かえるまえにぶちょうのところへいって「ほんじつはありがとうございました。おさきにしつれいします」とあいさつしました。',
      ruby: [
        { text: '帰', reading: 'かえ' },
        { text: '前', reading: 'まえ' },
        { text: '部長', reading: 'ぶちょう' },
        { text: '行', reading: 'い' },
        { text: '本日', reading: 'ほんじつ' },
        { text: '先', reading: 'さき' },
        { text: '失礼', reading: 'しつれい' },
        { text: '挨拶', reading: 'あいさつ' },
      ],
    },
  ],
  'ja-r-003': [
    {
      text: '午後、取引先の佐藤様から電話がありました。',
      reading: 'ごご、とりひきさきのさとうさまからでんわがありました。',
      ruby: [
        { text: '午後', reading: 'ごご' },
        { text: '取引先', reading: 'とりひきさき' },
        { text: '佐藤様', reading: 'さとうさま' },
        { text: '電話', reading: 'でんわ' },
      ],
    },
    {
      text: '「営業部の高橋部長はいらっしゃいますか」と聞かれました。',
      reading: '「えいぎょうぶのたかはしぶちょうはいらっしゃいますか」ときかれました。',
      ruby: [
        { text: '営業部', reading: 'えいぎょうぶ' },
        { text: '高橋部長', reading: 'たかはしぶちょう' },
        { text: '聞', reading: 'き' },
      ],
    },
    {
      text: '高橋部長は席にいましたが、私はこう答えました。',
      reading: 'たかはしぶちょうはせきにいましたが、わたしはこうこたえました。',
      ruby: [
        { text: '高橋部長', reading: 'たかはしぶちょう' },
        { text: '席', reading: 'せき' },
        { text: '私', reading: 'わたし' },
        { text: '答', reading: 'こた' },
      ],
    },
    {
      text: '「高橋はただいま席におります。少々お待ちください」。',
      reading: '「たかはしはただいませきにおります。しょうしょうおまちください」。',
      ruby: [
        { text: '高橋', reading: 'たかはし' },
        { text: '席', reading: 'せき' },
        { text: '少々', reading: 'しょうしょう' },
        { text: '待', reading: 'ま' },
      ],
    },
    {
      text: '電話を切った後、後輩が「どうして部長に敬語を使わなかったんですか」と不思議そうに聞きました。',
      reading: 'でんわをきったあと、こうはいが「どうしてぶちょうにけいごをつかわなかったんですか」とふしぎそうにききました。',
      ruby: [
        { text: '電話', reading: 'でんわ' },
        { text: '切', reading: 'き' },
        { text: '後', reading: 'あと' },
        { text: '後輩', reading: 'こうはい' },
        { text: '部長', reading: 'ぶちょう' },
        { text: '敬語', reading: 'けいご' },
        { text: '使', reading: 'つか' },
        { text: '不思議', reading: 'ふしぎ' },
        { text: '聞', reading: 'き' },
      ],
    },
    {
      text: '「社外の人と話すときは、自分の会社の人には敬語を使わないんだよ」と教えました。',
      reading: '「しゃがいのひととはなすときは、じぶんのかいしゃのひとにはけいごをつかわないんだよ」とおしえました。',
      ruby: [
        { text: '社外', reading: 'しゃがい' },
        { text: '人', reading: 'ひと' },
        { text: '話', reading: 'はな' },
        { text: '自分', reading: 'じぶん' },
        { text: '会社', reading: 'かいしゃ' },
        { text: '人', reading: 'ひと' },
        { text: '敬語', reading: 'けいご' },
        { text: '使', reading: 'つか' },
        { text: '教', reading: 'おし' },
      ],
    },
  ],
  'ja-r-004': [
    {
      text: '大学生の李さんは、駅前のコンビニで週に三回アルバイトをしています。',
      reading: 'だいがくせいのりさんは、えきまえのこんびにでしゅうにさんかいあるばいとをしています。',
      ruby: [
        { text: '大学生', reading: 'だいがくせい' },
        { text: '李', reading: 'り' },
        { text: '駅前', reading: 'えきまえ' },
        { text: '週', reading: 'しゅう' },
        { text: '三回', reading: 'さんかい' },
      ],
    },
    {
      text: '仕事は夕方五時から九時までです。',
      reading: 'しごとはゆうがたごじからくじまでです。',
      ruby: [
        { text: '仕事', reading: 'しごと' },
        { text: '夕方', reading: 'ゆうがた' },
        { text: '五時', reading: 'ごじ' },
        { text: '九時', reading: 'くじ' },
      ],
    },
    {
      text: 'レジでお金を受け取ったり、棚に商品を並べたりします。',
      reading: 'れじでおかねをうけとったり、たなにしょうひんをならべたりします。',
      ruby: [
        { text: '金', reading: 'かね' },
        { text: '受', reading: 'う' },
        { text: '取', reading: 'と' },
        { text: '棚', reading: 'たな' },
        { text: '商品', reading: 'しょうひん' },
        { text: '並', reading: 'なら' },
      ],
    },
    {
      text: '最初は敬語が難しくて、よく間違えました。',
      reading: 'さいしょはけいごがむずかしくて、よくまちがえました。',
      ruby: [
        { text: '最初', reading: 'さいしょ' },
        { text: '敬語', reading: 'けいご' },
        { text: '難', reading: 'むずか' },
        { text: '間違', reading: 'まちが' },
      ],
    },
    {
      text: '店長に「お客様には『いらっしゃいませ』、帰るときは『ありがとうございました』でいいよ」と言われて、少し楽になりました。',
      reading: 'てんちょうに「おきゃくさまには『いらっしゃいませ』、かえるときは『ありがとうございました』でいいよ」といわれて、すこしらくになりました。',
      ruby: [
        { text: '店長', reading: 'てんちょう' },
        { text: '客様', reading: 'きゃくさま' },
        { text: '帰', reading: 'かえ' },
        { text: '言', reading: 'い' },
        { text: '少', reading: 'すこ' },
        { text: '楽', reading: 'らく' },
      ],
    },
    {
      text: '今はお客さんと日本語で話すのが楽しいそうです。',
      reading: 'いまはおきゃくさんとにほんごではなすのがたのしいそうです。',
      ruby: [
        { text: '今', reading: 'いま' },
        { text: '客', reading: 'きゃく' },
        { text: '日本語', reading: 'にほんご' },
        { text: '話', reading: 'はな' },
        { text: '楽', reading: 'たの' },
      ],
    },
  ],
  'ja-r-005': [
    {
      text: '木村さんは三日前から熱があって、今朝病院へ行きました。',
      reading: 'きむらさんはみっかまえからねつがあって、けさびょういんへいきました。',
      ruby: [
        { text: '木村', reading: 'きむら' },
        { text: '三日前', reading: 'みっかまえ' },
        { text: '熱', reading: 'ねつ' },
        { text: '今朝', reading: 'けさ' },
        { text: '病院', reading: 'びょういん' },
        { text: '行', reading: 'い' },
      ],
    },
    {
      text: '受付で保険証を出して、三十分ぐらい待ちました。',
      reading: 'うけつけでほけんしょうをだして、さんじゅっぷんぐらいまちました。',
      ruby: [
        { text: '受付', reading: 'うけつけ' },
        { text: '保険証', reading: 'ほけんしょう' },
        { text: '出', reading: 'だ' },
        { text: '三十分', reading: 'さんじゅっぷん' },
        { text: '待', reading: 'ま' },
      ],
    },
    {
      text: '医者に「いつから具合が悪いですか」と聞かれて、「一昨日の夜からです」と答えました。',
      reading: 'いしゃに「いつからぐあいがわるいですか」ときかれて、「おとといのよるからです」とこたえました。',
      ruby: [
        { text: '医者', reading: 'いしゃ' },
        { text: '具合', reading: 'ぐあい' },
        { text: '悪', reading: 'わる' },
        { text: '聞', reading: 'き' },
        { text: '一昨日', reading: 'おととい' },
        { text: '夜', reading: 'よる' },
        { text: '答', reading: 'こた' },
      ],
    },
    {
      text: '医者は「風邪ですね。薬を出しますから、三日分きちんと飲んでください。お風呂は今日はやめたほうがいいですよ」と言いました。',
      reading: 'いしゃは「かぜですね。くすりをだしますから、みっかぶんきちんとのんでください。おふろはきょうはやめたほうがいいですよ」といいました。',
      ruby: [
        { text: '医者', reading: 'いしゃ' },
        { text: '風邪', reading: 'かぜ' },
        { text: '薬', reading: 'くすり' },
        { text: '出', reading: 'だ' },
        { text: '三日分', reading: 'みっかぶん' },
        { text: '飲', reading: 'の' },
        { text: '風呂', reading: 'ふろ' },
        { text: '今日', reading: 'きょう' },
        { text: '言', reading: 'い' },
      ],
    },
    {
      text: '木村さんは薬局で薬をもらって、まっすぐ家へ帰りました。',
      reading: 'きむらさんはやっきょくでくすりをもらって、まっすぐいえへかえりました。',
      ruby: [
        { text: '木村', reading: 'きむら' },
        { text: '薬局', reading: 'やっきょく' },
        { text: '薬', reading: 'くすり' },
        { text: '家', reading: 'いえ' },
        { text: '帰', reading: 'かえ' },
      ],
    },
  ],
  'ja-r-006': [
    {
      text: '来週の土曜日、私は友達と海へ行く予定です。',
      reading: 'らいしゅうのどようび、わたしはともだちとうみへいくよていです。',
      ruby: [
        { text: '来週', reading: 'らいしゅう' },
        { text: '土曜日', reading: 'どようび' },
        { text: '私', reading: 'わたし' },
        { text: '友達', reading: 'ともだち' },
        { text: '海', reading: 'うみ' },
        { text: '行', reading: 'い' },
        { text: '予定', reading: 'よてい' },
      ],
    },
    {
      text: '天気予報によると、土曜日は晴れですが、日曜日は雨が降るそうです。',
      reading: 'てんきよほうによると、どようびははれですが、にちようびはあめがふるそうです。',
      ruby: [
        { text: '天気予報', reading: 'てんきよほう' },
        { text: '土曜日', reading: 'どようび' },
        { text: '晴', reading: 'は' },
        { text: '日曜日', reading: 'にちようび' },
        { text: '雨', reading: 'あめ' },
        { text: '降', reading: 'ふ' },
      ],
    },
    {
      text: 'だから、泳ぐのは土曜日にして、日曜日は駅前の美術館へ行くことにしました。',
      reading: 'だから、およぐのはどようびにして、にちようびはえきまえのびじゅつかんへいくことにしました。',
      ruby: [
        { text: '泳', reading: 'およ' },
        { text: '土曜日', reading: 'どようび' },
        { text: '日曜日', reading: 'にちようび' },
        { text: '駅前', reading: 'えきまえ' },
        { text: '美術館', reading: 'びじゅつかん' },
        { text: '行', reading: 'い' },
      ],
    },
    {
      text: '友達は絵が好きなので、とても喜んでいます。',
      reading: 'ともだちはえがすきなので、とてもよろこんでいます。',
      ruby: [
        { text: '友達', reading: 'ともだち' },
        { text: '絵', reading: 'え' },
        { text: '好', reading: 'す' },
        { text: '喜', reading: 'よろこ' },
      ],
    },
    {
      text: '私はあまり詳しくありませんが、一緒に行くのは楽しみです。',
      reading: 'わたしはあまりくわしくありませんが、いっしょにいくのはたのしみです。',
      ruby: [
        { text: '私', reading: 'わたし' },
        { text: '詳', reading: 'くわ' },
        { text: '一緒', reading: 'いっしょ' },
        { text: '行', reading: 'い' },
        { text: '楽', reading: 'たの' },
      ],
    },
    {
      text: '土曜日の朝八時に駅で待ち合わせます。',
      reading: 'どようびのあさはちじにえきでまちあわせます。',
      ruby: [
        { text: '土曜日', reading: 'どようび' },
        { text: '朝', reading: 'あさ' },
        { text: '八時', reading: 'はちじ' },
        { text: '駅', reading: 'えき' },
        { text: '待', reading: 'ま' },
        { text: '合', reading: 'あ' },
      ],
    },
  ],
  'ja-r-007': [
    {
      text: '先月、私は東京から大阪へ引っ越しました。',
      reading: 'せんげつ、わたしはとうきょうからおおさかへひっこしました。',
      ruby: [
        { text: '先月', reading: 'せんげつ' },
        { text: '私', reading: 'わたし' },
        { text: '東京', reading: 'とうきょう' },
        { text: '大阪', reading: 'おおさか' },
        { text: '引', reading: 'ひ' },
        { text: '越', reading: 'こ' },
      ],
    },
    {
      text: '前のアパートは駅に近くて便利でしたが、部屋が狭くて家賃も高かったです。',
      reading: 'まえのあぱーとはえきにちかくてべんりでしたが、へやがせまくてやちんもたかかったです。',
      ruby: [
        { text: '前', reading: 'まえ' },
        { text: '駅', reading: 'えき' },
        { text: '近', reading: 'ちか' },
        { text: '便利', reading: 'べんり' },
        { text: '部屋', reading: 'へや' },
        { text: '狭', reading: 'せま' },
        { text: '家賃', reading: 'やちん' },
        { text: '高', reading: 'たか' },
      ],
    },
    {
      text: '新しい部屋は駅から歩いて二十分かかりますが、前より広くて、家賃は三分の二ぐらいです。',
      reading: 'あたらしいへやはえきからあるいてにじゅっぷんかかりますが、まえよりひろくて、やちんはさんぶんのにぐらいです。',
      ruby: [
        { text: '新', reading: 'あたら' },
        { text: '部屋', reading: 'へや' },
        { text: '駅', reading: 'えき' },
        { text: '歩', reading: 'ある' },
        { text: '二十分', reading: 'にじゅっぷん' },
        { text: '前', reading: 'まえ' },
        { text: '広', reading: 'ひろ' },
        { text: '家賃', reading: 'やちん' },
        { text: '三分', reading: 'さんぶん' },
        { text: '二', reading: 'に' },
      ],
    },
    {
      text: '引っ越しの日は雨が降っていて大変でした。',
      reading: 'ひっこしのひはあめがふっていてたいへんでした。',
      ruby: [
        { text: '引', reading: 'ひ' },
        { text: '越', reading: 'こ' },
        { text: '日', reading: 'ひ' },
        { text: '雨', reading: 'あめ' },
        { text: '降', reading: 'ふ' },
        { text: '大変', reading: 'たいへん' },
      ],
    },
    {
      text: '友達が三人手伝いに来てくれたので、夕方には終わりました。',
      reading: 'ともだちがさんにんてつだいにきてくれたので、ゆうがたにはおわりました。',
      ruby: [
        { text: '友達', reading: 'ともだち' },
        { text: '三人', reading: 'さんにん' },
        { text: '手伝', reading: 'てつだ' },
        { text: '来', reading: 'き' },
        { text: '夕方', reading: 'ゆうがた' },
        { text: '終', reading: 'お' },
      ],
    },
    {
      text: '夜はみんなで近くのお好み焼き屋へ行きました。',
      reading: 'よるはみんなでちかくのおこのみやきやへいきました。',
      ruby: [
        { text: '夜', reading: 'よる' },
        { text: '近', reading: 'ちか' },
        { text: '好', reading: 'この' },
        { text: '焼', reading: 'や' },
        { text: '屋', reading: 'や' },
        { text: '行', reading: 'い' },
      ],
    },
  ],
  'ja-r-008': [
    {
      text: '大学のテニス部では、一年生は先輩を必ず「〜さん」と呼びます。',
      reading: 'だいがくのてにすぶでは、いちねんせいはせんぱいをかならず「〜さん」とよびます。',
      ruby: [
        { text: '大学', reading: 'だいがく' },
        { text: '部', reading: 'ぶ' },
        { text: '一年生', reading: 'いちねんせい' },
        { text: '先輩', reading: 'せんぱい' },
        { text: '必', reading: 'かなら' },
        { text: '呼', reading: 'よ' },
      ],
    },
    {
      text: '先輩は後輩を名前で呼んだり、「〜君」と呼んだりします。',
      reading: 'せんぱいはこうはいをなまえでよんだり、「〜くん」とよんだりします。',
      ruby: [
        { text: '先輩', reading: 'せんぱい' },
        { text: '後輩', reading: 'こうはい' },
        { text: '名前', reading: 'なまえ' },
        { text: '呼', reading: 'よ' },
        { text: '君', reading: 'くん' },
        { text: '呼', reading: 'よ' },
      ],
    },
    {
      text: '練習の後、二年生の中村さんが一年生の私に「今日はよく走ってたね」と言ってくれました。',
      reading: 'れんしゅうのあと、にねんせいのなかむらさんがいちねんせいのわたしに「きょうはよくはしってたね」といってくれました。',
      ruby: [
        { text: '練習', reading: 'れんしゅう' },
        { text: '後', reading: 'あと' },
        { text: '二年生', reading: 'にねんせい' },
        { text: '中村', reading: 'なかむら' },
        { text: '一年生', reading: 'いちねんせい' },
        { text: '私', reading: 'わたし' },
        { text: '今日', reading: 'きょう' },
        { text: '走', reading: 'はし' },
        { text: '言', reading: 'い' },
      ],
    },
    {
      text: '私は「ありがとうございます。まだ全然だめですけど」と答えました。',
      reading: 'わたしは「ありがとうございます。まだぜんぜんだめですけど」とこたえました。',
      ruby: [
        { text: '私', reading: 'わたし' },
        { text: '全然', reading: 'ぜんぜん' },
        { text: '答', reading: 'こた' },
      ],
    },
    {
      text: '中村さんは笑って「僕も一年のときは同じだったよ」と言いました。',
      reading: 'なかむらさんはわらって「ぼくもいちねんのときはおなじだったよ」といいました。',
      ruby: [
        { text: '中村', reading: 'なかむら' },
        { text: '笑', reading: 'わら' },
        { text: '僕', reading: 'ぼく' },
        { text: '一年', reading: 'いちねん' },
        { text: '同', reading: 'おな' },
        { text: '言', reading: 'い' },
      ],
    },
    {
      text: '同じ部でも、話し方は学年で変わります。',
      reading: 'おなじぶでも、はなしかたはがくねんでかわります。',
      ruby: [
        { text: '同', reading: 'おな' },
        { text: '部', reading: 'ぶ' },
        { text: '話', reading: 'はな' },
        { text: '方', reading: 'かた' },
        { text: '学年', reading: 'がくねん' },
        { text: '変', reading: 'か' },
      ],
    },
  ],
};
