const express = require('express');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const Person = require('../models/Person');
const { searchGoogleBooks, buildBookAutofillPatch } = require('../lib/google-books');
const { bookFieldsFromInput, findDuplicateBookMatches } = require('../lib/book-dedup');
const { resolveBookForInfluence, normalizeInput } = require('../lib/resolve-book-for-influence');
const { previewBulkInfluences } = require('../lib/preview-bulk-influences');
const { applyBulkInfluences } = require('../lib/apply-bulk-influences');
const { INFLUENCE_KIND_OPTIONS, toInfluenceKind, getInfluenceKindLabel } = require('../lib/influence-kind');
const { importPeopleCsv, importBooksCsv, importInfluencesCsv } = require('../lib/csv-import');
const { validatePersonTemplate, toValidationMessage } = require('../lib/person-draft-validation');
const { generatePersonProfileDraft } = require('../services/person-profile-generator');
const { generatePersonBooksDraft, slugify } = require('../services/person-book-generator');
const { persistPersonDraft, buildNonEmptyPatch, normalizeKind } = require('../services/person-draft-persistence');
const {
  PRIMARY_CATEGORY_OPTIONS,
  normalizePrimaryCategory,
  buildPrimaryCategoryList
} = require('../lib/person-taxonomy');

const router = express.Router();

const COUNTRY_JA_OPTIONS = [
  '未設定',
  '日本',
  'アメリカ',
  'イギリス',
  '中国',
  '韓国',
  'フランス',
  'ドイツ',
  'カナダ',
  'オーストラリア',
  'インド',
  'シンガポール'
];

function getAdminAuthConfigError() {
  const missingKeys = [];
  if (!process.env.ADMIN_EMAIL) {
    missingKeys.push('ADMIN_EMAIL');
  }
  if (!process.env.ADMIN_PASSWORD) {
    missingKeys.push('ADMIN_PASSWORD');
  }

  if (missingKeys.length > 0) {
    return `管理認証の環境変数が不足しています: ${missingKeys.join(', ')}。 .env を確認してください。`;
  }

  return '';
}

function normalizePersonInput(input = {}) {
  return {
    name: input.name,
    slug: input.slug,
    imageUrl: input.imageUrl,
    occupationJa: input.occupationJa,
    occupation: input.occupationJa,
    countryJa: input.countryJa,
    category: normalizePrimaryCategory(input.category),
    intro: input.intro,
    bio: typeof input.bio === 'string' ? input.bio : '',
    career: input.career,
    coreMessage: input.coreMessage,
    featured: input.featured === 'on'
  };
}

function normalizeDraftBook(rawBook = {}) {
  const title = String(rawBook.title || '').trim();
  const slug = String(rawBook.slug || '').trim() || slugify(title);
  return {
    title,
    slug,
    author: String(rawBook.author || '').trim(),
    description: String(rawBook.description || '').trim(),
    coverUrl: String(rawBook.coverUrl || '').trim(),
    amazonUrl: String(rawBook.amazonUrl || '').trim(),
    rakutenUrl: String(rawBook.rakutenUrl || '').trim(),
    googleBooksId: String(rawBook.googleBooksId || '').trim(),
    isbn: String(rawBook.isbn || '').trim(),
    isbn10: String(rawBook.isbn10 || '').trim(),
    isbn13: String(rawBook.isbn13 || '').trim()
  };
}

function normalizeDraftInfluence(rawInfluence = {}) {
  const rawKind = String(rawInfluence.kind || '').trim();
  if (!['influence', 'about', 'authored'].includes(rawKind)) {
    const error = new Error(`不正な kind が指定されました: ${rawKind}`);
    error.code = 'invalid_influence_kind';
    throw error;
  }

  return {
    personSlug: String(rawInfluence.personSlug || '').trim(),
    bookSlug: String(rawInfluence.bookSlug || '').trim(),
    kind: normalizeKind(rawKind),
    impactSummary: String(rawInfluence.impactSummary || '').trim(),
    sourceTitle: String(rawInfluence.sourceTitle || '').trim(),
    sourceUrl: String(rawInfluence.sourceUrl || '').trim(),
    sourceType: String(rawInfluence.sourceType || '').trim(),
    featuredOrder: Number(rawInfluence.featuredOrder) || 0
  };
}

function normalizeBookFormValues(input = {}) {
  return {
    title: String(input.title || '').trim(),
    slug: String(input.slug || '').trim(),
    author: String(input.author || '').trim(),
    isbn: String(input.isbn || '').trim(),
    googleBooksId: String(input.googleBooksId || '').trim(),
    isbn10: String(input.isbn10 || '').trim(),
    isbn13: String(input.isbn13 || '').trim(),
    coverUrl: String(input.coverUrl || '').trim(),
    description: String(input.description || '').trim(),
    amazonUrl: String(input.amazonUrl || '').trim(),
    rakutenUrl: String(input.rakutenUrl || '').trim(),
    googleBooksQuery: String(input.googleBooksQuery || '').trim()
  };
}

function bookDuplicateMessageFromReason(reason) {
  const messages = {
    slug: '同じ slug の本が既に存在します。',
    googleBooksId: '同じ Google Books ID の本が既に存在します。',
    isbn: '同じ ISBN の本が既に存在します。',
    isbn13: '同じ ISBN-13 の本が既に存在します。',
    isbn10: '同じ ISBN-10 の本が既に存在します。',
    title_author: '同名または類似の本が既に存在します。'
  };
  return messages[reason] || '重複する本が既に存在します。';
}

