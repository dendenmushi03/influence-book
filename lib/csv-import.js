const { INFLUENCE_KIND_VALUES } = require('./influence-kind');
const { normalizePrimaryCategory } = require('./person-taxonomy');
const { validatePersonTemplate, toValidationMessage } = require('./person-draft-validation');

const PEOPLE_ALLOWED_HEADERS = [
  'slug',
  'name',
  'displayNameJa',
  'occupation',
  'occupationJa',
  'occupationEn',
  'category',
  'countryCode',
  'countryJa',
  'countryEn',
  'popularity',
  'tags',
  'keywords',
  'intro',
  'summary',
  'career',
  'bio',
  'imageUrl',
  'featured',
  'coreMessage'
];

const BOOK_ALLOWED_HEADERS = [
  'title',
  'slug',
  'author',
  'description',
  'coverUrl',
  'amazonUrl',
  'rakutenUrl',
  'googleBooksId',
  'isbn',
  'isbn10',
  'isbn13'
];

const INFLUENCE_ALLOWED_HEADERS = [
  'personSlug',
  'bookSlug',
  'kind',
  'impactSummary',
  'sourceTitle',
  'sourceUrl',
  'sourceType',
  'featuredOrder'
];

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

function isValidSlug(slug) {
  const normalized = String(slug || '').trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) && normalized.length >= 3;
}

function buildResult({ entity, dryRun, totalCount, successCount, failedCount, skippedCount = 0, errors = [], skipped = [], fatal = false }) {
  return {
    entity,
    dryRun,
    totalCount,
    successCount,
    failedCount,
    skippedCount,
    fatal,
    errors,
    skipped
  };
}

function validateCsvShape({ rows, entity, allowedHeaders, requiredHeaders }) {
  if (!rows.length) {
    return { ok: false, errors: [{ rowNumber: 1, message: 'CSVが空です。ヘッダー行を含めて入力してください。' }] };
  }

  const headers = rows[0].map((header) => String(header || '').trim());
  const headerSet = new Set(headers);

  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) {
    return {
      ok: false,
      errors: [{ rowNumber: 1, message: `ヘッダーが重複しています: ${Array.from(new Set(duplicateHeaders)).join(', ')}` }]
    };
  }

  const unknownHeaders = headers.filter((header) => header && !allowedHeaders.includes(header));
  if (unknownHeaders.length > 0) {
    return {
      ok: false,
      errors: [{ rowNumber: 1, message: `${entity} CSVとして未対応のヘッダーがあります: ${unknownHeaders.join(', ')}` }]
    };
  }

  const missingHeaders = requiredHeaders.filter((header) => !headerSet.has(header));
  if (missingHeaders.length > 0) {
    return {
      ok: false,
      errors: [{ rowNumber: 1, message: `必須ヘッダーが不足しています: ${missingHeaders.join(', ')}` }]
    };
  }

  const expectedColumnCount = headers.length;
  const columnErrors = [];
  rows.slice(1).forEach((row, index) => {
    if (row.length !== expectedColumnCount) {
      columnErrors.push({
        rowNumber: index + 2,
        message: `列数不一致を検知しました。期待列数=${expectedColumnCount}, 実際=${row.length}。ヘッダー名誤り/列ずれの可能性があります。`
      });
    }
  });

  if (columnErrors.length > 0) {
    return { ok: false, errors: columnErrors };
  }

  return { ok: true, headers };
}

function rowsToObjects(rows) {
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

async function importPeopleCsv({ csvText, Person, dryRun = true }) {
  const rawRows = parseCsv(csvText);
  const shapeValidation = validateCsvShape({
    rows: rawRows,
    entity: 'people',
    allowedHeaders: PEOPLE_ALLOWED_HEADERS,
    requiredHeaders: ['slug', 'displayNameJa', 'occupationJa', 'category', 'intro', 'career', 'imageUrl', 'countryJa']
  });

  if (!shapeValidation.ok) {
    return buildResult({
      entity: 'people',
      dryRun,
      totalCount: Math.max(rawRows.length - 1, 0),
      successCount: 0,
      failedCount: shapeValidation.errors.length,
      skippedCount: Math.max(rawRows.length - 1, 0),
      errors: shapeValidation.errors,
      fatal: true
    });
  }

  const rows = rowsToObjects(rawRows);
  const errors = [];
  const skipped = [];
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

    if (!isValidSlug(personData.slug)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `slug "${personData.slug}" は不正です。英小文字・数字・ハイフンのみ、3文字以上で指定してください。`
      });
      continue;
    }

    if (slugSeen.has(personData.slug) || existingSlugSet.has(personData.slug)) {
      skipped.push({ rowNumber: row.rowNumber, message: `slug "${personData.slug}" は既存またはCSV内で重複しているためスキップしました。` });
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

  return buildResult({
    entity: 'people',
    dryRun,
    totalCount: rows.length,
    successCount,
    failedCount: errors.length,
    skippedCount: skipped.length,
    errors,
    skipped
  });
}

