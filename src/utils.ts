export const fetchJson = async (url, params = {}) => {
  let res;
  try {
    res = await fetch(url, params);
    if (res.status !== 200) {
      console.log('res error');
      console.log(res);
      throw res;
    }
    return res.json();
  } catch (e) {
    console.log('fetchJson error', JSON.stringify(e));
  }
};