function duplicateReasonLabel(reason) {
  const labels = {
    slug: 'slug 一致',
    googleBooksId: 'Google Books ID 一致',
    isbn: 'ISBN 一致',
    isbn13: 'ISBN-13 一致',
    isbn10: 'ISBN-10 一致',
    title_author: 'タイトル・著者が近い'
  };
  return labels[reason] || '重複候補';
}

function buildDuplicateCandidatePayload(match) {
  return {
    id: match.book._id,
    title: match.book.title,
    slug: match.book.slug,
    author: match.book.author,
    googleBooksId: match.book.googleBooksId || '',
    isbn: match.book.isbn || '',
    isbn10: match.book.isbn10 || '',
    isbn13: match.book.isbn13 || '',
    reason: match.reason,
    reasonLabel: duplicateReasonLabel(match.reason),
    matchedOn: match.matchedOn || null,
    influenceCount: match.influenceCount
  };
}

function buildDuplicateDebugLog({ reason, duplicateBook, incomingBook, matchedOn }) {
  return {
    reason,
    matchedOn: matchedOn || null,
    existingId: duplicateBook._id || '',
    existingTitle: duplicateBook.title || '',
    existingSlug: duplicateBook.slug || '',
    existingIsbn: duplicateBook.isbn || '',
    existingIsbn10: duplicateBook.isbn10 || '',
    existingIsbn13: duplicateBook.isbn13 || '',
    existingGoogleBooksId: duplicateBook.googleBooksId || '',
    incomingIsbn: incomingBook.isbn || '',
    incomingIsbn10: incomingBook.isbn10 || '',
    incomingIsbn13: incomingBook.isbn13 || '',
    incomingGoogleBooksId: incomingBook.googleBooksId || ''
  };
}

function mapDuplicateKeyFieldName(rawFieldName = '') {
  const field = String(rawFieldName || '');
  if (field.includes('slug')) {
    return 'slug';
  }
  if (field.includes('googleBooksId')) {
    return 'googleBooksId';
  }
  if (field.includes('isbn13')) {
    return 'isbn13';
  }
  if (field.includes('isbn10')) {
    return 'isbn10';
  }
  if (field.includes('isbn')) {
    return 'isbn';
  }
  return field;
}

function extractDuplicateKeyInfo(error) {
  const keyPatternField = Object.keys(error && error.keyPattern ? error.keyPattern : {})[0] || '';
  const keyValueField = Object.keys(error && error.keyValue ? error.keyValue : {})[0] || '';
  const mappedField = mapDuplicateKeyFieldName(keyPatternField || keyValueField);
  const mappedValue = mappedField && error && error.keyValue ? error.keyValue[mappedField] : undefined;

  if (mappedField) {
    return {
      field: mappedField,
      value: mappedValue
    };
  }

  return {
    field: '',
    value: undefined
  };
}

function parseBookCreateError(error) {
  if (!error) {
    return null;
  }

  if (error.name === 'ValidationError') {
    const missingFields = Object.entries(error.errors || {})
      .filter(([, value]) => value && value.kind === 'required')
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return {
        userMessage: `必須項目が不足しています: ${missingFields.join(', ')}`,
        logReason: `validation error on ${missingFields.join(', ')}`,
        statusCode: 400
      };
    }

    return {
      userMessage: `入力値に誤りがあります: ${error.message}`,
      logReason: 'validation error',
      statusCode: 400
    };
  }

  if (error.code === 11000) {
    const duplicateKey = extractDuplicateKeyInfo(error);
    const keyField = duplicateKey.field;
    const labelMap = {
      slug: { userMessage: '同じ slug の本が既に存在します。', logReason: 'duplicate slug' },
      googleBooksId: { userMessage: '同じ Google Books ID の本が既に存在します。', logReason: 'duplicate googleBooksId' },
      isbn13: { userMessage: '同じ ISBN-13 の本が既に存在します。', logReason: 'duplicate isbn13' },
      isbn10: { userMessage: '同じ ISBN-10 の本が既に存在します。', logReason: 'duplicate isbn10' },
      isbn: { userMessage: '同じ ISBN の本が既に存在します。', logReason: 'duplicate isbn' }
    };
    const mapped = labelMap[keyField];
    if (mapped) {
      return { ...mapped, statusCode: 409, duplicateField: duplicateKey.field, duplicateValue: duplicateKey.value };
    }
    return {
      userMessage: '重複する本が既に存在します。',
      logReason: 'duplicate key',
      statusCode: 409,
      duplicateField: duplicateKey.field,
      duplicateValue: duplicateKey.value
    };
  }

  return {
    userMessage: `本の登録に失敗しました。時間をおいて再度お試しください。詳細: ${error.message}`,
    logReason: `unexpected error (${error.name || 'Error'})`,
    statusCode: 500
  };
}

async function renderBookNewForm(res, data = {}) {
  return res.render('admin/books-new', {
    duplicateCandidates: data.duplicateCandidates || [],
    errorMessage: data.errorMessage || '',
    formValues: data.formValues || {}
  });
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.keys(value)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => value[key]);
}

