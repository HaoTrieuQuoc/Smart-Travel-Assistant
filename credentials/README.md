# Thư mục chứa khóa xác thực Google Cloud (Credentials)

Anh hãy tải file JSON Service Account từ Google Cloud Console về, đổi tên thành:
`google-service-account.json`
và thả vào thư mục `credentials/` này.

Định dạng file mẫu sẽ giống như sau:
```json
{
  "type": "service_account",
  "project_id": "smart-travel-assistant-...",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "travel-bot@smart-travel-assistant-....iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

> **Lưu ý quan trọng:** Email `client_email` ở trên chính là địa chỉ email mà anh cần bấm **Share (Chia sẻ) quyền Editor** trong file Google Sheet của anh!

