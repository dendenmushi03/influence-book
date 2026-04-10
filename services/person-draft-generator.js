const { generatePersonProfileDraft, buildCoreMessage, buildBio, buildIntro, buildCareerTimeline } = require('./person-profile-generator');
const {
  generatePersonBooksDraft,
  fetchAuthoredBookCandidates,
  fetchAboutBookCandidates,
  fetchInfluenceBookCandidates,
  slugify
} = require('./person-book-generator');

async function generatePersonDraft(person) {
  const [profileDraft, booksDraft] = await Promise.all([generatePersonProfileDraft(person), generatePersonBooksDraft(person)]);
  return {
    meta: {
      generatorVersion: 'v3',
      generatedAt: new Date().toISOString()
    },
    personPatch: profileDraft.personPatch,
    books: booksDraft.books,
    influences: booksDraft.influences
  };
}

module.exports = {
  generatePersonDraft,
  slugify,
  buildCoreMessage,
  buildBio,
  buildIntro,
  buildCareerTimeline,
  fetchAuthoredBookCandidates,
  fetchAboutBookCandidates,
  fetchInfluenceBookCandidates
};
