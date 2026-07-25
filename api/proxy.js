const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'HEAD']
}));

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  const kcookie = req.query.kcookie;

  if (!target) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const fetchHeaders = new Headers();
    
    ['x-koryo-epg', 'accept', 'user-agent', 'range'].forEach(h => {
      const val = req.headers[h];
      if (val) fetchHeaders.set(h, val);
    });

    if (kcookie) {
      fetchHeaders.set('cookie', kcookie);
    } else if (req.headers.cookie) {
      fetchHeaders.set('cookie', req.headers.cookie);
    }

    fetchHeaders.set('referer', 'https://koryo.tv/channel/kctv');
    fetchHeaders.set('origin', 'https://koryo.tv');

    const response = await fetch(target, {
      method: req.method,
      headers: fetchHeaders,
      redirect: 'follow',
    });

    response.headers.forEach((val, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        const fixedCookies = response.headers.getSetCookie?.() || [val];
        fixedCookies.forEach(c => {
          let rewritten = c
            .replace(/;\s*Domain=[^;]+/gi, '')
            .replace(/;\s*Path=[^;]+/gi, '; Path=/')
            .replace(/;\s*SameSite=[^;]+/gi, '; SameSite=None');
          if (!rewritten.includes('Secure')) rewritten += '; Secure';
          res.append('Set-Cookie', rewritten);
        });
      } else if (!['content-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    });

    const contentType = response.headers.get('content-type') || '';
    const isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || target.includes('.m3u8');
    const isBinary = target.includes('.ts') || target.includes('/key') || contentType.includes('mp2t') || contentType.includes('octet-stream');

    if (isM3u8) {
      let text = await response.text();
      const host = req.get('host');
      const protocol = req.protocol;
      const proxyBase = `${protocol}://${host}/proxy?url=`;

      const rawCookies = response.headers.getSetCookie?.() || [];
      const extracted = rawCookies.map(c => c.split(';')[0]).join('; ');
      const cookieToPass = extracted || kcookie || '';

      const wrapUrl = (uri) => {
        const absoluteUrl = new URL(uri, response.url).href;
        let wrapped = `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
        if (cookieToPass) {
          wrapped += `&kcookie=${encodeURIComponent(cookieToPass)}`;
        }
        return wrapped;
      };

      text = text
        .replace(/URI="([^"]+)"/g, (match, uri) => `URI="${wrapUrl(uri.trim())}"`)
        .replace(/^(?!#)(.+)$/gm, (match, p1) => {
          const trimmed = p1.trim();
          if (!trimmed) return match;
          return wrapUrl(trimmed);
        });

      res.setHeader('Content-Length', Buffer.byteLength(text));
      return res.status(response.status).send(text);
    }

    if (isBinary || contentType.includes('xml') || contentType.includes('json')) {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Length', buffer.byteLength);
      return res.status(response.status).send(Buffer.from(buffer));
    }

    response.body.pipe(res);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Koryo Proxy running on port ${PORT}`);
});
