import { LIMITS } from './limits';
import { normalizeHeadword } from './headword';
import type { LexemeInput } from './types';

export const hasNewline = (value: string) => /[\r\n]/.test(value);

export type ValidationError = {
  field: keyof LexemeInput;
  message: string;
};

export const validateShortText = (
  field: keyof LexemeInput,
  value: string | undefined,
  max: number
): ValidationError | null => {
  if (value == null || value === '') {
    return null;
  }
  if (hasNewline(value)) {
    return { field, message: 'Newlines are not allowed.' };
  }
  if (value.length > max) {
    return {
      field,
      message: `Must be ${max} characters or fewer.`
    };
  }
  return null;
};

export const validateLexemeInput = (input: LexemeInput) => {
  const errors: ValidationError[] = [];
  const rawHeadword = input.headword || '';
  const headword = normalizeHeadword(rawHeadword);
  if (!headword) {
    errors.push({ field: 'headword', message: 'Headword is required.' });
  }
  if (headword.length > LIMITS.headword) {
    errors.push({ field: 'headword', message: `Must be ${LIMITS.headword} characters or fewer.` });
  }
  if (hasNewline(rawHeadword)) {
    errors.push({ field: 'headword', message: 'Newlines are not allowed.' });
  }
  const meaningError = validateShortText('meaning', input.meaning, LIMITS.meaning);
  if (meaningError) errors.push(meaningError);
  const exampleError = validateShortText('example', input.example, LIMITS.example);
  if (exampleError) errors.push(exampleError);
  const noteError = validateShortText('note', input.note, LIMITS.note);
  if (noteError) errors.push(noteError);
  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...input,
      headword
    }
  };
};
