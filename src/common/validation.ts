import Ajv, { ErrorObject } from 'ajv';
import { JSONSchemaType } from 'ajv';

const GENERAL_VALIDATION_ERROR = 'invalid content';

const ajv = new Ajv({ allErrors: true });

export interface ValidationResponse<T> {
  isValid: boolean;
  errors?: string | ErrorObject<string, Record<string, unknown>>[];
  content?: T;
}

export function validate<T>(content: unknown, schema: JSONSchemaType<T>): ValidationResponse<T> {
  const isValid = ajv.validate(schema, content);

  if (!isValid) {
    const errors = ajv.errors === undefined || ajv.errors === null ? GENERAL_VALIDATION_ERROR : ajv.errors;
    return { isValid, errors };
  }

  return { isValid, content };
}
