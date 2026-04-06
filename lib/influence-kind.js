const INFLUENCE_KIND_OPTIONS = [
  { value: 'influence', label: '影響を受けた本' },
  { value: 'about', label: 'この人を知る本' },
  { value: 'authored', label: '出版・監修している本' }
];

const INFLUENCE_KIND_VALUES = INFLUENCE_KIND_OPTIONS.map((option) => option.value);

function toInfluenceKind(value) {
  return INFLUENCE_KIND_VALUES.includes(value) ? value : 'influence';
}

function getInfluenceKindLabel(value) {
  const option = INFLUENCE_KIND_OPTIONS.find((item) => item.value === value);
  return option ? option.label : INFLUENCE_KIND_OPTIONS[0].label;
}

module.exports = {
  INFLUENCE_KIND_VALUES,
  INFLUENCE_KIND_OPTIONS,
  toInfluenceKind,
  getInfluenceKindLabel
};
