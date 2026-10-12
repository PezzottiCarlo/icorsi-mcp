// Read-only guard: every web service and AJAX call is checked here before it is sent.

import { ReadOnlyViolation } from '../errors.js';

// Moodle names reads <component>_get_..., _search_..., _list_..., _retrieve_..., _data_for_..., _check_updates
const READ = /_(get|search|list|retrieve|data_for)_|_check_updates$/;

// Named like reads, but they create credentials, open sessions or move an attempt forward
const DENY = new Set([
  'tool_mobile_get_autologin_key',
  'tool_mobile_get_tokens_for_qr_login',
  'core_calendar_get_calendar_export_token',
  'mod_lti_get_tool_launch_data',
  'mod_lti_get_tool_proxy_registration_request',
  'mod_bigbluebuttonbn_get_join_url',
  'tiny_premium_get_api_key',
  'core_files_get_unused_draft_itemid',
  'core_get_fragment',
  'mod_quiz_get_attempt_data',
  'mod_quiz_get_attempt_summary',
  'mod_lesson_get_page_data',
  'mod_wiki_get_page_for_editing', // takes the page edit lock
  'tool_mobile_get_content', // runs plugin callbacks with unknown side effects
  'core_h5p_get_trusted_h5p_file', // may deploy the H5P package on the server
]);

export const isReadOnly = (fn) => typeof fn === 'string' && /^[a-z][a-z0-9_]*$/.test(fn) && READ.test(fn) && !DENY.has(fn);

export function assertReadOnly(fn) {
  if (!isReadOnly(fn)) throw new ReadOnlyViolation(`${fn} is not a read-only function: the iCorsi tools only read`);
}
