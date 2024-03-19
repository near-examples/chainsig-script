export const fetchJson = async (url, params = {}) =>
  fetch(url, params).then((r) => r.json());
