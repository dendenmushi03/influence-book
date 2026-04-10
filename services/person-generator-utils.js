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

module.exports = {
  getFetchOrThrow,
  slugify,
  truncate,
  splitSentences,
  normalizeForMatch,
  escapeRegExp,
  sanitizeProfileSentence,
  fetchWikipediaSummary
};
