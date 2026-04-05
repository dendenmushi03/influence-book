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
    tags: ['経営', '長期思考', 'EC'],
    intro: 'Amazon創業者。長期視点の経営で知られる。',
    bio: 'AmazonとBlue Originを率いた起業家。',
    keywords: ['EC', '長期思考', '経営'],
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
    title: 'ジェフ・ベゾスの長期思考',
    slug: 'about-jeff-bezos-dummy',
    author: 'ダミー著者B',
    description: 'Jeff Bezos の経営観を深掘りするためのダミー書籍。',
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
    const [book1, book2, book3, aboutBillBook, aboutJeffBook, aboutFujitaBook] = await Book.create(bookSeedData);

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
        impactSummary: '破壊的イノベーションへの理解を深めた。',
        sourceTitle: 'Jeff Bezos book recommendation',
        sourceUrl: 'https://www.amazon.com/',
        sourceType: 'interview',
        featuredOrder: 1
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
        bookId: aboutJeffBook._id,
        kind: 'about',
        impactSummary: 'Amazon創業前後の意思決定プロセスを追える。',
        sourceTitle: 'Jeff Bezos 関連書籍（ダミー）',
        sourceUrl: 'https://example.com/about-jeff',
        sourceType: 'book-guide',
        featuredOrder: 1
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
