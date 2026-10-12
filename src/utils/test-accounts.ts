/**
 * QA and demo accounts sign up with reserved example domains (RFC 2606), so
 * they can be kept out of production analytics without a list to maintain.
 */
const TEST_EMAIL = /@example\.(com|net|org)$/i;

export const isTestAccountEmail = (email?: string | null): boolean =>
  !!email && TEST_EMAIL.test(email.trim());
