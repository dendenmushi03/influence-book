const express = require('express');
const Person = require('../models/Person');
const Influence = require('../models/Influence');

const router = express.Router();

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
    const people = await Person.find({}).sort({ createdAt: -1 });
    res.render('people', { people });
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

module.exports = router;
