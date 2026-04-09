const { toInfluenceKind } = require('./influence-kind');
const { normalizePrimaryCategory } = require('./person-taxonomy');
const { validatePersonTemplate, toValidationMessage } = require('./person-draft-validation');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  const input = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (inQuotes && char === '"' && nextChar === '"') {
      value += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(value.trim());
      value = '';
      continue;
    }

    if (!inQuotes && char === '\n') {
      row.push(value.trim());
      value = '';
      const hasVisibleValue = row.some((cell) => cell !== '');
      if (hasVisibleValue) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.trim());
    const hasVisibleValue = row.some((cell) => cell !== '');
    if (hasVisibleValue) {
      rows.push(row);
    }
  }

  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((row, index) => {
    const data = {};
    headers.forEach((header, columnIndex) => {
      if (!header) {
        return;
      }
      data[header] = String(row[columnIndex] || '').trim();
    });
    return { rowNumber: index + 2, data };
  });
}

function toList(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value, defaultValue = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function toBoolean(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function importPeopleCsv({ csvText, Person, dryRun = true }) {
  const rows = rowsToObjects(parseCsv(csvText));
  const errors = [];
  const slugSeen = new Set();

  const existingPeople = await Person.find({}, { slug: 1 });
  const existingSlugSet = new Set(existingPeople.map((person) => person.slug));

  let successCount = 0;
  for (const row of rows) {
    const personData = {
      slug: row.data.slug,
      name: row.data.name || row.data.displayNameJa,
      displayNameJa: row.data.displayNameJa,
      occupation: row.data.occupation,
      occupationJa: row.data.occupationJa,
      occupationEn: row.data.occupationEn,
      category: normalizePrimaryCategory(row.data.category),
      countryCode: row.data.countryCode,
      countryJa: row.data.countryJa,
      countryEn: row.data.countryEn,
      popularity: toNumber(row.data.popularity, 0),
      tags: toList(row.data.tags),
      keywords: toList(row.data.keywords),
      intro: row.data.intro,
      summary: row.data.summary,
      career: row.data.career,
      bio: row.data.bio,
      imageUrl: row.data.imageUrl,
      featured: toBoolean(row.data.featured),
      coreMessage: row.data.coreMessage
    };

    if (!personData.slug || !personData.name) {
      errors.push({ rowNumber: row.rowNumber, message: 'slug と name (または displayNameJa) は必須です。' });
      continue;
    }

    if (slugSeen.has(personData.slug) || existingSlugSet.has(personData.slug)) {
      errors.push({ rowNumber: row.rowNumber, message: `slug "${personData.slug}" が重複しています。` });
      continue;
    }

    const validation = validatePersonTemplate(personData);
    if (!validation.ok) {
      errors.push({
        rowNumber: row.rowNumber,
        message: toValidationMessage(validation.missingFields)
      });
      continue;
    }

    slugSeen.add(personData.slug);
    successCount += 1;
    if (!dryRun) {
      await Person.create(personData);
    }
  }

  return {
    entity: 'people',
    dryRun,
    totalCount: rows.length,
    successCount,
    failedCount: errors.length,
    errors
  };
}

async function importBooksCsv({ csvText, Book, dryRun = true }) {
  const rows = rowsToObjects(parseCsv(csvText));
  const errors = [];
  const slugSeen = new Set();
  const isbnSeen = new Set();

  const existingBooks = await Book.find({}, { slug: 1, isbn: 1 });
  const existingSlugSet = new Set(existingBooks.map((book) => book.slug));
  const existingIsbnSet = new Set(existingBooks.map((book) => book.isbn).filter(Boolean));

  let successCount = 0;
  for (const row of rows) {
    const bookData = {
      title: row.data.title,
      slug: row.data.slug,
      author: row.data.author,
      description: row.data.description,
      coverUrl: row.data.coverUrl,
      amazonUrl: row.data.amazonUrl,
      rakutenUrl: row.data.rakutenUrl,
      googleBooksId: row.data.googleBooksId,
      isbn: row.data.isbn,
      isbn10: row.data.isbn10,
      isbn13: row.data.isbn13
    };

    if (!bookData.title || !bookData.slug) {
      errors.push({ rowNumber: row.rowNumber, message: 'title と slug は必須です。' });
      continue;
    }

    if (slugSeen.has(bookData.slug) || existingSlugSet.has(bookData.slug)) {
      errors.push({ rowNumber: row.rowNumber, message: `slug "${bookData.slug}" が重複しています。` });
      continue;
    }

    const isbn = bookData.isbn;
    if (isbn && (isbnSeen.has(isbn) || existingIsbnSet.has(isbn))) {
      errors.push({ rowNumber: row.rowNumber, message: `isbn "${isbn}" が重複しています。` });
      continue;
    }

    slugSeen.add(bookData.slug);
    if (isbn) {
      isbnSeen.add(isbn);
    }
    successCount += 1;

    if (!dryRun) {
      await Book.create(bookData);
    }
  }

  return {
    entity: 'books',
    dryRun,
    totalCount: rows.length,
    successCount,
    failedCount: errors.length,
    errors
  };
}

async function importInfluencesCsv({ csvText, Person, Book, Influence, dryRun = true }) {
  const rows = rowsToObjects(parseCsv(csvText));
  const errors = [];
  const keySeen = new Set();

  const [people, books, existingInfluences] = await Promise.all([
    Person.find({}, { slug: 1 }),
    Book.find({}, { slug: 1 }),
    Influence.find({}, { personId: 1, bookId: 1, kind: 1 })
  ]);

  const personBySlug = new Map(people.map((person) => [person.slug, person]));
  const bookBySlug = new Map(books.map((book) => [book.slug, book]));
  const existingKeySet = new Set(existingInfluences.map((item) => `${String(item.personId)}::${String(item.bookId)}::${item.kind}`));

  let successCount = 0;
  for (const row of rows) {
    const personSlug = row.data.personSlug;
    const bookSlug = row.data.bookSlug;
    const kind = toInfluenceKind(row.data.kind);

    const person = personBySlug.get(personSlug);
    if (!person) {
      errors.push({ rowNumber: row.rowNumber, message: `personSlug "${personSlug}" が見つかりません。` });
      continue;
    }

    const book = bookBySlug.get(bookSlug);
    if (!book) {
      errors.push({ rowNumber: row.rowNumber, message: `bookSlug "${bookSlug}" が見つかりません。` });
      continue;
    }

    const key = `${String(person._id)}::${String(book._id)}::${kind}`;
    if (keySeen.has(key) || existingKeySet.has(key)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `person + book + kind の組み合わせが重複しています (${personSlug}, ${bookSlug}, ${kind})。`
      });
      continue;
    }

    const influenceData = {
      personId: person._id,
      bookId: book._id,
      kind,
      impactSummary: row.data.impactSummary,
      sourceTitle: row.data.sourceTitle,
      sourceUrl: row.data.sourceUrl,
      sourceType: row.data.sourceType,
      featuredOrder: toNumber(row.data.featuredOrder, 0)
    };

    keySeen.add(key);
    successCount += 1;
    if (!dryRun) {
      await Influence.create(influenceData);
    }
  }

  return {
    entity: 'influences',
    dryRun,
    totalCount: rows.length,
    successCount,
    failedCount: errors.length,
    errors
  };
}

module.exports = {
  importPeopleCsv,
  importBooksCsv,
  importInfluencesCsv
};
