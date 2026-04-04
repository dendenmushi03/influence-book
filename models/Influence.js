const mongoose = require('mongoose');

const influenceSchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    impactSummary: { type: String },
    sourceTitle: { type: String },
    sourceUrl: { type: String },
    sourceType: { type: String },
    featuredOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Influence', influenceSchema);
