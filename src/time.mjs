/**
 * 时间显示统一走北京时间（Asia/Shanghai）。
 * 数据库与事件流仍然存 UTC ISO 字符串，只有展示层做时区转换。
 */
export const TIME_ZONE = 'Asia/Shanghai';

const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parts(ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const out = {};
  for (const p of FORMATTER.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** HH:mm:ss */
export function fmtTime(ts) {
  const p = parts(ts);
  return p ? `${p.hour}:${p.minute}:${p.second}` : '';
}

/** YYYY-MM-DD HH:mm:ss */
export function fmtDateTime(ts) {
  const p = parts(ts);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` : '';
}

/** YYYY-MM-DD */
export function fmtDate(ts) {
  const p = parts(ts);
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}