async function classifyGeneratedBooks(books = []) {
  const classified = [];
  const existingBookIds = new Set();

  for (const rawBook of books) {
    const book = normalizeDraftBook(rawBook);
    if (!book.title || !book.slug) {
      continue;
    }

    let existingBook = await Book.findOne({ slug: book.slug });
    if (!existingBook) {
      const isbnCandidates = [book.isbn, book.isbn13, book.isbn10].filter(Boolean);
      if (isbnCandidates.length > 0) {
        existingBook = await Book.findOne({
          $or: [{ isbn: { $in: isbnCandidates } }, { isbn13: { $in: isbnCandidates } }, { isbn10: { $in: isbnCandidates } }]
        });
      }
    }

    const existingBookId = existingBook ? String(existingBook._id) : '';
    if (existingBookId) {
      existingBookIds.add(existingBookId);
    }

    classified.push({
      ...book,
      existingBookId,
      existingBookTitle: existingBook ? existingBook.title : '',
      resolutionType: existingBook ? 'reuse' : 'create'
    });
  }

  return {
    books: classified,
    existingBookIds: [...existingBookIds]
  };
}

function mergeInfluencesWithBooks(influences = [], books = []) {
  const bookMap = new Map(books.map((book) => [book.slug, book]));
  return influences.map((rawInfluence) => {
    const normalized = normalizeDraftInfluence(rawInfluence);
    const relatedBook = bookMap.get(normalized.bookSlug);
    return {
      ...normalized,
      resolutionType: relatedBook && relatedBook.resolutionType === 'reuse' ? 'reuse' : 'create',
      bookTitle: relatedBook ? relatedBook.title : normalized.bookSlug
    };
  });
}

function mergeInfluencesWithBooksForPreview(influences = [], books = []) {
  const bookMap = new Map(books.map((book) => [book.slug, book]));
  return influences.map((rawInfluence) => {
    const personSlug = String(rawInfluence.personSlug || '').trim();
    const bookSlug = String(rawInfluence.bookSlug || '').trim();
    const kind = String(rawInfluence.kind || '').trim();
    const relatedBook = bookMap.get(bookSlug);

    return {
      personSlug,
      bookSlug,
      kind,
      impactSummary: String(rawInfluence.impactSummary || '').trim(),
      sourceTitle: String(rawInfluence.sourceTitle || '').trim(),
      sourceUrl: String(rawInfluence.sourceUrl || '').trim(),
      sourceType: String(rawInfluence.sourceType || '').trim(),
      featuredOrder: Number(rawInfluence.featuredOrder) || 0,
      resolutionType: relatedBook && relatedBook.resolutionType === 'reuse' ? 'reuse' : 'create',
      bookTitle: relatedBook ? relatedBook.title : bookSlug
    };
  });
}

async function renderPersonForm(res, { person = null, errorMessage = '', formValues = {} } = {}) {
  const categoryOptions = buildPrimaryCategoryList([person ? person.category : formValues.category]);
  const viewName = person ? 'admin/people-edit' : 'admin/people-new';
  return res.render(viewName, {
    person,
    categoryOptions,
    countryOptions: COUNTRY_JA_OPTIONS,
    errorMessage,
    formValues
  });
}

async function renderCsvImportPage(res, data = {}) {
  return res.render('admin/csv-import', {
    formValues: data.formValues || {
      entityType: 'people',
      csvText: '',
      dryRun: true
    },
    result: data.result || null,
    errorMessage: data.errorMessage || ''
  });
}

async function renderInfluenceNewPage(res, data = {}) {
  const [people, books] = await Promise.all([
    Person.find({}).sort({ name: 1 }),
    Book.find({}).sort({ title: 1 })
  ]);

  const formValues = data.formValues || {};
  const selectedPersonId = formValues.personId ? String(formValues.personId) : '';
  const selectedPerson = selectedPersonId ? people.find((person) => String(person._id) === selectedPersonId) : null;

  return res.render('admin/influences-new', {
    people,
    books,
    influenceKindOptions: INFLUENCE_KIND_OPTIONS,
    formValues,
    selectedPerson: data.selectedPerson || selectedPerson || null,
    returnTo: data.returnTo || '',
    resolvePreview: data.resolvePreview || null,
    errorMessage: data.errorMessage || ''
  });
}

function mapResolveReason(reason) {
  const labels = {
    googleBooksId: 'googleBooksId一致',
    isbn13: 'isbn13一致',
    isbn10: 'isbn10一致',
    slug: 'slug一致',
    title_author: 'title+author近似',
    google_books_candidate: 'Google Books候補',
    existing_influence: '既存Influence重複',
    google_books_not_found: 'Google Books候補なし',
    unexpected: '予期せぬエラー'
  };
  return labels[reason] || reason || '-';
}

async function renderInfluenceBulkPage(res, data = {}) {
  const people = await Person.find({}).sort({ name: 1 });
  const previewResult = data.previewResult
    ? {
        ...data.previewResult,
        rows: (data.previewResult.rows || []).map((row) => ({
          ...row,
          reasonText: row.reasonLabel || mapResolveReason(row.reason)
        }))
      }
    : null;
  const applyResult = data.applyResult
    ? {
        ...data.applyResult,
        rows: (data.applyResult.rows || []).map((row) => ({
          ...row,
          reasonText: row.reasonLabel || mapResolveReason(row.reason)
        }))
      }
    : null;

  return res.render('admin/influences-bulk', {
    people,
    influenceKindOptions: INFLUENCE_KIND_OPTIONS,
    formValues: data.formValues || {},
    previewResult,
    applyResult,
    errorMessage: data.errorMessage || ''
  });
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminAuthenticated) {
    return next();
  }
  return res.redirect('/admin/login');
}

router.use((req, res, next) => {
  res.locals.adminAuthenticated = Boolean(req.session && req.session.adminAuthenticated);
  next();
});

