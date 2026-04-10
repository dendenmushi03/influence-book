const {
  getFetchOrThrow,
  truncate,
  splitSentences,
  escapeRegExp,
  sanitizeProfileSentence,
  fetchWikipediaSummary
} = require('./person-generator-utils');

const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_PROFILE_MODEL || 'gpt-5-mini';

function parseCareerLine(line) {
  const normalized = String(line || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const recentMatch = normalized.match(/^近年(?:[:：]|\s+|は|に)?\s*(.+)$/);
  if (recentMatch && recentMatch[1]) {
    return truncate(`近年: ${recentMatch[1].trim()}`, 70);
  }

  const yearMatch = normalized.match(/((18|19|20)\d{2})年(?:[:：]|\s+|に)?\s*(.+)$/);
  if (yearMatch && yearMatch[3]) {
    return truncate(`${yearMatch[1]}年: ${yearMatch[3].trim()}`, 70);
  }
  return '';
}

function normalizeStructuredProfile(payload = {}, person) {
  const coreMessage = truncate(String(payload.coreMessage || '').trim(), 65);
  const bio = truncate(String(payload.bio || '').trim(), 320);
  const intro = truncate(String(payload.intro || '').trim(), 90).replace(new RegExp(escapeRegExp(person.name), 'gi'), '').trim();
  const careerLines = Array.isArray(payload.careerLines) ? payload.careerLines.map(parseCareerLine).filter(Boolean) : [];

  return {
    coreMessage,
    bio,
    intro,
    career: careerLines.join('\n')
  };
}

function summarizeStructuredProfileShape(payload = {}) {
  const careerLines = Array.isArray(payload.careerLines) ? payload.careerLines : [];
  return {
    keys: safeListKeys(payload),
    coreMessageLength: String(payload.coreMessage || '').trim().length,
    bioLength: String(payload.bio || '').trim().length,
    introLength: String(payload.intro || '').trim().length,
    careerLinesCount: careerLines.length,
    careerLineLengths: careerLines.slice(0, 10).map((line) => String(line || '').trim().length)
  };
}

function detectMissingNormalizedFields(normalized) {
  const missing = [];
  if (!normalized.coreMessage) {
    missing.push('coreMessage');
  }
  if (!normalized.bio) {
    missing.push('bio');
  }
  if (!normalized.intro) {
    missing.push('intro');
  }
  if (!normalized.career) {
    missing.push('career');
  }
  return missing;
}

function buildProfilePrompt(person, wikipediaSummary) {
  const sourceText = String((wikipediaSummary && wikipediaSummary.extract) || '').trim();
  return [
    'あなたは人物紹介サイトの編集者です。出力はJSONのみ。',
    '以下の人物について、人物情報の下書きを作成してください。',
    '',
    `人物名: ${person.name}`,
    `人物slug: ${person.slug || ''}`,
    '',
    '制約:',
    '- coreMessage: 肩書き列挙禁止。判断軸・姿勢・強みを短文で表現。',
    '- bio: 百科事典調禁止。役職列挙ではなく、意思決定スタイル・経営哲学・特徴を伝える。',
    '- intro: 短文。人物名を含めない。',
    '- careerLines: 行単位の年表。例「1986年: 〜」「近年: 〜」。',
    '- careerLines は最大8行+近年1行まで。',
    '',
    'careerLines作成ルール:',
    '- 大学卒業イベントがあればその年から開始。',
    '- なければ主要イベントの最初の年から開始。',
    '- 主要イベント例: 入社, 創業, 設立, 就任, 上場, 退任, 買収, 売却, 出版, 受賞。',
    '- 各行はスマホで読みやすい短さにする。',
    '',
    '参考情報（不確実な場合は断定しない）:',
    sourceText || '(参考情報なし)'
  ].join('\n');
}

function safeListKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).slice(0, 12);
}

function summarizeResponsesPayload(payload) {
  const outputItems = Array.isArray(payload && payload.output) ? payload.output : [];
  return {
    topLevelKeys: safeListKeys(payload),
    hasOutputText: typeof (payload && payload.output_text) === 'string' && payload.output_text.trim().length > 0,
    outputLength: outputItems.length,
    outputTypes: outputItems.map((item) => item && item.type).filter(Boolean),
    outputContentTypes: outputItems.map((item) =>
      Array.isArray(item && item.content) ? item.content.map((contentItem) => contentItem && contentItem.type).filter(Boolean) : []
    ),
    textKeys: safeListKeys(payload && payload.text)
  };
}

function isStructuredProfileCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return ['coreMessage', 'bio', 'intro', 'careerLines'].every((key) => keys.includes(key));
}

function parseJsonString(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function extractStructuredProfileFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const queue = [payload];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (isStructuredProfileCandidate(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      current.forEach((item) => {
        if (item && typeof item === 'object') {
          queue.push(item);
        } else if (typeof item === 'string') {
          const parsed = parseJsonString(item);
          if (parsed && typeof parsed === 'object') {
            queue.push(parsed);
          }
        }
      });
      continue;
    }

    Object.keys(current).forEach((key) => {
      const value = current[key];
      if (value && typeof value === 'object') {
        queue.push(value);
        return;
      }
      if (typeof value === 'string') {
        const parsed = parseJsonString(value);
        if (parsed && typeof parsed === 'object') {
          queue.push(parsed);
        }
      }
    });
  }

  return null;
}

async function generateProfileWithResponsesAPI(person, wikipediaSummary) {
  const runtimeFetch = getFetchOrThrow();
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY が未設定です。');
    error.code = 'missing_openai_api_key';
    throw error;
  }

  const response = await runtimeFetch(OPENAI_RESPONSES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'あなたは人物情報の編集アシスタントです。出力は指定スキーマのJSONのみ。'
            }
          ]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: buildProfilePrompt(person, wikipediaSummary) }]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'person_profile_draft',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['coreMessage', 'bio', 'intro', 'careerLines'],
            properties: {
              coreMessage: { type: 'string' },
              bio: { type: 'string' },
              intro: { type: 'string' },
              careerLines: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          },
          strict: true
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Responses API request failed with status ${response.status}: ${body.slice(0, 180)}`);
    error.code = 'openai_responses_failed';
    throw error;
  }

  const payload = await response.json();
  console.info('Responses API payload summary:', JSON.stringify(summarizeResponsesPayload(payload)));

  const outputText = typeof (payload && payload.output_text) === 'string' ? payload.output_text : '';

  let parsed = null;
  if (outputText.trim()) {
    try {
      parsed = JSON.parse(outputText);
    } catch (error) {
      console.warn(`Responses API output_text JSON parse failed: ${error.message}`);
    }
  } else {
    console.warn('Responses API の output_text が空です。payload.output から structured output を探索します。');
  }

  if (!parsed) {
    parsed = extractStructuredProfileFromPayload(payload);
  }

  if (!parsed) {
    const error = new Error('Responses API の structured output を取得できませんでした。');
    error.code = 'openai_missing_structured_output';
    throw error;
  }
  console.info('Responses API structured profile shape:', JSON.stringify(summarizeStructuredProfileShape(parsed)));

  const normalized = normalizeStructuredProfile(parsed, person);
  const missingFields = detectMissingNormalizedFields(normalized);
  if (missingFields.length > 0) {
    console.warn(`Responses API normalized profile missing fields: ${missingFields.join(', ')}`);
  }

  if (missingFields.length === 1 && missingFields[0] === 'career') {
    const fallbackCareer = buildCareerTimeline(person, wikipediaSummary);
    if (fallbackCareer) {
      normalized.career = fallbackCareer;
      console.warn('Responses API career が空のため、career のみ fallback 生成を適用しました。');
    }
  }

  const missingAfterCareerFallback = detectMissingNormalizedFields(normalized);
  if (missingAfterCareerFallback.length > 0) {
    const error = new Error('Responses API の構造化出力に必要項目が不足しています。');
    error.code = 'openai_incomplete_output';
    error.details = { missingFields: missingAfterCareerFallback };
    throw error;
  }
  return normalized;
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
  const fallback =
    '意思決定の基準・実行設計・組織への浸透の3点から、この人物らしさを説明する。実績の列挙よりも、どんな判断軸で打ち手を選ぶかに焦点を当てる。';
  const traits = inferPersonTraitPhrases(wikipediaSummary);
  const sentences = splitSentences(wikipediaSummary && wikipediaSummary.extract);
  const selected = pickPhilosophySentences(sentences, person.name).slice(0, 3);

  if (selected.length >= 2) {
    return truncate(
      `${selected[0]} ${selected[1]} 成果そのものより、なぜその意思決定を行ったか・どう再現可能な仕組みにしたかに人物像が表れる。`,
      320
    );
  }

  if (traits.length >= 3) {
    return truncate(
      `${traits.slice(0, 3).join('・')}を判断軸に、短期最適より長期の再現性を優先するタイプ。経歴の事実より、意思決定の癖と経営哲学に人物らしさが出る。`,
      320
    );
  }

  return truncate(fallback, 320);
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

function hasMajorEventKeyword(text) {
  return /(入社|創業|設立|就任|上場|退任|買収|売却|出版|受賞|創刊|任命|共同創業)/.test(text);
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

      if (!event || event.length < 5) {
        return;
      }

      const key = `${year}:${event}`;
      if (seenEventKeys.has(key)) {
        return;
      }
      seenEventKeys.add(key);

      const majorKeyword = hasMajorEventKeyword(event);
      const score =
        (/(大学|卒業)/.test(event) ? 10 : 0) +
        (majorKeyword ? 8 : 0) +
        (/(CEO|会長|社長|代表|役員)/.test(event) ? 3 : 0);

      events.push({ year, event: truncate(event, 52), score, majorKeyword });
    });
  });

  if (events.length === 0) {
    return '経歴生成に必要な年次情報を抽出できませんでした。一次情報で確認してください。';
  }

  const graduationEvent = events
    .filter((event) => /(大学|卒業)/.test(event.event))
    .sort((a, b) => a.year - b.year)[0];
  const firstMajorEvent = events.filter((event) => event.majorKeyword).sort((a, b) => a.year - b.year)[0];
  const baselineYear = graduationEvent ? graduationEvent.year : firstMajorEvent ? firstMajorEvent.year : events.sort((a, b) => a.year - b.year)[0].year;

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
    return '経歴生成に必要な主要な年次イベントを抽出できませんでした。一次情報で確認してください。';
  }

  const lines = dedupedByYear.slice(0, 8).map((event) => `${event.year}年: ${event.event}`);
  const recentSentence = sentences.find((sentence) => /(近年|現在|現在は|recently|today)/i.test(sentence));
  if (recentSentence) {
    const recent = sanitizeProfileSentence(recentSentence, person.name).replace(/^[^、。]*?(現在|近年)[は、]?/, '').trim();
    if (recent) {
      lines.push(`近年: ${truncate(recent, 52)}`);
    }
  }

  return lines.join('\n');
}

function buildPersonPatch(person, wikipediaSummary) {
  return {
    coreMessage: buildCoreMessage(person, wikipediaSummary),
    bio: buildBio(person, wikipediaSummary),
    intro: buildIntro(person, wikipediaSummary),
    career: buildCareerTimeline(person, wikipediaSummary)
  };
}

async function generatePersonProfileDraft(person) {
  getFetchOrThrow();
  const normalizedName = String(person && person.name ? person.name : '').trim();
  if (!normalizedName) {
    const error = new Error('人物名が未入力のため人物情報を生成できません。');
    error.code = 'invalid_person_name';
    throw error;
  }

  const wikipediaSummary = await fetchWikipediaSummary(normalizedName);
  let personPatch = null;
  let generatorVersion = 'profile-v1';

  try {
    personPatch = await generateProfileWithResponsesAPI(person, wikipediaSummary);
    generatorVersion = 'profile-v2-responses';
  } catch (error) {
    console.warn('Responses API profile generation fallback:', error.message);
    personPatch = buildPersonPatch(person, wikipediaSummary);
    generatorVersion = 'profile-v1-fallback';
  }

  return {
    meta: {
      generatorVersion,
      generatedAt: new Date().toISOString()
    },
    personPatch
  };
}

module.exports = {
  generatePersonProfileDraft,
  buildCoreMessage,
  buildBio,
  buildIntro,
  buildCareerTimeline
};
