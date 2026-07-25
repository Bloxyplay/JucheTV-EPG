export const config = { runtime: 'edge' };

export default async function handler(request) {
  const reqOrigin = request.headers.get('Origin');
  
  // 1. Broaden CORS for Video Players
  const corsHeaders = {
    'Access-Control-Allow-Origin': reqOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Referer, Origin, Cookie, Range, Cache-Control, Pragma, X-Koryo-Epg',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
  };
  
  if (reqOrigin) {
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  }

  // Use 200 OK instead of 204. Some older video players drop 204 responses.
  if (request.method === 'OPTIONS') {
    return new Response('OK', { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const fetchHeaders = new Headers();
    
    // 2. Add 'range' so the proxy can handle chunked video requests
    const forwardHeaders = ['x-koryo-epg', 'accept', 'cookie', 'user-agent', 'range'];
    
    forwardHeaders.forEach(h => {
      const val = request.headers.get(h);
      if (val) fetchHeaders.set(h, val);
    });
    
    fetchHeaders.set('referer', 'https://koryo.tv/channel/kctv');
    fetchHeaders.set('origin', 'https://koryo.tv');

    const response = await fetch(target, {
      method: request.method,
      headers: fetchHeaders,
      redirect: 'follow',
    });

    const responseHeaders = new Headers();
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

    const contentType = response.headers.get('content-type') || '';
    const isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || target.includes('.m3u8');

    // 3. ONLY forward safe stream headers. Explicitly drop content-encoding 
    // and content-length for passthrough .ts streams to prevent corruption.
    ['content-type', 'cache-control', 'etag', 'content-range', 'accept-ranges'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    });

    const setCookies = typeof response.headers.getSetCookie === 'function' 
      ? response.headers.getSetCookie() 
      : [];
      
    setCookies.forEach(cookie => {
      let rewritten = cookie
        .replace(/;\s*Domain=[^;]+/gi, '')
        .replace(/;\s*Path=[^;]+/gi, '; Path=/')
        .replace(/;\s*SameSite=[^;]+/gi, '; SameSite=None');      
      
      if (!rewritten.includes('Secure')) {
        rewritten += '; Secure';
      }     
      responseHeaders.append('set-cookie', rewritten);
    });

    let body = response.body;    

    if (isM3u8) {
      const text = await response.text();
      const proxyBase = `${url.origin}${url.pathname}?url=`;
      
      const wrapUrl = (uri) => {
        const absoluteUrl = new URL(uri, response.url).href;
        return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
      };

      // 4. Bulletproof regex using .trim() to combat \r\n line-ending bugs
      let rewritten = text
        .replace(/URI="([^"]+)"/g, (match, uri) => `URI="${wrapUrl(uri.trim())}"`)
        .replace(/^(?!#)(.+)$/gm, (match, p1) => {
            const trimmed = p1.trim();
            if (!trimmed) return match;
            return wrapUrl(trimmed);
        });      
      
      body = rewritten;     
      
      // Re-calculate content length since we modified the text body
      responseHeaders.set('content-length', String(new TextEncoder().encode(body).length));     
    }
    
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
