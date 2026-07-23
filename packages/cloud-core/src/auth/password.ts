const ARGON2_OPTIONS = {
  algorithm: "argon2id",
  memoryCost: 19_456,
  timeCost: 2,
} as const;

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(input: {
  hash: string;
  password: string;
}): Promise<boolean> {
  return Bun.password.verify(input.password, input.hash);
}
