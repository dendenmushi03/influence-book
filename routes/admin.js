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

module.exports = router;
