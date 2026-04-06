const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const Person = require('../models/Person');
const { resolveBookForInfluence } = require('../lib/resolve-book-for-influence');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';
const shouldApply = process.argv.includes('--apply');

const TARGET_PERSON_SLUG = 'jeff-bezos';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function isBlank(value) {
  return String(value || '').trim() === '';
}

function buildPatch(target, donor) {
  const patch = {};
  const fields = ['impactSummary', 'sourceTitle', 'sourceUrl', 'sourceType', 'featuredOrder'];

  fields.forEach((field) => {
    if ((target[field] === undefined || target[field] === null || isBlank(target[field])) && donor[field] !== undefined) {
      patch[field] = donor[field];
    }
  });

  return patch;
}

async function ensureBook(definition) {
  const resolved = await resolveBookForInfluence({
    Book,
    Influence,
    input: {
      bookQuery: definition.query,
      title: definition.title,
      author: definition.author,
      isbn13: definition.isbn13 || '',
      googleBooksId: definition.googleBooksId || ''
    },
    slugify,
    dryRun: !shouldApply
  });

  if (!resolved.ok || !resolved.book) {
    throw new Error(`Failed to resolve book "${definition.title}": ${resolved.error || 'unknown_error'}`);
  }

  return resolved;
}

async function upsertInfluence({ personId, bookId, desiredKind, defaults, logPrefix }) {
  const existingAnyKind = await Influence.find({ personId, bookId }).sort({ createdAt: 1 });
  const desiredExisting = existingAnyKind.find((item) => item.kind === desiredKind);

  if (desiredExisting) {
    const sameBookWrongKind = existingAnyKind.filter((item) => item.kind !== desiredKind);
    const patch = buildPatch(desiredExisting, defaults);

    if (!shouldApply) {
      console.log(`${logPrefix} keep existing desired influence id=${desiredExisting._id}`);
      if (Object.keys(patch).length > 0) {
        console.log(`${logPrefix} would patch desired influence fields=${Object.keys(patch).join(',')}`);
      }
      sameBookWrongKind.forEach((item) => {
        console.log(`${logPrefix} would delete duplicate wrong-kind influence id=${item._id} kind=${item.kind}`);
      });
      return;
    }

    if (Object.keys(patch).length > 0) {
      await Influence.updateOne({ _id: desiredExisting._id }, { $set: patch });
      console.log(`${logPrefix} patched desired influence id=${desiredExisting._id} fields=${Object.keys(patch).join(',')}`);
    } else {
      console.log(`${logPrefix} kept desired influence id=${desiredExisting._id}`);
    }

    for (const item of sameBookWrongKind) {
      await Influence.deleteOne({ _id: item._id });
      console.log(`${logPrefix} deleted duplicate wrong-kind influence id=${item._id} kind=${item.kind}`);
    }
    return;
  }

  if (existingAnyKind.length > 0) {
    const candidate = existingAnyKind[0];
    const patch = {
      kind: desiredKind,
      ...buildPatch(candidate, defaults)
    };

    if (!shouldApply) {
      console.log(`${logPrefix} would move influence id=${candidate._id} kind:${candidate.kind}->${desiredKind}`);
      existingAnyKind.slice(1).forEach((dup) => {
        console.log(`${logPrefix} would delete duplicate influence id=${dup._id} kind=${dup.kind}`);
      });
      return;
    }

    await Influence.updateOne({ _id: candidate._id }, { $set: patch });
    console.log(`${logPrefix} moved influence id=${candidate._id} kind:${candidate.kind}->${desiredKind}`);

    for (const dup of existingAnyKind.slice(1)) {
      await Influence.deleteOne({ _id: dup._id });
      console.log(`${logPrefix} deleted duplicate influence id=${dup._id} kind=${dup.kind}`);
    }
    return;
  }

  if (!shouldApply) {
    console.log(`${logPrefix} would create influence kind=${desiredKind}`);
    return;
  }

  const created = await Influence.create({
    personId,
    bookId,
    kind: desiredKind,
    impactSummary: defaults.impactSummary,
    sourceTitle: defaults.sourceTitle,
    sourceUrl: defaults.sourceUrl,
    sourceType: defaults.sourceType,
    featuredOrder: defaults.featuredOrder
  });

  console.log(`${logPrefix} created influence id=${created._id} kind=${desiredKind}`);
}

