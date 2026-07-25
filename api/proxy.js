// api/proxy.js - Vercel Edge Function (no vercel.json needed)
export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, X-Koryo-Epg, Authorization, Accept, Referer, Origin, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter. Usage: /api/proxy?url=<target>' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const fetchHeaders = {};
    const forwardHeaders = ['x-koryo-epg', 'accept', 'referer', 'origin', 'cookie', 'user-agent', 'authorization'];
    
    forwardHeaders.forEach(h => {
      const val = request.headers.get(h);
      if (val) fetchHeaders[h] = val;
    });

    const response = await fetch(target, {
      method: request.method,
      headers: fetchHeaders,
    });

    const responseHeaders = { ...corsHeaders };
    ['content-type', 'content-encoding', 'content-length', 'cache-control', 'etag'].forEach(h => {
      const val = response.headers.get(h);
      if (val) responseHeaders[h] = val;
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) responseHeaders['set-cookie'] = setCookie;

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
