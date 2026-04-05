const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Person = require('../models/Person');
const Book = require('../models/Book');
const Influence = require('../models/Influence');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';

// ------------------------------
// Seed source data
// ------------------------------
// 1) Person data
const personSeedData = [
  {
    name: 'Bill Gates',
    slug: 'bill-gates',
    occupation: 'Co-chair, Bill & Melinda Gates Foundation',
    category: '起業家',
    popularity: 95,
    tags: ['テクノロジー', '長期思考', '経営'],
    intro: '世界的な起業家・慈善活動家。',
    bio: 'Microsoft共同創業者。読書家としても知られる。',
    keywords: ['テクノロジー', '慈善活動', '読書'],
    featured: true
  },
  {
    name: 'Jeff Bezos',
    displayNameJa: 'ジェフ・ベゾス',
    slug: 'jeff-bezos',
    occupation: 'Founder, Amazon',
    category: '起業家',
    popularity: 100,
    imageUrl: '/images/people/jeff-bezos.jpg',
    tags: ['経営', '長期思考', '顧客中心', 'EC', 'テクノロジー'],
    intro: 'Amazon創業者。長期視点と顧客起点の経営で知られる。',
    coreMessage: '顧客起点と長期視点を徹底し、仕組み化で巨大な事業を築いた経営者。',
    summary:
      'ジェフ・ベゾスは、短期的な収益よりも長期的な成長と顧客価値を優先する思考で知られる経営者です。既存産業をインターネットで再設計し、書店から始まったAmazonを巨大なテクノロジー企業へ育てました。彼の特徴は、顧客から逆算して考える姿勢、仕組み化への執着、そして小さな実験を積み重ねる文化づくりにあります。事業を単なる小売で終わらせず、物流、クラウド、デバイスへと広げた点にも、その長期思考が表れています。',
    career:
      '1986年: プリンストン大学を卒業し、金融・テクノロジー領域でキャリアを開始。\n1990年: D. E. Shawで副社長として働き、インターネット市場の伸長に着目。\n1994年: 安定した職を離れ、シアトルでAmazonを創業。\n1995年: オンライン書店としてAmazon.comを公開。\n2006年: AWSを本格展開し、小売を超えた基盤事業へ拡張。\n2021年: CEOを退任し、長期戦略と新規領域に注力。',
    bio:
      'Amazon創業者であり、Blue Originの創業者としても知られる起業家。顧客中心主義、長期思考、仕組み化、実験文化といったキーワードで語られることが多く、現代の経営者の中でも特に再現性のある思考法を持つ人物として注目されている。',
    keywords: ['長期思考', '顧客起点', '仕組み化', '破壊的イノベーション', '実験文化'],
    thoughtTraits: ['顧客中心主義', '長期視点', '実験と改善', '仕組み化', '高い採用基準'],
    featured: true
  },
  {
    name: '藤田晋',
    slug: 'susumu-fujita',
    occupation: '株式会社サイバーエージェント 代表取締役',
    category: '経営者',
    popularity: 85,
    tags: ['起業', 'インターネット', '経営'],
    intro: 'インターネット産業を牽引する経営者。',
    bio: 'Ameba事業などを展開するサイバーエージェント創業者。',
    keywords: ['起業', 'インターネット', '経営'],
    featured: true
  }
];

