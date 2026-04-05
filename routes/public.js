const express = require('express');
const Person = require('../models/Person');
const Book = require('../models/Book');
const Influence = require('../models/Influence');

const router = express.Router();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', async (req, res) => {
  try {
    const featuredPeople = await Person.find({ featured: true }).sort({ createdAt: -1 }).limit(3);
    res.render('index', { featuredPeople });
  } catch (error) {
    console.error('Failed to load top page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/people', async (req, res) => {
  try {
    const query = {};
    const selectedCategory = req.query.category ? req.query.category.trim() : '';
    const selectedTag = req.query.tag ? req.query.tag.trim() : '';
    const requestedSort = req.query.sort ? req.query.sort.trim() : '';
    const selectedSort = requestedSort === 'new' ? 'new' : 'popular';

    if (selectedCategory) {
      query.category = selectedCategory;
    }

    if (selectedTag) {
      query.tags = selectedTag;
    }

    const sortOption =
      selectedSort === 'new'
        ? { createdAt: -1 }
        : { popularity: -1, createdAt: -1 };

    const [people, categories, tags] = await Promise.all([
      Person.find(query).sort(sortOption),
      Person.distinct('category', { category: { $exists: true, $nin: ['', null] } }),
      Person.distinct('tags', { tags: { $exists: true, $ne: [] } })
    ]);

    res.render('people', {
      people,
      categories: categories.filter(Boolean).sort(),
      tags: tags.filter(Boolean).sort(),
      filters: {
        category: selectedCategory,
        tag: selectedTag,
        sort: selectedSort
      }
    });
  } catch (error) {
    console.error('Failed to load people page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/people/:slug', async (req, res) => {
  try {
    const person = await Person.findOne({ slug: req.params.slug });

    if (!person) {
      return res.status(404).send('Person not found');
    }

    const influences = await Influence.find({ personId: person._id })
      .sort({ featuredOrder: 1, createdAt: 1 })
      .populate('bookId');

    res.render('person-detail', { person, influences });
  } catch (error) {
    console.error('Failed to load person detail page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/books', async (req, res) => {
  try {
    const books = await Book.find({}).sort({ createdAt: -1 });
    res.render('books', { books });
  } catch (error) {
    console.error('Failed to load books page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/books/:slug', async (req, res) => {
  try {
    const book = await Book.findOne({ slug: req.params.slug });

    if (!book) {
      return res.status(404).send('Book not found');
    }

    const influences = await Influence.find({ bookId: book._id })
      .sort({ featuredOrder: 1, createdAt: 1 })
      .populate('personId');

    const influencedPeople = influences
      .map((influence) => influence.personId)
      .filter(Boolean);
    const influencedPersonIds = influencedPeople.map((person) => person._id);

    const collectedTags = [...new Set(influencedPeople.flatMap((person) => person.tags || []))];
    const collectedCategories = [...new Set(influencedPeople.map((person) => person.category).filter(Boolean))];

    let relatedPeople = [];

    if (collectedTags.length > 0) {
      relatedPeople = await Person.find({
        _id: { $nin: influencedPersonIds },
        tags: { $in: collectedTags }
      })
        .sort({ createdAt: -1 })
        .limit(6);
    }

    if (relatedPeople.length === 0 && collectedCategories.length > 0) {
      relatedPeople = await Person.find({
        _id: { $nin: influencedPersonIds },
        category: { $in: collectedCategories }
      })
        .sort({ createdAt: -1 })
        .limit(6);
    }

    if (relatedPeople.length === 0) {
      relatedPeople = influencedPeople.slice(0, 6);
    }

    res.render('book-detail', {
      book,
      influences,
      influencedPeople,
      relatedPeople
    });
  } catch (error) {
    console.error('Failed to load book detail page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/search', async (req, res) => {
  try {
    const rawKeyword = req.query.q ? req.query.q.trim() : '';
    if (!rawKeyword) {
      return res.render('search', { keyword: '', peopleResults: [], bookResults: [] });
    }

    const regex = new RegExp(escapeRegex(rawKeyword), 'i');
    const [peopleResults, bookResults] = await Promise.all([
      Person.find({
        $or: [
          { name: regex },
          { displayNameJa: regex },
          { occupation: regex },
          { intro: regex },
          { summary: regex },
          { career: regex },
          { bio: regex },
          { category: regex },
          { tags: regex }
        ]
      }).sort({ createdAt: -1 }),
      Book.find({
        $or: [{ title: regex }, { author: regex }, { description: regex }]
      }).sort({ createdAt: -1 })
    ]);

    res.render('search', {
      keyword: rawKeyword,
      peopleResults,
      bookResults
    });
  } catch (error) {
    console.error('Failed to load search page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
