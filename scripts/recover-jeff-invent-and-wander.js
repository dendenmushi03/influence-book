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

const INVENT_GOOGLE_BOOKS_ID = 'J6r5DwAAQBAJ';
const INVENT_ISBN13 = '9781982132616';

const shouldApply = process.argv.includes('--apply');
const shouldRepair = process.argv.includes('--repair');

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

function metadataScore(book = {}) {
  const fields = ['title', 'slug', 'author', 'coverUrl', 'googleBooksId', 'isbn', 'isbn10', 'isbn13', 'description'];
  return fields.reduce((score, field) => (isBlank(book[field]) ? score : score + 1), 0);
}

function buildBookPatchFromSources(targetBook, sourceBooks) {
  const patch = {};
  const fields = ['title', 'slug', 'author', 'coverUrl', 'googleBooksId', 'isbn', 'isbn10', 'isbn13', 'description'];

  fields.forEach((field) => {
    if (!isBlank(targetBook[field])) {
      return;
    }

    const donor = sourceBooks.find((book) => !isBlank(book[field]));
    if (donor) {
      patch[field] = donor[field];
    }
  });

  return patch;
}

async function listInventBooks() {
  const titleRegex = /invent\s+and\s+wander/i;
  const exactTitleRegex = /^invent and wander:\s*the collected writings of jeff bezos$/i;

  return Book.find({
    $or: [
      { slug: 'invent-and-wander' },
      { title: exactTitleRegex },
      { title: titleRegex },
      { googleBooksId: INVENT_GOOGLE_BOOKS_ID },
      { isbn13: INVENT_ISBN13 },
      { isbn: INVENT_ISBN13 }
    ]
  }).sort({ createdAt: 1 });
}

async function collectBookInfluenceInfo(books) {
  const ids = books.map((book) => book._id);
  const influences = await Influence.find({ bookId: { $in: ids } }).populate('personId', 'name slug').lean();
  const grouped = new Map();

  books.forEach((book) => grouped.set(String(book._id), []));
  influences.forEach((influence) => {
    const key = String(influence.bookId);
    const entry = grouped.get(key) || [];
    entry.push(influence);
    grouped.set(key, entry);
  });

  return books.map((book) => {
    const related = grouped.get(String(book._id)) || [];
    return {
      book,
      influences: related,
      influenceCount: related.length,
      metadataScore: metadataScore(book)
    };
  });
}

function toPrintableBookRow(entry) {
  return {
    _id: String(entry.book._id),
    title: entry.book.title || '',
    slug: entry.book.slug || '',
    author: entry.book.author || '',
    coverUrl: entry.book.coverUrl || '',
    googleBooksId: entry.book.googleBooksId || '',
    isbn: entry.book.isbn || '',
    isbn10: entry.book.isbn10 || '',
    isbn13: entry.book.isbn13 || '',
    influenceCount: entry.influenceCount,
    influences: entry.influences.map((influence) => ({
      influenceId: String(influence._id),
      kind: influence.kind || 'influence',
      personId: influence.personId ? String(influence.personId._id || influence.personId) : '',
      personName: influence.personId?.name || '',
      personSlug: influence.personId?.slug || ''
    }))
  };
}

function pickCanonicalEntry(entries) {
  const linkedEntries = entries.filter((entry) => entry.influenceCount > 0);
  const source = linkedEntries.length > 0 ? linkedEntries : entries;

  if (source.length === 0) {
    return null;
  }

  return [...source].sort((a, b) => {
    if ((a.influenceCount > 0) !== (b.influenceCount > 0)) {
      return a.influenceCount > 0 ? -1 : 1;
    }
    if (a.metadataScore !== b.metadataScore) {
      return b.metadataScore - a.metadataScore;
    }
    return new Date(a.book.createdAt).getTime() - new Date(b.book.createdAt).getTime();
  })[0];
}

