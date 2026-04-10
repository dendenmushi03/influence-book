const { searchGoogleBooks } = require('../lib/google-books');
const { getFetchOrThrow, slugify, truncate, normalizeForMatch, fetchWikipediaSummary } = require('./person-generator-utils');

function mapBookCandidate(candidate, person, kind, impactSummary, featuredOrder, sourceTitle, sourceUrl, sourceType) {
  const title = truncate(candidate.title, 120);

  return {
    book: {
      title,
      slug: slugify(title),
      author: truncate(candidate.author, 120),
      description: truncate(candidate.description, 320),
      coverUrl: candidate.coverUrl || '',
      amazonUrl: '',
      rakutenUrl: '',
      googleBooksId: candidate.googleBooksId || '',
      isbn: candidate.isbn13 || candidate.isbn10 || '',
      isbn10: candidate.isbn10 || '',
      isbn13: candidate.isbn13 || ''
    },
    influence: {
      personSlug: person.slug,
      bookSlug: slugify(title),
      kind,
      impactSummary,
      sourceTitle,
      sourceUrl,
      sourceType,
      featuredOrder
    }
  };
}

function isLikelyAuthoredByPerson(candidate, personName) {
  const author = normalizeForMatch(candidate.author);
  const person = normalizeForMatch(personName);
  const title = String(candidate.title || '');
  return Boolean(
    author &&
      person &&
      (author.includes(person) || (title.includes(personName) && /(著|監修|自伝|回顧録)/.test(title)))
  );
}

function isLikelyAboutPerson(candidate, personName) {
  const title = String(candidate.title || '');
  const description = String(candidate.description || '');
  const aboutKeywords = /(伝記|評伝|biography|biographical|経営|思想|leadership|マネジメント)/i;
  const titleHasName = title.includes(personName);
  const descriptionHasName = description.includes(personName);
  return (titleHasName || descriptionHasName) && (aboutKeywords.test(title) || aboutKeywords.test(description));
}

async function fetchAuthoredBookCandidates(person) {
  const queries = [`inauthor:"${person.name}"`, `${person.name} 著書`, `${person.name} 監修 本`];

  const results = [];
  const seen = new Set();

  for (const query of queries) {
    try {
      const candidate = await searchGoogleBooks(query);
      if (!candidate || !candidate.title) {
        continue;
      }
      const key = normalizeForMatch(candidate.title);
      if (seen.has(key)) {
        continue;
      }
      if (!isLikelyAuthoredByPerson(candidate, person.name)) {
        continue;
      }
      seen.add(key);
      results.push(candidate);
    } catch (error) {
      console.warn('Google Books authored candidate fetch warning:', error.message);
    }
  }

  return results.slice(0, 3);
}

async function fetchAboutBookCandidates(person) {
  const queries = [`${person.name} 伝記`, `${person.name} 評伝`, `${person.name} 経営 思想`];

  const results = [];
  const seen = new Set();

  for (const query of queries) {
    try {
      const candidate = await searchGoogleBooks(query);
      if (!candidate || !candidate.title) {
        continue;
      }
      const key = normalizeForMatch(candidate.title);
      if (seen.has(key)) {
        continue;
      }
      if (isLikelyAuthoredByPerson(candidate, person.name)) {
        continue;
      }
      if (!isLikelyAboutPerson(candidate, person.name)) {
        continue;
      }
      seen.add(key);
      results.push(candidate);
    } catch (error) {
      console.warn('Google Books about candidate fetch warning:', error.message);
    }
  }

  return results.slice(0, 3);
}

async function fetchInfluenceBookCandidates(person, wikipediaSummary) {
  const extract = String((wikipediaSummary && wikipediaSummary.extract) || '');
  if (!/(影響|愛読|感銘|推薦|influenced|favorite)/i.test(extract)) {
    return [];
  }
  const quotedTitles = [...extract.matchAll(/『([^』]{2,80})』/g)].map((m) => m[1]).slice(0, 2);

  if (quotedTitles.length === 0) {
    return [];
  }

  const results = [];
  const seen = new Set();
  for (const title of quotedTitles) {
    try {
      const candidate = await searchGoogleBooks(title);
      if (!candidate || !candidate.title) {
        continue;
      }
      const key = normalizeForMatch(candidate.title);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(candidate);
    } catch (error) {
      console.warn('Google Books influence candidate fetch warning:', error.message);
    }
  }

  return results.slice(0, 2);
}

async function fetchBookCandidates(person, wikipediaSummary) {
  const [authoredCandidates, aboutCandidates, influenceCandidates] = await Promise.all([
    fetchAuthoredBookCandidates(person),
    fetchAboutBookCandidates(person),
    fetchInfluenceBookCandidates(person, wikipediaSummary)
  ]);

  const sourceTitle = wikipediaSummary
    ? `${wikipediaSummary.title} - Wikipedia (${wikipediaSummary.lang})`
    : 'Google Books 検索結果';
  const sourceUrl = wikipediaSummary ? wikipediaSummary.url : '';
  const sourceType = wikipediaSummary ? 'wikipedia' : 'google_books';

  const pairs = [];

  authoredCandidates.forEach((candidate) => {
    pairs.push(
      mapBookCandidate(
        candidate,
        person,
        'authored',
        `${person.name}本人の著作・監修として信頼度が高い候補。`,
        pairs.length + 1,
        sourceTitle,
        sourceUrl,
        sourceType
      )
    );
  });

  aboutCandidates.forEach((candidate) => {
    pairs.push(
      mapBookCandidate(
        candidate,
        person,
        'about',
        `${person.name}の人物理解や経営思想の把握に役立つ候補。`,
        pairs.length + 1,
        sourceTitle,
        sourceUrl,
        sourceType
      )
    );
  });

  influenceCandidates.forEach((candidate) => {
    pairs.push(
      mapBookCandidate(
        candidate,
        person,
        'influence',
        `${person.name}が影響を受けた可能性を補足する候補（根拠は要確認）。`,
        pairs.length + 1,
        sourceTitle,
        sourceUrl,
        sourceType
      )
    );
  });

  return pairs;
}

async function generatePersonBooksDraft(person) {
  getFetchOrThrow();
  const normalizedName = String(person && person.name ? person.name : '').trim();
  if (!normalizedName) {
    const error = new Error('人物名が未入力のため本情報を生成できません。');
    error.code = 'invalid_person_name';
    throw error;
  }

  const wikipediaSummary = await fetchWikipediaSummary(normalizedName);
  const pairs = await fetchBookCandidates(person, wikipediaSummary);

  return {
    meta: {
      generatorVersion: 'books-v1',
      generatedAt: new Date().toISOString()
    },
    books: pairs.map((item) => item.book),
    influences: pairs.map((item) => item.influence)
  };
}

module.exports = {
  generatePersonBooksDraft,
  fetchAuthoredBookCandidates,
  fetchAboutBookCandidates,
  fetchInfluenceBookCandidates,
  slugify
};
