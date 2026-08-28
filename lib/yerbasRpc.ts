type RpcResponse<T> = { result?: T; error?: { code?: number; message?: string } | null };

export async function yerbasRpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const url = process.env.YERB_RPC_URL;
  const user = process.env.YERB_RPC_USER;
  const password = process.env.YERB_RPC_PASSWORD;
  if (!url || !user || !password) throw new Error('Yerbas RPC is not configured.');

  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'geoweedo', method, params }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Yerbas RPC HTTP ${response.status}`);
  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) throw new Error(payload.error.message || `Yerbas RPC error ${payload.error.code ?? ''}`);
  return payload.result as T;
}

export async function verifyYerbasMessage(address: string, signature: string, message: string) {
  return Boolean(await yerbasRpc<boolean>('verifymessage', [address, signature, message]));
}
