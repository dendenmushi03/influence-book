const { searchGoogleBooks, normalizeIsbn, buildBookAutofillPatch } = require('./google-books');
const { bookFieldsFromInput, findDuplicateBookMatches, buildFillBlankPatch } = require('./book-dedup');

function isBlank(value) {
  return String(value || '').trim() === '';
}

function normalizeInput(input = {}) {
  const bookQuery = String(input.bookQuery || '').trim();
  const author = String(input.author || '').trim();
  const title = String(input.title || '').trim() || (normalizeIsbn(bookQuery) ? '' : bookQuery);
  const normalizedQueryIsbn = normalizeIsbn(bookQuery);

  return {
    bookQuery,
    author,
    title,
    googleBooksId: String(input.googleBooksId || '').trim(),
    isbn: normalizeIsbn(input.isbn) || normalizedQueryIsbn,
    isbn10: normalizeIsbn(input.isbn10),
    isbn13: normalizeIsbn(input.isbn13)
  };
}

function mergeIncomingBook(base, candidate, slugify) {
  return bookFieldsFromInput(
    {
      ...base,
      title: base.title || candidate.title,
      author: base.author || candidate.author || candidate.authors,
      description: candidate.description,
      coverUrl: candidate.coverUrl,
      googleBooksId: base.googleBooksId || candidate.googleBooksId,
      isbn10: base.isbn10 || candidate.isbn10,
      isbn13: base.isbn13 || candidate.isbn13,
      isbn: base.isbn || candidate.isbn13 || candidate.isbn10
    },
    slugify
  );
}

async function applyFillBlankPatch({ Book, existingBook, incomingBook, dryRun = false }) {
  const fillBlankPatch = buildFillBlankPatch(existingBook.toObject(), incomingBook);
  let autoPatch = {};

  try {
    const merged = { ...existingBook.toObject(), ...fillBlankPatch };
    const autoFillResult = await buildBookAutofillPatch(merged, { respectExistingGoogleBooksId: true });
    autoPatch = autoFillResult.patch || {};
  } catch (error) {
    console.warn('Skipped Google Books auto-fill while resolving influence book:', error.message);
  }

  const patch = { ...fillBlankPatch, ...autoPatch };
  if (!dryRun && Object.keys(patch).length > 0) {
    await Book.updateOne({ _id: existingBook._id }, { $set: patch });
  }

  return patch;
}

async function resolveBookForInfluence({ Book, Influence, input, slugify, dryRun = false }) {
  const normalizedInput = normalizeInput(input);
  const baseIncomingBook = bookFieldsFromInput(
    {
      title: normalizedInput.title,
      author: normalizedInput.author,
      googleBooksId: normalizedInput.googleBooksId,
      isbn: normalizedInput.isbn,
      isbn10: normalizedInput.isbn10,
      isbn13: normalizedInput.isbn13
    },
    slugify
  );

  const initialMatches = await findDuplicateBookMatches(Book, baseIncomingBook, { Influence });
  if (initialMatches.length > 0) {
    const bestMatch = initialMatches[0];
    const patch = await applyFillBlankPatch({
      Book,
      existingBook: bestMatch.book,
      incomingBook: baseIncomingBook,
      dryRun
    });

    return {
      ok: true,
      action: 'use_existing',
      reason: bestMatch.reason,
      book: bestMatch.book,
      patch,
      candidates: initialMatches.slice(0, 5)
    };
  }

  const googleQuery =
    normalizedInput.bookQuery || normalizedInput.googleBooksId || normalizedInput.isbn || normalizedInput.title;

  let googleCandidate = null;
  if (!isBlank(googleQuery)) {
    try {
      googleCandidate = await searchGoogleBooks(googleQuery);
    } catch (error) {
      console.warn('Google Books lookup failed while resolving influence book:', error.message);
    }
  }

  if (!googleCandidate) {
    return {
      ok: false,
      action: 'not_found',
      error: 'google_books_not_found',
      message: '既存 Book が見つからず、Google Books からも候補を取得できませんでした。'
    };
  }

  const enrichedIncomingBook = mergeIncomingBook(baseIncomingBook, googleCandidate, slugify);

  const enrichedMatches = await findDuplicateBookMatches(Book, enrichedIncomingBook, { Influence });
  if (enrichedMatches.length > 0) {
    const bestMatch = enrichedMatches[0];
    const patch = await applyFillBlankPatch({
      Book,
      existingBook: bestMatch.book,
      incomingBook: enrichedIncomingBook,
      dryRun
    });

    return {
      ok: true,
      action: 'use_existing',
      reason: bestMatch.reason,
      book: bestMatch.book,
      patch,
      candidates: enrichedMatches.slice(0, 5)
    };
  }

  if (dryRun) {
    return {
      ok: true,
      action: 'create_new',
      reason: 'google_books_candidate',
      book: enrichedIncomingBook,
      candidate: googleCandidate
    };
  }

  const createdBook = await Book.create(enrichedIncomingBook);
  return {
    ok: true,
    action: 'create_new',
    reason: 'google_books_candidate',
    book: createdBook,
    candidate: googleCandidate
  };
}

module.exports = {
  normalizeInput,
  resolveBookForInfluence
};
