const { normalizeIsbn } = require('./google-books');

function isBlank(value) {
  return String(value || '').trim() === '';
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '');
}

function normalizeLooseText(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUndefinedIfBlank(value) {
  const trimmed = String(value || '').trim();
  return trimmed === '' ? undefined : trimmed;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bookFieldsFromInput(input, slugify) {
  const title = String(input.title || '').trim();
  const slug = String(input.slug || '').trim() || slugify(title);

  return {
    title,
    slug,
    author: toUndefinedIfBlank(input.author),
    isbn: toUndefinedIfBlank(normalizeIsbn(input.isbn)),
    googleBooksId: toUndefinedIfBlank(input.googleBooksId),
    isbn10: toUndefinedIfBlank(normalizeIsbn(input.isbn10)),
    isbn13: toUndefinedIfBlank(normalizeIsbn(input.isbn13)),
    coverUrl: toUndefinedIfBlank(input.coverUrl),
    description: toUndefinedIfBlank(input.description),
    amazonUrl: toUndefinedIfBlank(input.amazonUrl),
    rakutenUrl: toUndefinedIfBlank(input.rakutenUrl)
  };
}

async function withInfluenceInfo(books, Influence) {
  if (!books || books.length === 0) {
    return [];
  }

  if (!Influence) {
    return books.map((book) => ({ book, influenceCount: 0 }));
  }

  const counts = await Influence.aggregate([
    { $match: { bookId: { $in: books.map((book) => book._id) } } },
    { $group: { _id: '$bookId', count: { $sum: 1 } } }
  ]);

  const countMap = new Map(counts.map((item) => [String(item._id), item.count]));
  return books.map((book) => ({
    book,
    influenceCount: countMap.get(String(book._id)) || 0
  }));
}

function isSameOrSimilarTitleAuthor(existingBook, incomingBook) {
  const existingTitle = normalizeText(existingBook.title);
  const incomingTitle = normalizeText(incomingBook.title);
  if (!existingTitle || !incomingTitle) {
    return false;
  }

  const existingAuthor = normalizeText(existingBook.author);
  const incomingAuthor = normalizeText(incomingBook.author);

  const exactTitle = existingTitle === incomingTitle;
  const nearTitle = existingTitle.includes(incomingTitle) || incomingTitle.includes(existingTitle);

  const exactAuthor = !existingAuthor || !incomingAuthor || existingAuthor === incomingAuthor;
  const nearAuthor =
    !existingAuthor ||
    !incomingAuthor ||
    existingAuthor.includes(incomingAuthor) ||
    incomingAuthor.includes(existingAuthor);

  return (exactTitle && nearAuthor) || (nearTitle && exactAuthor);
}

async function findDuplicateBookMatches(Book, inputBook, options = {}) {
  const { Influence = null } = options;
  const booksById = new Map();
  const reasonMetaById = new Map();

  async function addMatches(query, reason, matchedOn = null) {
    const matches = await Book.find(query).sort({ createdAt: 1 }).limit(20);
    matches.forEach((book) => {
      const key = String(book._id);
      if (!booksById.has(key)) {
        booksById.set(key, book);
        reasonMetaById.set(key, { reason, matchedOn });
      }
    });
  }

  if (!isBlank(inputBook.googleBooksId)) {
    await addMatches({ googleBooksId: inputBook.googleBooksId }, 'googleBooksId', {
      incomingField: 'googleBooksId',
      existingField: 'googleBooksId'
    });
  }

  if (!isBlank(inputBook.isbn13)) {
    await addMatches({ isbn13: inputBook.isbn13 }, 'isbn13', {
      incomingField: 'isbn13',
      existingField: 'isbn13'
    });
  }

  if (!isBlank(inputBook.isbn10)) {
    await addMatches({ isbn10: inputBook.isbn10 }, 'isbn10', {
      incomingField: 'isbn10',
      existingField: 'isbn10'
    });
  }

  if (!isBlank(inputBook.isbn)) {
    await addMatches({ isbn: inputBook.isbn }, 'isbn', {
      incomingField: 'isbn',
      existingField: 'isbn'
    });
  }

  if (!isBlank(inputBook.slug)) {
    await addMatches({ slug: inputBook.slug }, 'slug', {
      incomingField: 'slug',
      existingField: 'slug'
    });
  }

  const looseTitle = normalizeLooseText(inputBook.title);
  if (looseTitle) {
    const titleHeadTokens = looseTitle.split(' ').slice(0, 3);
    const regex = new RegExp(titleHeadTokens.map(escapeRegex).join('.*'), 'i');
    const maybeMatches = await Book.find({ title: regex }).sort({ createdAt: 1 }).limit(50);
    maybeMatches.forEach((book) => {
      if (!isSameOrSimilarTitleAuthor(book, inputBook)) {
        return;
      }

      const key = String(book._id);
      if (!booksById.has(key)) {
        booksById.set(key, book);
        reasonMetaById.set(key, {
          reason: 'title_author',
          matchedOn: { incomingField: 'title+author', existingField: 'title+author' }
        });
      }
    });
  }

  const books = Array.from(booksById.values());
  const booksWithInfluence = await withInfluenceInfo(books, Influence);

  const priorityOrder = {
    googleBooksId: 1,
    isbn13: 2,
    isbn10: 3,
    isbn: 4,
    slug: 5,
    title_author: 6
  };

  return booksWithInfluence
    .map(({ book, influenceCount }) => {
      const meta = reasonMetaById.get(String(book._id)) || { reason: 'title_author', matchedOn: null };
      const reason = meta.reason || 'title_author';
      return { book, reason, matchedOn: meta.matchedOn || null, influenceCount, priority: priorityOrder[reason] || 99 };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      if ((a.influenceCount > 0) !== (b.influenceCount > 0)) {
        return a.influenceCount > 0 ? -1 : 1;
      }
      return new Date(a.book.createdAt).getTime() - new Date(b.book.createdAt).getTime();
    });
}

function buildFillBlankPatch(existingBook, incomingBook) {
  const patch = {};
  const fillableFields = [
    'title',
    'slug',
    'author',
    'isbn',
    'googleBooksId',
    'isbn10',
    'isbn13',
    'coverUrl',
    'description',
    'amazonUrl',
    'rakutenUrl'
  ];

  fillableFields.forEach((field) => {
    if (isBlank(existingBook[field]) && !isBlank(incomingBook[field])) {
      patch[field] = incomingBook[field];
    }
  });

  return patch;
}

module.exports = {
  isBlank,
  normalizeText,
  bookFieldsFromInput,
  isSameOrSimilarTitleAuthor,
  findDuplicateBookMatches,
  buildFillBlankPatch
};
