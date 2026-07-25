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
    const isBinaryAsset = target.includes('.ts') || target.includes('/key') || contentType.includes('mp2t') || contentType.includes('octet-stream');

    // Forward standard headers
    ['content-type', 'cache-control', 'etag', 'content-range', 'accept-ranges'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    });

    if (isBinaryAsset) {
      ['content-encoding', 'content-length'].forEach(h => {
        const val = response.headers.get(h);
        if (val) responseHeaders.set(h, val);
      });
    }

    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    let extractedCookies = [];
    
    setCookies.forEach(cookie => {
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

    let cookieToPass = extractedCookies.length > 0 ? extractedCookies.join('; ') : (kcookie || "");

    // IF IT'S A M3U8 PLAYLIST: Rewrite text links and embed cookies
    if (isM3u8) {
      const text = await response.text();
      const proxyBase = `${url.origin}${url.pathname}?url=`;
      
      const wrapUrl = (uri) => {
        const absoluteUrl = new URL(uri, response.url).href;
        let wrapped = `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
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
      
      responseHeaders.set('content-length', String(new TextEncoder().encode(rewritten).length));     
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // IF IT'S A BINARY ASSET (.ts segments or .key decryption files): 
    // Pull as raw ArrayBuffer so Vercel doesn't corrupt the bits.
    if (isBinaryAsset) {
      const buffer = await response.arrayBuffer();
      return new Response(buffer, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // Default fallback pass-through
    return new Response(response.body, {
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
