const { searchGoogleBooks } = require('../lib/google-books');

function getFetchOrThrow() {
  if (typeof fetch === 'function') {
    return fetch;
  }

  throw new Error(
    'この実行環境では fetch が利用できません。Node.js 18+ で実行するか、fetch ポリフィルを導入してください。'
  );
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function truncate(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function splitSentences(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/(?<=[。！？.!?])\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function fetchWikipediaSummaryByTitle(title, lang) {
  const runtimeFetch = getFetchOrThrow();
  const endpoint = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const response = await runtimeFetch(endpoint, {
    headers: {
      'User-Agent': 'InfluenceBookDraftGenerator/1.0 (admin draft generation)'
    }
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Wikipedia API (${lang}) が ${response.status} を返しました。`);
  }

  const payload = await response.json();
  if (!payload || !payload.extract) {
    return null;
  }

  return {
    title: payload.title || title,
    extract: payload.extract,
    url: payload.content_urls && payload.content_urls.desktop ? payload.content_urls.desktop.page : '',
    lang
  };
}

async function fetchWikipediaSummary(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return null;
  }

  const candidates = [
    () => fetchWikipediaSummaryByTitle(normalizedName, 'ja'),
    () => fetchWikipediaSummaryByTitle(normalizedName, 'en')
  ];

  for (const loader of candidates) {
    try {
      const result = await loader();
      if (result) {
        return result;
      }
    } catch (error) {
      console.warn('Wikipedia summary fetch warning:', error.message);
    }
  }

  return null;
}

function buildPersonPatch(person, wikipediaSummary) {
  const fallbackCoreMessage = `${person.name}の意思決定と思考法を、実績・発言・読書から辿る。`;
  const fallbackBio = `${person.name}に関する人物情報の下書きです。管理画面で事実確認と表現調整を行ってください。`;
  const fallbackCareer = [
    `${person.name}の初期キャリアと価値観形成を整理する`,
    '転機となった意思決定・プロジェクトを確認する',
    '現在の活動と発信テーマを更新する'
  ].join('\n');

  if (!wikipediaSummary) {
    return {
      coreMessage: truncate(fallbackCoreMessage, 65),
      bio: truncate(fallbackBio, 320),
      career: fallbackCareer,
      intro: truncate(fallbackBio, 70)
    };
  }

  const sentences = splitSentences(wikipediaSummary.extract);
  const coreMessage = truncate(sentences[0] || fallbackCoreMessage, 65);
  const bio = truncate(sentences.slice(0, 4).join(' '), 360) || truncate(wikipediaSummary.extract, 360);

  const careerLines = sentences
    .slice(0, 5)
    .map((line) => truncate(line, 70))
    .filter(Boolean);

  return {
    coreMessage: coreMessage || truncate(fallbackCoreMessage, 65),
    bio: bio || truncate(fallbackBio, 320),
    career: careerLines.length > 0 ? careerLines.join('\n') : fallbackCareer,
    intro: truncate(sentences[0] || fallbackBio, 70)
  };
}

function classifyBookKind(candidate, personName, queryLabel) {
  const normalizedAuthor = String(candidate.author || '').toLowerCase();
  const normalizedName = String(personName || '').toLowerCase();
  const normalizedQuery = String(queryLabel || '').toLowerCase();

  if (normalizedAuthor && normalizedName && normalizedAuthor.includes(normalizedName)) {
    return 'authored';
  }
  if (normalizedQuery.includes('biography') || normalizedQuery.includes('伝記')) {
    return 'about';
  }
  return 'influence';
}

function buildImpactSummary(kind, personName, title) {
  if (kind === 'authored') {
    return `${personName}自身の発信テーマを把握するための候補書籍（${title}）。`;
  }
  if (kind === 'about') {
    return `${personName}の背景や意思決定を理解するための候補書籍（${title}）。`;
  }
  return `${personName}の思考形成に関連する可能性がある候補書籍（${title}）。`;
}

async function fetchBookCandidates(person, wikipediaSummary) {
  const querySet = [
    `${person.name} book`,
    `${person.name} biography`,
    `${person.name} 伝記`
  ];

  const uniqueByTitle = new Map();

  for (const query of querySet) {
    try {
      const candidate = await searchGoogleBooks(query);
      if (!candidate || !candidate.title) {
        continue;
      }

      const titleKey = String(candidate.title).trim().toLowerCase();
      if (uniqueByTitle.has(titleKey)) {
        continue;
      }

      uniqueByTitle.set(titleKey, {
        query,
        candidate
      });
    } catch (error) {
      console.warn('Google Books candidate fetch warning:', error.message);
    }
  }

  const sourceTitle = wikipediaSummary
    ? `${wikipediaSummary.title} - Wikipedia (${wikipediaSummary.lang})`
    : 'Google Books 検索結果';
  const sourceUrl = wikipediaSummary ? wikipediaSummary.url : '';
  const sourceType = wikipediaSummary ? 'wikipedia' : 'google_books';

  return [...uniqueByTitle.values()].slice(0, 6).map(({ query, candidate }, index) => {
    const kind = classifyBookKind(candidate, person.name, query);
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
        impactSummary: buildImpactSummary(kind, person.name, title),
        sourceTitle,
        sourceUrl,
        sourceType,
        featuredOrder: index + 1
      }
    };
  });
}

async function generatePersonDraft(person) {
  getFetchOrThrow();
  const normalizedName = String(person && person.name ? person.name : '').trim();
  if (!normalizedName) {
    const error = new Error('人物名が未入力のため下書きを生成できません。');
    error.code = 'invalid_person_name';
    throw error;
  }

  const wikipediaSummary = await fetchWikipediaSummary(normalizedName);
  const personPatch = buildPersonPatch(person, wikipediaSummary);
  const pairs = await fetchBookCandidates(person, wikipediaSummary);

  return {
    meta: {
      generatorVersion: 'v1',
      generatedAt: new Date().toISOString()
    },
    personPatch,
    books: pairs.map((item) => item.book),
    influences: pairs.map((item) => item.influence)
  };
}

module.exports = {
  generatePersonDraft,
  slugify
};
