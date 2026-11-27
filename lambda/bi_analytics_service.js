/**
 * Channel-Based RBAC & Deterministic AI Travel BI Analytics Engine
 * Separates ADMIN_HR (#biz-admin-alerts) and EMPLOYEE (#travel-booking) permissions
 * and executes zero-hallucination aggregations over DynamoDB TravelBookings data.
 */

const { parseDepartureTime } = require('./flight_time');

const ROLES = {
  ADMIN_HR: 'ADMIN_HR',
  EMPLOYEE: 'EMPLOYEE',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Resolve channel role based on configured Slack Channel IDs
 */
function getChannelRole(channelId) {
  const adminChannelId = (process.env.SLACK_ADMIN_CHANNEL_ID || 'C0CGLFPNW7R').trim();
  const employeeChannelId = (process.env.SLACK_EMPLOYEE_CHANNEL_ID || 'C0CH1CC22FL').trim();

  if (!channelId) return ROLES.UNKNOWN;
  if (channelId === adminChannelId) return ROLES.ADMIN_HR;
  if (channelId === employeeChannelId) return ROLES.EMPLOYEE;
  return ROLES.UNKNOWN;
}

/**
 * Standard out-of-authority response for EMPLOYEE channel
 */
function buildUnauthorizedMessage(contextType = 'general') {
  if (contextType === 'slash_command') {
    return 'Yêu cầu này không nằm trong thẩm quyền xử lý tại kênh nhân viên. Lệnh quản trị /travel-admin chỉ được cấp quyền cho bộ phận HR tại kênh #biz-admin-alerts. Tại kênh này, bạn vui lòng tải ảnh vé máy bay để hệ thống hỗ trợ tự động.';
  }
  if (contextType === 'edit_saved_trip') {
    return 'Yêu cầu chỉnh sửa chuyến công tác đã lưu không nằm trong thẩm quyền tại kênh nhân viên. Vui lòng liên hệ bộ phận HR tại kênh quản trị #biz-admin-alerts để điều chỉnh dữ liệu đã chốt.';
  }
  return 'Yêu cầu này không nằm trong thẩm quyền xử lý tại kênh nhân viên. Kênh #travel-booking chỉ hỗ trợ tải ảnh vé máy bay và điền/chỉnh sửa thông tin vé công tác. Mọi yêu cầu thống kê, quản trị hoặc truy vấn AI chuyên sâu chỉ được thực hiện tại kênh quản trị HR (#biz-admin-alerts).';
}

/**
 * Parse numeric VND price safely (returns null if missing/Chưa rõ/0)
 */
function parsePriceVnd(rawPrice) {
  if (rawPrice === null || rawPrice === undefined) return null;
  const str = String(rawPrice).trim();
  if (!str || str.toLowerCase() === 'chưa rõ' || str.toLowerCase() === 'null' || str.toLowerCase() === 'n/a') {
    return null;
  }
  const digits = str.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Filter out non-trip system records (DRAFT#, EVENT#, PR-) and CANCELLED bookings
 */
function filterConfirmedTrips(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => {
    const id = String(item?.trip_id || '');
    if (!id) return false;
    if (id.startsWith('DRAFT#') || id.startsWith('EVENT#') || id.startsWith('PR-')) return false;
    if (item?.record_type === 'PURCHASE_REQUEST') return false;
    if (String(item?.status || '').toUpperCase() === 'CANCELLED') return false;
    return true;
  });
}

/**
 * Normalize string for accent-insensitive / case-insensitive substring matching
 */
function normalizeSearchText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Deterministic Analytics Execution Engine
 * Computes exact metrics & groupings in pure JS so LLM never hallucinates numbers.
 */
function executeBIQuery(rawItems, plan = {}, nowDate = new Date()) {
  const confirmedTrips = filterConfirmedTrips(rawItems);
  const filters = plan.filters || {};
  const queryType = plan.query_type || 'GENERAL_STATS';
  const limit = Math.min(Math.max(Number(plan.limit) || 10, 1), 25);

  let filtered = confirmedTrips.filter(trip => {
    // Month filter (YYYY-MM) against departure_time or created_at
    if (filters.month) {
      const targetMonth = String(filters.month).trim();
      const depTime = String(trip.departure_time || '');
      const createdAt = String(trip.created_at || '');
      if (!depTime.startsWith(targetMonth) && !createdAt.startsWith(targetMonth)) {
        return false;
      }
    }

    // Department filter
    if (filters.department) {
      const targetDept = normalizeSearchText(filters.department);
      const tripDept = normalizeSearchText(trip.department || '');
      if (!tripDept.includes(targetDept)) return false;
    }

    // Destination filter (city or IATA)
    if (filters.destination) {
      const targetDest = normalizeSearchText(filters.destination);
      const arrCity = normalizeSearchText(trip.arrival_city || '');
      const arrIata = normalizeSearchText(trip.arrival_iata || '');
      if (!arrCity.includes(targetDest) && !arrIata.includes(targetDest)) return false;
    }

    // Airline filter
    if (filters.airline) {
      const targetAirline = normalizeSearchText(filters.airline);
      const tripAirline = normalizeSearchText(trip.airline || '');
      if (!tripAirline.includes(targetAirline)) return false;
    }

    // Passenger filter
    if (filters.passenger_name) {
      const targetName = normalizeSearchText(filters.passenger_name);
      const tripName = normalizeSearchText(trip.passenger_name || '');
      const tripUser = normalizeSearchText(trip.slack_username || '');
      if (!tripName.includes(targetName) && !tripUser.includes(targetName)) return false;
    }

    // Ticket class filter
    if (filters.ticket_class) {
      const targetClass = normalizeSearchText(filters.ticket_class);
      const tripClass = normalizeSearchText(trip.ticket_class || '');
      if (!tripClass.includes(targetClass)) return false;
    }

    // Missing price only filter
    if (filters.missing_price_only || queryType === 'MISSING_PRICE_AUDIT') {
      if (parsePriceVnd(trip.ticket_price) !== null) return false;
    }

    // Upcoming days filter
    if (filters.upcoming_days || queryType === 'UPCOMING_FLIGHTS') {
      const days = Number(filters.upcoming_days) || 14;
      const depStr = String(trip.departure_time || '').trim();
      if (!depStr) return false;
      const depDate = parseDepartureTime(depStr, trip.departure_iata);
      if (isNaN(depDate.getTime())) return false;
      const diffMs = depDate.getTime() - nowDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays < 0 || diffDays > days) return false;
    }

    return true;
  });

  // Sort upcoming flights chronologically, otherwise newest/highest cost first
  if (queryType === 'UPCOMING_FLIGHTS' || filters.upcoming_days) {
    filtered.sort((a, b) => String(a.departure_time || '').localeCompare(String(b.departure_time || '')));
  } else {
    filtered.sort((a, b) => String(b.departure_time || b.created_at || '').localeCompare(String(a.departure_time || a.created_at || '')));
  }

  let totalCostVnd = 0;
  let pricedTrips = 0;
  let missingPriceTrips = 0;
  let maxCostTrip = null;
  const businessClassTrips = [];

  for (const trip of filtered) {
    const price = parsePriceVnd(trip.ticket_price);
    if (price !== null) {
      totalCostVnd += price;
      pricedTrips++;
      if (!maxCostTrip || price > maxCostTrip.price) {
        maxCostTrip = {
          trip_id: trip.trip_id,
          passenger_name: trip.passenger_name || 'N/A',
          route: `${trip.departure_iata || 'N/A'} -> ${trip.arrival_iata || 'N/A'}`,
          price
        };
      }
    } else {
      missingPriceTrips++;
    }

    if (normalizeSearchText(trip.ticket_class || '').includes('business')) {
      businessClassTrips.push(trip.trip_id);
    }
  }

  const avgCostVnd = pricedTrips > 0 ? Math.round(totalCostVnd / pricedTrips) : 0;

  // Grouping logic
  let groupField = null;
  if (queryType === 'GROUP_BY_DEPARTMENT') groupField = 'department';
  else if (queryType === 'GROUP_BY_AIRLINE') groupField = 'airline';
  else if (queryType === 'GROUP_BY_DESTINATION') groupField = 'arrival_city';
  else if (plan.group_by && ['department', 'airline', 'arrival_city', 'month'].includes(plan.group_by)) {
    groupField = plan.group_by;
  }

  const breakdown = [];
  if (groupField) {
    const groups = new Map();
    for (const trip of filtered) {
      let key;
      if (groupField === 'month') {
        key = String(trip.departure_time || trip.created_at || 'Không rõ').slice(0, 7);
      } else {
        key = trip[groupField] || 'Chưa phân loại';
      }
      if (!groups.has(key)) {
        groups.set(key, { key, trip_count: 0, total_cost_vnd: 0, missing_price_count: 0 });
      }
      const g = groups.get(key);
      g.trip_count++;
      const price = parsePriceVnd(trip.ticket_price);
      if (price !== null) {
        g.total_cost_vnd += price;
      } else {
        g.missing_price_count++;
      }
    }
    breakdown.push(
      ...Array.from(groups.values()).sort((a, b) => b.total_cost_vnd - a.total_cost_vnd || b.trip_count - a.trip_count)
    );
  }

  // Detect data & cost anomalies
  const anomalies = [];
  if (missingPriceTrips > 0) {
    anomalies.push(`Có ${missingPriceTrips}/${filtered.length} chuyến bay chưa có giá vé ("Chưa rõ") cần kế toán đối soát.`);
  }
  if (businessClassTrips.length > 0) {
    anomalies.push(`Phát hiện ${businessClassTrips.length} chuyến bay hạng Business (${businessClassTrips.slice(0, 3).join(', ')}).`);
  }
  if (avgCostVnd > 0 && maxCostTrip && maxCostTrip.price > avgCostVnd * 1.5 && pricedTrips >= 3) {
    anomalies.push(`Chuyến ${maxCostTrip.trip_id} (${maxCostTrip.passenger_name}) có giá ${maxCostTrip.price.toLocaleString('vi-VN')} VND, cao hơn 50% mức trung bình.`);
  }

  const matchedTrips = filtered.slice(0, limit).map(t => ({
    trip_id: t.trip_id,
    passenger_name: t.passenger_name || 'N/A',
    department: t.department || 'Nhân sự / Quản lý',
    airline: t.airline || 'N/A',
    flight_number: t.flight_number || 'N/A',
    route: `${t.departure_city || t.departure_iata || 'N/A'} (${t.departure_iata || '?'}) ➔ ${t.arrival_city || t.arrival_iata || 'N/A'} (${t.arrival_iata || '?'})`,
    departure_time: t.departure_time || 'N/A',
    ticket_class: t.ticket_class || 'Economy',
    ticket_price: parsePriceVnd(t.ticket_price) !== null ? `${parsePriceVnd(t.ticket_price).toLocaleString('vi-VN')} VND` : 'Chưa rõ'
  }));

  return {
    query_type: queryType,
    total_records_in_db: confirmedTrips.length,
    matched_count: filtered.length,
    priced_trips: pricedTrips,
    missing_price_trips: missingPriceTrips,
    total_cost_vnd: totalCostVnd,
    avg_cost_vnd: avgCostVnd,
    max_cost_trip: maxCostTrip,
    group_by: groupField,
    breakdown,
    anomalies,
    matched_trips: matchedTrips
  };
}

/**
 * Render clean Slack Block Kit BI Executive Report Card (Anti-AI Persona compliant)
 */
function buildBIReportCard(channelId, threadTs, userQuestion, stats, executiveSummary = '') {
  const totalCostFmt = stats.total_cost_vnd > 0
    ? `${stats.total_cost_vnd.toLocaleString('vi-VN')} VND`
    : '0 VND (chưa có dữ liệu giá)';
  const avgCostFmt = stats.avg_cost_vnd > 0
    ? `${stats.avg_cost_vnd.toLocaleString('vi-VN')} VND`
    : 'Chưa rõ';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'BÁO CÁO PHÂN TÍCH CÔNG TÁC (AI TRAVEL BI)', emoji: false }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Truy vấn quản trị:* _"${userQuestion}"_` }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Số chuyến khớp điều kiện:*\n${stats.matched_count} / ${stats.total_records_in_db} chuyến` },
        { type: 'mrkdwn', text: `*Tổng chi phí đã ghi nhận:*\n${totalCostFmt}` },
        { type: 'mrkdwn', text: `*Chi phí trung bình / vé:*\n${avgCostFmt}` },
        { type: 'mrkdwn', text: `*Vé chưa rõ giá (Cần đối soát):*\n${stats.missing_price_trips} chuyến` }
      ]
    }
  ];

  if (stats.breakdown && stats.breakdown.length > 0) {
    const groupLabelMap = {
      department: 'PHÂN BỔ THEO PHÒNG BAN',
      airline: 'PHÂN BỔ THEO HÃNG HÀNG KHÔNG',
      arrival_city: 'PHÂN BỔ THEO ĐIỂM ĐẾN',
      month: 'PHÂN BỔ THEO THÁNG'
    };
    const breakdownLines = stats.breakdown.slice(0, 8).map((g, idx) => {
      const costStr = g.total_cost_vnd > 0 ? `${g.total_cost_vnd.toLocaleString('vi-VN')} VND` : 'Chưa rõ giá';
      const missingNote = g.missing_price_count > 0 ? ` (${g.missing_price_count} vé thiếu giá)` : '';
      return `${idx + 1}. *${g.key}:* ${g.trip_count} chuyến | ${costStr}${missingNote}`;
    }).join('\n');

    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${groupLabelMap[stats.group_by] || 'CHI TIẾT PHÂN NHÓM'}*\n${breakdownLines}`
        }
      }
    );
  }

  if (stats.matched_trips && stats.matched_trips.length > 0) {
    const tripLines = stats.matched_trips.slice(0, 6).map(t =>
      `• \`${t.trip_id}\` | *${t.passenger_name}* (${t.department}) | ${t.flight_number} ${t.route} | ${t.departure_time} | ${t.ticket_price}`
    ).join('\n');

    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*DANH SÁCH CHUYẾN BAY TIÊU BIỂU (Tối đa 6 dòng)*\n${tripLines}`
        }
      }
    );
  }

  if (stats.anomalies && stats.anomalies.length > 0) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*CẢNH BÁO ĐỐI SOÁT & BẤT THƯỜNG*\n${stats.anomalies.map(a => `• ${a}`).join('\n')}`
        }
      }
    );
  }

  if (executiveSummary) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*NHẬN ĐỊNH TỔNG HỢP (AI EXECUTIVE INSIGHT)*\n${executiveSummary}`
        }
      }
    );
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '_Dữ liệu được tổng hợp trực tiếp từ Amazon DynamoDB (TravelBookings) với quyền ADMIN_HR._'
      }
    ]
  });

  return {
    channel: channelId,
    thread_ts: threadTs,
    blocks
  };
}

/**
 * Fast heuristic check to detect if an admin message is a BI/analytics query
 */
function isLikelyBIQuery(text) {
  if (!text) return false;
  return /(tổng|chi phí|thống kê|báo cáo|bao nhiêu|phòng nào|phòng ban|hãng nào|liệt kê|danh sách|ai bay|ai sắp bay|sắp bay|chưa có giá|thiếu giá|đối soát|ngân sách|trung bình|top|nhiều nhất|ít nhất|cost|report|summary|analytics|audit|upcoming|list)/i.test(text);
}

module.exports = {
  ROLES,
  getChannelRole,
  buildUnauthorizedMessage,
  parsePriceVnd,
  filterConfirmedTrips,
  executeBIQuery,
  buildBIReportCard,
  isLikelyBIQuery
};
