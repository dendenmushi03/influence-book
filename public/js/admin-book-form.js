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
  const isbn10Input = form.querySelector('[data-book-isbn10]');
  const isbn13Input = form.querySelector('[data-book-isbn13]');

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
      updateStatus('候補をフォームに反映しました。必要に応じて修正して保存してください。', false);
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
})();
