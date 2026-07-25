export const config = { runtime: 'edge' };

export default async function handler(request) {
  // 1. Dynamic Origin for Credentials
  const origin = request.headers.get('Origin') || '*';
  
  // Base URL of your proxy so we can loop requests back to it
  const proxyBaseUrl = new URL(request.url); 

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin, // Fixed: Cannot be '*' with credentials
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, X-Koryo-Epg, Authorization, Accept, Referer, Origin, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const target = proxyBaseUrl.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const fetchHeaders = {};    
    
    // Forward browser headers
    const forwardHeaders = ['x-koryo-epg', 'accept', 'cookie', 'user-agent'];
    forwardHeaders.forEach(h => {
      const val = request.headers.get(h);
      if (val) fetchHeaders[h] = val;
    });
    
    // Always set Referer and Origin to Koryo.TV
    fetchHeaders['referer'] = 'https://koryo.tv/channel/kctv';
    fetchHeaders['origin'] = 'https://koryo.tv';

    const response = await fetch(target, {
      method: request.method,
      headers: fetchHeaders,
      redirect: 'follow',
    });

    // Use Headers API to handle multiple Set-Cookie headers properly
    const responseHeaders = new Headers(corsHeaders);  
    
    // Forward safe content headers (Removed content-encoding and content-length for now)
    ['content-type', 'cache-control', 'etag'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    });

    // Rewrite Set-Cookie safely
    // Edge API getSetCookie() gets all cookies as an array. Using .get() merges them and breaks them.
    if (response.headers.getSetCookie) {
      const cookies = response.headers.getSetCookie();
      cookies.forEach(cookieStr => {
        let rewritten = cookieStr
          .replace(/;\s*Domain=[^;]+/gi, '')
          .replace(/;\s*Path=[^;]+/gi, '; Path=/')
          .replace(/;\s*SameSite=[^;]+/gi, '; SameSite=None');      
        
        if (!rewritten.includes('Secure')) {
          rewritten += '; Secure';
        }     
        responseHeaders.append('set-cookie', rewritten);
      });
    }

    let body = response.body;    
    const contentType = response.headers.get('content-type') || '';
    
    // Check if response is a playlist
    if (contentType.includes('mpegurl') || contentType.includes('m3u8') || target.includes('.m3u8')) {
      const text = await response.text();
      const targetUrlObj = new URL(response.url);
      
      // Helper function to wrap urls back into your proxy
      const proxyfy = (urlStr) => {
        let absoluteUrl = urlStr;
        // Make relative paths absolute to the koryo.tv domain
        if (!urlStr.startsWith('http')) {
          absoluteUrl = new URL(urlStr, targetUrlObj.href).href;
        }
        // Wrap it in your proxy URL
        const newUrl = new URL(proxyBaseUrl.pathname, proxyBaseUrl.origin);
        newUrl.searchParams.set('url', absoluteUrl);
        return newUrl.href;
      };

      // Rewrite absolute paths and relative URLs to flow through the proxy
      let rewritten = text
        .replace(/URI="([^"]+)"/g, (match, uri) => {
          return `URI="${proxyfy(uri)}"`; // Proxifies encryption keys/sub-playlists
        })
        .replace(/^(?!#)(\S+)$/gm, (match) => {
          return proxyfy(match); // Proxifies TS segments
        });      
      
      body = rewritten;     
      
      // Calculate new content length. Do NOT copy content-encoding!
      responseHeaders.set('content-length', String(new TextEncoder().encode(body).length));
      
    } else {
      // If it's a direct media segment (.ts), pass length and encoding safely
      ['content-length', 'content-encoding'].forEach(h => {
        const val = response.headers.get(h);
        if (val) responseHeaders.set(h, val);
      });
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
