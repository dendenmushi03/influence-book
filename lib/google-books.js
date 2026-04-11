const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1/volumes';
const { findOpenBdCoverForBook } = require('./openbd');

function isBlank(value) {
  return String(value || '').trim() === '';
}

function normalizeIsbn(rawValue) {
  const value = String(rawValue || '')
    .replace(/[\s-]/g, '')
    .toUpperCase();

  if (!value) {
    return '';
  }

  const isbn10Pattern = /^\d{9}[\dX]$/;
  const isbn13Pattern = /^\d{13}$/;
  if (isbn10Pattern.test(value) || isbn13Pattern.test(value)) {
    return value;
  }

  return '';
}

function selectCoverUrl(imageLinks) {
  if (!imageLinks) {
    return '';
  }

  const priorityKeys = ['extraLarge', 'large', 'medium', 'small', 'thumbnail', 'smallThumbnail'];
  for (const key of priorityKeys) {
    if (imageLinks[key]) {
      return String(imageLinks[key]).replace(/^http:\/\//, 'https://');
    }
  }

  return '';
}

function extractIsbnFromIdentifiers(identifiers) {
  const result = { isbn10: '', isbn13: '' };
  if (!Array.isArray(identifiers)) {
    return result;
  }

  identifiers.forEach((identifier) => {
    if (!identifier || !identifier.type || !identifier.identifier) {
      return;
    }

    const normalized = String(identifier.identifier).replace(/[\s-]/g, '').toUpperCase();
    if (identifier.type === 'ISBN_10') {
      result.isbn10 = normalized;
    }
    if (identifier.type === 'ISBN_13') {
      result.isbn13 = normalized;
    }
  });

  return result;
}

function mapGoogleBooksItemToBookFields(item) {
  const volumeInfo = (item && item.volumeInfo) || {};
  const { isbn10, isbn13 } = extractIsbnFromIdentifiers(volumeInfo.industryIdentifiers);

  return {
    title: volumeInfo.title || '',
    author: Array.isArray(volumeInfo.authors) ? volumeInfo.authors.join(', ') : '',
    authors: Array.isArray(volumeInfo.authors) ? volumeInfo.authors.join(', ') : '',
    description: volumeInfo.description || '',
    coverUrl: selectCoverUrl(volumeInfo.imageLinks),
    googleBooksId: item && item.id ? String(item.id) : '',
    isbn10,
    isbn13,
    coverImages: volumeInfo.imageLinks || {}
  };
}

function createGoogleBooksParams(query, maxResults) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    printType: 'books',
    orderBy: 'relevance'
  });

  if (process.env.GOOGLE_BOOKS_API_KEY) {
    params.set('key', process.env.GOOGLE_BOOKS_API_KEY);
  }

  return params;
}

