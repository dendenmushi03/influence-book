function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePersonTemplate(personInput = {}) {
  const missingFields = [];

  if (!hasText(personInput.displayNameJa)) {
    missingFields.push('displayNameJa');
  }

  if (!hasText(personInput.occupationJa) && !hasText(personInput.occupation)) {
    missingFields.push('occupationJa or occupation');
  }

  if (!hasText(personInput.intro)) {
    missingFields.push('intro');
  }

  if (!hasText(personInput.summary) && !hasText(personInput.bio)) {
    missingFields.push('summary or bio');
  }

  if (!hasText(personInput.career)) {
    missingFields.push('career');
  }

  if (!hasText(personInput.imageUrl)) {
    missingFields.push('imageUrl');
  }

  if (!hasText(personInput.category)) {
    missingFields.push('category');
  }

  if (!hasText(personInput.countryJa) && !hasText(personInput.countryEn) && !hasText(personInput.countryCode)) {
    missingFields.push('country');
  }

  return {
    ok: missingFields.length === 0,
    missingFields
  };
}

function toValidationMessage(missingFields = []) {
  if (!missingFields.length) {
    return '';
  }
  return `入力不足: ${missingFields.join(', ')}`;
}

module.exports = {
  validatePersonTemplate,
  toValidationMessage
};
