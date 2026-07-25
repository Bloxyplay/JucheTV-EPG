export const config = { runtime: 'edge' };

export default async function handler(request) {
  const reqOrigin = request.headers.get('Origin');
  
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

  if (request.method === 'OPTIONS') {
    return new Response('OK', { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  
  // 1. Intercept the custom cookie passed via URL
  const kcookie = url.searchParams.get('kcookie'); 

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const fetchHeaders = new Headers();
    const forwardHeaders = ['x-koryo-epg', 'accept', 'user-agent', 'range'];
    
    forwardHeaders.forEach(h => {
      const val = request.headers.get(h);
      if (val) fetchHeaders.set(h, val);
    });
    
    // 2. Prioritize our injected cookie; fallback to browser cookie if it exists
    if (kcookie) {
      fetchHeaders.set('cookie', kcookie);
    } else {
      const browserCookie = request.headers.get('cookie');
      if (browserCookie) fetchHeaders.set('cookie', browserCookie);
    }
    
    fetchHeaders.set('referer', 'https://koryo.tv/channel/kctv');
    fetchHeaders.set('origin', 'https://koryo.tv');
    fetchHeaders.delete('x-forwarded-for');
    fetchHeaders.delete('x-real-ip');

    const response = await fetch(target, {
      method: request.method,
      headers: fetchHeaders,
      redirect: 'follow',
    });

    const responseHeaders = new Headers();
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

    const contentType = response.headers.get('content-type') || '';
    const isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || target.includes('.m3u8');

    ['content-type', 'cache-control', 'etag', 'content-range', 'accept-ranges'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    });
    
    // 3. Extract cookies to pass them manually
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    let extractedCookies = [];
    
    setCookies.forEach(cookie => {
      // Extract just the "key=value" part for our manual URL injection
      const keyVal = cookie.split(';')[0];
      if (keyVal) extractedCookies.push(keyVal);

      let rewritten = cookie
        .replace(/;\s*Domain=[^;]+/gi, '')
        .replace(/;\s*Path=[^;]+/gi, '; Path=/')
        .replace(/;\s*SameSite=[^;]+/gi, '; SameSite=None');      
      
      if (!rewritten.includes('Secure')) {
        rewritten += '; Secure';
      }     
      responseHeaders.append('set-cookie', rewritten);
    });

    // 4. Determine which cookie string to pass forward to the next .ts chunks
    let cookieToPass = extractedCookies.length > 0 ? extractedCookies.join('; ') : (kcookie || "");

    let body = response.body;    

    if (isM3u8) {
      const text = await response.text();
      const proxyBase = `${url.origin}${url.pathname}?url=`;
      
      const wrapUrl = (uri) => {
        const absoluteUrl = new URL(uri, response.url).href;
        let wrapped = `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
        
        // 5. Inject the cookie directly into every .ts fragment URL
        if (cookieToPass) {
           wrapped += `&kcookie=${encodeURIComponent(cookieToPass)}`; 
        }
        return wrapped;
      };

      let rewritten = text
        .replace(/URI="([^"]+)"/g, (match, uri) => `URI="${wrapUrl(uri.trim())}"`)
        .replace(/^(?!#)(.+)$/gm, (match, p1) => {
            const trimmed = p1.trim();
            if (!trimmed) return match;
            return wrapUrl(trimmed);
        });      
      
      body = rewritten;     
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
