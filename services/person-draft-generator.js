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

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s・･・.,。、]/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeProfileSentence(sentence, personName) {
  let sanitized = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return '';
  }

  const escapedPersonName = escapeRegExp(personName);
  const leadingNamePattern = new RegExp(`^${escapedPersonName}\\s*は[、,]?`);
  sanitized = sanitized.replace(leadingNamePattern, '');
  sanitized = sanitized.replace(
    /^[^。]*?(日本の|アメリカの|実業家|起業家|投資家|政治家|俳優|歌手|作家|学者|YouTuber|馬主|CEO|会長|社長|創業者)[^。]*。[\s]*/g,
    ''
  );
  sanitized = sanitized.replace(/^[、,\s]+/, '').trim();
  return sanitized.trim();
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

function pickPhilosophySentences(sentences, personName) {
  const keywords = /(顧客|長期|意思決定|哲学|思考|戦略|仕組み|文化|実行|価値|徹底|重視|判断|リスク|挑戦|革新|構想|習慣|原則|基準|vision|strategy|leadership|decision)/i;
  const excluded = /(日本の|アメリカの|実業家|起業家|政治家|俳優|歌手|作家|馬主|CEO|会長|社長|創業者|生まれ|誕生|出身|である。?$)/;

  return sentences
    .map((sentence) => sanitizeProfileSentence(sentence, personName))
    .filter(Boolean)
    .filter((sentence) => !excluded.test(sentence))
    .filter((sentence) => keywords.test(sentence))
    .sort((a, b) => b.length - a.length);
}

function inferPersonTraitPhrases(wikipediaSummary) {
  const extract = String((wikipediaSummary && wikipediaSummary.extract) || '');
  const traitMap = [
    { pattern: /(顧客|顧客起点|customer)/i, phrase: '顧客起点' },
    { pattern: /(長期|long-term)/i, phrase: '長期視点' },
    { pattern: /(仕組み|制度|オペレーション)/i, phrase: '仕組み化' },
    { pattern: /(データ|検証|実験)/i, phrase: '検証重視' },
    { pattern: /(意思決定|判断)/i, phrase: '意思決定の明確さ' },
    { pattern: /(文化|組織)/i, phrase: '組織文化へのこだわり' },
    { pattern: /(挑戦|革新|新規)/i, phrase: '挑戦志向' },
    { pattern: /(実行|徹底)/i, phrase: '実行の徹底' }
  ];

  return traitMap.filter((item) => item.pattern.test(extract)).map((item) => item.phrase);
}

function buildCoreMessage(person, wikipediaSummary) {
  const fallback = '長期視点と本質思考で、再現性ある成果につなげる実行家。';
  const traits = inferPersonTraitPhrases(wikipediaSummary);
  if (traits.length >= 2) {
    return truncate(`${traits.slice(0, 2).join('と')}を軸に、意思決定を成果へ結びつける。`, 65);
  }

  const sentences = splitSentences(wikipediaSummary && wikipediaSummary.extract);
  const candidates = pickPhilosophySentences(sentences, person.name)
    .map((sentence) => truncate(sentence, 55))
    .filter(Boolean);

  return candidates[0] || fallback;
}

function buildBio(person, wikipediaSummary) {
  const fallback = '成果の大きさだけでなく、意思決定の基準や実行の仕組み化に特徴がある人物として整理する。';
  const traits = inferPersonTraitPhrases(wikipediaSummary);
  if (traits.length >= 3) {
    return truncate(
      `${traits.slice(0, 3).join('・')}を重視し、短期成果よりも再現性のある成長を設計するタイプ。` +
        '実績そのものより、判断基準と組織への落とし込み方に人物らしさが表れる。',
      320
    );
  }

  const sentences = splitSentences(wikipediaSummary && wikipediaSummary.extract);
  const selected = pickPhilosophySentences(sentences, person.name).slice(0, 3);

  if (selected.length === 0) {
    return truncate(fallback, 220);
  }

  const combined = selected.join(' ');
  return truncate(combined, 320);
}

function buildIntro(person, wikipediaSummary) {
  const fallback = '長期視点の意思決定と実行の仕組み化に特徴がある。成果だけでなく判断軸から人物像を捉えられる。';
  const traits = inferPersonTraitPhrases(wikipediaSummary);
  if (traits.length >= 2) {
    return truncate(`${traits.slice(0, 2).join('と')}に特徴がある。成果の背景にある判断軸を短く掴める。`, 90);
  }

  const sentences = splitSentences(wikipediaSummary && wikipediaSummary.extract);
  const selected = pickPhilosophySentences(sentences, person.name).slice(0, 2);

  if (selected.length === 0) {
    return truncate(fallback, 90);
  }

  const intro = truncate(selected.join(' '), 90);
  const escapedPersonName = escapeRegExp(person.name);
  return intro.replace(new RegExp(escapedPersonName, 'g'), '').trim() || truncate(fallback, 90);
}

