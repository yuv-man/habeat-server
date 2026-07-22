/**
 * Custom class-validator decorators that wrap InputSanitizer.
 *
 * Usage:
 *   @SafeText(200)               – display/storage field (max 200 chars)
 *   @SafeLLMInput(500)           – field forwarded to AI prompt (max 500 chars)
 *   @SafeTextArray(100)          – string[] where each element is display text
 *   @SafeLLMArray(100)           – string[] where each element goes into a prompt
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";
import { Transform } from "class-transformer";
import { InputSanitizer } from "./input-sanitizer";
import { applyDecorators } from "@nestjs/common";
import { IsOptional, IsString, IsArray } from "class-validator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildValidator(
  name: string,
  maxLength: number,
  isLLMInput: boolean,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: {},
      validator: {
        validate(value: any): boolean {
          if (value == null) return true; // let @IsNotEmpty / @IsOptional handle nulls
          if (typeof value !== "string") return false;
          const result = InputSanitizer.sanitise(value, {
            maxLength,
            isLLMInput,
            fieldName: propertyName,
          });
          return !result.blocked;
        },
        defaultMessage(args: ValidationArguments): string {
          const value = args.value;
          if (typeof value === "string") {
            const result = InputSanitizer.sanitise(value, {
              maxLength,
              isLLMInput,
              fieldName: args.property,
            });
            return result.reason ?? `${args.property} contains invalid content`;
          }
          return `${args.property} must be a string`;
        },
      },
    });
  };
}

function buildArrayValidator(
  name: string,
  maxLength: number,
  isLLMInput: boolean,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: {},
      validator: {
        validate(value: any): boolean {
          if (value == null) return true;
          if (!Array.isArray(value)) return false;
          return value.every((item: any) => {
            if (typeof item !== "string") return false;
            const result = InputSanitizer.sanitise(item, {
              maxLength,
              isLLMInput,
              fieldName: propertyName,
            });
            return !result.blocked;
          });
        },
        defaultMessage(args: ValidationArguments): string {
          const arr = args.value;
          if (Array.isArray(arr)) {
            for (let i = 0; i < arr.length; i++) {
              const result = InputSanitizer.sanitise(String(arr[i]), {
                maxLength,
                isLLMInput,
                fieldName: `${args.property}[${i}]`,
              });
              if (result.blocked) return result.reason ?? `${args.property}[${i}] contains invalid content`;
            }
          }
          return `${args.property} contains invalid content`;
        },
      },
    });
  };
}

// ─── Exported decorators ────────────────────────────────────────────────────

/**
 * Validates a display/storage string field.
 * Blocks XSS, HTML injection, and NoSQL operators.
 * Strips residual HTML tags.
 */
export function SafeText(maxLength = 500, validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsString(validationOptions),
    buildValidator("SafeText", maxLength, false) as any,
    Transform(({ value }) => {
      if (typeof value !== "string") return value;
      const result = InputSanitizer.sanitise(value, { maxLength, isLLMInput: false });
      return result.blocked ? value : result.clean; // validator will reject blocked values
    }),
  );
}

/**
 * Validates a string field that is forwarded to an AI/LLM prompt.
 * Adds prompt-injection detection on top of XSS/NoSQL checks.
 */
export function SafeLLMInput(maxLength = 1000, validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsString(validationOptions),
    buildValidator("SafeLLMInput", maxLength, true) as any,
    Transform(({ value }) => {
      if (typeof value !== "string") return value;
      const result = InputSanitizer.sanitise(value, { maxLength, isLLMInput: true });
      return result.blocked ? value : result.clean;
    }),
  );
}

/**
 * Validates a string[] field for display/storage.
 */
export function SafeTextArray(maxLengthPerItem = 200, validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsArray(validationOptions),
    IsString({ each: true }),
    buildArrayValidator("SafeTextArray", maxLengthPerItem, false) as any,
  );
}

/**
 * Validates a string[] field where each element goes into an AI/LLM prompt.
 */
export function SafeLLMArray(maxLengthPerItem = 200, validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsArray(validationOptions),
    IsString({ each: true }),
    buildArrayValidator("SafeLLMArray", maxLengthPerItem, true) as any,
  );
}
