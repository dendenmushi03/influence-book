const mongoose = require('mongoose');

const personSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    bio: { type: String },
    occupation: { type: String },
    imageUrl: { type: String },
    keywords: [{ type: String }],
    intro: { type: String },
    featured: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Person', personSchema);
