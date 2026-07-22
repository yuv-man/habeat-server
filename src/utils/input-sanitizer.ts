/**
 * Centralised input sanitisation for all free-text entry points.
 *
 * Three threat categories are handled:
 *  1. XSS / HTML injection   – <script>, event handlers, javascript: URIs, etc.
 *  2. NoSQL operator injection – MongoDB $ operators in string fields
 *  3. LLM prompt injection   – attempts to override the system prompt or
 *                              extract instructions (applies only to fields
 *                              that are forwarded to Gemini / Llama).
 */

export interface SanitiseOptions {
  /** Maximum allowed length. Inputs exceeding this are rejected. */
  maxLength?: number;
  /**
   * When true, prompt-injection patterns are also checked.
   * Set this for every field that ends up inside an AI prompt.
   */
  isLLMInput?: boolean;
  /** Human-readable field name used in error messages. */
  fieldName?: string;
}

export interface SanitiseResult {
  /** Cleaned string (HTML tags stripped). */
  clean: string;
  /** Whether the input was blocked outright. */
  blocked: boolean;
  /** Human-readable reason when blocked === true. */
  reason?: string;
}

// ─── Pattern banks ──────────────────────────────────────────────────────────

/** HTML / XSS patterns that must never appear in stored or LLM-forwarded text */
const XSS_PATTERNS: RegExp[] = [
  /<script[\s\S]*?>/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /on\w+\s*=/i,               // inline event handlers  onerror=, onclick=, …
  /<iframe[\s\S]*?>/i,
  /<object[\s\S]*?>/i,
  /<embed[\s\S]*?>/i,
  /<link[\s\S]*?>/i,
  /<meta[\s\S]*?>/i,
  /eval\s*\(/i,
  /document\s*\.\s*cookie/i,
  /document\s*\.\s*location/i,
  /window\s*\.\s*location/i,
  /\bexprression\s*\(/i,      // CSS expression()
  /&#x?[0-9a-f]+;/i,          // HTML entity encoding used to bypass filters
];

/** MongoDB operator injection */
const NOSQL_PATTERNS: RegExp[] = [
  /\$(?:where|expr|function|accumulator|reduce|map|filter)\b/i,
  /\$(?:ne|gt|gte|lt|lte|in|nin|or|and|not|nor|exists|type|regex|text|search)\b/i,
  /\$(?:set|unset|inc|mul|rename|min|max|push|pull|addToSet|pop|pullAll)\b/i,
];

/**
 * Patterns that indicate an attempt to hijack the LLM system prompt.
 * These are intentionally strict – false positives are acceptable because
 * legitimate meal / preference inputs do not contain instruction language.
 */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  // Classic override attempts
  /ignore\s+(all\s+)?(?:previous|prior|above|your|the\s+above)\s+instructions?/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|your)\s+instructions?/i,
  /forget\s+(?:everything|all|your|previous|the\s+above)/i,
  /overwrite\s+(?:system|instructions?|rules?|context)/i,
  /override\s+(?:system|instructions?|rules?|directives?|constraints?)/i,

  // Persona / role-play jailbreaks
  /you\s+are\s+now\s+(?:a|an|the)\b/i,
  /act\s+as\s+(?:a|an|the|if\s+you)\b/i,
  /pretend\s+(?:you\s+are|to\s+be)\b/i,
  /roleplay\s+as\b/i,
  /your\s+new\s+(?:persona|role|identity|name)\s+is\b/i,
  /from\s+now\s+on\s+(?:you\s+are|you\s+will|act)/i,

  // Instruction / prompt exfiltration
  /(?:print|repeat|reveal|show|tell\s+me|what\s+are|output)\s+(?:your\s+)?(?:system\s+prompt|instructions?|rules?|directives?|constraints?|context)/i,
  /what\s+(?:were|are)\s+(?:your\s+)?(?:instructions?|rules?|directives?)/i,
  /(?:leak|expose|dump)\s+(?:your\s+)?(?:system\s+prompt|context|instructions?)/i,

  // New task / instruction injection
  /new\s+(?:prompt|task|instruction|role|persona|directive|objective)\s*:/i,
  /(?:user|system|assistant|human|ai)\s*:\s*(?:\[|\{|<)/i,  // role prefix + bracket
  /\[\s*(?:SYSTEM|INST|SYS|INSTRUCTION)\s*\]/i,
  /<\s*\|?\s*(?:system|instruction|s)\s*\|?\s*>/i,
  /#+\s*(?:system|instructions?|context|new\s+task)\s*:/i,

  // Well-known jailbreak strings
  /\bDAN\b.*(?:mode|jailbreak|enabled|activated)/i,
  /jailbreak\s+(?:mode|this|the)/i,
  /do\s+anything\s+now/i,
  /(?:token|word)\s+limit\s+(?:is\s+)?(?:removed|disabled|off|unlimited)/i,
  /no\s+(?:restrictions?|limitations?|rules?|guidelines?)\s+(?:apply|mode)/i,

  // Template / injection characters that could break prompt structure
  /\{\{.{0,200}?\}\}/,          // {{ ... }} handlebars / jinja style
  /\[\[.{0,200}?\]\]/,          // [[ ... ]] template style
  /<\|.{0,50}?\|>/,             // <|...|> token-style separators
];

// ─── Core sanitiser ─────────────────────────────────────────────────────────

export class InputSanitizer {
  /**
   * Validate and sanitise a single string value.
   *
   * Returns a SanitiseResult; call `.blocked` to decide whether to throw.
   */
  static sanitise(value: string, options: SanitiseOptions = {}): SanitiseResult {
    if (value == null || typeof value !== "string") {
      return { clean: value ?? "", blocked: false };
    }

    const { maxLength = 2000, isLLMInput = false, fieldName = "Input" } = options;

    // 1. Length
    if (value.length > maxLength) {
      return {
        clean: value,
        blocked: true,
        reason: `${fieldName} exceeds maximum length of ${maxLength} characters`,
      };
    }

    // 2. NoSQL operator injection
    for (const pattern of NOSQL_PATTERNS) {
      if (pattern.test(value)) {
        return {
          clean: value,
          blocked: true,
          reason: `${fieldName} contains disallowed database operators`,
        };
      }
    }

    // 3. XSS / HTML injection
    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(value)) {
        return {
          clean: value,
          blocked: true,
          reason: `${fieldName} contains disallowed HTML or script content`,
        };
      }
    }

    // 4. Prompt injection (LLM-bound fields only)
    if (isLLMInput) {
      for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          return {
            clean: value,
            blocked: true,
            reason: `${fieldName} contains disallowed instruction content`,
          };
        }
      }
    }

    // 5. Strip residual HTML tags (defence-in-depth; should already be blocked above)
    const clean = value.replace(/<[^>]*>/g, "").trim();

    return { clean, blocked: false };
  }

  /**
   * Sanitise and throw a BadRequestException-compatible Error if blocked.
   * Returns the cleaned string on success.
   */
  static validate(value: string, options: SanitiseOptions = {}): string {
    const result = this.sanitise(value, options);
    if (result.blocked) {
      throw new Error(result.reason ?? "Invalid input");
    }
    return result.clean;
  }

  /**
   * Validate each element of a string array.
   * Throws on first blocked element.
   */
  static validateArray(values: string[], options: SanitiseOptions = {}): string[] {
    return values.map((v, i) =>
      this.validate(v, { ...options, fieldName: `${options.fieldName ?? "Item"}[${i}]` })
    );
  }
}
