(function initAdminBookForm() {
  const form = document.querySelector('[data-book-form]');
  if (!form) {
    return;
  }

  const queryInput = form.querySelector('[data-google-books-query]');
  const fetchButton = form.querySelector('[data-google-books-fetch]');
  const statusElement = form.querySelector('[data-google-books-status]');

  const titleInput = form.querySelector('[data-book-title]');
  const authorInput = form.querySelector('[data-book-author]');
  const descriptionInput = form.querySelector('[data-book-description]');
  const coverUrlInput = form.querySelector('[data-book-cover-url]');
  const googleBooksIdInput = form.querySelector('[data-book-google-id]');
  const isbnInput = form.querySelector('[data-book-isbn]');
  const isbn10Input = form.querySelector('[data-book-isbn10]');
  const isbn13Input = form.querySelector('[data-book-isbn13]');
  const duplicateWarning = form.querySelector('[data-duplicate-warning]');
  const duplicateWarningMessage = form.querySelector('[data-duplicate-warning-message]');
  const duplicateList = form.querySelector('[data-duplicate-list]');

  function updateStatus(message, isError) {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message;
    statusElement.style.color = isError ? '#b64242' : '';
  }

  function applyBookCandidate(book) {
    if (!book) {
      return;
    }

    if (titleInput && book.title) {
      titleInput.value = book.title;
    }

    if (authorInput && book.authors) {
      authorInput.value = book.authors;
    }

    if (descriptionInput && book.description) {
      descriptionInput.value = book.description.slice(0, 3000);
    }

    if (coverUrlInput && book.coverUrl) {
      coverUrlInput.value = book.coverUrl;
    }

    if (googleBooksIdInput && book.googleBooksId) {
      googleBooksIdInput.value = book.googleBooksId;
    }

    if (isbn10Input && book.isbn10) {
      isbn10Input.value = book.isbn10;
    }

    if (isbn13Input && book.isbn13) {
      isbn13Input.value = book.isbn13;
    }
  }

  function reasonLabel(reason) {
    const labels = {
      googleBooksId: 'Google Books ID 一致',
      isbn: 'ISBN 一致',
      isbn13: 'ISBN-13 一致',
      isbn10: 'ISBN-10 一致',
      slug: 'slug 一致',
      title_author: 'タイトル・著者が近い'
    };
    return labels[reason] || '重複候補';
  }

  function updateDuplicateWarning(candidates) {
    if (!duplicateWarning || !duplicateList) {
      return;
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      duplicateWarning.hidden = true;
      if (duplicateWarningMessage) {
        duplicateWarningMessage.textContent = '';
      }
      duplicateList.innerHTML = '';
      return;
    }

    const hasHardDuplicate = candidates.some((candidate) =>
      ['googleBooksId', 'isbn', 'isbn13', 'isbn10', 'slug'].includes(String(candidate.reason || ''))
    );
    if (duplicateWarningMessage) {
      duplicateWarningMessage.textContent = hasHardDuplicate
        ? '重複候補が見つかりました。どのレコードに一致したか確認してから登録してください。'
        : '類似候補があります。別本ならそのまま登録できます。';
    }

    duplicateList.innerHTML = candidates
      .map((candidate) => {
        const title = candidate.title || '(タイトル未設定)';
        const author = candidate.author || '著者未設定';
        const influenceBadge = candidate.influenceCount > 0 ? ` / Influence紐づき ${candidate.influenceCount}件` : '';
        const matchedOn =
          candidate.matchedOn && candidate.matchedOn.incomingField && candidate.matchedOn.existingField
            ? ` / 判定: incoming.${candidate.matchedOn.incomingField} = existing.${candidate.matchedOn.existingField}`
            : '';
        const identifiers = ` / slug:${candidate.slug || '-'} / ISBN:${candidate.isbn || '-'} / ISBN-10:${candidate.isbn10 || '-'} / ISBN-13:${candidate.isbn13 || '-'} / Google Books ID:${candidate.googleBooksId || '-'}`;
        return `<li><a href=\"/admin/books/${candidate.id}/edit\">${title}（${author}）</a> - ${reasonLabel(candidate.reason)}${matchedOn}${influenceBadge}${identifiers}</li>`;
      })
      .join('');
    duplicateWarning.hidden = false;
  }

  let duplicateCheckTimer = null;
  async function checkDuplicateCandidates() {
    if (!titleInput || !titleInput.value.trim()) {
      updateDuplicateWarning([]);
      return;
    }

    const params = new URLSearchParams({
      title: titleInput ? titleInput.value : '',
      author: authorInput ? authorInput.value : '',
      googleBooksId: googleBooksIdInput ? googleBooksIdInput.value : '',
      isbn: isbnInput ? isbnInput.value : '',
      isbn10: isbn10Input ? isbn10Input.value : '',
      isbn13: isbn13Input ? isbn13Input.value : ''
    });

    try {
      const response = await fetch(`/admin/books/duplicate-candidates?${params.toString()}`);
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      updateDuplicateWarning(payload.candidates || []);
    } catch (error) {
      console.warn('Failed to check duplicate candidates:', error);
    }
  }

  function scheduleDuplicateCheck() {
    if (duplicateCheckTimer) {
      clearTimeout(duplicateCheckTimer);
    }
    duplicateCheckTimer = setTimeout(checkDuplicateCandidates, 250);
  }

  async function fetchGoogleBooksCandidate() {
    const query = queryInput ? queryInput.value.trim() : '';
    if (!query) {
      updateStatus('タイトルまたは ISBN を入力してください。', true);
      return;
    }

    fetchButton.disabled = true;
    updateStatus('Google Books から候補を取得中です...', false);

    try {
      const response = await fetch(`/admin/books/google-books?query=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          updateStatus('候補を取得できませんでした。キーワードを変えてお試しください。', true);
          return;
        }

        throw new Error(`request failed: ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.book) {
        updateStatus('候補を取得できませんでした。', true);
        return;
      }

      applyBookCandidate(payload.book);
      if (payload.coverSource === 'none') {
        updateStatus('書影を取得できませんでしたが、本情報は登録できます。必要に応じて手動で入力してください。', false);
      } else if (payload.coverSource === 'openbd') {
        updateStatus('候補をフォームに反映しました。書影は OpenBD から補完しています。必要に応じて修正して保存してください。', false);
      } else {
        updateStatus('候補をフォームに反映しました。必要に応じて修正して保存してください。', false);
      }
      scheduleDuplicateCheck();
    } catch (error) {
      console.error('Failed to fetch Google Books candidate:', error);
      updateStatus('候補を取得できませんでした。時間をおいて再試行してください。', true);
    } finally {
      fetchButton.disabled = false;
    }
  }

  if (fetchButton) {
    fetchButton.addEventListener('click', fetchGoogleBooksCandidate);
  }

  [titleInput, authorInput, googleBooksIdInput, isbnInput, isbn10Input, isbn13Input].forEach((input) => {
    if (!input) {
      return;
    }
    input.addEventListener('input', scheduleDuplicateCheck);
    input.addEventListener('blur', checkDuplicateCandidates);
  });
})();