router.get('/login', (req, res) => {
  const configError = getAdminAuthConfigError();
  if (configError) {
    return res.status(500).render('admin/login', { errorMessage: configError });
  }

  if (req.session && req.session.adminAuthenticated) {
    return res.redirect('/admin');
  }
  return res.render('admin/login', { errorMessage: '' });
});

router.post('/login', (req, res) => {
  const configError = getAdminAuthConfigError();
  if (configError) {
    return res.status(500).render('admin/login', { errorMessage: configError });
  }

  const adminEmail = process.env.ADMIN_EMAIL.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const email = req.body.email ? req.body.email.trim() : '';
  const password = req.body.password || '';

  if (email === adminEmail && password === adminPassword) {
    req.session.adminAuthenticated = true;
    return res.redirect('/admin');
  }

  return res.status(401).render('admin/login', {
    errorMessage: 'メールアドレスまたはパスワードが正しくありません。'
  });
});

router.post('/logout', (req, res) => {
  if (!req.session) {
    return res.redirect('/admin/login');
  }
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.use((req, res, next) => {
  const configError = getAdminAuthConfigError();
  if (configError) {
    return res.status(500).send(configError);
  }
  return next();
});

router.use(requireAdminAuth);

router.get('/', (req, res) => {
  res.render('admin/dashboard');
});

router.get('/people', async (req, res) => {
  try {
    const saveResult = req.session ? req.session.personDraftSaveResult : null;
    if (req.session) {
      req.session.personDraftSaveResult = null;
    }
    const people = await Person.find({}).sort({ createdAt: -1 });
    res.render('admin/people-list', { people, saveResult });
  } catch (error) {
    console.error('Failed to load people list:', error.message);
    res.status(500).send('Failed to load people list');
  }
});

router.get('/books', async (req, res) => {
  try {
    const isbnQuery = String(req.query.isbn || '').trim();
    const googleBooksIdQuery = String(req.query.googleBooksId || '').trim();
    const filters = [];

    if (isbnQuery) {
      filters.push({
        $or: [{ isbn: isbnQuery }, { isbn10: isbnQuery }, { isbn13: isbnQuery }]
      });
    }
    if (googleBooksIdQuery) {
      filters.push({ googleBooksId: googleBooksIdQuery });
    }

    const mongoFilter = filters.length > 0 ? { $and: filters } : {};
    const books = await Book.find(mongoFilter).sort({ createdAt: -1 });
    res.render('admin/books-list', {
      books,
      searchValues: {
        isbn: isbnQuery,
        googleBooksId: googleBooksIdQuery
      }
    });
  } catch (error) {
    console.error('Failed to load books list:', error.message);
    res.status(500).send('Failed to load books list');
  }
});

router.get('/influences', async (req, res) => {
  try {
    const [people, influenceCounts] = await Promise.all([
      Person.find({}).sort({ name: 1 }),
      Influence.aggregate([{ $group: { _id: '$personId', count: { $sum: 1 } } }])
    ]);

    const countMap = new Map(influenceCounts.map((item) => [String(item._id), item.count]));
    const peopleWithInfluenceCount = people.map((person) => ({
      ...person.toObject(),
      influenceCount: countMap.get(String(person._id)) || 0
    }));

    res.render('admin/influences-list', { people: peopleWithInfluenceCount });
  } catch (error) {
    console.error('Failed to load influences list:', error.message);
    res.status(500).send('Failed to load influences list');
  }
});

router.get('/people/new', (req, res) => {
  res.render('admin/people-new', {
    categoryOptions: PRIMARY_CATEGORY_OPTIONS,
    countryOptions: COUNTRY_JA_OPTIONS,
    errorMessage: '',
    formValues: {}
  });
});

router.post('/people', async (req, res) => {
  try {
    const personData = normalizePersonInput(req.body);
    const isDraft = req.body.saveAsDraft === 'on';

    if (isDraft) {
      personData.occupationJa = personData.occupationJa || '未設定（下書き）';
      personData.occupation = personData.occupationJa;
      personData.intro = personData.intro || '下書きです。公開前に内容を更新してください。';
      personData.career = personData.career || '下書き';
      personData.imageUrl = personData.imageUrl || '';
      personData.category = personData.category || '起業家';
      personData.countryJa = personData.countryJa || '未設定';
    } else {
      const validation = validatePersonTemplate(personData);
      if (!validation.ok) {
        return renderPersonForm(res, {
          errorMessage: toValidationMessage(validation.missingFields),
          formValues: req.body
        });
      }
    }

    await Person.create(personData);

    res.redirect('/admin');
  } catch (error) {
    console.error('Failed to create person:', error.message);
    res.status(500);
    return renderPersonForm(res, {
      errorMessage: `人物の登録に失敗しました: ${error.message}`,
      formValues: req.body
    });
  }
});

router.get('/people/:id/edit', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }
    return renderPersonForm(res, {
      person,
      errorMessage: ''
    });
  } catch (error) {
    console.error('Failed to load person edit form:', error.message);
    res.status(500).send('Failed to load person edit form');
  }
});

router.get('/people/:id/generate', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    return res.render('admin/people-generate', {
      person,
      errorMessage: '',
      generationNotice: ''
    });
  } catch (error) {
    console.error('Failed to load person generation page:', error.message);
    return res.status(500).send('Failed to load person generation page');
  }
});

router.get('/people/:id/generate/person', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    return res.render('admin/people-generate-person', {
      person,
      errorMessage: '',
      generationNotice: ''
    });
  } catch (error) {
    console.error('Failed to load person profile generation page:', error.message);
    return res.status(500).send('Failed to load person profile generation page');
  }
});

