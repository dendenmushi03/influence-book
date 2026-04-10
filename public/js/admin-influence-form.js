(function initAdminInfluenceForm() {
  const form = document.querySelector('form[action="/admin/influences"]');
  if (!form) {
    return;
  }

  const queryInput = form.querySelector('[data-book-query]');
  const resolveButton = form.querySelector('[data-book-resolve]');
  const status = form.querySelector('[data-book-resolve-status]');
  const resolvedBookIdInput = form.querySelector('[data-resolved-book-id]');
  const bookSelect = form.querySelector('[data-book-id-select]');
  const reasonLabel = {
    googleBooksId: 'Google Books ID 一致',
    isbn13: 'ISBN-13 一致',
    isbn10: 'ISBN-10 一致',
    slug: 'slug 一致',
    title_author: 'タイトル・著者が近い'
  };

  function setStatus(message, isError) {
    if (!status) {
      return;
    }
    status.textContent = message;
    status.style.color = isError ? '#b64242' : '';
  }

  function clearResolvedBookId() {
    if (resolvedBookIdInput) {
      resolvedBookIdInput.value = '';
    }
  }

  async function resolveBook() {
    const bookQuery = queryInput ? queryInput.value.trim() : '';
    if (!bookQuery) {
      setStatus('タイトルまたは ISBN を入力してください。', true);
      clearResolvedBookId();
      return;
    }

    resolveButton.disabled = true;
    setStatus('Book を解決中です...', false);

    try {
      const params = new URLSearchParams({
        bookQuery
      });

      const response = await fetch(`/admin/influences/resolve-book?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(payload.message || 'Book の解決に失敗しました。', true);
        clearResolvedBookId();
        return;
      }

      if (payload.action === 'use_existing' && payload.resolvedBook) {
        if (resolvedBookIdInput) {
          resolvedBookIdInput.value = payload.resolvedBook.id;
        }
        if (bookSelect) {
          bookSelect.value = payload.resolvedBook.id;
        }
        const matchedBy = reasonLabel[payload.reason] || '既存データ一致';
        setStatus(`既存 Book を利用します: ${payload.resolvedBook.title}（${matchedBy}）`, false);
        return;
      }

      if (payload.action === 'create_new' && payload.candidate) {
        clearResolvedBookId();
        if (bookSelect) {
          bookSelect.value = '';
        }
        setStatus(`新規 Book を作成して紐づけます: ${payload.candidate.title || bookQuery}`, false);
        return;
      }

      clearResolvedBookId();
      setStatus('Book を解決できませんでした。', true);
    } catch (error) {
      console.error('Failed to resolve influence book:', error);
      clearResolvedBookId();
      setStatus('Book の解決に失敗しました。時間をおいて再試行してください。', true);
    } finally {
      resolveButton.disabled = false;
    }
  }

  if (resolveButton) {
    resolveButton.addEventListener('click', resolveBook);
  }

  if (queryInput) {
    queryInput.addEventListener('input', clearResolvedBookId);
  }

})();
