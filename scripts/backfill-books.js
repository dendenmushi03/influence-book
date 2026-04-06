const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Book = require('../models/Book');
const { hasMissingAutofillFields, buildBookAutofillPatch } = require('../lib/google-books');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';
const dryRun = process.argv.includes('--dry-run');

function isBlank(value) {
  return String(value || '').trim() === '';
}

function shouldProcessBook(book) {
  if (!book || !hasMissingAutofillFields(book)) {
    return false;
  }

  const hasLookupKey = !isBlank(book.googleBooksId) || !isBlank(book.isbn) || !isBlank(book.isbn10) || !isBlank(book.isbn13);
  if (hasLookupKey) {
    return true;
  }

  const normalizedTitle = String(book.title || '').trim();
  return normalizedTitle.length >= 2;
}

async function run() {
  let updatedCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[backfill] Connected to MongoDB (${dryRun ? 'dry-run' : 'apply'})`);

    const books = await Book.find({}).sort({ createdAt: 1 });
    console.log(`[backfill] Loaded ${books.length} books`);

    for (const book of books) {
      const label = `${book._id} ${book.title || '(no title)'}`;

      if (!shouldProcessBook(book)) {
        skippedCount += 1;
        console.log(`[skip] ${label} - no missing targets or insufficient key data`);
        continue;
      }

      try {
        const { patch, reason } = await buildBookAutofillPatch(book.toObject(), {
          respectExistingGoogleBooksId: false,
          minTitleLength: 2
        });

        if (!patch || Object.keys(patch).length === 0) {
          if (reason === 'no_candidate') {
            notFoundCount += 1;
            console.log(`[not-found] ${label} - no Google Books candidate`);
          } else {
            skippedCount += 1;
            console.log(`[skip] ${label} - ${reason}`);
          }
          continue;
        }

        if (dryRun) {
          console.log(`[dry-run:update] ${label}`, patch);
          updatedCount += 1;
          continue;
        }

        await Book.updateOne({ _id: book._id }, { $set: patch });
        console.log(`[update] ${label}`, patch);
        updatedCount += 1;
      } catch (bookError) {
        errorCount += 1;
        console.error(`[error] ${label} - ${bookError.message}`);
      }
    }

    console.log('--- backfill summary ---');
    console.log(`updated: ${updatedCount}`);
    console.log(`skipped: ${skippedCount}`);
    console.log(`notFound: ${notFoundCount}`);
    console.log(`errors: ${errorCount}`);
  } catch (error) {
    console.error('[fatal] backfill failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
