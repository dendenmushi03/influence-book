const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    author: { type: String },
    isbn: { type: String },
    googleBooksId: { type: String },
    isbn10: { type: String },
    isbn13: { type: String },
    coverUrl: { type: String },
    description: { type: String },
    amazonUrl: { type: String },
    rakutenUrl: { type: String }
  },
  { timestamps: true }
);

bookSchema.index({ isbn: 1 }, { unique: true, sparse: true, name: 'uniq_book_isbn' });

module.exports = mongoose.model('Book', bookSchema);