async function fetchGoogleBooksVolumes(query, maxResults = 5) {
  const params = createGoogleBooksParams(query, maxResults);
  const response = await fetch(`${GOOGLE_BOOKS_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Google Books API request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

async function fetchGoogleBooksVolumeById(googleBooksId) {
  if (isBlank(googleBooksId)) {
    return null;
  }

  const params = new URLSearchParams();
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    params.set('key', process.env.GOOGLE_BOOKS_API_KEY);
  }

  const response = await fetch(`${GOOGLE_BOOKS_BASE_URL}/${encodeURIComponent(googleBooksId)}?${params.toString()}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Google Books volume API request failed with status ${response.status}`);
  }

  const item = await response.json();
  return item && item.id ? mapGoogleBooksItemToBookFields(item) : null;
}

function buildSearchQuery({ title, author, isbn }) {
  const normalizedIsbn = normalizeIsbn(isbn);
  if (normalizedIsbn) {
    return { query: `isbn:${normalizedIsbn}`, mode: 'isbn', normalizedIsbn };
  }

  const normalizedTitle = String(title || '').trim();
  if (normalizedTitle.length < 2) {
    return { query: '', mode: 'none', normalizedIsbn: '' };
  }

  const normalizedAuthor = String(author || '').trim();
  if (normalizedAuthor) {
    return { query: `intitle:${normalizedTitle} inauthor:${normalizedAuthor}`, mode: 'title', normalizedIsbn: '' };
  }

  return { query: normalizedTitle, mode: 'title', normalizedIsbn: '' };
}

function chooseBestItem(items, normalizedIsbn) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  if (!normalizedIsbn) {
    return items[0];
  }

  const exactMatch = items.find((item) => {
    const volumeInfo = (item && item.volumeInfo) || {};
    const { isbn10, isbn13 } = extractIsbnFromIdentifiers(volumeInfo.industryIdentifiers);
    return isbn10 === normalizedIsbn || isbn13 === normalizedIsbn;
  });

  return exactMatch || items[0];
}

async function searchGoogleBooks(query) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return null;
  }

  const normalizedIsbn = normalizeIsbn(normalizedQuery);
  const apiQuery = normalizedIsbn ? `isbn:${normalizedIsbn}` : normalizedQuery;
  const items = await fetchGoogleBooksVolumes(apiQuery, 5);
  const bestItem = chooseBestItem(items, normalizedIsbn);
  return bestItem ? mapGoogleBooksItemToBookFields(bestItem) : null;
}

function buildAutofillPatch(currentBook, candidate) {
  if (!candidate) {
    return {};
  }

  const patch = {};
  const fillableFields = ['author', 'description', 'coverUrl', 'googleBooksId', 'isbn10', 'isbn13'];

  fillableFields.forEach((field) => {
    if (isBlank(currentBook[field]) && !isBlank(candidate[field])) {
      patch[field] = candidate[field];
    }
  });

  return patch;
}

function getPrimaryIsbn(book) {
  return normalizeIsbn(book.isbn13) || normalizeIsbn(book.isbn10) || normalizeIsbn(book.isbn);
}

function hasMissingAutofillFields(book) {
  return ['author', 'description', 'coverUrl', 'googleBooksId', 'isbn10', 'isbn13'].some((field) => isBlank(book[field]));
}

async function buildBookAutofillPatch(book, options = {}) {
  const {
    respectExistingGoogleBooksId = true,
    minTitleLength = 2
  } = options;

  if (!book || !hasMissingAutofillFields(book)) {
    return { patch: {}, reason: 'no_missing_fields' };
  }

  if (respectExistingGoogleBooksId && !isBlank(book.googleBooksId)) {
    return { patch: {}, reason: 'already_has_google_books_id' };
  }

  let candidate = null;
  if (!isBlank(book.googleBooksId) && !respectExistingGoogleBooksId) {
    candidate = await fetchGoogleBooksVolumeById(book.googleBooksId);
  }

  if (!candidate) {
    const primaryIsbn = getPrimaryIsbn(book);
    const normalizedTitle = String(book.title || '').trim();

    if (!primaryIsbn && normalizedTitle.length < minTitleLength) {
      return { patch: {}, reason: 'title_too_short' };
    }

    const { query, normalizedIsbn } = buildSearchQuery({
      title: normalizedTitle,
      author: book.author,
      isbn: primaryIsbn
    });

    if (!query) {
      return { patch: {}, reason: 'no_query' };
    }

    const items = await fetchGoogleBooksVolumes(query, 5);
    const bestItem = chooseBestItem(items, normalizedIsbn);
    if (!bestItem) {
      return { patch: {}, reason: 'no_candidate' };
    }

    candidate = mapGoogleBooksItemToBookFields(bestItem);
  }

  const patch = buildAutofillPatch(book, candidate);
  if (isBlank(patch.coverUrl) && isBlank(book.coverUrl)) {
    try {
      const openBdCoverUrl = await findOpenBdCoverForBook({
        isbn13: patch.isbn13 || book.isbn13,
        isbn10: patch.isbn10 || book.isbn10,
        isbn: book.isbn
      });
      if (!isBlank(openBdCoverUrl)) {
        patch.coverUrl = openBdCoverUrl;
      }
    } catch (openBdError) {
      console.warn('OpenBD cover fallback skipped:', openBdError.message);
    }
  }

  return { patch, reason: candidate ? 'ok' : 'no_candidate' };
}

module.exports = {
  normalizeIsbn,
  selectCoverUrl,
  extractIsbnFromIdentifiers,
  mapGoogleBooksItemToBookFields,
  searchGoogleBooks,
  hasMissingAutofillFields,
  buildBookAutofillPatch
};
