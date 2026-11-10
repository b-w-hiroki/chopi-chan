// Metadata checks only: never infer medical validity from dates or source labels.
(function (root) {
  'use strict';
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function assess(entry, today = new Date().toLocaleDateString('sv-SE')) {
    const issues = [];
    const checked = entry.verifiedDate;
    if (!validDate(checked)) issues.push('内容確認日が未記録または不正');
    else if (checked > today) issues.push('内容確認日が未来のため要再確認');
    if (entry.reviewAfter && !validDate(entry.reviewAfter)) issues.push('次回確認期限が不正');
    else if (entry.reviewAfter && entry.reviewAfter < today) issues.push('次回確認期限を超過：要再確認');
    const policy = entry.category === '手続き・制度';
    if (policy && !entry.policyYear) issues.push('適用年度・地域が未確認');
    const summary = '内容確認（登録値）: ' + (validDate(checked) ? checked : '未確認')
      + (policy ? ' ／ 適用年度・地域: ' + (entry.policyYear || '未確認') : '')
      + ' ／ 次回確認: ' + (validDate(entry.reviewAfter) ? entry.reviewAfter : '未設定');
    return { issues, summary };
  }
  root.ChopiFreshness = { validDate, assess };
})(globalThis);
