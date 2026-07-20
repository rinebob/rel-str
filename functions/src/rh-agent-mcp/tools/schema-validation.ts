import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

export interface ValidationResult {
  valid: true;
  args: Record<string, unknown>;
}

export interface ValidationFailure {
  valid: false;
  error: string;
}

export type ValidateToolArgsResult = ValidationResult | ValidationFailure;

const ajv = new Ajv({
  coerceTypes: true,
  removeAdditional: true,
  useDefaults: true,
  strict: false,
  allErrors: true,
});
addFormats(ajv, ['date', 'date-time']);

const validatorCache = new WeakMap<Record<string, unknown>, ValidateFunction>();

export function validateToolArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): ValidateToolArgsResult {
  if (schema.type !== 'object' && !Array.isArray(schema.type)) {
    return { valid: false, error: 'Schema root type is not object' };
  }

  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }

  const coerced = structuredClone(args);
  const valid = validate(coerced);

  if (!valid) {
    const message = validate.errors
      ?.map((err) => {
        const path = err.instancePath || (err.params?.missingProperty as string) || '';
        return `${path}: ${err.message}`;
      })
      .join('; ');
    return { valid: false, error: message || 'Invalid arguments' };
  }

  return { valid: true, args: coerced };
}
