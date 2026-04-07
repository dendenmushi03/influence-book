const express = require('express');
const Person = require('../models/Person');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const { buildPrimaryCategoryList, normalizePrimaryCategory } = require('../lib/person-taxonomy');

const router = express.Router();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPeopleSearchParams(filters) {
  const params = new URLSearchParams();

  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.category) {
    params.set('category', filters.category);
  }
  if (filters.country) {
    params.set('country', filters.country);
  }
  if (filters.tag) {
    params.set('tag', filters.tag);
  }
  if (filters.sort && filters.sort !== 'popular') {
    params.set('sort', filters.sort);
  }

  return params;
}

function normalizePeopleFilters(rawFilters = {}) {
  const requestedKeyword = rawFilters.q ? rawFilters.q.trim() : '';
  const keyword = requestedKeyword ? requestedKeyword.replace(/\s+/g, ' ') : '';
  const selectedCategory = normalizePrimaryCategory(rawFilters.category);
  const selectedCountry = rawFilters.country ? rawFilters.country.trim() : '';
  const selectedTag = rawFilters.tag ? rawFilters.tag.trim() : '';
  const requestedSort = rawFilters.sort ? rawFilters.sort.trim() : '';
  const selectedSort = requestedSort === 'new' ? 'new' : 'popular';

  return {
    q: keyword,
    category: selectedCategory,
    country: selectedCountry,
    countryLabel: '',
    tag: selectedTag,
    sort: selectedSort
  };
}

function hasPeopleFilters(filters) {
  return Boolean(filters.q || filters.category || filters.country || filters.tag || filters.sort === 'new');
}

function buildPeopleQuery(filters) {
  const query = {};

  if (filters.category) {
    query.category = filters.category;
  }

  if (filters.country) {
    query.countryCode = filters.country;
  }

  if (filters.tag) {
    query.tags = filters.tag;
  }

  if (filters.q) {
    const escapedKeyword = escapeRegex(filters.q);
    const keywordRegex = new RegExp(escapedKeyword, 'i');
    query.$or = [
      { name: keywordRegex },
      { displayNameJa: keywordRegex },
      { occupation: keywordRegex },
      { occupationJa: keywordRegex },
      { occupationEn: keywordRegex },
      { intro: keywordRegex },
      { summary: keywordRegex },
      { tags: keywordRegex },
      { keywords: keywordRegex }
    ];
  }

  return query;
}

function buildPeopleSortOption(sort) {
  return sort === 'new' ? { createdAt: -1 } : { popularity: -1, createdAt: -1 };
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

function buildCountryOptions(countries) {
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

  return [...countryMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

async function fetchPeopleFilterOptions() {
  const [categories, tags, countries] = await Promise.all([
    Person.distinct('category', { category: { $exists: true, $nin: ['', null] } }),
    Person.distinct('tags', { tags: { $exists: true, $ne: [] } }),
    Person.find(
      { countryCode: { $exists: true, $nin: ['', null] } },
      { countryCode: 1, countryJa: 1, countryEn: 1, _id: 0 }
    )
  ]);

  return {
    categories: buildPrimaryCategoryList(categories),
    tags: tags.filter(Boolean).sort(),
    countries: buildCountryOptions(countries)
  };
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
    const peopleFilters = normalizePeopleFilters(req.query);
    const peopleQuery = buildPeopleQuery(peopleFilters);
    const peopleSortOption = buildPeopleSortOption(peopleFilters.sort);
    const hasActivePeopleFilters = hasPeopleFilters(peopleFilters);

    const [featuredPeople, filterOptions, searchResultPeople, searchResultCount] = await Promise.all([
      Person.find({ featured: true }).sort({ createdAt: -1 }).limit(3),
      fetchPeopleFilterOptions(),
      hasActivePeopleFilters ? Person.find(peopleQuery).sort(peopleSortOption).limit(6) : Promise.resolve([]),
      hasActivePeopleFilters ? Person.countDocuments(peopleQuery) : Promise.resolve(0)
    ]);

    const selectedCountryLabel = peopleFilters.country
      ? (filterOptions.countries.find((country) => country.code === peopleFilters.country) || {}).label || peopleFilters.country
      : '';

    const indexPeopleFilters = {
      ...peopleFilters,
      countryLabel: selectedCountryLabel
    };
    const searchParams = toPeopleSearchParams(indexPeopleFilters).toString();

    res.render('index', {
      featuredPeople,
      peopleEntryCategories: filterOptions.categories,
      peopleEntryCountries: filterOptions.countries,
      peopleEntryTags: filterOptions.tags,
      peopleEntryFilters: indexPeopleFilters,
      topSearchHasActiveFilters: hasActivePeopleFilters,
      topSearchPeople: searchResultPeople,
      topSearchResultCount: searchResultCount,
      topSearchResultPath: `/people${searchParams ? `?${searchParams}` : ''}`,
      topSearchClearPath: '/'
    });
  } catch (error) {
    console.error('Failed to load top page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/people', async (req, res) => {
  try {
    const filters = normalizePeopleFilters(req.query);
    const query = buildPeopleQuery(filters);
    const sortOption = buildPeopleSortOption(filters.sort);

    const [people, filterOptions] = await Promise.all([
      Person.find(query).sort(sortOption),
      fetchPeopleFilterOptions()
    ]);

    const selectedCountryLabel = filters.country
      ? (filterOptions.countries.find((country) => country.code === filters.country) || {}).label || filters.country
      : '';

    res.render('people', {
      people,
      categories: filterOptions.categories,
      countries: filterOptions.countries,
      tags: filterOptions.tags,
      filters: {
        ...filters,
        country: filters.country,
        countryLabel: selectedCountryLabel,
        sort: filters.sort
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
