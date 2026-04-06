const mongoose = require('mongoose');
const { INFLUENCE_KIND_VALUES } = require('../lib/influence-kind');

const influenceSchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    kind: { type: String, enum: INFLUENCE_KIND_VALUES, default: 'influence' },
    impactSummary: { type: String },
    sourceTitle: { type: String },
    sourceUrl: { type: String },
    sourceType: { type: String },
    featuredOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Influence', influenceSchema);
