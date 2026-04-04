const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Person = require('../models/Person');
const Book = require('../models/Book');
const Influence = require('../models/Influence');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seed');

    await Promise.all([
      Influence.deleteMany({}),
      Person.deleteMany({}),
      Book.deleteMany({})
    ]);

    const [bill, jeff, fujita] = await Person.create([
      {
        name: 'Bill Gates',
        slug: 'bill-gates',
        occupation: 'Co-chair, Bill & Melinda Gates Foundation',
        intro: '世界的な起業家・慈善活動家。',
        bio: 'Microsoft共同創業者。読書家としても知られる。',
        keywords: ['テクノロジー', '慈善活動', '読書'],
        featured: true
      },
      {
        name: 'Jeff Bezos',
        slug: 'jeff-bezos',
        occupation: 'Founder, Amazon',
        intro: 'Amazon創業者。長期視点の経営で知られる。',
        bio: 'AmazonとBlue Originを率いた起業家。',
        keywords: ['EC', '長期思考', '経営'],
        featured: true
      },
      {
        name: '藤田晋',
        slug: 'susumu-fujita',
        occupation: '株式会社サイバーエージェント 代表取締役',
        intro: 'インターネット産業を牽引する経営者。',
        bio: 'Ameba事業などを展開するサイバーエージェント創業者。',
        keywords: ['起業', 'インターネット', '経営'],
        featured: true
      }
    ]);

    const [book1, book2, book3] = await Book.create([
      {
        title: 'Business Adventures',
        author: 'John Brooks',
        description: 'ビジネス史から学べる名著。',
        amazonUrl: 'https://www.amazon.com/',
        rakutenUrl: 'https://books.rakuten.co.jp/'
      },
      {
        title: 'The Innovator\'s Dilemma',
        author: 'Clayton M. Christensen',
        description: 'イノベーションのジレンマを解説。',
        amazonUrl: 'https://www.amazon.com/',
        rakutenUrl: 'https://books.rakuten.co.jp/'
      },
      {
        title: '人を動かす',
        author: 'デール・カーネギー',
        description: '人間関係の原則を学べる定番書。',
        amazonUrl: 'https://www.amazon.co.jp/',
        rakutenUrl: 'https://books.rakuten.co.jp/'
      }
    ]);

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
