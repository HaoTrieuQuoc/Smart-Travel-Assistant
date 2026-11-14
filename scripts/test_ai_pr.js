const { parsePurchaseRequestChat } = require('./ai_ocr_service');

async function testPR() {
  const userMsg = "Em ơi tạo giúp anh một cái PR đi công tác Hà Nội ngày 20/11/2026 này để gặp đối tác Viettel ký hợp đồng, dự trù kinh phí 12 triệu bao gồm vé máy bay và khách sạn nhé.";
  console.log('--- TEST BÓC TÁCH YÊU CẦU TẠO PR TỰ NHIÊN BẰNG AI ---');
  console.log(`User: "${userMsg}"\n`);

  try {
    const result = await parsePurchaseRequestChat(userMsg);
    console.log('✅ KẾT QUẢ AI BÓC TÁCH THÀNH CÔNG:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('❌ Lỗi:', err.message);
  }
}

testPR();
