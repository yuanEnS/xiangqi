// 验证 Google 登录返回的 ID 令牌（RS256 签名的 JWT）。keys 是 Google 公钥列表（JWKS 的 keys）。
// 通过时返回令牌内容，不通过返回 null。
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function base64url(text) {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

function parse(part) {
  return JSON.parse(new TextDecoder().decode(base64url(part)));
}

async function verifyGoogleToken(token, clientId, keys, now = Date.now()) {
  try {
    const [head, body, signature] = String(token).split('.');
    const header = parse(head);
    const jwk = keys.find(k => k.kid === header.kid);
    if (header.alg !== 'RS256' || !jwk) return null;
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    const signed = new TextEncoder().encode(`${head}.${body}`);
    if (!await crypto.subtle.verify(algorithm, key, base64url(signature), signed)) return null;
    const claims = parse(body);
    if (claims.aud !== clientId || !ISSUERS.includes(claims.iss)) return null;
    if (claims.exp * 1000 < now) return null;
    return claims;
  } catch (e) {
    return null;
  }
}

module.exports = { verifyGoogleToken };
