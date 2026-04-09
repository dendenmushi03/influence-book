const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Influence = require('../models/Influence');
const Book = require('../models/Book');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influence-book';

async function run() {
  await mongoose.connect(MONGODB_URI);

  const duplicateInfluences = await Influence.aggregate([
    {
      $group: {
        _id: { personId: '$personId', bookId: '$bookId', kind: '$kind' },
        count: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]);

  const duplicateIsbn = await Book.aggregate([
    { $match: { isbn: { $exists: true, $ne: '' } } },
    {
      $group: {
        _id: '$isbn',
        count: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]);

  console.log('duplicateInfluences:', JSON.stringify(duplicateInfluences, null, 2));
  console.log('duplicateIsbn:', JSON.stringify(duplicateIsbn, null, 2));
}

run()
  .catch((error) => {
    console.error('check failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
