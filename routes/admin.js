const express = require('express');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const Person = require('../models/Person');
const { searchGoogleBooks, buildBookAutofillPatch } = require('../lib/google-books');
const { bookFieldsFromInput, findDuplicateBookMatches, buildFillBlankPatch } = require('../lib/book-dedup');

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

function toInfluenceKind(value) {
  return value === 'about' ? 'about' : 'influence';
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

    res.render('admin/influences-list', { influences });
  } catch (error) {
    console.error('Failed to load influences list:', error.message);
    res.status(500).send('Failed to load influences list');
  }
});

router.get('/people/new', (req, res) => {
  res.render('admin/people-new');
});

router.post('/people', async (req, res) => {
  try {
    const keywords = toTagArray(req.body.keywords);
    const tags = toTagArray(req.body.tags);

    await Person.create({
      name: req.body.name,
      displayNameJa: req.body.displayNameJa,
      slug: req.body.slug,
      summary: req.body.summary,
      career: req.body.career,
      bio: req.body.bio,
      occupation: req.body.occupation,
      occupationJa: req.body.occupationJa,
      occupationEn: req.body.occupationEn,
      countryCode: req.body.countryCode,
      countryJa: req.body.countryJa,
      countryEn: req.body.countryEn,
      imageUrl: req.body.imageUrl,
      keywords,
      category: req.body.category,
      popularity: toPopularity(req.body.popularity),
      tags,
      intro: req.body.intro,
      featured: req.body.featured === 'on'
    });

    res.redirect('/admin');
  } catch (error) {
    console.error('Failed to create person:', error.message);
    res.status(500).send('Failed to create person');
  }
});

router.get('/people/:id/edit', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).send('Person not found');
    }
    res.render('admin/people-edit', { person });
  } catch (error) {
    console.error('Failed to load person edit form:', error.message);
    res.status(500).send('Failed to load person edit form');
  }
});

router.post('/people/:id', async (req, res) => {
  try {
    const keywords = toTagArray(req.body.keywords);
    const tags = toTagArray(req.body.tags);

    await Person.findByIdAndUpdate(req.params.id, {
      name: req.body.name,
      displayNameJa: req.body.displayNameJa,
      slug: req.body.slug,
      summary: req.body.summary,
      career: req.body.career,
      bio: req.body.bio,
      occupation: req.body.occupation,
      occupationJa: req.body.occupationJa,
      occupationEn: req.body.occupationEn,
      countryCode: req.body.countryCode,
      countryJa: req.body.countryJa,
      countryEn: req.body.countryEn,
      imageUrl: req.body.imageUrl,
      keywords,
      category: req.body.category,
      popularity: toPopularity(req.body.popularity),
      tags,
      intro: req.body.intro,
      featured: req.body.featured === 'on'
    });

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
    const [people, books] = await Promise.all([
      Person.find({}).sort({ name: 1 }),
      Book.find({}).sort({ title: 1 })
    ]);

    res.render('admin/influences-new', { people, books });
  } catch (error) {
    console.error('Failed to load influence form:', error.message);
    res.status(500).send('Failed to load influence form');
  }
});

router.post('/influences', async (req, res) => {
  try {
    await Influence.create({
      personId: req.body.personId,
      bookId: req.body.bookId,
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

    return res.render('admin/influences-edit', { influence, people, books });
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
