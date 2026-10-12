import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnly, assertReadOnly } from '../src/transport/readonly.js';
import { ReadOnlyViolation } from '../src/errors.js';

test('reads are allowed', () => {
  for (const fn of [
    'core_course_get_contents',
    'mod_forum_get_discussion_posts',
    'core_course_check_updates',
    'core_course_search_courses',
    'core_message_message_search_users',
    'core_message_data_for_messagearea_search_messages',
    'mod_board_get_board',
    'gradereport_user_get_grade_items',
    'block_recentlyaccesseditems_get_recent_items',
    'mod_forum_get_discussion_posts_by_userid',
  ]) assert.equal(isReadOnly(fn), true, fn);
});

test('writes, views and credential makers are refused', () => {
  for (const fn of [
    'core_course_view_course',
    'mod_forum_add_discussion_post',
    'core_message_send_instant_messages',
    'core_message_mark_notification_read',
    'mod_assign_submit_for_grading',
    'mod_quiz_start_attempt',
    'core_completion_update_activity_completion_status_manually',
    'tool_mobile_get_autologin_key',
    'tool_mobile_get_tokens_for_qr_login',
    'core_calendar_get_calendar_export_token',
    'mod_lti_get_tool_launch_data',
    'mod_bigbluebuttonbn_get_join_url',
    'mod_quiz_get_attempt_data',
    'tool_mobile_call_external_functions',
    'aiplacement_courseassist_summarise_text',
    'core_get_fragment',
    'mod_wiki_get_page_for_editing',
    'tool_mobile_get_content',
    'core_h5p_get_trusted_h5p_file',
    '',
    'core_course_get_contents; drop',
    undefined,
  ]) assert.equal(isReadOnly(fn), false, String(fn));
});

test('assertReadOnly throws a ReadOnlyViolation naming the function', () => {
  assert.throws(() => assertReadOnly('core_message_send_instant_messages'), (e) => e instanceof ReadOnlyViolation && /core_message_send_instant_messages/.test(e.message));
  assert.doesNotThrow(() => assertReadOnly('core_course_get_contents'));
});
