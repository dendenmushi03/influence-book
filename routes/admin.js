const express = require('express');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const Person = require('../models/Person');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('admin/login');
});

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
    const keywords = req.body.keywords
      ? req.body.keywords.split(',').map((word) => word.trim()).filter(Boolean)
      : [];

    await Person.create({
      name: req.body.name,
      slug: req.body.slug,
      bio: req.body.bio,
      occupation: req.body.occupation,
      imageUrl: req.body.imageUrl,
      keywords,
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
    console.error('Failed to load person edit page:', error.message);
    res.status(500).send('Failed to load person edit page');
  }
});

router.post('/people/:id', async (req, res) => {
  try {
    const keywords = req.body.keywords
      ? req.body.keywords.split(',').map((word) => word.trim()).filter(Boolean)
      : [];

    const person = await Person.findByIdAndUpdate(
      req.params.id,
      {
        name: req.body.name,
        slug: req.body.slug,
        bio: req.body.bio,
        occupation: req.body.occupation,
        imageUrl: req.body.imageUrl,
        keywords,
        intro: req.body.intro,
        featured: req.body.featured === 'on'
      },
      { new: true }
    );

    if (!person) {
      return res.status(404).send('Person not found');
    }

    res.redirect('/admin/people');
  } catch (error) {
    console.error('Failed to update person:', error.message);
    res.status(500).send('Failed to update person');
  }
});

router.post('/people/:id/delete', async (req, res) => {
  try {
    await Promise.all([
      Person.findByIdAndDelete(req.params.id),
      Influence.deleteMany({ personId: req.params.id })
    ]);

    res.redirect('/admin/people');
  } catch (error) {
    console.error('Failed to delete person:', error.message);
    res.status(500).send('Failed to delete person');
  }
});

router.get('/books/new', (req, res) => {
  res.render('admin/books-new');
});

router.post('/books', async (req, res) => {
  try {
    await Book.create({
      title: req.body.title,
      author: req.body.author,
      isbn: req.body.isbn,
      coverUrl: req.body.coverUrl,
      description: req.body.description,
      amazonUrl: req.body.amazonUrl,
      rakutenUrl: req.body.rakutenUrl
    });

    res.redirect('/admin');
  } catch (error) {
    console.error('Failed to create book:', error.message);
    res.status(500).send('Failed to create book');
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
    console.error('Failed to load book edit page:', error.message);
    res.status(500).send('Failed to load book edit page');
  }
});

router.post('/books/:id', async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      {
        title: req.body.title,
        author: req.body.author,
        isbn: req.body.isbn,
        coverUrl: req.body.coverUrl,
        description: req.body.description,
        amazonUrl: req.body.amazonUrl,
        rakutenUrl: req.body.rakutenUrl
      },
      { new: true }
    );

    if (!book) {
      return res.status(404).send('Book not found');
    }

    res.redirect('/admin/books');
  } catch (error) {
    console.error('Failed to update book:', error.message);
    res.status(500).send('Failed to update book');
  }
});

router.post('/books/:id/delete', async (req, res) => {
  try {
    await Promise.all([
      Book.findByIdAndDelete(req.params.id),
      Influence.deleteMany({ bookId: req.params.id })
    ]);

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

    res.render('admin/influences-edit', { influence, people, books });
  } catch (error) {
    console.error('Failed to load influence edit page:', error.message);
    res.status(500).send('Failed to load influence edit page');
  }
});

router.post('/influences/:id', async (req, res) => {
  try {
    const influence = await Influence.findByIdAndUpdate(
      req.params.id,
      {
        personId: req.body.personId,
        bookId: req.body.bookId,
        impactSummary: req.body.impactSummary,
        sourceTitle: req.body.sourceTitle,
        sourceUrl: req.body.sourceUrl,
        sourceType: req.body.sourceType,
        featuredOrder: Number(req.body.featuredOrder) || 0
      },
      { new: true }
    );

    if (!influence) {
      return res.status(404).send('Influence not found');
    }

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
