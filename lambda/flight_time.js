/**
 * Giờ bay được lưu theo giờ địa phương của sân bay đi, còn Lambda chạy theo UTC
 */

// Sân bay không có trong bảng được hiểu là giờ Việt Nam
const AIRPORT_TIME_ZONES = {
  KUL: 'Asia/Kuala_Lumpur', SIN: 'Asia/Singapore', BKK: 'Asia/Bangkok', DMK: 'Asia/Bangkok',
  NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', GMP: 'Asia/Seoul',
  TPE: 'Asia/Taipei', HKG: 'Asia/Hong_Kong', CAN: 'Asia/Shanghai', PVG: 'Asia/Shanghai',
  PEK: 'Asia/Shanghai', PKX: 'Asia/Shanghai', CDG: 'Europe/Paris', LHR: 'Europe/London',
  FRA: 'Europe/Berlin', SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne',
  DXB: 'Asia/Dubai', DOH: 'Asia/Qatar'
};
const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

// Độ lệch (ms) của múi giờ so với UTC tại một thời điểm, có tính giờ mùa hè
function zoneOffsetMs(timeZone, utcMs) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs)).forEach(p => { parts[p.type] = Number(p.value); });
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utcMs;
}

/**
 * "YYYY-MM-DD HH:mm" tại sân bay đi -> Date. Chuỗi đã có Z hoặc +07:00 được giữ nguyên nghĩa.
 * Trả về Invalid Date nếu không đọc được.
 */
function parseDepartureTime(value, departureIata) {
  const text = String(value || '').trim();
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!local) {
    return /(Z|[+-]\d{2}:?\d{2})$/.test(text) ? new Date(text) : new Date(NaN);
  }

  const [, year, month, day, hour, minute] = local.map(Number);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const timeZone = AIRPORT_TIME_ZONES[String(departureIata || '').trim().toUpperCase()] || DEFAULT_TIME_ZONE;
  const guess = wallMs - zoneOffsetMs(timeZone, wallMs);
  return new Date(wallMs - zoneOffsetMs(timeZone, guess));
}

module.exports = { parseDepartureTime };
