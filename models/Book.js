const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    author: { type: String },
    isbn: { type: String },
    coverUrl: { type: String },
    description: { type: String },
    amazonUrl: { type: String },
    rakutenUrl: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Book', bookSchema);