router.post('/people/:id/generate/person', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    if (!person.name || !String(person.name).trim()) {
      return res.status(400).render('admin/people-generate-person', {
        person,
        errorMessage: '人物名が未入力のため人物情報を生成できません。人物編集画面で名前を設定してください。',
        generationNotice: ''
      });
    }

    const generatedDraft = await generatePersonProfileDraft(person);
    const personPatch = buildNonEmptyPatch(generatedDraft.personPatch || {});

    return res.render('admin/people-generate-preview-person', {
      person,
      errorMessage: '',
      generationNotice: '人物情報の下書きを生成しました。内容を確認・編集してから保存してください。',
      draft: {
        personPatch
      }
    });
  } catch (error) {
    console.error('Failed to generate person profile draft:', error.message);

    const person = await Person.findById(req.params.id);
    return res.status(500).render('admin/people-generate-person', {
      person,
      errorMessage: `人物情報の下書き生成に失敗しました。時間をおいて再実行してください。詳細: ${error.message}`,
      generationNotice: ''
    });
  }
});

router.post('/people/:id/generate/person/save', async (req, res) => {
  try {
    const personId = req.params.id;
    const personPatch = buildNonEmptyPatch(req.body.personPatch || {});

    const result = await persistPersonDraft({
      Person,
      Book,
      Influence,
      personId,
      draft: {
        personPatch,
        books: [],
        influences: []
      }
    });

    if (req.session) {
      req.session.personDraftSaveResult = result;
    }

    return res.redirect('/admin/people');
  } catch (error) {
    console.error('Failed to save generated person profile draft:', error.message);
    const person = await Person.findById(req.params.id);

    return res.status(500).render('admin/people-generate-preview-person', {
      person,
      errorMessage: `人物情報の下書き保存に失敗しました。詳細: ${error.message}`,
      generationNotice: '',
      draft: {
        personPatch: buildNonEmptyPatch(req.body.personPatch || {})
      }
    });
  }
});

router.get('/people/:id/generate/books', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    return res.render('admin/people-generate-books', {
      person,
      errorMessage: '',
      generationNotice: ''
    });
  } catch (error) {
    console.error('Failed to load person books generation page:', error.message);
    return res.status(500).send('Failed to load person books generation page');
  }
});

router.post('/people/:id/generate/books', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    if (!person.name || !String(person.name).trim()) {
      return res.status(400).render('admin/people-generate-books', {
        person,
        errorMessage: '人物名が未入力のため本情報を生成できません。人物編集画面で名前を設定してください。',
        generationNotice: ''
      });
    }

    const generatedDraft = await generatePersonBooksDraft(person);
    const { books } = await classifyGeneratedBooks(generatedDraft.books || []);
    const influences = mergeInfluencesWithBooks(generatedDraft.influences || [], books);

    return res.render('admin/people-generate-preview-books', {
      person,
      errorMessage: '',
      generationNotice: '本情報の下書きを生成しました。内容を確認・編集してから保存してください。',
      draft: {
        books,
        influences
      }
    });
  } catch (error) {
    console.error('Failed to generate person books draft:', error.message);

    const person = await Person.findById(req.params.id);
    return res.status(500).render('admin/people-generate-books', {
      person,
      errorMessage: `本情報の下書き生成に失敗しました。時間をおいて再実行してください。詳細: ${error.message}`,
      generationNotice: ''
    });
  }
});

router.post('/people/:id/generate/books/save', async (req, res) => {
  try {
    const personId = req.params.id;
    const books = toArray(req.body.books).map(normalizeDraftBook).filter((book) => book.title && book.slug);
    const influences = toArray(req.body.influences).map(normalizeDraftInfluence).filter((influence) => influence.bookSlug);

    const result = await persistPersonDraft({
      Person,
      Book,
      Influence,
      personId,
      draft: {
        personPatch: {},
        books,
        influences
      }
    });

    if (req.session) {
      req.session.personDraftSaveResult = result;
    }

    return res.redirect('/admin/people');
  } catch (error) {
    console.error('Failed to save generated books draft:', error.message);
    const person = await Person.findById(req.params.id);
    const { books } = await classifyGeneratedBooks(toArray(req.body.books).map(normalizeDraftBook));
    const influences = mergeInfluencesWithBooksForPreview(
      toArray(req.body.influences).map((rawInfluence) => ({
        personSlug: String(rawInfluence.personSlug || '').trim(),
        bookSlug: String(rawInfluence.bookSlug || '').trim(),
        kind: String(rawInfluence.kind || '').trim(),
        impactSummary: String(rawInfluence.impactSummary || '').trim(),
        sourceTitle: String(rawInfluence.sourceTitle || '').trim(),
        sourceUrl: String(rawInfluence.sourceUrl || '').trim(),
        sourceType: String(rawInfluence.sourceType || '').trim(),
        featuredOrder: Number(rawInfluence.featuredOrder) || 0
      })),
      books
    );

    return res.status(500).render('admin/people-generate-preview-books', {
      person,
      errorMessage: `本情報の下書き保存に失敗しました。詳細: ${error.message}`,
      generationNotice: '',
      draft: {
        books,
        influences
      }
    });
  }
});

router.post('/people/:id', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    const personData = normalizePersonInput(req.body);
    const validation = validatePersonTemplate(personData);
    if (!validation.ok) {
      return renderPersonForm(res, {
        person,
        errorMessage: toValidationMessage(validation.missingFields),
        formValues: req.body
      });
    }

    Object.entries(personData).forEach(([key, value]) => {
      person[key] = value;
    });

    await person.save();

    res.redirect('/admin/people');
  } catch (error) {
    console.error('Failed to update person:', error.message);
    res.status(500).send('Failed to update person');
  }
});