async function printJeffSummary(personId) {
  const influences = await Influence.find({ personId }).populate('bookId', 'title').sort({ kind: 1, featuredOrder: 1, createdAt: 1 }).lean();
  const grouped = influences.reduce(
    (acc, item) => {
      const key = item.kind || 'influence';
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item.bookId?.title || '(book missing)');
      return acc;
    },
    { influence: [], about: [], authored: [] }
  );

  console.log('[summary] Jeff Bezos book groups');
  console.log(JSON.stringify(grouped, null, 2));
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[info] connected: ${MONGODB_URI}`);
  console.log(`[mode] ${shouldApply ? 'APPLY' : 'DRY-RUN'}`);

  const person = await Person.findOne({ slug: TARGET_PERSON_SLUG });
  if (!person) {
    throw new Error(`Person not found: ${TARGET_PERSON_SLUG}`);
  }

  const targets = [
    {
      title: 'The Everything Store: Jeff Bezos and the Age of Amazon',
      query: 'The Everything Store: Jeff Bezos and the Age of Amazon',
      author: 'Brad Stone',
      desiredKind: 'about',
      defaults: {
        impactSummary:
          '創業初期からAmazon拡大までの意思決定、組織文化、競争戦略を追うのに向いている。ベゾスの強みと苛烈さの両面を理解する入口になる。',
        sourceTitle: 'The Everything Store by Brad Stone',
        sourceUrl: 'https://www.goodreads.com/book/show/17660462-the-everything-store',
        sourceType: 'book-guide',
        featuredOrder: 1
      }
    },
    {
      title: 'Amazon Unbound: Jeff Bezos and the Invention of a Global Empire',
      query: 'Amazon Unbound: Jeff Bezos and the Invention of a Global Empire',
      author: 'Brad Stone',
      desiredKind: 'about',
      defaults: {
        impactSummary:
          'Amazonの巨大化フェーズでの意思決定、AWS・Prime・物流拡大、文化の変化を追える続編。The Everything Storeの続きとして人物像の立体感が増す。',
        sourceTitle: 'Amazon Unbound by Brad Stone',
        sourceUrl: 'https://www.goodreads.com/book/show/56426485-amazon-unbound',
        sourceType: 'book-guide',
        featuredOrder: 2
      }
    },
    {
      title: 'The Bezos Letters: 14 Principles to Grow Your Business Like Amazon',
      query: 'The Bezos Letters: 14 Principles to Grow Your Business Like Amazon',
      author: 'Steve Anderson with Karen Anderson',
      desiredKind: 'about',
      defaults: {
        impactSummary:
          '株主書簡の要点を14原則として整理しており、ベゾスの思考を外部から構造的に理解しやすい。Invent and Wanderの補助線として有効。',
        sourceTitle: 'The Bezos Letters by Steve Anderson',
        sourceUrl: 'https://www.steveanderson.com/the-bezos-letters',
        sourceType: 'book-guide',
        featuredOrder: 3
      }
    },
    {
      title: 'Invent and Wander: The Collected Writings of Jeff Bezos',
      query: 'Invent and Wander: The Collected Writings of Jeff Bezos',
      author: 'Jeff Bezos',
      isbn13: '9781982132616',
      googleBooksId: 'J6r5DwAAQBAJ',
      desiredKind: 'authored',
      defaults: {
        impactSummary:
          '株主への手紙やスピーチを通して、ベゾス自身の言葉で思想を追える本。Day 1、長期思考、顧客起点などを一次資料に近い形で理解しやすい。',
        sourceTitle: 'Invent and Wander',
        sourceUrl: 'https://www.simonandschuster.com/books/Invent-and-Wander/Jeff-Bezos/9781982132616',
        sourceType: 'book-guide',
        featuredOrder: 1
      }
    }
  ];

  for (const target of targets) {
    const resolved = await ensureBook(target);
    const bookId = resolved.book._id;
    const logPrefix = `[book] ${target.title} (id=${bookId})`;
    console.log(`${logPrefix} resolved action=${resolved.action} reason=${resolved.reason || '-'}`);

    await upsertInfluence({
      personId: person._id,
      bookId,
      desiredKind: target.desiredKind,
      defaults: target.defaults,
      logPrefix
    });
  }

  const everythingStoreBook = await Book.findOne({ slug: 'the-everything-store' }).lean();
  const everythingStoreAbout = everythingStoreBook
    ? await Influence.findOne({ personId: person._id, bookId: everythingStoreBook._id, kind: 'about' }).lean()
    : null;

  console.log('[check] The Everything Store status');
  console.log(`  - book exists: ${Boolean(everythingStoreBook)}`);
  console.log(`  - linked to Jeff/about: ${Boolean(everythingStoreAbout)}`);

  await printJeffSummary(person._id);
}

main()
  .catch((error) => {
    console.error('[error]', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
