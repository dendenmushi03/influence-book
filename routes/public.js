const express = require('express');
const Person = require('../models/Person');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const { buildPrimaryCategoryList, normalizePrimaryCategory } = require('../lib/person-taxonomy');

const router = express.Router();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toIdString(value) {
  return value ? String(value) : '';
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean);
}

function compareRelatedPeople(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  if ((b.person.popularity || 0) !== (a.person.popularity || 0)) {
    return (b.person.popularity || 0) - (a.person.popularity || 0);
  }

  const aCreatedAt = a.person.createdAt ? new Date(a.person.createdAt).getTime() : 0;
  const bCreatedAt = b.person.createdAt ? new Date(b.person.createdAt).getTime() : 0;
  return bCreatedAt - aCreatedAt;
}

async function buildRelatedPeople(person, influences, maxPeople = 4) {
  const currentPersonId = toIdString(person._id);
  const relatedCandidateMap = new Map();

  const addCandidate = (candidate, score) => {
    if (!candidate) {
      return;
    }

    const candidateId = toIdString(candidate._id);
    if (!candidateId || candidateId === currentPersonId) {
      return;
    }

    const existing = relatedCandidateMap.get(candidateId);
    if (existing) {
      existing.score += score;
      return;
    }

    relatedCandidateMap.set(candidateId, { person: candidate, score });
  };

  const baseTags = normalizeTags(person.tags);
  const baseTagSet = new Set(baseTags);

  if (baseTags.length > 0) {
    const tagMatchedPeople = await Person.find({
      _id: { $ne: person._id },
      tags: { $in: baseTags }
    });

    tagMatchedPeople.forEach((candidate) => {
      const overlapCount = normalizeTags(candidate.tags).filter((tag) => baseTagSet.has(tag)).length;
      if (overlapCount > 0) {
        addCandidate(candidate, overlapCount * 100);
      }
    });
  }

  if (person.category) {
    const sameCategoryPeople = await Person.find({
      _id: { $ne: person._id },
      category: person.category
    });

    sameCategoryPeople.forEach((candidate) => addCandidate(candidate, 30));
  }

  const currentBookIds = [
    ...new Set(
      influences
        .map((influence) => toIdString(influence.bookId && influence.bookId._id ? influence.bookId._id : influence.bookId))
        .filter(Boolean)
    )
  ];

  if (currentBookIds.length > 0) {
    const sameBookInfluences = await Influence.find({
      personId: { $ne: person._id },
      bookId: { $in: currentBookIds }
    }).populate('personId');

    const sharedBookCountMap = new Map();
    const personMap = new Map();
    sameBookInfluences.forEach((record) => {
      const candidate = record.personId;
      const candidateId = toIdString(candidate && candidate._id ? candidate._id : candidate);
      if (!candidateId) {
        return;
      }

      sharedBookCountMap.set(candidateId, (sharedBookCountMap.get(candidateId) || 0) + 1);
      if (!personMap.has(candidateId)) {
        personMap.set(candidateId, candidate);
      }
    });

    personMap.forEach((candidate, candidateId) => {
      const sharedBookCount = sharedBookCountMap.get(candidateId) || 0;
      if (sharedBookCount > 1) {
        addCandidate(candidate, sharedBookCount * 20);
      } else if (sharedBookCount === 1) {
        addCandidate(candidate, 20);
      }
    });
  }

  const relatedPeople = [...relatedCandidateMap.values()].sort(compareRelatedPeople).map((entry) => entry.person);

  if (relatedPeople.length < maxPeople) {
    const pickedIds = new Set([currentPersonId, ...relatedPeople.map((candidate) => toIdString(candidate._id))]);
    const featuredPeople = await Person.find({
      featured: true,
      _id: { $nin: [...pickedIds] }
    })
      .sort({ popularity: -1, createdAt: -1 })
      .limit(maxPeople - relatedPeople.length);

    relatedPeople.push(...featuredPeople);
  }

  return relatedPeople.slice(0, maxPeople);
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
    const selectedCategory = normalizePrimaryCategory(req.query.category);
    const selectedCountry = req.query.country ? req.query.country.trim() : '';
    const selectedTag = req.query.tag ? req.query.tag.trim() : '';
    const requestedSort = req.query.sort ? req.query.sort.trim() : '';
    const selectedSort = requestedSort === 'new' ? 'new' : 'popular';

    if (selectedCategory) {
      query.category = selectedCategory;
    }

    if (selectedCountry) {
      query.countryCode = selectedCountry;
    }

    if (selectedTag) {
      query.tags = selectedTag;
    }

    const sortOption =
      selectedSort === 'new'
        ? { createdAt: -1 }
        : { popularity: -1, createdAt: -1 };

    const [people, categories, tags, countries] = await Promise.all([
      Person.find(query).sort(sortOption),
      Person.distinct('category', { category: { $exists: true, $nin: ['', null] } }),
      Person.distinct('tags', { tags: { $exists: true, $ne: [] } }),
      Person.find(
        { countryCode: { $exists: true, $nin: ['', null] } },
        { countryCode: 1, countryJa: 1, countryEn: 1, _id: 0 }
      )
    ]);

    const countryMap = new Map();
    countries.forEach((country) => {
      const code = (country.countryCode || '').trim();
      if (!code || countryMap.has(code)) {
        return;
      }
      countryMap.set(code, {
        code,
        label: country.countryJa || country.countryEn || code
      });
    });
    const selectedCountryLabel = selectedCountry
      ? (countryMap.get(selectedCountry) && countryMap.get(selectedCountry).label) || selectedCountry
      : '';

    res.render('people', {
      people,
      categories: buildPrimaryCategoryList(categories),
      countries: [...countryMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'ja')),
      tags: tags.filter(Boolean).sort(),
      filters: {
        category: selectedCategory,
        country: selectedCountry,
        countryLabel: selectedCountryLabel,
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

    const influenceBooks = influences.filter((influence) => influence.kind === 'influence');
    const aboutBooks = influences.filter((influence) => influence.kind === 'about');
    const authoredBooks = influences.filter((influence) => influence.kind === 'authored');
    const relatedPeople = await buildRelatedPeople(person, influences, 4);

    res.render('person-detail', { person, influenceBooks, aboutBooks, authoredBooks, relatedPeople });
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

    const influenceRecords = await Influence.find({ bookId: book._id })
      .sort({ featuredOrder: 1, createdAt: 1 })
      .populate('personId');

    const influences = influenceRecords.filter(
      (influence) => influence.kind === 'influence' || influence.kind === 'authored'
    );

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
