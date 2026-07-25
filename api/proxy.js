export const config = { runtime: 'edge' };
export default async function handler(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, X-Koryo-Epg, Authorization, Accept, Referer, Origin, Cookie',   'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
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
    // Build headers to forward to Koryo.TV
    const fetchHeaders = {};    
    // Forward browser headers
    const forwardHeaders = ['x-koryo-epg', 'accept', 'cookie', 'user-agent'];
    forwardHeaders.forEach(h => {
      const val = request.headers.get(h);
      if (val) fetchHeaders[h] = val;
    });
    // Always set Referer and Origin to Koryo.TV (they check these)
    fetchHeaders['referer'] = 'https://koryo.tv/channel/kctv';
    fetchHeaders['origin'] = 'https://koryo.tv';
    const response = await fetch(target, {
      method: request.method,
      headers: fetchHeaders,
      redirect: 'follow',
    });
    // Build response headers
    const responseHeaders = { ...corsHeaders };  
    // Forward content headers
    ['content-type', 'content-encoding', 'content-length', 'cache-control', 'etag'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders[h] = val;
    });
    // Rewrite Set-Cookie to remove Domain attribute (critical!)
    // Otherwise browser rejects cookies from different domain
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      // Remove Domain=... and set Path=/ so browser accepts it
      let rewritten = setCookie
        .replace(/;\\s*Domain=[^;]+/gi, '')
        .replace(/;\\s*Path=[^;]+/gi, '; Path=/')
        .replace(/;\\s*SameSite=[^;]+/gi, '; SameSite=None');      
      // If Secure is not present, add it (required for SameSite=None)
      if (!rewritten.includes('Secure')) {
        rewritten += '; Secure';
      }     
      responseHeaders['set-cookie'] = rewritten;
    }
    // Get response body
    let body = response.body;    
    // If it's an m3u8, rewrite relative URLs to absolute
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('mpegurl') || contentType.includes('m3u8') || target.includes('.m3u8')) {
      const text = await response.text();
      const baseOrigin = new URL(response.url).origin;      
      // Rewrite absolute paths and relative URLs in m3u8
      let rewritten = text
        // Rewrite URI="/path" to absolute
        .replace(/URI="([^"]+)"/g, (match, uri) => {
          if (uri.startsWith('http')) return match;
          if (uri.startsWith('/')) return `URI="${baseOrigin}${uri}"`;
          return `URI="${new URL(uri, response.url).href}"`;
        })
        // Rewrite segment lines (non-comments, non-absolute URLs)
        .replace(/^(?!#)(?!https?:\\/\\/)(\\S+)$/gm, (match) => {
          if (match.startsWith('/')) return baseOrigin + match;
          return new URL(match, response.url).href;
        });      
      body = rewritten;     responseHeaders['content-length'] = String(new TextEncoder().encode(body).length);     
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
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
