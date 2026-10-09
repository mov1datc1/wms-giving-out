/**
 * Helper reutilizable para protección de concurrencia y reintentos transaccionales
 * ante colisiones de llaves únicas (Prisma P2002 / Postgres 23505 / duplicate key).
 */
export async function withConcurrencyRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    contextName?: string;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 50;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      return await operation(attempt);
    } catch (err: any) {
      const isUniqueConstraint =
        err?.code === 'P2002' ||
        err?.code === '23505' ||
        (typeof err?.message === 'string' &&
          (err.message.includes('Unique constraint failed') ||
            err.message.includes('duplicate key value violates unique constraint') ||
            err.message.includes('P2002')));

      if (isUniqueConstraint && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 50);
        const delayMs = baseDelayMs * attempt + jitter;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Excedido número máximo de reintentos por concurrencia (${maxRetries}) en ${options.contextName || 'operación'}.`,
  );
}
