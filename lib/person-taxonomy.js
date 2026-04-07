const PRIMARY_CATEGORY_OPTIONS = [
  '起業家',
  '経営者',
  '投資家',
  '発明家',
  '科学者',
  '研究者',
  '哲学者',
  '思想家',
  '作家',
  '芸術家',
  '音楽家',
  '俳優',
  '映画監督',
  'デザイナー',
  'コメディアン',
  'アイドル',
  'スポーツ選手',
  '政治家',
  'インフルエンサー'
];

function normalizePrimaryCategory(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function buildPrimaryCategoryList(existingCategories = []) {
  const normalizedExisting = existingCategories
    .map((category) => normalizePrimaryCategory(category))
    .filter(Boolean);

  const merged = [...PRIMARY_CATEGORY_OPTIONS];

  normalizedExisting.forEach((category) => {
    if (!merged.includes(category)) {
      merged.push(category);
    }
  });

  return merged;
}

module.exports = {
  PRIMARY_CATEGORY_OPTIONS,
  normalizePrimaryCategory,
  buildPrimaryCategoryList
};
