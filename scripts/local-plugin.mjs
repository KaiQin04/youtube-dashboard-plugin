// stdout is exclusively MCP JSON when --stdio is selected. Never print runtime settings.
let runtime;
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error();
  process.umask(0o077);
  const args = process.argv.slice(2), stdio = args.includes('--stdio');
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stdio') continue;
    if (['--data-dir', '--port'].includes(args[i]) && args[i + 1]) { i++; continue; }
    throw new Error();
  }
  const { startLocalWorkspace } = await import('../src/local-workspace.mjs');
  runtime = await startLocalWorkspace({ ...(option('--data-dir') ? { directory: option('--data-dir') } : {}), ...(option('--port') !== undefined ? { port: Number(option('--port')) } : {}) });
  let closing = false;
  async function close() { if (!closing) { closing = true; await runtime.close(); } }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await close(); process.exit(0); });
  if (stdio) {
    async function line(bytes) {
      if (!bytes.toString('utf8').trim()) return;
      let message;
      try { message = JSON.parse(bytes.toString('utf8')); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }) + '\n'); return; }
      let reply;
      try {
        if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string' || Array.isArray(message)) throw new Error();
        reply = await runtime.rpc(message);
      } catch { reply = { jsonrpc: '2.0', id: typeof message?.id === 'string' || typeof message?.id === 'number' ? message.id : null, error: { code: -32600, message: 'Invalid request.' } }; }
      if (reply !== null) process.stdout.write(JSON.stringify(reply) + '\n');
    }
    let buffer = Buffer.alloc(0);
    for await (const chunk of process.stdin) {
      buffer = Buffer.concat([buffer, chunk]);
      let newline;
      while ((newline = buffer.indexOf(10)) >= 0) {
        if (newline > 65536) throw new Error();
        await line(buffer.subarray(0, newline)); buffer = buffer.subarray(newline + 1);
      }
      if (buffer.length > 65536) throw new Error();
    }
    if (buffer.length) await line(buffer);
    await close();
  } else {
    console.log('Local YouTube Dashboard: ' + runtime.url);
    console.log('Enter Google OAuth settings only in your own browser. Press Ctrl+C to stop before starting the Plugin.');
  }
} catch {
  await runtime?.close().catch(() => {});
  console.error('Local plugin startup/request failed. Use Node.js 24+, install the locked dependencies with npm ci --ignore-scripts, and check your local profile and port. No setting values are logged.');
  process.exitCode = 1;
}
