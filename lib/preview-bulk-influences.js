const { normalizeIsbn } = require('./google-books');
const { resolveBookForInfluence } = require('./resolve-book-for-influence');
const { toInfluenceKind } = require('./influence-kind');

function normalizeBulkLines(multilineBookInput) {
  return String(multilineBookInput || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toResolveInput(line) {
  const isbn = normalizeIsbn(line);
  return {
    bookQuery: line,
    title: isbn ? '' : line,
    isbn
  };
}

async function previewBulkInfluences({ Book, Influence, personId, kind, multilineBookInput, slugify }) {
  const normalizedKind = toInfluenceKind(kind);
  const lines = normalizeBulkLines(multilineBookInput);
  const rows = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawInput = lines[index];

    try {
      const result = await resolveBookForInfluence({
        Book,
        Influence,
        input: toResolveInput(rawInput),
        slugify,
        dryRun: true
      });

      if (!result.ok) {
        rows.push({
          lineNumber: index + 1,
          rawInput,
          status: 'failed_google_books_not_found',
          statusLabel: '候補なし',
          reason: result.error || 'google_books_not_found',
          reasonLabel: result.message || '既存 Book と Google Books の候補が見つかりませんでした。',
          resolvedTitle: '',
          resolvedAuthor: ''
        });
        continue;
      }

      const resolvedBook = result.book || {};
      const resolvedBookId = resolvedBook && resolvedBook._id ? String(resolvedBook._id) : '';

      if (resolvedBookId) {
        const existingInfluence = await Influence.findOne({
          personId,
          kind: normalizedKind,
          bookId: resolvedBookId
        }).lean();

        if (existingInfluence) {
          rows.push({
            lineNumber: index + 1,
            rawInput,
            status: 'skipped_existing_influence',
            statusLabel: '既存Influenceあり',
            reason: 'existing_influence',
            reasonLabel: '同じ人物・本・種類の Influence が既に存在します。',
            resolvedBookId,
            resolvedTitle: resolvedBook.title || '',
            resolvedAuthor: resolvedBook.author || ''
          });
          continue;
        }
      }

      rows.push({
        lineNumber: index + 1,
        rawInput,
        status: result.action === 'use_existing' ? 'use_existing_book' : 'create_new_book',
        statusLabel: result.action === 'use_existing' ? '既存Book利用' : '新規Book作成予定',
        reason: result.reason || '',
        reasonLabel: result.reason || '',
        resolvedBookId,
        resolvedTitle: resolvedBook.title || '',
        resolvedAuthor: resolvedBook.author || ''
      });
    } catch (error) {
      rows.push({
        lineNumber: index + 1,
        rawInput,
        status: 'failed_unexpected',
        statusLabel: 'エラー',
        reason: 'unexpected',
        reasonLabel: error.message || '予期せぬエラー',
        resolvedTitle: '',
        resolvedAuthor: ''
      });
    }
  }

  return {
    totalRows: rows.length,
    rows
  };
}

module.exports = {
  normalizeBulkLines,
  previewBulkInfluences
};
