const ALLOWED_HOSTS = ['www.ciyuangu.com'];

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const targetUrlParam = searchParams.get('url');

  if (!targetUrlParam) {
    return new Response(
      JSON.stringify({ error: 'Missing url parameter' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlParam);
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid URL' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EnStory/1.0)',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    const contents = await response.text();

    return new Response(
      JSON.stringify({ contents, status: response.status }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
