import { Wallet, ethers } from 'ethers';
import crypto from 'crypto';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('wallet');

// USDC contract on Polygon
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// Polygon RPC endpoint
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

export interface StoredWallet {
  address: string;
  encryptedPrivateKey: string;
  iv: string;
  createdAt: Date;
  isActive: boolean;
}

export interface WalletBalance {
  usdc: number;
  matic: number;
}

/**
 * WalletService handles wallet generation, storage, and balance checking.
 * Private keys are encrypted at rest using AES-256-GCM.
 */
export class WalletService {
  private provider: ethers.JsonRpcProvider;
  private encryptionKey: Buffer;
  private currentWallet: Wallet | null = null;
  private storedWallet: StoredWallet | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    
    // Derive encryption key from a secret (in production, use a proper key management system)
    const secret = process.env.WALLET_ENCRYPTION_SECRET || 'poly-trader-wallet-secret-key-v1';
    this.encryptionKey = crypto.scryptSync(secret, 'salt', 32);
  }

  /**
   * Initialize the wallet service, loading existing wallet if present.
   */
  async initialize(existingWallet?: StoredWallet) {
    if (existingWallet) {
      this.storedWallet = existingWallet;
      try {
        const privateKey = this.decryptPrivateKey(
          existingWallet.encryptedPrivateKey,
          existingWallet.iv
        );
        this.currentWallet = new Wallet(privateKey, this.provider);
        logger.info('Wallet loaded', { address: this.currentWallet.address });
      } catch (err) {
        logger.error('Failed to decrypt wallet', { error: (err as Error).message });
      }
    }
  }

  /**
   * Generate a new wallet. Throws if current wallet has a balance.
   */
  async generateNewWallet(force: boolean = false): Promise<StoredWallet> {
    // Check if current wallet has balance
    if (this.currentWallet && !force) {
      const balance = await this.getBalance();
      if (balance.usdc > 0.01 || balance.matic > 0.001) {
        throw new Error(
          `Cannot generate new wallet: current wallet has balance (${balance.usdc.toFixed(2)} USDC, ${balance.matic.toFixed(4)} MATIC). ` +
          'Please withdraw funds first or use force=true to override (not recommended).'
        );
      }
    }

    // Generate new wallet
    const newWallet = Wallet.createRandom();
    const { encryptedKey, iv } = this.encryptPrivateKey(newWallet.privateKey);

    const stored: StoredWallet = {
      address: newWallet.address,
      encryptedPrivateKey: encryptedKey,
      iv,
      createdAt: new Date(),
      isActive: true,
    };

    // Connect to provider
    this.currentWallet = newWallet.connect(this.provider);
    this.storedWallet = stored;

    logger.info('New wallet generated', { address: newWallet.address });

    return stored;
  }

  /**
   * Get wallet address.
   */
  getAddress(): string | null {
    return this.currentWallet?.address || this.storedWallet?.address || null;
  }

  /**
   * Get the decrypted private key (use with caution!).
   */
  getPrivateKey(): string | null {
    if (!this.storedWallet) return null;
    try {
      return this.decryptPrivateKey(
        this.storedWallet.encryptedPrivateKey,
        this.storedWallet.iv
      );
    } catch {
      return null;
    }
  }

  /**
   * Get wallet balance (USDC and MATIC).
   */
  async getBalance(): Promise<WalletBalance> {
    if (!this.currentWallet) {
      return { usdc: 0, matic: 0 };
    }

    try {
      // Get MATIC balance
      const maticBalance = await this.provider.getBalance(this.currentWallet.address);
      const matic = parseFloat(ethers.formatEther(maticBalance));

      // Get USDC balance
      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, this.provider);
      const usdcBalance = await usdcContract.balanceOf(this.currentWallet.address);
      const decimals = await usdcContract.decimals();
      const usdc = parseFloat(ethers.formatUnits(usdcBalance, decimals));

      return { usdc, matic };
    } catch (err) {
      logger.error('Failed to fetch balance', { error: (err as Error).message });
      return { usdc: 0, matic: 0 };
    }
  }

  /**
   * Withdraw USDC to an external address.
   */
  async withdrawUSDC(toAddress: string, amount: number): Promise<string> {
    if (!this.currentWallet) {
      throw new Error('No wallet initialized');
    }

    if (!ethers.isAddress(toAddress)) {
      throw new Error('Invalid destination address');
    }

    try {
      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, this.currentWallet);
      const decimals = await usdcContract.decimals();
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

      logger.info('Initiating USDC withdrawal', {
        to: toAddress,
        amount,
      });

      const tx = await usdcContract.transfer(toAddress, amountWei);
      const receipt = await tx.wait();

      logger.info('Withdrawal complete', {
        txHash: receipt.hash,
        amount,
      });

      return receipt.hash;
    } catch (err) {
      logger.error('Withdrawal failed', { error: (err as Error).message });
      throw err;
    }
  }

  /**
   * Check if wallet can be replaced (no balance).
   */
  async canGenerateNew(): Promise<boolean> {
    if (!this.currentWallet) return true;
    
    const balance = await this.getBalance();
    return balance.usdc < 0.01 && balance.matic < 0.001;
  }

  /**
   * Get stored wallet data for persistence.
   */
  getStoredWallet(): StoredWallet | null {
    return this.storedWallet;
  }

  /**
   * Encrypt private key using AES-256-GCM.
   */
  private encryptPrivateKey(privateKey: string): { encryptedKey: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    const encryptedKey = encrypted + ':' + authTag.toString('hex');
    
    return {
      encryptedKey,
      iv: iv.toString('hex'),
    };
  }

  /**
   * Decrypt private key.
   */
  private decryptPrivateKey(encryptedKey: string, ivHex: string): string {
    const [encrypted, authTagHex] = encryptedKey.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