// 2) Book data
const bookSeedData = [
  {
    title: 'Business Adventures',
    slug: 'business-adventures',
    author: 'John Brooks',
    description: 'ビジネス史から学べる名著。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: 'The Innovator\'s Dilemma',
    slug: 'the-innovators-dilemma',
    author: 'Clayton M. Christensen',
    description: 'イノベーションのジレンマを解説。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: 'Sam Walton: Made in America',
    slug: 'sam-walton-made-in-america',
    author: 'Sam Walton',
    description: '顧客志向とオペレーション重視の経営観を学べる一冊。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: 'The Remains of the Day',
    slug: 'the-remains-of-the-day',
    author: 'Kazuo Ishiguro',
    description: '責任感・献身・選択の重みを描く小説。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: '人を動かす',
    slug: 'hito-wo-ugokasu',
    author: 'デール・カーネギー',
    description: '人間関係の原則を学べる定番書。',
    amazonUrl: 'https://www.amazon.co.jp/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: 'ビル・ゲイツ: 巨大ソフトウェア帝国を築いた思想',
    slug: 'about-bill-gates-dummy',
    author: 'ダミー著者A',
    description: 'Bill Gates の思想とキャリアをたどるためのダミー書籍。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: 'The Everything Store: Jeff Bezos and the Age of Amazon',
    slug: 'the-everything-store',
    author: 'Brad Stone',
    description: 'Amazon創業から拡大までの意思決定と組織文化を追う評伝。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: 'Invent and Wander: The Collected Writings of Jeff Bezos',
    slug: 'invent-and-wander',
    author: 'Jeff Bezos, edited by Walter Isaacson',
    description: '株主書簡やスピーチを通じてベゾスの思考をたどる書籍。',
    amazonUrl: 'https://www.amazon.com/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  },
  {
    title: '藤田晋の経営哲学',
    slug: 'about-susumu-fujita-dummy',
    author: 'ダミー著者C',
    description: '藤田晋の歩みを知るためのダミー書籍。',
    amazonUrl: 'https://www.amazon.co.jp/',
    rakutenUrl: 'https://books.rakuten.co.jp/'
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seed');

    await Promise.all([
      Influence.deleteMany({}),
      Person.deleteMany({}),
      Book.deleteMany({})
    ]);

    const [bill, jeff, fujita] = await Person.create(personSeedData);
    const [
      book1,
      book2,
      jeffInfluenceBook2,
      jeffInfluenceBook3,
      book3,
      aboutBillBook,
      aboutJeffBook1,
      aboutJeffBook2,
      aboutFujitaBook
    ] = await Book.create(bookSeedData);

    // 3) Influence/About relation data
    await Influence.create([
      {
        personId: bill._id,
        bookId: book1._id,
        impactSummary: '企業経営の現実を学ぶうえで大きな示唆を得た。',
        sourceTitle: 'Recommended by Bill Gates',
        sourceUrl: 'https://www.gatesnotes.com/',
        sourceType: 'blog',
        featuredOrder: 1
      },
      {
        personId: jeff._id,
        bookId: book2._id,
        impactSummary:
          '既存事業の成功が次の破壊的変化への対応を遅らせる、という視点を学ぶうえで重要な一冊。Amazonが自ら既存のやり方を壊しながら新規事業へ進んでいく姿勢とも相性が良い。',
        sourceTitle: 'Jeff Bezos on Clayton Christensen and disruption',
        sourceUrl: 'https://www.youtube.com/watch?v=EJ4fRfp4jbo',
        sourceType: 'interview',
        featuredOrder: 1
      },
      {
        personId: jeff._id,
        bookId: jeffInfluenceBook2._id,
        impactSummary:
          '顧客志向、低価格、オペレーションの強さ、現場感覚といった考え方に通じる内容として知られる。ベゾスの顧客中心主義や、地道な改善の積み重ねとつながる文脈で参照されることが多い。',
        sourceTitle: 'Jeff Bezos discusses Sam Walton',
        sourceUrl: 'https://www.youtube.com/watch?v=rxDMiP8Xgak',
        sourceType: 'interview',
        featuredOrder: 2
      },
      {
        personId: jeff._id,
        bookId: jeffInfluenceBook3._id,
        impactSummary:
          'ベゾスが小説から学ぶことの象徴として語られる一冊。責任感、基準の高さ、役割への献身、選択の重みなど、経営以外の側面から思考に影響した本として位置づけられる。',
        sourceTitle: 'Jeff Bezos on books and The Remains of the Day',
        sourceUrl: 'https://www.newsweek.com/what-jeff-bezos-reads-84149',
        sourceType: 'article',
        featuredOrder: 3
      },
      {
        personId: fujita._id,
        bookId: book3._id,
        impactSummary: '人との関係性を築く姿勢に影響を受けた。',
        sourceTitle: 'インタビュー記事',
        sourceUrl: 'https://www.cyberagent.co.jp/',
        sourceType: 'article',
        featuredOrder: 1
      },
      {
        personId: bill._id,
        bookId: aboutBillBook._id,
        kind: 'about',
        impactSummary: '生い立ちから慈善活動まで、人物像を広く把握できる。',
        sourceTitle: 'Bill Gates 関連書籍（ダミー）',
        sourceUrl: 'https://example.com/about-bill',
        sourceType: 'book-guide',
        featuredOrder: 1
      },
      {
        personId: jeff._id,
        bookId: aboutJeffBook1._id,
        kind: 'about',
        impactSummary:
          '創業初期からAmazon拡大までの意思決定、組織文化、競争戦略を追うのに向いている。ベゾスの強みと苛烈さの両面を理解する入口になる。',
        sourceTitle: 'The Everything Store by Brad Stone',
        sourceUrl: 'https://www.goodreads.com/book/show/17660462-the-everything-store',
        sourceType: 'book-guide',
        featuredOrder: 1
      },
      {
        personId: jeff._id,
        bookId: aboutJeffBook2._id,
        kind: 'about',
        impactSummary:
          '株主への手紙やスピーチを通して、ベゾス自身の言葉で思想を追える本。Day 1、長期思考、顧客起点など、本人の思考を一次資料に近い形で理解しやすい。',
        sourceTitle: 'Invent and Wander',
        sourceUrl: 'https://www.simonandschuster.com/books/Invent-and-Wander/Jeff-Bezos/9781982132616',
        sourceType: 'book-guide',
        featuredOrder: 2
      },
      {
        personId: fujita._id,
        bookId: aboutFujitaBook._id,
        kind: 'about',
        impactSummary: '起業から事業拡大までの実践的な視点を学べる。',
        sourceTitle: '藤田晋 関連書籍（ダミー）',
        sourceUrl: 'https://example.com/about-fujita',
        sourceType: 'book-guide',
        featuredOrder: 1
      }
    ]);

    console.log('Seed completed successfully');
  } catch (error) {
    console.error('Seed failed:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

seed();
