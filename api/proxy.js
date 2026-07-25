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

    ['content-type', 'cache-control', 'etag', 'content-range', 'accept-ranges'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    });

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
