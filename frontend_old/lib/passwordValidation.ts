/**
 * 密码策略：长度 8–64，至少满足 4 类中的 3 类（大写/小写/数字/符号）。
 */
export function validatePassword(password: string): { valid: boolean; message: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: "passwordMinLength" };
  }
  if (password.length > 64) {
    return { valid: false, message: "passwordMaxLength" };
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const count = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;
  if (count < 3) {
    return { valid: false, message: "passwordComplexity" };
  }
  return { valid: true, message: "" };
}
