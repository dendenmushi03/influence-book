const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Book = require('../models/Book');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';
const IDENTIFIER_FIELDS = ['isbn', 'isbn10', 'isbn13', 'googleBooksId'];
const LIST_LIMIT = Number(process.env.LIST_LIMIT || 100);

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[empty-identifiers] Connected to MongoDB');

    const perFieldCounts = await Promise.all(
      IDENTIFIER_FIELDS.map(async (field) => ({ field, count: await Book.countDocuments({ [field]: '' }) }))
    );

    perFieldCounts.forEach(({ field, count }) => {
      console.log(`[empty-identifiers] ${field}: ${count}`);
    });

    const emptyIdentifierQuery = { $or: IDENTIFIER_FIELDS.map((field) => ({ [field]: '' })) };
    const totalAffected = await Book.countDocuments(emptyIdentifierQuery);
    console.log(`[empty-identifiers] affected books: ${totalAffected}`);

    if (totalAffected === 0) {
      return;
    }

    const rows = await Book.find(emptyIdentifierQuery)
      .sort({ createdAt: 1 })
      .limit(LIST_LIMIT)
      .select('_id title slug author isbn isbn10 isbn13 googleBooksId createdAt')
      .lean();

    console.log(`[empty-identifiers] showing up to ${LIST_LIMIT} records:`);
    rows.forEach((book) => {
      const emptyFields = IDENTIFIER_FIELDS.filter((field) => book[field] === '').join(',');
      console.log(
        `- ${book._id} | ${book.title || '(no title)'} | slug=${book.slug || '-'} | empty=[${emptyFields}] | /admin/books/${book._id}/edit`
      );
    });
  } catch (error) {
    console.error('[empty-identifiers] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
