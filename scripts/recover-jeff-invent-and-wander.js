const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Book = require('../models/Book');
const Influence = require('../models/Influence');
const Person = require('../models/Person');
const { resolveBookForInfluence } = require('../lib/resolve-book-for-influence');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';
const TARGET_PERSON_SLUG = 'jeff-bezos';
const TARGET_KIND = 'about';
const TARGET_TITLE = 'Invent and Wander: The Collected Writings of Jeff Bezos';
const TARGET_AUTHOR = 'Jeff Bezos';
const EVERYTHING_STORE_SLUG = 'the-everything-store';

const shouldApply = process.argv.includes('--apply');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function ensureAboutInfluence({ personId, bookId, featuredOrderHint }) {
  const existing = await Influence.findOne({ personId, kind: TARGET_KIND, bookId }).lean();
  if (existing) {
    return { status: 'already_linked', influenceId: String(existing._id) };
  }

  if (!shouldApply) {
    return { status: 'would_link' };
  }

  const aboutInfluences = await Influence.find({ personId, kind: TARGET_KIND }).sort({ featuredOrder: -1 }).lean();
  const maxFeaturedOrder = aboutInfluences.length > 0 ? Number(aboutInfluences[0].featuredOrder) || 0 : 0;
  const featuredOrder = Math.max(maxFeaturedOrder + 1, featuredOrderHint || 2);

  const created = await Influence.create({
    personId,
    bookId,
    kind: TARGET_KIND,
    impactSummary:
      '株主への手紙やスピーチを通して、ベゾス自身の言葉で思想を追える本。Day 1、長期思考、顧客起点などを理解しやすい。',
    sourceTitle: 'Invent and Wander',
    sourceUrl: 'https://www.simonandschuster.com/books/Invent-and-Wander/Jeff-Bezos/9781982132616',
    sourceType: 'book-guide',
    featuredOrder
  });

  return { status: 'linked', influenceId: String(created._id), featuredOrder };
}

async function findInventAndWanderBook() {
  const titleRegex = /^invent and wander:\s*the collected writings of jeff bezos$/i;
  return Book.findOne({
    $or: [
      { slug: 'invent-and-wander' },
      { title: titleRegex },
      { googleBooksId: 'J6r5DwAAQBAJ' },
      { isbn13: '9781982132616' },
      { isbn: '9781982132616' }
    ]
  }).sort({ createdAt: 1 });
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[info] connected: ${MONGODB_URI}`);
  console.log(`[mode] ${shouldApply ? 'APPLY' : 'DRY-RUN'}`);

  const person = await Person.findOne({ slug: TARGET_PERSON_SLUG });
  if (!person) {
    throw new Error(`Person not found: ${TARGET_PERSON_SLUG}`);
  }

  console.log(`[person] ${person.name} (${person.slug}) id=${person._id}`);

  const everythingStoreBook = await Book.findOne({ slug: EVERYTHING_STORE_SLUG });
  const everythingStoreInfluence = everythingStoreBook
    ? await Influence.findOne({ personId: person._id, kind: TARGET_KIND, bookId: everythingStoreBook._id }).lean()
    : null;

  console.log('[check] The Everything Store status');
  console.log(`  - book exists: ${Boolean(everythingStoreBook)}`);
  console.log(`  - linked to Jeff/about: ${Boolean(everythingStoreInfluence)}`);

  let inventBook = await findInventAndWanderBook();
  console.log(`[check] Invent and Wander book exists: ${Boolean(inventBook)}`);

  let resolveAction = 'none';
  if (!inventBook && shouldApply) {
    const resolved = await resolveBookForInfluence({
      Book,
      Influence,
      input: {
        bookQuery: TARGET_TITLE,
        title: TARGET_TITLE,
        author: TARGET_AUTHOR,
        isbn13: '9781982132616'
      },
      slugify,
      dryRun: false
    });

    if (!resolved.ok || !resolved.book?._id) {
      throw new Error(`Invent and Wander restore failed: ${resolved.error || 'unknown_error'}`);
    }

    inventBook = await Book.findById(resolved.book._id);
    resolveAction = resolved.action;
    console.log(`[restore] Book resolved via ${resolved.action} (reason=${resolved.reason || '-'}) id=${resolved.book._id}`);
  }

  let linkResult = { status: 'not_possible_without_book' };
  if (inventBook) {
    linkResult = await ensureAboutInfluence({
      personId: person._id,
      bookId: inventBook._id,
      featuredOrderHint: 2
    });
  }

  const aboutRows = await Influence.find({ personId: person._id, kind: TARGET_KIND })
    .sort({ featuredOrder: 1, createdAt: 1 })
    .populate('bookId', 'title slug author')
    .lean();

  console.log('[result] Jeff Bezos / about books:');
  aboutRows.forEach((row, index) => {
    const book = row.bookId || {};
    console.log(
      `  ${index + 1}. featuredOrder=${row.featuredOrder} title=${book.title || '-'} slug=${book.slug || '-'} influenceId=${row._id}`
    );
  });

  console.log('[summary]');
  console.log(`  - inventBookFoundOrCreated: ${Boolean(inventBook)}`);
  console.log(`  - bookResolveAction: ${resolveAction}`);
  console.log(`  - linkResult: ${linkResult.status}`);
  console.log(`  - everythingStoreUnaffected: ${Boolean(everythingStoreBook) && Boolean(everythingStoreInfluence)}`);
}

main()
  .catch((error) => {
    console.error('[error]', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