router.post('/people/:id/delete', async (req, res) => {
  try {
    const personId = req.params.id;
    await Promise.all([Influence.deleteMany({ personId }), Person.findByIdAndDelete(personId)]);
    res.redirect('/admin/people');
  } catch (error) {
    console.error('Failed to delete person:', error.message);
    res.status(500).send('Failed to delete person');
  }
});

router.get('/books/new', (req, res) => {
  renderBookNewForm(res, {
    duplicateCandidates: [],
    errorMessage: '',
    formValues: {}
  });
});

router.get('/books/google-books', async (req, res) => {
  try {
    const query = req.query.query ? req.query.query.trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const bookCandidate = await searchGoogleBooks(query);
    if (!bookCandidate) {
      return res.status(404).json({ error: 'not found' });
    }

    return res.json({ book: bookCandidate });
  } catch (error) {
    console.error('Failed to fetch Google Books candidate:', error.message);
    return res.status(500).json({ error: 'google_books_fetch_failed' });
  }
});

router.post('/books', async (req, res) => {
  const formValues = normalizeBookFormValues(req.body);

  try {
    const bookData = bookFieldsFromInput(req.body, slugify);
    if (!bookData.slug && bookData.title) {
      bookData.slug = slugify(bookData.title);
    }

    try {
      const { patch } = await buildBookAutofillPatch(bookData, { respectExistingGoogleBooksId: true });
      Object.assign(bookData, patch);
    } catch (googleBooksError) {
      console.warn('Google Books auto-fill skipped:', googleBooksError.message);
    }

    const duplicateMatches = await findDuplicateBookMatches(Book, bookData, { Influence });
    const duplicate = duplicateMatches[0];

    if (duplicate) {
      const reason = duplicate.reason || 'title_author';
      const duplicateBook = duplicate.book || {};
      const duplicateDebug = buildDuplicateDebugLog({
        reason,
        duplicateBook,
        incomingBook: bookData,
        matchedOn: duplicate.matchedOn || null
      });
      console.warn(
        `Failed to create book: duplicate detected before save: ${JSON.stringify(duplicateDebug)}`
      );
      res.status(409);
      return renderBookNewForm(res, {
        errorMessage: bookDuplicateMessageFromReason(reason),
        formValues,
        duplicateCandidates: duplicateMatches.slice(0, 5).map(buildDuplicateCandidatePayload)
      });
    }

    await Book.create(bookData);

    res.redirect('/admin');
  } catch (error) {
    const parsed = parseBookCreateError(error);
    const extra = parsed.duplicateField
      ? ` (field=${parsed.duplicateField}, value=${parsed.duplicateValue || '-'})`
      : '';
    console.error(`Failed to create book: ${parsed.logReason}${extra}`);
    res.status(parsed.statusCode);
    return renderBookNewForm(res, {
      errorMessage: parsed.userMessage,
      formValues,
      duplicateCandidates: []
    });
  }
});

router.get('/books/duplicate-candidates', async (req, res) => {
  try {
    const bookData = bookFieldsFromInput(req.query, slugify);
    const duplicateMatches = await findDuplicateBookMatches(Book, bookData, { Influence });

    return res.json({
      candidates: duplicateMatches.slice(0, 5).map((match) => ({
        ...buildDuplicateCandidatePayload(match)
      }))
    });
  } catch (error) {
    console.error('Failed to check duplicate candidates:', error.message);
    return res.status(500).json({ error: 'duplicate_check_failed' });
  }
});

router.get('/books/:id/edit', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).send('Book not found');
    }
    res.render('admin/books-edit', { book });
  } catch (error) {
    console.error('Failed to load book edit form:', error.message);
    res.status(500).send('Failed to load book edit form');
  }
});

router.post('/books/:id', async (req, res) => {
  try {
    const slug = req.body.slug ? req.body.slug.trim() : slugify(req.body.title);
    await Book.findByIdAndUpdate(req.params.id, {
      title: req.body.title,
      slug,
      author: req.body.author,
      isbn: req.body.isbn,
      googleBooksId: req.body.googleBooksId,
      isbn10: req.body.isbn10,
      isbn13: req.body.isbn13,
      coverUrl: req.body.coverUrl,
      description: req.body.description,
      amazonUrl: req.body.amazonUrl,
      rakutenUrl: req.body.rakutenUrl
    });

    res.redirect('/admin/books');
  } catch (error) {
    console.error('Failed to update book:', error.message);
    res.status(500).send('Failed to update book');
  }
});

router.post('/books/:id/delete', async (req, res) => {
  try {
    const bookId = req.params.id;
    await Promise.all([Influence.deleteMany({ bookId }), Book.findByIdAndDelete(bookId)]);
    res.redirect('/admin/books');
  } catch (error) {
    console.error('Failed to delete book:', error.message);
    res.status(500).send('Failed to delete book');
  }
});

router.get('/influences/new', async (req, res) => {
  try {
    await renderInfluenceNewPage(res);
  } catch (error) {
    console.error('Failed to load influence form:', error.message);
    res.status(500).send('Failed to load influence form');
  }
});

