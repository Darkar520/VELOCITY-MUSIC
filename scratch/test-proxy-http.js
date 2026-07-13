async function main() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('1. Registering/logging in...');
  const email = `testproxy_${Date.now()}@example.com`;
  const password = 'Password12345!';
  
  // Register
  let res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  console.log('Register status:', res.status);
  
  // Login
  res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  console.log('Login status:', res.status);
  const { token } = await res.json();
  console.log('JWT Token obtained:', token ? 'yes' : 'no');

  // 2. Sign the stream URL
  const artist = 'System Of A Down';
  const title = 'Toxicity';
  const id = 'mUEsqQpact0';
  const quality = 'high';
  
  res = await fetch(`${baseUrl}/api/stream-sign?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}&id=${id}&quality=${quality}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Sign status:', res.status);
  const { exp, sig } = await res.json();
  console.log('Signature:', { exp, sig });

  // 3. Request the stream proxy
  const proxyUrl = `${baseUrl}/api/stream-proxy?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}&id=${id}&quality=${quality}&exp=${exp}&sig=${sig}`;
  console.log('\nRequesting stream proxy:', proxyUrl);
  
  res = await fetch(proxyUrl, {
    headers: { 'Range': 'bytes=0-100' }
  });
  
  console.log('Proxy Response Status:', res.status, res.statusText);
  console.log('Proxy Headers:');
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  
  const text = await res.text();
  console.log('Proxy Response Body (first 300 chars):', text.substring(0, 300));
}

main().catch(console.error);
