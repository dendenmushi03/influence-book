const OPENBD_BASE_URL = 'https://api.openbd.jp/v1/get';

function normalizeIsbn(rawValue) {
  const value = String(rawValue || '')
    .replace(/[\s-]/g, '')
    .toUpperCase();

  const isbn10Pattern = /^\d{9}[\dX]$/;
  const isbn13Pattern = /^\d{13}$/;
  if (isbn10Pattern.test(value) || isbn13Pattern.test(value)) {
    return value;
  }

  return '';
}

function pickOpenBdCoverUrl(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }

  const summary = record.summary && typeof record.summary === 'object' ? record.summary : {};
  const cover = String(summary.cover || '').trim();
  return cover;
}

async function fetchOpenBdCoverByIsbn(isbn) {
  const normalizedIsbn = normalizeIsbn(isbn);
  if (!normalizedIsbn) {
    return '';
  }

  const params = new URLSearchParams({ isbn: normalizedIsbn });
  const response = await fetch(`${OPENBD_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`OpenBD API request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    return '';
  }

  return pickOpenBdCoverUrl(payload[0]);
}

async function findOpenBdCoverForBook(book) {
  if (!book || typeof book !== 'object') {
    return '';
  }

  const isbnCandidates = [book.isbn13, book.isbn10, book.isbn];
  for (const isbn of isbnCandidates) {
    const normalized = normalizeIsbn(isbn);
    if (!normalized) {
      continue;
    }

    const coverUrl = await fetchOpenBdCoverByIsbn(normalized);
    if (coverUrl) {
      return coverUrl;
    }
  }

  return '';
}

module.exports = {
  fetchOpenBdCoverByIsbn,
  findOpenBdCoverForBook
};
