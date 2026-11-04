const { z } = require('zod');
const { badRequest } = require('./errors');

const registerSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  email: z.email('email must be a valid email').transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().min(1).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(10),
});

function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest(errors.map((e) => e.message).join('; '), { errors });
  }
  return result.data;
}

const MAX_AMOUNT_MINOR = 100000 * 100;

/**
 * Converts "12.34" or 12.34 into 1234 minor units without float math.
 * Works on the string form because 19.99 * 100 === 1998.9999999999998 in JavaScript.
 */
function parseAmount(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw badRequest('amount is required and must be a number');
  const str = String(raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw badRequest('amount must be a positive number with at most 2 decimals');
  const [whole, frac = ''] = str.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (minor <= 0) throw badRequest('amount must be greater than 0');
  if (minor > MAX_AMOUNT_MINOR) throw badRequest('amount must not exceed 100000');
  return minor;
}

const toMajor = (minor) => (minor / 100).toFixed(2);

module.exports = { registerSchema, loginSchema, paginationSchema, parse, parseAmount, toMajor };
