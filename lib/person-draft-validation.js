function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePersonTemplate(personInput = {}) {
  const missingFields = [];

  if (!hasText(personInput.name)) {
    missingFields.push('name');
  }

  if (!hasText(personInput.slug)) {
    missingFields.push('slug');
  }

  if (!hasText(personInput.occupationJa)) {
    missingFields.push('occupationJa');
  }

  if (!hasText(personInput.intro)) {
    missingFields.push('intro');
  }

  if (!hasText(personInput.career)) {
    missingFields.push('career');
  }


  if (!hasText(personInput.category)) {
    missingFields.push('category');
  }

  if (!hasText(personInput.countryJa)) {
    missingFields.push('countryJa');
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
