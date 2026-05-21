import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin.trim(), ROUNDS);
}

export async function verifyPin(pin: string, pinHash: string | null): Promise<boolean> {
  if (!pinHash) return false;
  return bcrypt.compare(pin.trim(), pinHash);
}

export function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
