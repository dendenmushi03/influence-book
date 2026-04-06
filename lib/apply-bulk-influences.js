const { normalizeIsbn } = require('./google-books');
const { resolveBookForInfluence } = require('./resolve-book-for-influence');
const { normalizeBulkLines } = require('./preview-bulk-influences');
const { toInfluenceKind } = require('./influence-kind');

function toResolveInput(line) {
  const isbn = normalizeIsbn(line);
  return {
    bookQuery: line,
    title: isbn ? '' : line,
    isbn
  };
}

async function applyBulkInfluences({ Book, Influence, personId, kind, multilineBookInput, slugify, commonFields = {} }) {
  const normalizedKind = toInfluenceKind(kind);
  const lines = normalizeBulkLines(multilineBookInput);
  const rows = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawInput = lines[index];

    try {
      const resolved = await resolveBookForInfluence({
        Book,
        Influence,
        input: toResolveInput(rawInput),
        slugify,
        dryRun: false
      });

      if (!resolved.ok || !resolved.book || !resolved.book._id) {
        rows.push({
          lineNumber: index + 1,
          rawInput,
          status: resolved.error === 'google_books_not_found' ? 'failed_google_books_not_found' : 'failed_validation',
          statusLabel: resolved.error === 'google_books_not_found' ? '候補なし' : 'バリデーション失敗',
          reason: resolved.error || 'book_not_resolved',
          reasonLabel: resolved.message || 'Book を解決できませんでした。'
        });
        continue;
      }

      const bookId = String(resolved.book._id);
      const existingInfluence = await Influence.findOne({ personId, kind: normalizedKind, bookId }).lean();
      if (existingInfluence) {
        rows.push({
          lineNumber: index + 1,
          rawInput,
          status: 'skipped_existing_influence',
          statusLabel: '既存Influenceあり',
          reason: 'existing_influence',
          reasonLabel: '同じ人物・本・種類の Influence が既に存在します。',
          resolvedBookId: bookId,
          resolvedTitle: resolved.book.title || '',
          resolvedAuthor: resolved.book.author || ''
        });
        continue;
      }

      await Influence.create({
        personId,
        kind: normalizedKind,
        bookId,
        impactSummary: commonFields.impactSummary || '',
        sourceTitle: commonFields.sourceTitle || '',
        sourceUrl: commonFields.sourceUrl || '',
        sourceType: commonFields.sourceType || '',
        featuredOrder: Number(commonFields.featuredOrder) || 0
      });

      rows.push({
        lineNumber: index + 1,
        rawInput,
        status: resolved.action === 'use_existing' ? 'success_existing_book' : 'success_created_book',
        statusLabel: resolved.action === 'use_existing' ? '成功（既存Book）' : '成功（新規Book作成）',
        reason: resolved.reason || '',
        reasonLabel: resolved.reason || '',
        resolvedBookId: bookId,
        resolvedTitle: resolved.book.title || '',
        resolvedAuthor: resolved.book.author || ''
      });
    } catch (error) {
      rows.push({
        lineNumber: index + 1,
        rawInput,
        status: 'failed_unexpected',
        statusLabel: 'エラー',
        reason: 'unexpected',
        reasonLabel: error.message || '予期せぬエラー'
      });
    }
  }

  return {
    totalRows: rows.length,
    rows
  };
}

module.exports = {
  applyBulkInfluences
};
