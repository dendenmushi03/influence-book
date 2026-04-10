const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Book = require('../models/Book');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';
const IDENTIFIER_FIELDS = ['isbn', 'isbn10', 'isbn13', 'googleBooksId'];

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[cleanup-empty-identifiers] Connected to MongoDB');

    let totalMatched = 0;
    let totalModified = 0;

    for (const field of IDENTIFIER_FIELDS) {
      const result = await Book.updateMany({ [field]: '' }, { $unset: { [field]: 1 } });
      totalMatched += result.matchedCount || 0;
      totalModified += result.modifiedCount || 0;
      console.log(
        `[cleanup-empty-identifiers] ${field}: matched=${result.matchedCount || 0}, modified=${result.modifiedCount || 0}`
      );
    }

    console.log(`[cleanup-empty-identifiers] done: matched=${totalMatched}, modified=${totalModified}`);
  } catch (error) {
    console.error('[cleanup-empty-identifiers] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
