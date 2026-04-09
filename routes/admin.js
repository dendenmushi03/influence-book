const express = require('express');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const Person = require('../models/Person');
const { searchGoogleBooks, buildBookAutofillPatch } = require('../lib/google-books');
const { bookFieldsFromInput, findDuplicateBookMatches, buildFillBlankPatch } = require('../lib/book-dedup');
const { resolveBookForInfluence, normalizeInput } = require('../lib/resolve-book-for-influence');
const { previewBulkInfluences } = require('../lib/preview-bulk-influences');
const { applyBulkInfluences } = require('../lib/apply-bulk-influences');
const { INFLUENCE_KIND_OPTIONS, toInfluenceKind, getInfluenceKindLabel } = require('../lib/influence-kind');
const { importPeopleCsv, importBooksCsv, importInfluencesCsv } = require('../lib/csv-import');
const { validatePersonTemplate, toValidationMessage } = require('../lib/person-draft-validation');
const {
  PRIMARY_CATEGORY_OPTIONS,
  normalizePrimaryCategory,
  buildPrimaryCategoryList
} = require('../lib/person-taxonomy');

const router = express.Router();

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

function toTagArray(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function toPopularity(value) {
  const popularity = Number(value);
  return Number.isFinite(popularity) ? popularity : 0;
}

function normalizePersonInput(input = {}) {
  return {
    name: input.name,
    displayNameJa: input.displayNameJa,
    slug: input.slug,
    summary: input.summary,
    coreMessage: input.coreMessage,
    career: input.career,
    bio: input.bio,
    occupation: input.occupation,
    occupationJa: input.occupationJa,
    occupationEn: input.occupationEn,
    countryCode: input.countryCode,
    countryJa: input.countryJa,
    countryEn: input.countryEn,
    imageUrl: input.imageUrl,
    keywords: toTagArray(input.keywords),
    category: normalizePrimaryCategory(input.category),
    popularity: toPopularity(input.popularity),
    tags: toTagArray(input.tags),
    intro: input.intro,
    featured: input.featured === 'on'
  };
}

async function renderPersonForm(res, { person = null, errorMessage = '', formValues = {} } = {}) {
  const categoryOptions = buildPrimaryCategoryList([person ? person.category : formValues.category]);
  const viewName = person ? 'admin/people-edit' : 'admin/people-new';
  return res.render(viewName, {
    person,
    categoryOptions,
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

  return res.render('admin/influences-new', {
    people,
    books,
    influenceKindOptions: INFLUENCE_KIND_OPTIONS,
    formValues: data.formValues || {},
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
    const people = await Person.find({}).sort({ createdAt: -1 });
    res.render('admin/people-list', { people });
  } catch (error) {
    console.error('Failed to load people list:', error.message);
    res.status(500).send('Failed to load people list');
  }
});

router.get('/books', async (req, res) => {
  try {
    const books = await Book.find({}).sort({ createdAt: -1 });
    res.render('admin/books-list', { books });
  } catch (error) {
    console.error('Failed to load books list:', error.message);
    res.status(500).send('Failed to load books list');
  }
});

router.get('/influences', async (req, res) => {
  try {
    const influences = await Influence.find({})
      .sort({ featuredOrder: 1, createdAt: -1 })
      .populate('personId')
      .populate('bookId');

    const influencesWithKindLabel = influences.map((influence) => ({
      ...influence.toObject(),
      kindLabel: getInfluenceKindLabel(influence.kind)
    }));

    res.render('admin/influences-list', { influences: influencesWithKindLabel });
  } catch (error) {
    console.error('Failed to load influences list:', error.message);
    res.status(500).send('Failed to load influences list');
  }
});

router.get('/people/new', (req, res) => {
  res.render('admin/people-new', {
    categoryOptions: PRIMARY_CATEGORY_OPTIONS,
    errorMessage: '',
    formValues: {}
  });
});

router.post('/people', async (req, res) => {
  try {
    const personData = normalizePersonInput(req.body);
    const isDraft = req.body.saveAsDraft === 'on';

    if (isDraft) {
      personData.displayNameJa = personData.displayNameJa || personData.name;
      personData.occupationJa = personData.occupationJa || personData.occupation || '未設定（下書き）';
      personData.intro = personData.intro || '下書きです。公開前に内容を更新してください。';
      personData.summary = personData.summary || '下書き';
      personData.career = personData.career || '下書き';
      personData.bio = personData.bio || '下書き';
      personData.imageUrl = personData.imageUrl || '';
      personData.category = personData.category || '起業家';
      personData.countryJa = personData.countryJa || '未設定';
      if (!personData.tags.includes('下書き')) {
        personData.tags.push('下書き');
      }
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

router.post('/people/:id', async (req, res) => {
  try {
    const personData = normalizePersonInput(req.body);
    const validation = validatePersonTemplate(personData);
    if (!validation.ok) {
      const person = await Person.findById(req.params.id);
      if (!person) {
        return res.status(404).send('Person not found');
      }
      return renderPersonForm(res, {
        person,
        errorMessage: toValidationMessage(validation.missingFields),
        formValues: req.body
      });
    }

    await Person.findByIdAndUpdate(req.params.id, personData);

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
  res.render('admin/books-new', { duplicateCandidates: [] });
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
  try {
    const bookData = bookFieldsFromInput(req.body, slugify);

    try {
      const { patch } = await buildBookAutofillPatch(bookData, { respectExistingGoogleBooksId: true });
      Object.assign(bookData, patch);
    } catch (googleBooksError) {
      console.warn('Google Books auto-fill skipped:', googleBooksError.message);
    }

    const duplicateMatches = await findDuplicateBookMatches(Book, bookData, { Influence });
    const duplicate = duplicateMatches[0];

    if (duplicate) {
      const patch = buildFillBlankPatch(duplicate.book.toObject(), bookData);
      if (Object.keys(patch).length > 0) {
        await Book.updateOne({ _id: duplicate.book._id }, { $set: patch });
      }
      return res.redirect(`/admin/books/${duplicate.book._id}/edit`);
    }

    await Book.create(bookData);

    res.redirect('/admin');
  } catch (error) {
    console.error('Failed to create book:', error.message);
    res.status(500).send('Failed to create book');
  }
});

router.get('/books/duplicate-candidates', async (req, res) => {
  try {
    const bookData = bookFieldsFromInput(req.query, slugify);
    const duplicateMatches = await findDuplicateBookMatches(Book, bookData, { Influence });

    return res.json({
      candidates: duplicateMatches.slice(0, 5).map((match) => ({
        id: match.book._id,
        title: match.book.title,
        slug: match.book.slug,
        author: match.book.author,
        reason: match.reason,
        influenceCount: match.influenceCount
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
          errorMessage: result.message || 'Book を解決できなかったため、Influence を作成しませんでした。'
        });
      }

      resolvedBookId = String(result.book._id);
    }

    await Influence.create({
      personId: req.body.personId,
      bookId: resolvedBookId,
      kind: toInfluenceKind(req.body.kind),
      impactSummary: req.body.impactSummary,
      sourceTitle: req.body.sourceTitle,
      sourceUrl: req.body.sourceUrl,
      sourceType: req.body.sourceType,
      featuredOrder: Number(req.body.featuredOrder) || 0
    });

    res.redirect('/admin');
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

    return res.render('admin/influences-edit', { influence, people, books, influenceKindOptions: INFLUENCE_KIND_OPTIONS });
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

    res.redirect('/admin/influences');
  } catch (error) {
    console.error('Failed to update influence:', error.message);
    res.status(500).send('Failed to update influence');
  }
});

router.post('/influences/:id/delete', async (req, res) => {
  try {
    await Influence.findByIdAndDelete(req.params.id);
    res.redirect('/admin/influences');
  } catch (error) {
    console.error('Failed to delete influence:', error.message);
    res.status(500).send('Failed to delete influence');
  }
});

module.exports = router;