async function ensureJeffAboutLink({ person, canonicalBookId }) {
  const existing = await Influence.findOne({ personId: person._id, kind: TARGET_KIND, bookId: canonicalBookId }).lean();
  if (existing) {
    return { status: 'already_linked', influenceId: String(existing._id) };
  }

  if (!shouldApply) {
    return { status: 'would_link' };
  }

  const aboutInfluences = await Influence.find({ personId: person._id, kind: TARGET_KIND }).sort({ featuredOrder: -1 }).lean();
  const maxFeaturedOrder = aboutInfluences.length > 0 ? Number(aboutInfluences[0].featuredOrder) || 0 : 0;
  const created = await Influence.create({
    personId: person._id,
    bookId: canonicalBookId,
    kind: TARGET_KIND,
    impactSummary:
      '株主への手紙やスピーチを通して、ベゾス自身の言葉で思想を追える本。Day 1、長期思考、顧客起点などを理解しやすい。',
    sourceTitle: 'Invent and Wander',
    sourceUrl: 'https://www.simonandschuster.com/books/Invent-and-Wander/Jeff-Bezos/9781982132616',
    sourceType: 'book-guide',
    featuredOrder: Math.max(maxFeaturedOrder + 1, 2)
  });

  return { status: 'linked', influenceId: String(created._id) };
}

async function unifyInfluencesToCanonical({ canonicalBook, duplicateBooks }) {
  const result = {
    moved: 0,
    deletedAsDuplicate: 0,
    mergedDuplicateInfluence: 0
  };

  for (const duplicateBook of duplicateBooks) {
    const duplicateInfluences = await Influence.find({ bookId: duplicateBook._id }).lean();

    for (const inf of duplicateInfluences) {
      const existing = await Influence.findOne({
        personId: inf.personId,
        kind: inf.kind || 'influence',
        bookId: canonicalBook._id
      });

      if (!existing) {
        if (shouldApply) {
          await Influence.updateOne({ _id: inf._id }, { $set: { bookId: canonicalBook._id } });
        }
        result.moved += 1;
        continue;
      }

      const patch = {};
      const fields = ['impactSummary', 'sourceTitle', 'sourceUrl', 'sourceType'];
      fields.forEach((field) => {
        if (isBlank(existing[field]) && !isBlank(inf[field])) {
          patch[field] = inf[field];
        }
      });

      const existingOrder = Number(existing.featuredOrder) || 0;
      const infOrder = Number(inf.featuredOrder) || 0;
      if (!existingOrder && infOrder) {
        patch.featuredOrder = infOrder;
      }

      if (shouldApply && Object.keys(patch).length > 0) {
        await Influence.updateOne({ _id: existing._id }, { $set: patch });
      }

      if (shouldApply) {
        await Influence.deleteOne({ _id: inf._id });
      }

      result.deletedAsDuplicate += 1;
      if (Object.keys(patch).length > 0) {
        result.mergedDuplicateInfluence += 1;
      }
    }
  }

  return result;
}

async function deleteOrphanDuplicateBooks(duplicateBooks) {
  const deleted = [];

  for (const book of duplicateBooks) {
    const remainingInfluenceCount = await Influence.countDocuments({ bookId: book._id });
    if (remainingInfluenceCount > 0) {
      continue;
    }

    if (shouldApply) {
      await Book.deleteOne({ _id: book._id });
    }
    deleted.push(String(book._id));
  }

  return deleted;
}