router.get('/people/:id/influences', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    const influences = await Influence.find({ personId: person._id })
      .sort({ featuredOrder: 1, createdAt: -1 })
      .populate('bookId');

    const groupedInfluences = INFLUENCE_KIND_OPTIONS.map((option) => ({
      ...option,
      items: influences
        .filter((influence) => influence.kind === option.value)
        .map((influence) => ({
          ...influence.toObject(),
          kindLabel: getInfluenceKindLabel(influence.kind)
        }))
    }));

    return res.render('admin/person-influences', { person, groupedInfluences });
  } catch (error) {
    console.error('Failed to load person influences page:', error.message);
    return res.status(500).send('Failed to load person influences page');
  }
});

router.get('/people/:id/influences/new', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }

    await renderInfluenceNewPage(res, {
      selectedPerson: person,
      returnTo: `/admin/people/${person._id}/influences`,
      formValues: {
        personId: person._id,
        kind: req.query.kind || 'influence'
      }
    });
  } catch (error) {
    console.error('Failed to load person influence form:', error.message);
    return res.status(500).send('Failed to load person influence form');
  }
});

router.get('/import/csv', async (req, res) => {
  try {
    await renderCsvImportPage(res);
  } catch (error) {
    console.error('Failed to load CSV import page:', error.message);
    res.status(500).send('Failed to load CSV import page');
  }
});

router.post('/import/csv', async (req, res) => {
  try {
    const entityType = String(req.body.entityType || '').trim();
    const csvText = String(req.body.csvText || '');
    const dryRun = req.body.dryRun === 'on';
    const formValues = { entityType, csvText, dryRun };

    if (!csvText.trim()) {
      return renderCsvImportPage(res, {
        formValues,
        errorMessage: 'CSVテキストを入力してください。'
      });
    }

    let result;
    if (entityType === 'people') {
      result = await importPeopleCsv({ csvText, Person, dryRun });
    } else if (entityType === 'books') {
      result = await importBooksCsv({ csvText, Book, dryRun });
    } else if (entityType === 'influences') {
      result = await importInfluencesCsv({ csvText, Person, Book, Influence, dryRun });
    } else {
      return renderCsvImportPage(res, {
        formValues,
        errorMessage: '対象エンティティを選択してください。'
      });
    }

    return renderCsvImportPage(res, { formValues, result });
  } catch (error) {
    console.error('Failed to import CSV:', error.message);
    return res.status(500).send('Failed to import CSV');
  }
});

router.get('/influences/bulk', async (req, res) => {
  try {
    await renderInfluenceBulkPage(res);
  } catch (error) {
    console.error('Failed to load influence bulk form:', error.message);
    res.status(500).send('Failed to load influence bulk form');
  }
});

router.post('/influences/bulk/preview', async (req, res) => {
  try {
    const personId = String(req.body.personId || '').trim();
    const kind = toInfluenceKind(req.body.kind);
    const multilineBookInput = String(req.body.multilineBookInput || '');
    const formValues = {
      personId,
      kind,
      multilineBookInput,
      impactSummary: req.body.impactSummary || '',
      sourceTitle: req.body.sourceTitle || '',
      sourceUrl: req.body.sourceUrl || '',
      sourceType: req.body.sourceType || '',
      featuredOrder: req.body.featuredOrder || 0
    };

    if (!personId || !multilineBookInput.trim()) {
      return renderInfluenceBulkPage(res, {
        formValues,
        errorMessage: '人物と本リストは必須です。'
      });
    }

    const personExists = await Person.exists({ _id: personId });
    if (!personExists) {
      return renderInfluenceBulkPage(res, {
        formValues,
        errorMessage: '指定された人物が見つかりません。'
      });
    }

    const previewResult = await previewBulkInfluences({
      Book,
      Influence,
      personId,
      kind,
      multilineBookInput,
      slugify
    });

    return renderInfluenceBulkPage(res, {
      formValues,
      previewResult
    });
  } catch (error) {
    console.error('Failed to preview bulk influences:', error.message);
    return res.status(500).send('Failed to preview bulk influences');
  }
});

router.post('/influences/bulk/apply', async (req, res) => {
  try {
    const personId = String(req.body.personId || '').trim();
    const kind = toInfluenceKind(req.body.kind);
    const multilineBookInput = String(req.body.multilineBookInput || '');
    const formValues = {
      personId,
      kind,
      multilineBookInput,
      impactSummary: req.body.impactSummary || '',
      sourceTitle: req.body.sourceTitle || '',
      sourceUrl: req.body.sourceUrl || '',
      sourceType: req.body.sourceType || '',
      featuredOrder: req.body.featuredOrder || 0
    };

    if (!personId || !multilineBookInput.trim()) {
      return renderInfluenceBulkPage(res, {
        formValues,
        errorMessage: '人物と本リストは必須です。'
      });
    }

    const personExists = await Person.exists({ _id: personId });
    if (!personExists) {
      return renderInfluenceBulkPage(res, {
        formValues,
        errorMessage: '指定された人物が見つかりません。'
      });
    }

    const applyResult = await applyBulkInfluences({
      Book,
      Influence,
      personId,
      kind,
      multilineBookInput,
      slugify,
      commonFields: {
        impactSummary: req.body.impactSummary,
        sourceTitle: req.body.sourceTitle,
        sourceUrl: req.body.sourceUrl,
        sourceType: req.body.sourceType,
        featuredOrder: req.body.featuredOrder
      }
    });

    return renderInfluenceBulkPage(res, {
      formValues,
      applyResult
    });
  } catch (error) {
    console.error('Failed to apply bulk influences:', error.message);
    return res.status(500).send('Failed to apply bulk influences');
  }
});

