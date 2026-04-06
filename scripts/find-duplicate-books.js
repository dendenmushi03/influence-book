const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const { normalizeText } = require('../lib/book-dedup');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';

function groupByNonEmpty(books, keyBuilder) {
  const groups = new Map();
  books.forEach((book) => {
    const key = keyBuilder(book);
    if (!key) {
      return;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(book);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => ({ key, items }))
    .filter((group) => group.items.length > 1);
}

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[duplicates] Connected to MongoDB');

    const books = await Book.find({}).sort({ createdAt: 1 }).lean();
    const counts = await Influence.aggregate([
      { $group: { _id: '$bookId', count: { $sum: 1 } } }
    ]);
    const influenceCountMap = new Map(counts.map((item) => [String(item._id), item.count]));

    const googleBooksIdGroups = groupByNonEmpty(books, (book) => String(book.googleBooksId || '').trim());
    const isbn13Groups = groupByNonEmpty(books, (book) => String(book.isbn13 || '').trim());
    const slugGroups = groupByNonEmpty(books, (book) => String(book.slug || '').trim());
    const titleAuthorGroups = groupByNonEmpty(books, (book) => {
      const title = normalizeText(book.title);
      const author = normalizeText(book.author);
      return title ? `${title}::${author}` : '';
    });

    const sections = [
      { label: 'googleBooksId', groups: googleBooksIdGroups },
      { label: 'isbn13', groups: isbn13Groups },
      { label: 'slug', groups: slugGroups },
      { label: 'title+author', groups: titleAuthorGroups }
    ];

    sections.forEach((section) => {
      console.log(`\n=== ${section.label} duplicates: ${section.groups.length} groups ===`);
      section.groups.forEach((group) => {
        console.log(`- key: ${group.key}`);
        group.items.forEach((book) => {
          const influenceCount = influenceCountMap.get(String(book._id)) || 0;
          console.log(
            `  - ${book._id} | ${book.title || '(no title)'} | ${book.author || '(no author)'} | influences:${influenceCount} | /admin/books/${book._id}/edit`
          );
        });
      });
    });
  } catch (error) {
    console.error('[duplicates] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
