/**
 * Make the iOS signing material through the App Store Connect API, so EAS
 * can build without a terminal prompt: a distribution certificate from a
 * fresh key, and an App Store provisioning profile for the bundle id.
 *
 * Writes into apps/app/credentials (gitignored):
 *   dist-key.pem, dist.cer, dist.p12 (password in dist.p12.password),
 *   nima.mobileprovision, and apps/app/credentials.json for EAS.
 *
 * Usage: node apple-signing.mjs <projectDir> <keyId> <issuerId> <p8Path> <bundleId> [profileName]
 */
import { execFileSync } from 'node:child_process';
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [projectDir, keyId, issuerId, p8Path, bundleIdentifier, profileName = 'Nima App Store'] = process.argv.slice(2);
if (!projectDir || !keyId || !issuerId || !p8Path || !bundleIdentifier) {
  console.error('usage: node apple-signing.mjs <projectDir> <keyId> <issuerId> <p8Path> <bundleId> [profileName]');
  process.exit(2);
}
const credDir = join(projectDir, 'credentials');
const openssl = process.env.OPENSSL ?? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const data = `${header}.${payload}`;
  const key = createPrivateKey(readFileSync(p8Path, 'utf8'));
  const sig = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(sig)}`;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail ?? e.title}`).join('; ') ?? text.slice(0, 300);
    throw new Error(`${method} ${path} -> ${res.status} ${detail}`);
  }
  return json;
}

function run(args) {
  return execFileSync(openssl, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

// 1. Bundle id.
const bundles = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleIdentifier)}&filter[platform]=IOS`);
let bundle = bundles.data.find((b) => b.attributes.identifier === bundleIdentifier);
if (!bundle) {
  console.log(`Registering bundle id ${bundleIdentifier}`);
  bundle = (
    await api('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: bundleIdentifier, name: 'Nima', platform: 'IOS' } },
    })
  ).data;
} else {
  console.log(`Bundle id ${bundleIdentifier} exists (${bundle.id}, ${bundle.attributes.name})`);
}

// 1b. Capabilities the app needs: Sign in with Apple.
const caps = await api('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`);
const capTypes = caps.data.map((c) => c.attributes.capabilityType);
console.log('Capabilities:', capTypes.join(', ') || 'none');
if (!capTypes.includes('APPLE_ID_AUTH')) {
  console.log('Enabling Sign in with Apple');
  await api('POST', '/v1/bundleIdCapabilities', {
    data: {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType: 'APPLE_ID_AUTH', settings: [] },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } },
    },
  });
}

// 2. Distribution certificate from a key we hold.
const existing = await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=50');
for (const c of existing.data) {
  console.log(`Existing cert: ${c.attributes.certificateType} ${c.attributes.serialNumber} ${c.attributes.displayName ?? ''} expires ${c.attributes.expirationDate}`);
}

const keyPem = join(credDir, 'dist-key.pem');
const csrPath = join(credDir, 'dist.csr');
if (!existsSync(keyPem)) {
  run(['genrsa', '-out', keyPem, '2048']);
}
run(['req', '-new', '-key', keyPem, '-out', csrPath, '-subj', '/CN=Nima AI Inc/O=Nima AI Inc/C=US']);
const csr = readFileSync(csrPath, 'utf8')
  .replace(/-----BEGIN CERTIFICATE REQUEST-----/, '')
  .replace(/-----END CERTIFICATE REQUEST-----/, '')
  .replace(/\s+/g, '');

let certId;
let certPath = join(credDir, 'dist.cer');
if (existsSync(join(credDir, 'dist.cert-id'))) {
  certId = readFileSync(join(credDir, 'dist.cert-id'), 'utf8').trim();
  console.log(`Reusing certificate ${certId}`);
} else {
  console.log('Creating a distribution certificate');
  const created = await api('POST', '/v1/certificates', {
    data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } },
  });
  certId = created.data.id;
  writeFileSync(certPath, Buffer.from(created.data.attributes.certificateContent, 'base64'));
  writeFileSync(join(credDir, 'dist.cert-id'), certId);
  console.log(`Certificate ${certId}, serial ${created.data.attributes.serialNumber}, expires ${created.data.attributes.expirationDate}`);
}

// 3. p12 for EAS.
const p12Path = join(credDir, 'dist.p12');
const passPath = join(credDir, 'dist.p12.password');
if (!existsSync(passPath)) writeFileSync(passPath, randomBytes(18).toString('base64url'));
const p12Password = readFileSync(passPath, 'utf8').trim();
const certPem = join(credDir, 'dist.pem');
run(['x509', '-inform', 'der', '-in', certPath, '-out', certPem]);
run(['pkcs12', '-export', '-inkey', keyPem, '-in', certPem, '-out', p12Path, '-passout', `pass:${p12Password}`, '-name', 'Nima distribution']);

// 4. App Store profile.
const profiles = await api('GET', `/v1/profiles?filter[name]=${encodeURIComponent(profileName)}&include=certificates`);
for (const p of profiles.data) {
  console.log(`Removing old profile ${p.id} (${p.attributes.profileState})`);
  await api('DELETE', `/v1/profiles/${p.id}`);
}
const profile = await api('POST', '/v1/profiles', {
  data: {
    type: 'profiles',
    attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundle.id } },
      certificates: { data: [{ type: 'certificates', id: certId }] },
    },
  },
});
const profilePath = join(credDir, 'nima.mobileprovision');
writeFileSync(profilePath, Buffer.from(profile.data.attributes.profileContent, 'base64'));
console.log(`Profile ${profile.data.id} ${profile.data.attributes.name} (${profile.data.attributes.profileState}) expires ${profile.data.attributes.expirationDate}`);

// 5. credentials.json for EAS (paths relative to the project root).
writeFileSync(
  join(projectDir, 'credentials.json'),
  `${JSON.stringify(
    {
      ios: {
        provisioningProfilePath: 'credentials/nima.mobileprovision',
        distributionCertificate: { path: 'credentials/dist.p12', password: p12Password },
      },
    },
    null,
    2,
  )}\n`,
);
console.log('Wrote credentials.json');
