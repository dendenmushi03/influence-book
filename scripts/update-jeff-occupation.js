const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Person = require('../models/Person');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';
const TARGET_SLUG = 'jeff-bezos';
const TARGET_OCCUPATION_JA = 'Amazon創業者';

async function updateJeffOccupation() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await Person.updateOne(
      { slug: TARGET_SLUG },
      { $set: { occupationJa: TARGET_OCCUPATION_JA } }
    );

    if (result.matchedCount === 0) {
      console.log(`No person found for slug: ${TARGET_SLUG}`);
      return;
    }

    console.log(
      `Updated ${TARGET_SLUG} occupationJa to "${TARGET_OCCUPATION_JA}" (modifiedCount: ${result.modifiedCount})`
    );
  } catch (error) {
    console.error('Failed to update Jeff Bezos occupation:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

updateJeffOccupation();
