export function findMatches(text, query) {
  if (!query) {
    return [];
  }

  const matches = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    matches.push({ from: index, to: index + query.length });
    index = haystack.indexOf(needle, index + query.length);
  }

  return matches;
}

export function nextMatchIndex(count, current, direction) {
  if (count === 0) {
    return -1;
  }

  return (current + direction + count) % count;
}

export function scrollRatio(scrollTop, scrollHeight, clientHeight) {
  const max = scrollHeight - clientHeight;
  return max <= 0 ? 0 : scrollTop / max;
}

export function scrollTopForRatio(scrollHeight, clientHeight, ratio) {
  return Math.round(Math.max(0, scrollHeight - clientHeight) * ratio);
}
