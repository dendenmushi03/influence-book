const mongoose = require('mongoose');

const personSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    displayNameJa: { type: String },
    slug: { type: String, required: true, unique: true },
    summary: { type: String },
    coreMessage: { type: String },
    career: { type: String },
    bio: { type: String },
    occupation: { type: String },
    occupationJa: { type: String },
    occupationEn: { type: String },
    countryCode: { type: String },
    countryJa: { type: String },
    countryEn: { type: String },
    imageUrl: { type: String },
    keywords: [{ type: String }],
    category: { type: String },
    popularity: { type: Number, default: 0 },
    tags: [{ type: String }],
    thoughtTraits: [{ type: String }],
    intro: { type: String },
    featured: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Person', personSchema);
