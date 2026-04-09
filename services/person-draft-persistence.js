function isBlank(value) {
  return String(value || '').trim() === '';
}

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeKind(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'influence' || normalized === 'about' || normalized === 'authored') {
    return normalized;
  }

  const error = new Error(`不正な kind が指定されました: ${normalized || '(empty)'}`);
  error.code = 'invalid_influence_kind';
  throw error;
}

function buildNonEmptyPatch(patch = {}) {
  const result = {};
  ['coreMessage', 'bio', 'career', 'intro'].forEach((key) => {
    const value = patch[key];
    if (!isBlank(value)) {
      result[key] = String(value).trim();
    }
  });
  return result;
}

async function resolveExistingBook(Book, candidate = {}) {
  const slug = String(candidate.slug || '').trim();
  if (slug) {
    const bySlug = await Book.findOne({ slug });
    if (bySlug) {
      return { book: bySlug, status: 'reused' };
    }
  }

  const isbnCandidates = [candidate.isbn, candidate.isbn13, candidate.isbn10]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (isbnCandidates.length > 0) {
    const byIsbn = await Book.findOne({
      $or: [
        { isbn: { $in: isbnCandidates } },
        { isbn13: { $in: isbnCandidates } },
        { isbn10: { $in: isbnCandidates } }
      ]
    });

    if (byIsbn) {
      return { book: byIsbn, status: 'reused' };
    }
  }

  const created = await Book.create({
    title: String(candidate.title || '').trim(),
    slug,
    author: String(candidate.author || '').trim(),
    description: String(candidate.description || '').trim(),
    coverUrl: String(candidate.coverUrl || '').trim(),
    amazonUrl: String(candidate.amazonUrl || '').trim(),
    rakutenUrl: String(candidate.rakutenUrl || '').trim(),
    googleBooksId: String(candidate.googleBooksId || '').trim(),
    isbn: String(candidate.isbn || '').trim(),
    isbn10: String(candidate.isbn10 || '').trim(),
    isbn13: String(candidate.isbn13 || '').trim()
  });

  return { book: created, status: 'created' };
}

async function persistPersonDraft({ Person, Book, Influence, personId, draft }) {
  const person = await Person.findById(personId);
  if (!person) {
    throw new Error('対象の人物が見つかりません。');
  }

  const personPatch = buildNonEmptyPatch(draft.personPatch || {});
  Object.entries(personPatch).forEach(([key, value]) => {
    person[key] = value;
  });
  await person.save();

  const bookResolutions = [];
  const bookIdBySlug = new Map();
  const books = Array.isArray(draft.books) ? draft.books : [];

  for (const candidate of books) {
    const normalizedTitle = String(candidate.title || '').trim();
    const normalizedSlug = String(candidate.slug || '').trim();
    if (!normalizedTitle || !normalizedSlug) {
      continue;
    }

    const resolution = await resolveExistingBook(Book, candidate);
    bookResolutions.push({
      slug: normalizedSlug,
      bookId: String(resolution.book._id),
      status: resolution.status
    });
    bookIdBySlug.set(normalizedSlug, resolution.book._id);
  }

  const influenceResults = [];
  const influences = Array.isArray(draft.influences) ? draft.influences : [];
  for (const candidate of influences) {
    const bookSlug = String(candidate.bookSlug || '').trim();
    const resolvedBookId = bookIdBySlug.get(bookSlug);
    if (!resolvedBookId) {
      continue;
    }

    const kind = normalizeKind(candidate.kind);
    const exists = await Influence.findOne({
      personId: person._id,
      bookId: resolvedBookId,
      kind
    });

    if (exists) {
      influenceResults.push({ status: 'reused', bookSlug, kind, influenceId: String(exists._id) });
      continue;
    }

    const created = await Influence.create({
      personId: person._id,
      bookId: resolvedBookId,
      kind,
      impactSummary: String(candidate.impactSummary || '').trim(),
      sourceTitle: String(candidate.sourceTitle || '').trim(),
      sourceUrl: String(candidate.sourceUrl || '').trim(),
      sourceType: String(candidate.sourceType || '').trim(),
      featuredOrder: toInteger(candidate.featuredOrder, 0)
    });

    influenceResults.push({ status: 'created', bookSlug, kind, influenceId: String(created._id) });
  }

  return {
    personUpdatedFields: Object.keys(personPatch),
    booksCreated: bookResolutions.filter((item) => item.status === 'created').length,
    booksReused: bookResolutions.filter((item) => item.status === 'reused').length,
    influencesCreated: influenceResults.filter((item) => item.status === 'created').length,
    influencesReused: influenceResults.filter((item) => item.status === 'reused').length
  };
}

module.exports = {
  buildNonEmptyPatch,
  normalizeKind,
  persistPersonDraft
};