function buildCareerTimeline(person, wikipediaSummary) {
  if (!wikipediaSummary || !wikipediaSummary.extract) {
    return '経歴生成に必要な年次情報を抽出できませんでした。一次情報で確認してください。';
  }

  const sentences = splitSentences(wikipediaSummary.extract);
  const events = [];
  const seenEventKeys = new Set();

  sentences.forEach((sentence) => {
    const yearMatch = sentence.match(/((18|19|20)\d{2})年/g);
    if (!yearMatch || yearMatch.length === 0) {
      return;
    }

    const pure = sanitizeProfileSentence(sentence, person.name);
    if (!pure || /(生まれ|誕生|出身)/.test(pure)) {
      return;
    }

    yearMatch.forEach((yearText) => {
      const year = Number(yearText.replace('年', ''));
      const event = pure
        .replace(/((18|19|20)\d{2})年(に|、)?/g, '')
        .replace(/^[、,\s]+/, '')
        .replace(/(同年|その後|のちに)$/g, '')
        .trim();

      if (!event || event.length < 6) {
        return;
      }

      const key = `${year}:${event}`;
      if (seenEventKeys.has(key)) {
        return;
      }
      seenEventKeys.add(key);
      const score =
        (/(大学|卒業)/.test(event) ? 10 : 0) +
        (/(創業|設立|入社|就任|上場|退任|買収|売却)/.test(event) ? 5 : 0) +
        (/(受賞|出版)/.test(event) ? 2 : 0);
      events.push({ year, event: truncate(event, 65), score });
    });
  });

  if (events.length === 0) {
    return '経歴生成に必要な年次情報を抽出できませんでした。一次情報で確認してください。';
  }

  const graduationEvent = events
    .filter((event) => /(大学|卒業)/.test(event.event))
    .sort((a, b) => a.year - b.year)[0];
  const majorEventThreshold = 5;
  const majorEvents = events.filter((event) => event.score >= majorEventThreshold);
  const firstMajorEvent = majorEvents.sort((a, b) => a.year - b.year)[0];
  const baselineYear = graduationEvent ? graduationEvent.year : firstMajorEvent ? firstMajorEvent.year : null;
  if (!baselineYear) {
    return '経歴生成に必要な主要な年次イベントを抽出できませんでした。一次情報で確認してください。';
  }

  const filtered = events
    .filter((event) => event.year >= baselineYear)
    .sort((a, b) => (a.year === b.year ? b.score - a.score : a.year - b.year));

  const dedupedByYear = [];
  const seenYear = new Set();
  filtered.forEach((event) => {
    if (seenYear.has(event.year)) {
      return;
    }
    seenYear.add(event.year);
    dedupedByYear.push(event);
  });

  if (dedupedByYear.length === 0) {
    return '経歴生成に必要な年次情報を抽出できませんでした。一次情報で確認してください。';
  }

  const lines = dedupedByYear.slice(0, 8).map((event) => `${event.year}年: ${event.event}`);
  const recentSentence = sentences.find((sentence) => /(近年|現在|現在は|recently|today)/i.test(sentence));
  if (recentSentence) {
    const recent = sanitizeProfileSentence(recentSentence, person.name).replace(/^[^、。]*?(現在|近年)[は、]?/, '').trim();
    if (recent) {
      lines.push(`近年: ${truncate(recent, 65)}`);
    }
  }

  return lines.join('\n');
}

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
  const queries = [
    `inauthor:"${person.name}"`,
    `${person.name} 著書`,
    `${person.name} 監修 本`
  ];

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
  const queries = [
    `${person.name} 伝記`,
    `${person.name} 評伝`,
    `${person.name} 経営 思想`
  ];

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

function buildPersonPatch(person, wikipediaSummary) {
  return {
    coreMessage: buildCoreMessage(person, wikipediaSummary),
    bio: buildBio(person, wikipediaSummary),
    intro: buildIntro(person, wikipediaSummary),
    career: buildCareerTimeline(person, wikipediaSummary)
  };
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
      generatorVersion: 'v2',
      generatedAt: new Date().toISOString()
    },
    personPatch,
    books: pairs.map((item) => item.book),
    influences: pairs.map((item) => item.influence)
  };
}

module.exports = {
  generatePersonDraft,
  slugify,
  buildCoreMessage,
  buildBio,
  buildIntro,
  buildCareerTimeline,
  fetchAuthoredBookCandidates,
  fetchAboutBookCandidates,
  fetchInfluenceBookCandidates
};
