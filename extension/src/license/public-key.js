/**
 * Public key Ed25519 nhúng trong extension để verify offline.
 * Tương ứng license/keys/public.pem (keypair demo/dev).
 * Khi phát hành production: tạo keypair mới, thay PEM này, KHÔNG commit private.pem.
 */
module.exports.PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA4qUJe3GKRq5OaObIUDTZKPYCTG/46//YiCgK7ozPjW4=
-----END PUBLIC KEY-----
`;

module.exports.PUBLIC_KEY_READY = true;
