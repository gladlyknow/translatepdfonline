/**
 * Google One Tap auto-prompt on load. FedCM-related AbortError console noise is common
 * when prompt runs during hydration/navigation; set to "false" to only use modal OAuth.
 */
export const isGoogleOneTapAutoPromptEnabled =
  process.env.NEXT_PUBLIC_GOOGLE_ONE_TAP_AUTO !== 'false';
