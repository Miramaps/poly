const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

// Get auth header from localStorage or env
function getAuthHeader(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('poly_auth');
    if (stored) return stored;
  }
  // Default credentials - must match DASH_USER/DASH_PASS in .env
  return `Basic ${Buffer.from('admin:sexmachine666').toString('base64')}`;
}

export function setAuth(username: string, password: string) {
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  localStorage.setItem('poly_auth', auth);
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized');
    }
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export async function getStatus() {
  return fetchApi<{ success: boolean; data: any }>('/api/status');
}

export async function sendCommand(command: string) {
  return fetchApi<{ success: boolean; message: string; data?: any }>('/api/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

export async function getCycles(limit = 20) {
  return fetchApi<{ success: boolean; data: any[] }>(`/api/cycles?limit=${limit}`);
}

export async function getTrades(limit = 50) {
  return fetchApi<{ success: boolean; data: any[] }>(`/api/trades?limit=${limit}`);
}

export async function getEquity(limit = 1000) {
  return fetchApi<{ success: boolean; data: any[] }>(`/api/equity?limit=${limit}`);
}

export async function getLogs(limit = 100) {
  return fetchApi<{ success: boolean; data: any[] }>(`/api/logs?limit=${limit}`);
}

export async function getConfig() {
  return fetchApi<{ success: boolean; data: any }>('/api/config');
}

// ─── Wallet API ──────────────────────────────────────────────────────────────

export async function getWallet() {
  return fetchApi<{ success: boolean; data: {
    hasWallet: boolean;
    address: string | null;
    balance: { usdc: number; matic: number };
    canGenerateNew: boolean;
  } }>('/api/wallet');
}

export async function getPrivateKey() {
  return fetchApi<{ success: boolean; data: { privateKey: string } }>('/api/wallet/private-key');
}

export async function generateWallet(confirm: boolean, force: boolean = false) {
  return fetchApi<{ 
    success: boolean; 
    data?: { address: string; message: string };
    error?: string;
    requiresConfirmation?: boolean;
    hasBalance?: boolean;
    balance?: { usdc: number; matic: number };
  }>('/api/wallet/generate', {
    method: 'POST',
    body: JSON.stringify({ confirm, force }),
  });
}

export async function withdrawFunds(toAddress: string, amount: number) {
  return fetchApi<{ 
    success: boolean; 
    data?: { txHash: string; amount: number; toAddress: string; message: string };
    error?: string;
  }>('/api/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify({ toAddress, amount }),
  });
}

// ─── Trading Mode API ────────────────────────────────────────────────────────

export async function setTradingMode(mode: 'PAPER' | 'LIVE') {
  return fetchApi<{ 
    success: boolean; 
    data?: { mode: string; message: string };
    error?: string;
  }>('/api/trading-mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

// WebSocket connection
export function createWebSocket(onMessage: (data: any) => void, onError?: (error: Event) => void) {
  const ws = new WebSocket(`${WS_URL}/ws`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (err) {
      console.error('WebSocket parse error:', err);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    onError?.(error);
  };

  ws.onclose = () => {
    console.log('WebSocket closed, reconnecting in 3s...');
    setTimeout(() => {
      createWebSocket(onMessage, onError);
    }, 3000);
  };

  return ws;
}

