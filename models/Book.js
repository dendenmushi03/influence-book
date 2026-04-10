const mongoose = require('mongoose');

function emptyStringToUndefined(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    author: { type: String },
    isbn: { type: String, set: emptyStringToUndefined },
    googleBooksId: { type: String, set: emptyStringToUndefined },
    isbn10: { type: String, set: emptyStringToUndefined },
    isbn13: { type: String, set: emptyStringToUndefined },
    coverUrl: { type: String },
    description: { type: String },
    amazonUrl: { type: String },
    rakutenUrl: { type: String }
  },
  { timestamps: true }
);

bookSchema.index({ isbn: 1 }, { unique: true, sparse: true, name: 'uniq_book_isbn' });

module.exports = mongoose.model('Book', bookSchema);