async function importBooksCsv({ csvText, Book, dryRun = true }) {
  const rawRows = parseCsv(csvText);
  const shapeValidation = validateCsvShape({
    rows: rawRows,
    entity: 'books',
    allowedHeaders: BOOK_ALLOWED_HEADERS,
    requiredHeaders: ['title', 'slug', 'isbn']
  });

  if (!shapeValidation.ok) {
    return buildResult({
      entity: 'books',
      dryRun,
      totalCount: Math.max(rawRows.length - 1, 0),
      successCount: 0,
      failedCount: shapeValidation.errors.length,
      skippedCount: Math.max(rawRows.length - 1, 0),
      errors: shapeValidation.errors,
      fatal: true
    });
  }

  const rows = rowsToObjects(rawRows);
  const errors = [];
  const skipped = [];
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

    if (!bookData.title || !bookData.slug || !bookData.isbn) {
      errors.push({ rowNumber: row.rowNumber, message: 'title と slug と isbn は必須です。' });
      continue;
    }

    if (!isValidSlug(bookData.slug)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `slug "${bookData.slug}" は不正です。英小文字・数字・ハイフンのみ、3文字以上で指定してください。`
      });
      continue;
    }

    if (slugSeen.has(bookData.slug) || existingSlugSet.has(bookData.slug)) {
      skipped.push({ rowNumber: row.rowNumber, message: `slug "${bookData.slug}" は既存またはCSV内で重複しているためスキップしました。` });
      continue;
    }

    if (isbnSeen.has(bookData.isbn) || existingIsbnSet.has(bookData.isbn)) {
      skipped.push({ rowNumber: row.rowNumber, message: `isbn "${bookData.isbn}" は既存またはCSV内で重複しているためスキップしました。` });
      continue;
    }

    slugSeen.add(bookData.slug);
    isbnSeen.add(bookData.isbn);
    successCount += 1;

    if (!dryRun) {
      await Book.create(bookData);
    }
  }

  return buildResult({
    entity: 'books',
    dryRun,
    totalCount: rows.length,
    successCount,
    failedCount: errors.length,
    skippedCount: skipped.length,
    errors,
    skipped
  });
}

async function importInfluencesCsv({ csvText, Person, Book, Influence, dryRun = true }) {
  const rawRows = parseCsv(csvText);
  const shapeValidation = validateCsvShape({
    rows: rawRows,
    entity: 'influences',
    allowedHeaders: INFLUENCE_ALLOWED_HEADERS,
    requiredHeaders: ['personSlug', 'bookSlug', 'kind']
  });

  if (!shapeValidation.ok) {
    return buildResult({
      entity: 'influences',
      dryRun,
      totalCount: Math.max(rawRows.length - 1, 0),
      successCount: 0,
      failedCount: shapeValidation.errors.length,
      skippedCount: Math.max(rawRows.length - 1, 0),
      errors: shapeValidation.errors,
      fatal: true
    });
  }

  const rows = rowsToObjects(rawRows);
  const errors = [];
  const skipped = [];
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
    const kind = String(row.data.kind || '').trim();

    if (!isValidSlug(personSlug)) {
      errors.push({ rowNumber: row.rowNumber, message: `personSlug "${personSlug}" は不正です。` });
      continue;
    }

    if (!isValidSlug(bookSlug)) {
      errors.push({ rowNumber: row.rowNumber, message: `bookSlug "${bookSlug}" は不正です。` });
      continue;
    }

    if (!INFLUENCE_KIND_VALUES.includes(kind)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `kind "${kind}" は不正です。利用可能値: ${INFLUENCE_KIND_VALUES.join(', ')}`
      });
      continue;
    }

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
      skipped.push({
        rowNumber: row.rowNumber,
        message: `person + book + kind が重複しているためスキップしました (${personSlug}, ${bookSlug}, ${kind})。`
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

  return buildResult({
    entity: 'influences',
    dryRun,
    totalCount: rows.length,
    successCount,
    failedCount: errors.length,
    skippedCount: skipped.length,
    errors,
    skipped
  });
}

module.exports = {
  importPeopleCsv,
  importBooksCsv,
  importInfluencesCsv,
  isValidSlug
};
