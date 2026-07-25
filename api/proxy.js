export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Koryo-Epg');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: {},
    };

    // Forward specific headers
    ['x-koryo-epg', 'accept', 'referer', 'origin'].forEach(h => {
      if (req.headers[h]) fetchOptions.headers[h] = req.headers[h];
    });

    // Include cookies for session-based requests
    if (req.headers.cookie) {
      fetchOptions.headers['cookie'] = req.headers.cookie;
    }

    const response = await fetch(target, fetchOptions);

    // Forward response headers
    ['content-type', 'content-encoding', 'set-cookie'].forEach(h => {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    });

    const body = await response.arrayBuffer();
    res.status(response.status).send(Buffer.from(body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