async function maybeCreateInventBook(entries) {
  if (entries.length > 0) {
    return null;
  }

  if (!shouldRepair || !shouldApply) {
    return null;
  }

  const resolved = await resolveBookForInfluence({
    Book,
    Influence,
    input: {
      bookQuery: TARGET_TITLE,
      title: TARGET_TITLE,
      author: TARGET_AUTHOR,
      isbn13: INVENT_ISBN13,
      googleBooksId: INVENT_GOOGLE_BOOKS_ID
    },
    slugify,
    dryRun: false
  });

  if (!resolved.ok || !resolved.book?._id) {
    throw new Error(`Invent and Wander restore failed: ${resolved.error || 'unknown_error'}`);
  }

  return {
    action: resolved.action,
    bookId: String(resolved.book._id),
    reason: resolved.reason || ''
  };
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[info] connected: ${MONGODB_URI}`);
  console.log(`[mode] ${shouldApply ? 'APPLY' : 'DRY-RUN'}${shouldRepair ? ' + REPAIR' : ''}`);

  const person = await Person.findOne({ slug: TARGET_PERSON_SLUG });
  if (!person) {
    throw new Error(`Person not found: ${TARGET_PERSON_SLUG}`);
  }

  const everythingStoreBook = await Book.findOne({ slug: EVERYTHING_STORE_SLUG });
  const everythingStoreInfluence = everythingStoreBook
    ? await Influence.findOne({ personId: person._id, kind: TARGET_KIND, bookId: everythingStoreBook._id }).lean()
    : null;

  console.log('[check] The Everything Store status');
  console.log(`  - book exists: ${Boolean(everythingStoreBook)}`);
  console.log(`  - linked to Jeff/about: ${Boolean(everythingStoreInfluence)}`);

  const createResult = await maybeCreateInventBook(await listInventBooks());
  if (createResult) {
    console.log(
      `[repair] Invent book restored via ${createResult.action} id=${createResult.bookId} reason=${createResult.reason || '-'}`
    );
  }

  const books = await listInventBooks();
  const entries = await collectBookInfluenceInfo(books);

  console.log('[current] Invent and Wander related books');
  console.log(JSON.stringify(entries.map(toPrintableBookRow), null, 2));

  if (entries.length === 0) {
    console.log('[summary] No Invent and Wander books found. Run with --apply --repair to recreate safely.');
    return;
  }

  const canonical = pickCanonicalEntry(entries);
  const duplicates = entries.filter((entry) => String(entry.book._id) !== String(canonical.book._id));
  const linkedWeak = entries.filter((entry) => entry.influenceCount > 0 && entry.metadataScore < canonical.metadataScore);
  const richUnlinked = entries.filter((entry) => entry.influenceCount === 0 && entry.metadataScore > 0);

  console.log(`[decision] canonicalBookId=${canonical.book._id}`);
  console.log(`[decision] canonicalReason=influenceCount:${canonical.influenceCount},metadataScore:${canonical.metadataScore}`);
  console.log(`[check] linked_but_weak_metadata_exists=${linkedWeak.length > 0}`);
  console.log(`[check] metadata_rich_but_unlinked_exists=${richUnlinked.length > 0}`);

  const canonicalInfluenceKinds = new Set(canonical.influences.map((inf) => inf.kind || 'influence'));
  if (canonical.influenceCount === 0) {
    console.log('[warning] linked canonical candidate does not exist (no book has influence).');
  }

  const metadataPatch = buildBookPatchFromSources(canonical.book, duplicates.map((entry) => entry.book));
  if (Object.keys(metadataPatch).length > 0) {
    console.log(`[plan] metadata patch for canonical: ${JSON.stringify(metadataPatch)}`);
    if (shouldApply) {
      await Book.updateOne({ _id: canonical.book._id }, { $set: metadataPatch });
    }
  } else {
    console.log('[plan] metadata patch for canonical: none');
  }

  const influenceUnify = await unifyInfluencesToCanonical({
    canonicalBook: canonical.book,
    duplicateBooks: duplicates.map((entry) => entry.book)
  });

  const deletedBookIds = await deleteOrphanDuplicateBooks(duplicates.map((entry) => entry.book));

  const ensureAbout = await ensureJeffAboutLink({ person, canonicalBookId: canonical.book._id });

  const finalEntries = await collectBookInfluenceInfo(await listInventBooks());

  console.log('[result]');
  console.log(
    JSON.stringify(
      {
        canonicalBookId: String(canonical.book._id),
        canonicalInfluenceKinds: Array.from(canonicalInfluenceKinds),
        metadataPatched: Object.keys(metadataPatch),
        influenceUnify,
        deletedBookIds,
        ensureAbout,
        finalBookCount: finalEntries.length,
        finalBooks: finalEntries.map(toPrintableBookRow),
        everythingStoreUnaffected: Boolean(everythingStoreBook) && Boolean(everythingStoreInfluence)
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[error]', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
