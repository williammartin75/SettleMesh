import { createHmac, randomBytes } from "node:crypto";

// TOTP RFC 6238 (SHA-1, 6 chiffres, pas de 30 s) et Base32 RFC 4648,
// implémentation pure Node sans dépendance. La vérification accepte une
// fenêtre de ±1 pas (dérive d'horloge) et compare en temps constant.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let output = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

const hotp = (hmac, digits) => {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
};

export function totpCode(secretBase32, { timestampMs = Date.now(), period = 30, digits = 6 } = {}) {
  const counter = Math.floor(timestampMs / 1000 / period);
  const secretBytes = base32Decode(secretBase32);
  // Compteur sur 8 octets grand-boutiste (HOTP RFC 4226)
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter - hi * 0x100000000;
  const message = Buffer.from([
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff
  ]);
  return hotp(createHmac("sha1", Buffer.from(secretBytes)).update(message).digest(), digits);
}

const constantEquals = (left, right) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

export function verifyTotp(secretBase32, candidate, { timestampMs = Date.now(), period = 30, digits = 6, window = 1 } = {}) {
  if (!/^\d{6}$/.test(String(candidate || "").trim())) return false;
  const expected = String(candidate).trim();
  for (let drift = -window; drift <= window; drift += 1) {
    if (constantEquals(totpCode(secretBase32, { timestampMs: timestampMs + drift * period * 1000, period, digits }), expected)) return true;
  }
  return false;
}

export function generateTotpSecret(email) {
  const secret = base32Encode(randomBytes(20));
  return {
    secret,
    otpauthUri: `otpauth://totp/${encodeURIComponent("SettleMesh")}:${encodeURIComponent(String(email || "membre"))}?secret=${secret}&issuer=SettleMesh&algorithm=SHA1&digits=6&period=30`
  };
}