router.get('/influences/resolve-book', async (req, res) => {
  try {
    const input = normalizeInput({
      bookQuery: req.query.bookQuery,
      author: req.query.bookAuthor,
      title: req.query.bookTitle,
      googleBooksId: req.query.googleBooksId,
      isbn: req.query.isbn,
      isbn10: req.query.isbn10,
      isbn13: req.query.isbn13
    });

    if (!input.bookQuery && !input.title && !input.isbn && !input.googleBooksId) {
      return res.status(400).json({ error: 'book_query_required' });
    }

    const result = await resolveBookForInfluence({
      Book,
      Influence,
      input,
      slugify,
      dryRun: true
    });

    if (!result.ok) {
      return res.status(404).json({
        error: result.error || 'book_not_resolved',
        message: result.message || 'Book を解決できませんでした。'
      });
    }

    if (result.action === 'use_existing') {
      return res.json({
        action: result.action,
        reason: result.reason,
        resolvedBook: {
          id: result.book._id,
          title: result.book.title,
          author: result.book.author,
          slug: result.book.slug
        },
        candidates: (result.candidates || []).map((item) => ({
          id: item.book._id,
          title: item.book.title,
          author: item.book.author,
          reason: item.reason
        }))
      });
    }

    return res.json({
      action: result.action,
      reason: result.reason,
      candidate: {
        title: result.book.title,
        author: result.book.author,
        googleBooksId: result.book.googleBooksId,
        isbn10: result.book.isbn10,
        isbn13: result.book.isbn13
      }
    });
  } catch (error) {
    console.error('Failed to resolve book for influence:', error.message);
    return res.status(500).json({ error: 'book_resolve_failed' });
  }
});

router.post('/influences', async (req, res) => {
  try {
    let resolvedBookId = req.body.bookId ? String(req.body.bookId).trim() : '';

    if (!resolvedBookId && req.body.resolvedBookId) {
      resolvedBookId = String(req.body.resolvedBookId).trim();
    }

    if (!resolvedBookId) {
      const result = await resolveBookForInfluence({
        Book,
        Influence,
        input: {
          bookQuery: req.body.bookQuery,
          author: req.body.bookAuthor
        },
        slugify
      });

      if (!result.ok || !result.book || !result.book._id) {
        return renderInfluenceNewPage(res, {
          formValues: req.body,
          returnTo: req.body.returnTo || '',
          errorMessage: result.message || 'Book を解決できなかったため、Influence を作成しませんでした。'
        });
      }

      resolvedBookId = String(result.book._id);
    }

    const createdInfluence = await Influence.create({
      personId: req.body.personId,
      bookId: resolvedBookId,
      kind: toInfluenceKind(req.body.kind),
      impactSummary: req.body.impactSummary,
      sourceTitle: req.body.sourceTitle,
      sourceUrl: req.body.sourceUrl,
      sourceType: req.body.sourceType,
      featuredOrder: Number(req.body.featuredOrder) || 0
    });

    const returnTo = String(req.body.returnTo || '').trim();
    if (returnTo && returnTo.startsWith('/admin/')) {
      return res.redirect(returnTo);
    }

    if (createdInfluence && createdInfluence.personId) {
      return res.redirect(`/admin/people/${createdInfluence.personId}/influences`);
    }

    return res.redirect('/admin/influences');
  } catch (error) {
    console.error('Failed to create influence:', error.message);
    res.status(500).send('Failed to create influence');
  }
});

router.get('/influences/:id/edit', async (req, res) => {
  try {
    const [influence, people, books] = await Promise.all([
      Influence.findById(req.params.id),
      Person.find({}).sort({ name: 1 }),
      Book.find({}).sort({ title: 1 })
    ]);

    if (!influence) {
      return res.status(404).send('Influence not found');
    }

    const returnTo = String(req.query.returnTo || '').trim();
    return res.render('admin/influences-edit', { influence, people, books, returnTo, influenceKindOptions: INFLUENCE_KIND_OPTIONS });
  } catch (error) {
    console.error('Failed to load influence edit form:', error.message);
    return res.status(500).send('Failed to load influence edit form');
  }
});

router.post('/influences/:id', async (req, res) => {
  try {
    await Influence.findByIdAndUpdate(req.params.id, {
      personId: req.body.personId,
      bookId: req.body.bookId,
      kind: toInfluenceKind(req.body.kind),
      impactSummary: req.body.impactSummary,
      sourceTitle: req.body.sourceTitle,
      sourceUrl: req.body.sourceUrl,
      sourceType: req.body.sourceType,
      featuredOrder: Number(req.body.featuredOrder) || 0
    });

    const returnTo = String(req.body.returnTo || req.query.returnTo || '').trim();
    if (returnTo && returnTo.startsWith('/admin/')) {
      return res.redirect(returnTo);
    }

    res.redirect('/admin/influences');
  } catch (error) {
    console.error('Failed to update influence:', error.message);
    res.status(500).send('Failed to update influence');
  }
});

router.post('/influences/:id/delete', async (req, res) => {
  try {
    const influence = await Influence.findById(req.params.id);
    await Influence.findByIdAndDelete(req.params.id);

    const returnTo = String(req.body.returnTo || req.query.returnTo || '').trim();
    if (returnTo && returnTo.startsWith('/admin/')) {
      return res.redirect(returnTo);
    }

    if (influence && influence.personId) {
      return res.redirect(`/admin/people/${influence.personId}/influences`);
    }

    return res.redirect('/admin/influences');
  } catch (error) {
    console.error('Failed to delete influence:', error.message);
    res.status(500).send('Failed to delete influence');
  }
});

module.exports = router;
