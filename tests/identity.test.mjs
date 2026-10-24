import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createIdentityVerifier, requirePrincipal } from '../src/auth/identity.mjs';
import { identities } from './helpers.mjs';

test('validated identity scopes access and rejects forged headers or principal objects', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const authenticate = createIdentityVerifier({ issuer: 'https://identity.example', audience: 'https://dashboard.example/mcp', jwks: { keys: [{ ...jwk, kid: 'test-key' }] } });
  const token = await new SignJWT({ scope: 'dashboard:read dashboard:manage' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://identity.example').setAudience('https://dashboard.example/mcp').setSubject('test-user-a').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const principal = await authenticate(new Request('https://dashboard.example/mcp', { headers: { authorization: `Bearer ${token}` } }));
  assert.match(requirePrincipal(principal, 'dashboard:read'), /^[a-f0-9]{64}$/);
  await assert.rejects(authenticate(new Request('https://dashboard.example/mcp', { headers: { 'oai-authenticated-user-id': 'test-user-a' } })), { code: 'UNAUTHORIZED' });
  assert.throws(() => requirePrincipal({ ...principal }, 'dashboard:read'), { code: 'UNAUTHORIZED' });
});

test('wrong issuer, audience, expiry, signature and missing management scope are rejected',async()=>{
  const f=await identities();
  for(const changes of [{issuer:'https://attacker.example'},{audience:'https://another.example/mcp'},{exp:1}]){
    const token=await f.token('user-a','dashboard:read',changes);
    await assert.rejects(f.authenticate(new Request('https://dashboard.example/mcp',{headers:{authorization:`Bearer ${token}`}})),{code:'UNAUTHORIZED'});
  }
  const outsider=await identities();const token=await outsider.token();
  await assert.rejects(f.authenticate(new Request('https://dashboard.example/mcp',{headers:{authorization:`Bearer ${token}`}})),{code:'UNAUTHORIZED'});
  const reader=await f.principal('user-a','dashboard:read');
  assert.throws(()=>requirePrincipal(reader,'dashboard:manage'),{code:'FORBIDDEN'});
});
