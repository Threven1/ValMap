// Checks a bug report before it is sent, and again when reports are exported
// (tools/export-bug-reports.js), so only short, plain sentences get through:
// no links, code, HTML, markdown links or images, @mentions or invisible characters.

const BUGCHECK = (() => {
  const MIN = 10;
  const MAX = 255;

  // Letters and numbers in any language, spaces, and simple punctuation only.
  // Left out on purpose: < > [ ] { } ` @ # $ \ | ~ ^ _ & and every control or invisible character.
  const ALLOWED = /^[\p{L}\p{M}\p{N} .,!?'"()\-:;/+%=*]+$/u;
  const LINK = /(?:https?|ftp|file|javascript|data|vbscript|mailto)\s*:|:\/\/|www\s*\.|\b[a-z0-9-]+\s*\.\s*(?:com|net|org|io|ru|xyz|info|biz|gg|me|co|ly|link|click|top|site|online|app|dev|tk|cn|shop|live|to)\b/i;
  const REPEAT = /(.)\1{7,}/u;

  // Returns { text } with the cleaned report, or { error } with a message for the user.
  function check(raw) {
    if (typeof raw !== 'string') return { error: 'Please write a few words.' };
    const text = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const length = [...text].length;
    if (length < MIN) return { error: `Please write a bit more (at least ${MIN} characters).` };
    if (length > MAX) return { error: `Too long: ${MAX} characters at most.` };
    if (LINK.test(text)) return { error: 'Links are not allowed.' };
    if (!ALLOWED.test(text)) return { error: 'Please use only letters, numbers and simple punctuation.' };
    if (REPEAT.test(text)) return { error: 'Too many repeated characters.' };
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < length / 2) return { error: 'That does not look like a sentence.' };
    return { text };
  }

  return { MIN, MAX, check };
})();

if (typeof module !== 'undefined') module.exports = BUGCHECK;
